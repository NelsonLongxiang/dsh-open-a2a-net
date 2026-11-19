/**
 * #650 (superagent-root-team R8 「组成 root 团队」): with two or more team frames selected, 建队 (G) composes a root
 * team from them instead of a session team. Every check that can be made before a write is made first
 * ({@link canCompose}); the writes then run strictly in order through the owner's existing routes — a surely new
 * canvas team (create requireNew) → set-root → the router as its member → the superagent team binding → add-team for
 * each child — and each step's effect is read back before the next one runs ({@link composeRoot}). A refusal, a timeout
 * or an answer whose effect cannot be seen stops the chain: the confirmed steps stay as they are (nothing is deleted
 * and nothing is replayed), and the reason is written on the dialog and on the frame it concerns.
 * Text goes in via textContent only. planning-view only hooks this in (module cap).
 * @module nexus-stage/planning-root-compose
 */
import { dropRefusal } from './planning-root'
import type { PlanningInput, PlanningSession, PlanningTeam } from './planning-types'

/** The router preset a superagent team's router runs (src/superagent/host/role-tools.ts ROUTER_PRESET). */
export const ROUTER_PRESET = 'superagent-router'

/** One HTTP answer: the status and the parsed body (undefined when it was no JSON). A network failure throws. */
export interface ComposeReply { readonly status: number; readonly body: unknown }
/** The owner routes the composer writes and reads through (main.ts: controlFetch). */
export interface ComposeIo {
  /** POST `path` with the JSON body, or GET it when `body` is undefined. */
  call(path: string, body?: unknown): Promise<ComposeReply>
}

/** What the board knows of one team frame, from the state (local) or a peer's published org (mirror). */
export interface ComposeFrame {
  readonly name: string
  /** `<zone>/canvas/<name>@<fp8>` from the state — never derived from the frame name. */
  readonly ref?: string
  readonly superagentTeam?: boolean
  readonly root?: boolean
  readonly roster?: boolean
  /** The owning peer of a mirror frame, and whether its card was missed on the last read. */
  readonly peer?: string
  readonly unreachable?: boolean
}

type Facts = Pick<PlanningInput, 'teams' | 'peerOrg' | 'sessions'>

/** The frame facts for a frame name: this host's team wins over a peer's team of the same name (as the board draws it). */
export function frameFacts(name: string, facts: Facts): ComposeFrame | undefined {
  const local = facts.teams.find(t => t.name === name)
  if (local !== undefined) return { name, ...(local.id !== undefined ? { ref: local.id } : {}), ...(local.superagentTeam === true ? { superagentTeam: true } : {}), ...(local.root === true ? { root: true } : {}), ...(local.kind === 'roster' ? { roster: true } : {}) }
  for (const row of facts.peerOrg ?? []) {
    const org = row.org.find(t => t.name === name)
    if (org !== undefined) return { name, peer: row.url, ...(org.id !== undefined && org.id !== '' ? { ref: org.id } : {}), ...(org.superagentTeam === true ? { superagentTeam: true } : {}), ...(org.root === true ? { root: true } : {}), ...(row.unreachable === true ? { unreachable: true } : {}) }
  }
  return undefined
}

export type ComposeCheck =
  | { readonly ok: true; readonly children: ReadonlyArray<{ readonly frame: string; readonly ref: string }> }
  | { readonly ok: false; readonly frame?: string; readonly reason: string }

/**
 * Whether the selected frames can become one root's children, before any write: at least two, each a superagent team
 * taking requests (not a roster, not a root, not already a child of a root here), on a reachable host, with its own
 * canvas address, and no two the same team. The first problem is the answer, with the frame it concerns.
 */
