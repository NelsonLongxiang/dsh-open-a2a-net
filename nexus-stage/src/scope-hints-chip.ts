/**
 * The board's 协作提示 chip (production feedback 2026-11-14). A peer host's canvas can hold one of this host's sessions
 * beside its own session while this host declares nothing about that session: routing out works, but the peer session
 * cannot call in and nobody is told. The host's /state carries those pairs as `scopeHints`; this chip sits on the
 * toolbar next to 未入网, counts them, and offers the owner one click per pair: add the peer session (its key-pinned
 * reference) to a local canvas that already holds the local side, or join the local session to the network first.
 * Suggestions only — every click is the owner's own canvas or join write through the usual routes.
 * @module nexus-stage/scope-hints-chip
 */
import { peerHostOf } from './federation'

export interface ScopeHintLocalView { readonly id: string; readonly handle: string; readonly joined: boolean; readonly canvases: readonly string[] }
export interface ScopeHintView {
  readonly peer: string
  readonly peerCanvas: string
  readonly remote: string
  readonly memberRef?: string
  readonly name: string
  readonly local: readonly ScopeHintLocalView[]
}

const str = (v: unknown): v is string => typeof v === 'string' && v !== ''

/** Tolerant reader of /state `scopeHints` (absent on an older host: no chip). */
export function parseScopeHints(raw: unknown): ScopeHintView[] {
  if (!Array.isArray(raw)) return []
  const out: ScopeHintView[] = []
  for (const h of raw as Array<Record<string, unknown> | null>) {
    if (h === null || typeof h !== 'object' || !str(h.peer) || !str(h.peerCanvas) || !str(h.remote) || !Array.isArray(h.local)) continue
    const local = (h.local as Array<Record<string, unknown> | null>).flatMap(l => l !== null && typeof l === 'object' && str(l.id) && str(l.handle)
      ? [{ id: l.id, handle: l.handle, joined: l.joined === true, canvases: Array.isArray(l.canvases) ? l.canvases.filter(str) : [] }] : [])
    if (local.length === 0) continue
    out.push({ peer: h.peer, peerCanvas: h.peerCanvas, remote: h.remote, ...(str(h.memberRef) ? { memberRef: h.memberRef } : {}), name: typeof h.name === 'string' ? h.name : '', local })
  }
  return out
}

/** One pickable action of a hint. */
export type ScopeHintAction =
  | { readonly kind: 'add'; readonly canvas: string; readonly ref: string; readonly label: string }
  | { readonly kind: 'join'; readonly id: string; readonly label: string }

const canvasName = (team: string): string => team.slice(team.lastIndexOf('/canvas/') + '/canvas/'.length) || team

/** The sentence and the buttons for one hint (pure: the chip and the tests share it). */
export function describeScopeHint(h: ScopeHintView): { text: string; actions: ScopeHintAction[] } {
  const who = h.name !== '' ? `${h.name}（${h.remote}）` : h.remote
  const locals = h.local.map(l => l.handle).join('、')
  const text = `${who} @ ${peerHostOf(h.peer)} 与本机 ${locals} 同在对端团队「${canvasName(h.peerCanvas)}」，本机还没把它加入任何画布。`
  const actions: ScopeHintAction[] = []
  const ref = h.memberRef ?? h.remote
  const canvases = [...new Set(h.local.filter(l => l.joined).flatMap(l => l.canvases))]
  for (const canvas of canvases) actions.push({ kind: 'add', canvas, ref, label: `加入本机「${canvas}」` })
  for (const l of h.local) if (!l.joined) actions.push({ kind: 'join', id: l.id, label: `先让 ${l.handle} 入网` })
  return { text, actions }
}

export interface ScopeHintsChipDeps {
  addMember(canvas: string, ref: string): Promise<boolean>
  joinNetwork(id: string): Promise<boolean>
  notice(kind: 'info' | 'error', text: string): void
}

export interface ScopeHintsChip {
  readonly el: HTMLButtonElement
  update(hints: readonly ScopeHintView[]): void
}

export function createScopeHintsChip(d: ScopeHintsChipDeps): ScopeHintsChip {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'p-hintbtn'
  el.title = '对端团队里有本机会话、但本机还没声明的协作者（点击查看并加入）'
  el.setAttribute('aria-haspopup', 'menu')
  el.hidden = true
  let hints: readonly ScopeHintView[] = []
  let menu: HTMLDivElement | null = null
  const close = (): void => { menu?.remove(); menu = null }
  const run = async (a: ScopeHintAction): Promise<void> => {
    close()
    const ok = a.kind === 'add' ? await d.addMember(a.canvas, a.ref) : await d.joinNetwork(a.id)
    d.notice(ok ? 'info' : 'error', ok ? `已提交：${a.label}（下次刷新生效）` : `未完成：${a.label}`)
  }
  el.addEventListener('click', () => {
    if (menu !== null) { close(); return }
    if (hints.length === 0) return
    const m = document.createElement('div')
    m.className = 'p-menu p-hintmenu'
    m.setAttribute('role', 'menu')
    m.setAttribute('aria-label', '协作提示')
    for (const h of hints) {
      const { text, actions } = describeScopeHint(h)
      const row = document.createElement('div')
      row.className = 'p-hint'
      const p = document.createElement('p')
      p.textContent = text
      row.appendChild(p)
      if (actions.length === 0) {
        const none = document.createElement('p')
        none.className = 'p-hint-none'
        none.textContent = '本机这一侧的会话还不在任何画布里：先把它放进一个画布，再回来加入。'
        row.appendChild(none)
      }
      for (const a of actions) {
        const b = document.createElement('button')
        b.type = 'button'
        b.setAttribute('role', 'menuitem')
        b.textContent = a.label
        b.addEventListener('click', () => { void run(a) })
        row.appendChild(b)
      }
      m.appendChild(row)
    }
    menu = m
    ;(el.closest('#dsh-plan') ?? document.body).appendChild(m)
    const rect = el.getBoundingClientRect()
    m.style.left = `${String(Math.max(8, Math.min(rect.left, window.innerWidth - 340)))}px`
    m.style.top = `${String(Math.max(8, rect.top - Math.min(320, hints.length * 92 + 10)))}px`
  })
  document.addEventListener('pointerdown', e => {
    const t = e.target as Node | null
    if (menu !== null && t !== null && !menu.contains(t) && t !== el && !el.contains(t)) close()
  })
  return {
    el,
    update(next) {
      hints = next
      el.hidden = next.length === 0
      el.textContent = `协作提示(${String(next.length)})`
      if (next.length === 0) close()
    },
  }
}