export function canCompose(selected: readonly string[], facts: Facts): ComposeCheck {
  if (selected.length < 2) return { ok: false, reason: '组成 root 团队需要先选中至少 2 个团队框（Shift 点击框头加选）' }
  const children: Array<{ frame: string; ref: string }> = []
  const roots = facts.teams.filter(t => t.root === true)
  for (const name of selected) {
    const frame = frameFacts(name, facts)
    if (frame === undefined) return { ok: false, frame: name, reason: `「${name}」已不在画布上：刷新后重选` }
    if (frame.root === true) return { ok: false, frame: name, reason: `「${name}」已是 root 团队（root 只有一层）：取消选中它` }
    if (frame.roster === true || frame.superagentTeam !== true) return { ok: false, frame: name, reason: `「${name}」不是接单的 superagent 团队：先在团队页绑定它并打开 A2A 来源，或取消选中它` }
    if (frame.unreachable === true) return { ok: false, frame: name, reason: `「${name}」所在主机暂不可达：等它恢复后再组成` }
    if (frame.ref === undefined) return { ok: false, frame: name, reason: `「${name}」没有画布地址（对端版本较旧）：升级对端后再选` }
    const owner = roots.find(root => root.children?.some(child => child.ref === frame.ref) === true)
    if (owner !== undefined) return { ok: false, frame: name, reason: `「${name}」已是 root「${owner.name}」的子团队：先从那里移出` }
    const twin = children.find(child => child.ref === frame.ref)
    if (twin !== undefined) return { ok: false, frame: name, reason: `「${name}」与「${twin.frame}」是同一个团队：只留一个` }
    children.push({ frame: name, ref: frame.ref })
  }
  return { ok: true, children }
}

/**
 * The local sessions the router picker offers: what the team binding (saveSettings) would accept — a live, joined
 * session of this host, running the router preset (or none reported), that sits in no canvas team yet (one session,
 * one team role). The server still has the last word.
 */
export function routerCandidates(sessions: ReadonlyArray<PlanningSession>, teams: ReadonlyArray<PlanningTeam>): PlanningSession[] {
  const seated = new Set(teams.flatMap(t => t.members.map(m => m.id)))
  return sessions.filter(s => s.joined && s.live !== false && !s.id.startsWith('peer-') && !s.id.startsWith('member-') && (s.preset === undefined || s.preset === ROUTER_PRESET) && !seated.has(s.id) && (s.teams?.length ?? 0) === 0)
}

export type StepName = 'create' | 'set-root' | 'add-router' | 'register' | 'add-team'
export interface StepRecord { readonly step: StepName; readonly frame: string; readonly label: string }
export type ComposeResult =
  | { readonly ok: true; readonly done: readonly StepRecord[] }
  | { readonly ok: false; readonly done: readonly StepRecord[]; readonly failed: StepRecord & { readonly kind: 'refused' | 'unknown'; readonly reason: string } }

export interface ComposeDeps {
  readonly io: ComposeIo
  /** How long one call may take before its outcome counts as unknown (default 15 s). */
  readonly timeoutMs?: number
  /** Each confirmed step, as it is confirmed (the dialog's progress list). */
  readonly onStep?: (step: StepRecord) => void
}

const CANVAS = '/__dsh_a2a/canvas'
const TEAMS = '/__dsh_a2a/superagent/teams'
const obj = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

type Outcome = { kind: 'ok'; body: Record<string, unknown> } | { kind: 'refused' | 'unknown'; reason: string }

/** One call, classified: a JSON `ok:true` answer, a refusal in the server's words, or an outcome nobody can know. */
async function attempt(io: ComposeIo, timeoutMs: number, path: string, body?: unknown): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs) })
  try {
    const reply = await Promise.race([io.call(path, body), timeout])
    if (reply === 'timeout') return { kind: 'unknown', reason: `等了 ${String(Math.round(timeoutMs / 1000))} 秒没有回音，不知道是否已生效` }
    const answer = obj(reply.body)
    if (answer === undefined) return { kind: 'unknown', reason: `回复不是可读的 JSON（HTTP ${String(reply.status)}），不知道是否已生效` }
    // A read (no body) answers its rows without an ok flag; a write must say ok.
    if (body !== undefined && answer.ok !== true) return { kind: 'refused', reason: typeof answer.error === 'string' && answer.error !== '' ? answer.error : `被拒绝（HTTP ${String(reply.status)}）` }
    return { kind: 'ok', body: answer }
  } catch (error) {
    return { kind: 'unknown', reason: `连接中断（${String((error as Error | undefined)?.message ?? error).slice(0, 80)}），不知道是否已生效` }
  } finally { clearTimeout(timer) }
}

/**
 * Compose the root, in order, each step confirmed by what the server reads back. The first refusal, timeout or
 * unconfirmed answer stops it; the steps already confirmed are reported and left as they are.
 */
export async function composeRoot(d: ComposeDeps, plan: { readonly name: string; readonly router: string; readonly children: ReadonlyArray<{ readonly frame: string; readonly ref: string }> }): Promise<ComposeResult> {
  const timeoutMs = d.timeoutMs ?? 15_000
  const done: StepRecord[] = []
  let name = plan.name
  const run = async (record: Omit<StepRecord, 'frame'> & { frame?: string }, path: string, body: unknown, effect: (answer: Record<string, unknown>) => Promise<boolean> | boolean): Promise<ComposeResult | undefined> => {
    const step: StepRecord = { step: record.step, label: record.label, frame: record.frame ?? name }
    const out = await attempt(d.io, timeoutMs, path, body)
    if (out.kind !== 'ok') return { ok: false, done, failed: { ...step, kind: out.kind, reason: out.reason } }
    if (!(await effect(out.body))) return { ok: false, done, failed: { ...step, kind: 'unknown', reason: '服务端答应了，但回读看不到效果：刷新后核对再决定' } }
    done.push(step)
    d.onStep?.(step)
    return undefined
  }
  const stopped = await run({ step: 'create', label: `新建画布团队「${plan.name}」` }, CANVAS, { action: 'create', name: plan.name, requireNew: true }, (a) => {
    if (a.created !== true || typeof a.name !== 'string') return false
    name = a.name
    return strings(a.teams).includes(name)
  })
    ?? await run({ step: 'set-root', label: '设为 root 团队' }, CANVAS, { action: 'set-root', name, root: true }, a => strings(a.roots).includes(name))
    ?? await run({ step: 'add-router', label: '把总工加入 root 团队' }, CANVAS, { action: 'add-member', name, id: plan.router }, a => strings(a.members).includes(plan.router))
    ?? await run({ step: 'register', label: '登记为 superagent 团队' }, TEAMS, { canvas: name, router: plan.router }, async (a) => {
      if (typeof a.id !== 'string') return false
      const back = await attempt(d.io, timeoutMs, TEAMS)
      const rows = back.kind === 'ok' && Array.isArray(back.body.teams) ? back.body.teams.map(obj) : []
      return rows.some(row => row !== undefined && row.id === a.id && row.canvas === name && row.router === plan.router)
    })
  if (stopped !== undefined) return stopped
  for (const child of plan.children) {
    const out = await run({ step: 'add-team', label: `加入子团队「${child.frame}」`, frame: child.frame }, CANVAS, { action: 'add-team', name, team: child.ref }, a => Array.isArray(a.children) && a.children.some(c => obj(c)?.ref === child.ref))
    if (out !== undefined) return out
  }
  return { ok: true, done }
}

/** Add one frame's team to a root (the keyboard twin of dropping it on the root), confirmed by the root's children. */
export async function joinRoot(d: ComposeDeps, root: string, ref: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const out = await attempt(d.io, d.timeoutMs ?? 15_000, CANVAS, { action: 'add-team', name: root, team: ref })
  if (out.kind !== 'ok') return { ok: false, reason: out.reason }
  return Array.isArray(out.body.children) && out.body.children.some(c => obj(c)?.ref === ref) ? { ok: true } : { ok: false, reason: '服务端答应了，但回读看不到效果：刷新后核对' }
}

export interface RootComposeDeps {
  readonly root: HTMLElement
  readonly signal: AddEventListenerOptions
  readonly io?: ComposeIo
  readonly timeoutMs?: number
  /** The board's frame elements, for the reasons written on a frame. */
  frames(): ReadonlyMap<string, HTMLElement>
  notice(kind: 'error' | 'info', text: string): void
  /** After a successful compose: the selection that led to it is done. */
  composed?(): void
}

export interface RootCompose {
  /** The latest poll's facts. */
  update(input: Facts): void
  /** Write (or clear) each frame's compose error line; the view calls it after each frame render. */
  paint(): void
  /** Open the dialog for ≥2 selected frames; false (nothing opened) for fewer, so 建队 falls back to a session team. */
  open(selected: readonly string[]): boolean
  isOpen(): boolean
  /** The frame menu's 「加入 root「R」」 items for a frame (none for a root, a roster or a frame with no address). */
  menuItems(frame: string, item: (label: string, enabled: boolean, onPick: () => void) => HTMLButtonElement): HTMLButtonElement[]
}

export function createRootCompose(d: RootComposeDeps): RootCompose {
  let facts: Facts = { teams: [], sessions: [] }
  const frameErrors = new Map<string, string>()
  let dialog: HTMLElement | null = null
  let running = false
  const deps = (onStep?: (s: StepRecord) => void): ComposeDeps => ({ io: d.io!, ...(d.timeoutMs !== undefined ? { timeoutMs: d.timeoutMs } : {}), ...(onStep !== undefined ? { onStep } : {}) })

  function paint(): void {
    for (const [name, frame] of d.frames()) {
      const text = frameErrors.get(name)
      let line = frame.querySelector<HTMLElement>(':scope > .p-root-compose-err')
      if (text === undefined) { line?.remove(); continue }
      if (line === null) {
        line = document.createElement('div'); line.className = 'p-root-compose-err'; line.setAttribute('role', 'alert')
        const msg = document.createElement('span'); msg.className = 'msg'
        const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', '知道了，清除这条提示')
        dismiss.addEventListener('click', () => { frameErrors.delete(name); paint() })
        line.append(msg, dismiss); frame.appendChild(line)
      }
      const msg = line.querySelector<HTMLElement>('.msg')!
      if (msg.textContent !== text) msg.textContent = text
    }
  }
  const frameError = (frame: string, text: string): void => { frameErrors.set(frame, text); paint() }

  function open(selected: readonly string[]): boolean {
    if (selected.length < 2) return false
    if (dialog !== null) return true
    const check = canCompose(selected, facts)
    if (!check.ok && check.frame !== undefined) frameError(check.frame, check.reason)
    const restoreFocus = document.activeElement as HTMLElement | null
    const wrap = document.createElement('div')
    wrap.className = 'p-dialog p-root-compose'
    const panel = document.createElement('div')
    panel.className = 'p-dialog-panel'
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'p-root-compose-title')
    const title = document.createElement('div')
    title.id = 'p-root-compose-title'; title.className = 'p-dialog-title'
    title.textContent = `组成 root 团队（${String(selected.length)} 个子团队）`
    const list = document.createElement('ul')
    list.className = 'p-root-compose-children'
    for (const name of selected) { const li = document.createElement('li'); li.textContent = name; list.appendChild(li) }
    const input = document.createElement('input')
    input.className = 'p-dialog-input'; input.maxLength = 40; input.setAttribute('aria-label', 'root 团队名'); input.placeholder = 'root 团队名'
    const router = document.createElement('select')
    router.className = 'p-dialog-input'; router.setAttribute('aria-label', 'root 团队的总工')
    const candidates = routerCandidates(facts.sessions, facts.teams)
    router.appendChild(new Option(candidates.length > 0 ? '选择总工' : '没有可做总工的本机会话', ''))
    for (const s of candidates) router.appendChild(new Option(s.name !== undefined && s.name !== '' ? s.name : s.label, s.id))
    const hint = document.createElement('div')
    hint.className = 'p-dialog-hint'
    hint.textContent = candidates.length > 0 ? '总工：本机已入网、用 superagent-router 预设、还不在任何画布团队里的会话。' : '先在本机建一个 superagent-router 预设的会话并入网（不要放进别的团队），再来组成。'
    const err = document.createElement('div')
    err.className = 'p-dialog-err'; err.setAttribute('aria-live', 'polite')
    if (!check.ok) err.textContent = check.reason
    const progress = document.createElement('ol')
    progress.className = 'p-root-compose-progress'; progress.setAttribute('aria-live', 'polite')
    const row = document.createElement('div')
    row.className = 'p-dialog-row'
    const okBtn = document.createElement('button')
    okBtn.type = 'button'; okBtn.textContent = '组成'; okBtn.disabled = !check.ok || candidates.length === 0
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'; cancelBtn.textContent = '取消'
    row.append(okBtn, cancelBtn)
    panel.append(title, list, input, router, hint, err, progress, row)
    wrap.appendChild(panel)
    d.root.appendChild(wrap)
    dialog = wrap

    const close = (): void => {
      if (running) return
      wrap.remove(); dialog = null
      if (restoreFocus?.isConnected === true) restoreFocus.focus(); else d.root.focus()
    }
    const submit = async (): Promise<void> => {
      if (running || okBtn.disabled || !check.ok) return
      const name = input.value.trim()
      if (name === '' || name.length > 40 || name.includes('/') || name.startsWith('roster:') || /^\d+$/.test(name)) { err.textContent = '队名需 1..40 字，不含“/”或保留前缀，不为纯数字'; input.focus(); return }
      if (router.value === '') { err.textContent = '先选总工'; router.focus(); return }
      running = true
      okBtn.disabled = true; cancelBtn.disabled = true; input.disabled = true; router.disabled = true
      err.textContent = ''
      const result = await composeRoot(deps((step) => { const li = document.createElement('li'); li.textContent = `✓ ${step.label}`; progress.appendChild(li) }), { name, router: router.value, children: check.children })
      running = false
      if (result.ok) {
        for (const child of check.children) frameErrors.delete(child.frame)
        paint()
        close()
        d.notice('info', `root 团队「${name}」已组成：${String(check.children.length)} 个子团队`)
        d.composed?.()
        return
      }
      const failed = result.failed
      const li = document.createElement('li'); li.textContent = `✗ ${failed.label}`; progress.appendChild(li)
      const kept = result.done.length > 0 ? `已完成的 ${String(result.done.length)} 步保留不动，没有回滚也不会重放；` : '还没有写入任何东西；'
      err.textContent = `${failed.label}${failed.kind === 'refused' ? '被拒绝' : '结果未知'}：${failed.reason}。${kept}其余步骤未执行。`
      if (result.done.length > 0 || failed.step !== 'create') frameError(failed.frame, `组成 root「${name}」停在「${failed.label}」：${failed.reason}`)
      cancelBtn.disabled = false; cancelBtn.textContent = '关闭'
      cancelBtn.focus()
    }
    okBtn.addEventListener('click', () => { void submit() })
    cancelBtn.addEventListener('click', close)
    // A modal: the board's own keys, presses and wheel never see what happens inside it.
    for (const type of ['pointerdown', 'contextmenu', 'wheel'] as const) wrap.addEventListener(type, ev => ev.stopPropagation(), d.signal)
    wrap.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); void submit(); return }
      if (e.key !== 'Tab') return
      e.preventDefault()
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>('input, select, button')).filter(el => !(el as HTMLButtonElement).disabled)
      const idx = focusables.indexOf(document.activeElement as HTMLElement)
      focusables[e.shiftKey ? (idx - 1 + focusables.length) % focusables.length : (idx + 1) % focusables.length]?.focus()
    }, d.signal)
    if (check.ok) input.focus(); else cancelBtn.focus()
    return true
  }

  function menuItems(frame: string, item: (label: string, enabled: boolean, onPick: () => void) => HTMLButtonElement): HTMLButtonElement[] {
    const self = frameFacts(frame, facts)
    if (d.io === undefined || self === undefined || self.root === true || self.roster === true || self.ref === undefined) return []
    const ref = self.ref
    return facts.teams.filter(t => t.root === true && t.name !== frame).map((root) => {
      const verdict = dropRefusal(root, { name: frame, ...(self.superagentTeam === true ? { superagent: true } : {}) })
      const already = root.children?.some(child => child.ref === ref) === true
      const button = item(already ? `已在 root「${root.name}」里` : `加入 root「${root.name}」`, verdict.ok && !already, () => {
        void joinRoot(deps(), root.name, ref).then((out) => {
          if (out.ok) { frameErrors.delete(root.name); paint(); d.notice('info', `「${frame}」已加入 root「${root.name}」`) }
          else frameError(root.name, `「${frame}」没能加入：${out.reason}`)
        })
      })
      if (!verdict.ok) button.title = verdict.reason
      return button
    })
  }

  return {
    update(input) { facts = { teams: input.teams, sessions: input.sessions, ...(input.peerOrg !== undefined ? { peerOrg: input.peerOrg } : {}) } },
    paint,
    open: selected => d.io !== undefined && open(selected),
    isOpen: () => dialog !== null,
    menuItems,
  }
}
