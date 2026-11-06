/**
 * Session ↔ node binding (docs/design/node-identity.md, slices N2+N3).
 *
 * - A binding ties one JOINED session to one node (§3): a session carries
 *   at most one node, a node may have several live sessions. The table is
 *   `node-bindings.json` under the a2a home; it survives restarts and
 *   cooling unloads (`agent/disposed` is not the end of a binding).
 * - A binding ends when the session leaves the network (leave, or its join
 *   intent falls off JOIN_CAP), or when its node is archived: the row is
 *   deleted and the sections come off. An ARCHIVED session never mounts and
 *   cannot bind; its row is kept, like its join intent (the 3081 lesson: a
 *   transient archived reading must not destroy durable intent).
 * - Mounts belong to the session scope, not to this plugin: the plugin
 *   disposes every mount it made when it unloads (`disposeAll`), so a
 *   reloaded plugin never meets registrations it cannot see.
 * - Binding mounts at once (§3 "绑定即生效"): two prompt sections are
 *   registered on that session's own `agent.ctx` — the mutable layer at
 *   10150, the core layer after it at 10180 with an explicit precedence
 *   line, both before the deployment suffix at 10200 (§5).
 * - Frozen snapshot (§5): the texts are read once, when the session mounts.
 *   A layer written later takes effect from the session's next mount
 *   (resume / clear / compact re-publish it), never mid-session: the binding
 *   row records the versions each mount froze, and a plugin reload re-mounts
 *   live sessions at them (#174).
 * - No interpolation (§5, B3): the installed system-prompt has no
 *   `interpolate:false`; it interpolates `{{name}}` groups and fails on an
 *   unknown one. Each section's text is therefore only `{{a2a_node_*}}`,
 *   and the frozen text rides a scoped prompt VARIABLE — substituted values
 *   are never scanned again, so a `{{x}}` written into a layer stays literal
 *   and assembly cannot fail on it.
 * - Never a veto (§3): mounting runs inside `agent/created`, where a throw
 *   would block the session from publishing. Every mount path catches and
 *   logs; a corrupt roster, a missing node or a tampered version file
 *   leaves the session without node sections, never without a session.
 * - The task context `a2a:node:tasks` (N6) is LIVE, not frozen: it is a
 *   runtime context that the system prompt materialises per assembly, so a
 *   pointer that changes state shows at the next step (§5 "即时"). Its text
 *   rides a scoped variable too. A pointer that finished calls `remind`:
 *   each live session carrying that node gets a follow-up turn (§6).
 * - `node_update_self` (N4) is registered with the sections on the bound
 *   session's own scope, and leaves with them. A write it makes is echoed in
 *   a live `a2a:node:self` context for the rest of that session (the frozen
 *   sections do not change, §5).
 * @module @nelsonlongxiang/dsh-open-a2a-net/node-bind
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import { MUTABLE_SECTIONS, type NodeRecord, type NodeResult, type NodeStore, type PromptVersion } from './node-store.ts'
import { selfUpdateTool, type SelfUpdateDeps } from './node-self.ts'

/** §5: section names, orders and the scoped variables that carry their frozen text. */
export const NODE_PROMPT = {
  mutable: { section: 'a2a:node:mutable', order: 10150, variable: 'a2a_node_mutable' },
  core: { section: 'a2a:node:core', order: 10180, variable: 'a2a_node_core' },
  tasks: { context: 'a2a:node:tasks', order: 9150, variable: 'a2a_node_tasks' },
  self: { context: 'a2a:node:self', order: 9160, variable: 'a2a_node_self' },
} as const

export interface NodeBinding {
  readonly session: string
  readonly node: string
  readonly by: string
  readonly at: string
  /**
   * What the session's last mount froze, per layer: version (0 = the layer had none, so it mounts
   * empty) and that version's sha. Absent = never recorded (an older row): the current version.
   * A plugin reload re-mounts at these (#174).
   */
  readonly core_version?: number
  readonly core_sha256?: string
  readonly mutable_version?: number
  readonly mutable_sha256?: string
}

/** One layer's frozen pin as recorded on a row, or undefined when the row never recorded it. */
export type LayerPin = { readonly version: number; readonly sha256: string } | undefined

const versionField = (raw: unknown): number | undefined => typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined
const shaField = (raw: unknown): string | undefined => typeof raw === 'string' && /^([0-9a-f]{64})?$/.test(raw) ? raw : undefined
const pinOf = (version: number | undefined, sha: string | undefined): LayerPin => version === undefined || sha === undefined ? undefined : { version, sha256: sha }

/**
 * A code fence left open would swallow everything rendered after it (even the core layer), so one
 * still open at the end is closed. Tracked by the CommonMark rules: an opener is ``` or ~~~ (three
 * or more) indented at most three spaces, and a backtick opener's info string has no backtick (else
 * it is inline code); inside, only a run of the SAME character, at least as long, followed by nothing
 * but blanks closes it. Lines split on CRLF, CR or LF alike; the closer carries the opener's indent, so
 * a fence opened inside a list item is closed inside it rather than opening a new one at column 0.
 */
export function closeFences(text: string): string {
  let open: { indent: string; ch: string; len: number } | undefined
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (open === undefined) {
      const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
      if (m === null) continue
      const fence = m[2] as string
      if (fence.startsWith('`') && (m[3] as string).includes('`')) continue
      open = { indent: m[1] as string, ch: fence.charAt(0), len: fence.length }
    } else {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (m !== null && (m[1] as string).startsWith(open.ch) && (m[1] as string).length >= open.len) open = undefined
    }
  }
  return open === undefined ? text : `${text}\n${open.indent}${open.ch.repeat(open.len)}`
}

const fail = <T>(code: 'bad-request' | 'not-found' | 'conflict' | 'unavailable', error: string): NodeResult<T> => ({ ok: false, code, error })

/**
 * Mutable text cannot leave its fence: the fence markers are neutralised, and every Markdown heading
 * form is escaped — an ATX marker (`#`…`######` then a space or the line end) and a Setext underline
 * (a line of only `=` or `-`), at the line start or behind any block-quote / list-item prefix
 * (`>`, `-`, `*`, `+`, `1.`, `1)`). `#156` stays as written; a `# comment` inside a code block is
 * escaped too (harmless in a prompt, and simpler than tracking code blocks). An unclosed code fence
 * is closed, so it cannot swallow what follows. A note can never close the fence or forge a heading.
 */
const BLOCK_PREFIX = '((?:[ \\t]*(?:>|(?:[-*+]|\\d{1,9}[.)])(?=[ \\t])))*[ \\t]*)'
const ATX = new RegExp(`^${BLOCK_PREFIX}(#{1,6})(?=[ \\t]|$)`, 'gm')
const SETEXT = new RegExp(`^${BLOCK_PREFIX}(=+|-+)([ \\t]*)$`, 'gm')
export function fenceSafe(text: string): string {
  return closeFences(text.replaceAll('<<<节点自记', '‹‹‹节点自记').replaceAll('节点自记>>>', '节点自记›››')
    .replace(ATX, '$1\\$2')
    .replace(SETEXT, '$1\\$2$3'))
}

/** The mutable layer, fenced and marked lower than the core layer below it. '' when every section is empty. */
export function renderMutable(v: PromptVersion | undefined): string {
  if (v === undefined) return ''
  const parts = MUTABLE_SECTIONS.map(key => ({ key, text: fenceSafe((v.sections[key] ?? '').trim()) })).filter(p => p.text !== '')
  if (parts.length === 0) return ''
  return [
    '## 节点自记（a2a:node:mutable）',
    '',
    '下面围栏里是本节点自己记的笔记，优先级低于后面的「节点契约」；与契约冲突时，以契约为准。',
    '',
    '<<<节点自记',
    ...parts.flatMap(p => [`### ${p.key}`, p.text, '']),
    '节点自记>>>',
  ].join('\n')
}

/** The core layer: identity from the record, the human-written text, and the precedence line. */
export function renderCore(node: NodeRecord, v: PromptVersion | undefined): string {
  const identity = [
    `- 节点：${node.name}${node.label !== '' ? `（${node.label}）` : ''}`,
    ...(node.role.length > 0 ? [`- 职责：${node.role.join('、')}`] : []),
    ...(node.teams.length > 0 ? [`- 团队：${node.teams.join('、')}`] : []),
  ]
  const text = (v?.sections.core ?? '').trim()
  return [
    '## 节点契约（a2a:node:core）',
    '',
    ...identity,
    ...(text !== '' ? ['', text] : []),
    '',
    '本段优先于上方的「节点自记」。',
  ].join('\n')
}

/**
 * The binding table. A file that does not parse is left in place and the
 * table comes back READ-ONLY and empty (sessions open, nothing mounts);
 * a copy is kept beside it, as the node roster does.
 */
export class NodeBindings {
  private rows: NodeBinding[] = []
  private readOnlyReason = ''

  /** @param root - the `<home>/a2a` directory; '' keeps the table in memory (tests). */
  constructor(private readonly root: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.restore()
  }

  private get file(): string { return join(this.root, 'node-bindings.json') }

  private restore(): void {
    if (this.root === '' || !existsSync(this.file)) return
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      raw = undefined
    }
    const list = (raw as { bindings?: unknown } | null | undefined)?.bindings
    if (raw === null || typeof raw !== 'object' || !Array.isArray(list)) {
      const aside = `${this.file}.corrupt-${this.now().replace(/[:.]/g, '-')}`
      try { copyFileSync(this.file, aside) } catch { /* the original stays in place either way */ }
      this.readOnlyReason = `node-bindings.json is unreadable (copy kept at ${aside}); repair it, then restart`
      return
    }
    let dropped = 0
    for (const row of list as unknown[]) {
      const r = row as Partial<NodeBinding> | null
      if (r === null || typeof r !== 'object' || typeof r.session !== 'string' || typeof r.node !== 'string' || this.rows.some(b => b.session === r.session)) {
        dropped++
        continue
      }
      const core = pinOf(versionField(r.core_version), shaField(r.core_sha256))
      const mutable = pinOf(versionField(r.mutable_version), shaField(r.mutable_sha256))
      this.rows.push({
        session: r.session, node: r.node, by: typeof r.by === 'string' ? r.by : '', at: typeof r.at === 'string' ? r.at : '',
        ...(core !== undefined ? { core_version: core.version, core_sha256: core.sha256 } : {}),
        ...(mutable !== undefined ? { mutable_version: mutable.version, mutable_sha256: mutable.sha256 } : {}),
      })
    }
    // The next commit rewrites the table without the dropped rows: keep the original first (as the roster does).
    if (dropped > 0) {
      try { copyFileSync(this.file, `${this.file}.dropped-${this.now().replace(/[:.]/g, '-')}`) } catch { /* best effort; the rows were unusable either way */ }
    }
  }

  private commit(rows: NodeBinding[]): NodeResult<true> {
    if (this.readOnlyReason !== '') return fail('unavailable', `node bindings are read-only: ${this.readOnlyReason}`)
    if (this.root !== '') {
      try {
        mkdirSync(this.root, { recursive: true })
        const tmp = `${this.file}.${String(process.pid)}.tmp`
        writeFileSync(tmp, JSON.stringify({ bindings: rows }), { mode: 0o600 })
        renameSync(tmp, this.file)
      } catch (error) {
        return fail('unavailable', `could not persist node-bindings.json: ${String(error)}`)
      }
    }
    this.rows = rows
    return { ok: true, value: true }
  }

  get readOnly(): string { return this.readOnlyReason }
  list(): readonly NodeBinding[] { return this.rows }
  get(session: string): NodeBinding | undefined { return this.rows.find(b => b.session === session) }

  set(session: string, node: string, by: string): NodeResult<NodeBinding> {
    const row: NodeBinding = { session, node, by, at: this.now() }
    const done = this.commit([...this.rows.filter(b => b.session !== session), row])
    return done.ok ? { ok: true, value: row } : done
  }

  /** Record what a mount froze (best effort; unchanged values write nothing). */
  setFrozen(session: string, core: { version: number; sha256: string }, mutable: { version: number; sha256: string }): NodeResult<true> {
    const row = this.get(session)
    if (row === undefined) return fail('not-found', `session ${session} carries no node`)
    if (row.core_version === core.version && row.core_sha256 === core.sha256 && row.mutable_version === mutable.version && row.mutable_sha256 === mutable.sha256) return { ok: true, value: true }
    return this.commit(this.rows.map(b => b.session === session
      ? { ...b, core_version: core.version, core_sha256: core.sha256, mutable_version: mutable.version, mutable_sha256: mutable.sha256 }
      : b))
  }

  delete(session: string): NodeResult<true> {
    if (this.readOnlyReason !== '') return fail('unavailable', `node bindings are read-only: ${this.readOnlyReason}`)
    if (this.get(session) === undefined) return fail('not-found', `session ${session} carries no node`)
    return this.commit(this.rows.filter(b => b.session !== session))
  }

  /** Delete every row matching `drop` in one write; the deleted rows on success. */
  deleteWhere(drop: (b: NodeBinding) => boolean): NodeResult<NodeBinding[]> {
    const gone = this.rows.filter(drop)
    if (gone.length === 0) return { ok: true, value: [] }
    const done = this.commit(this.rows.filter(b => !drop(b)))
    return done.ok ? { ok: true, value: gone } : done
  }
}

/** The part of a live session the binder touches: its id and its own registration scope. */
export interface BindableAgent {
  readonly id: unknown
  readonly ctx: Context
  /** Queue a follow-up turn (the §6 reminder); absent on test doubles that never get one. */
  followup?(message: UserMessage): void
  /** Queue a message for the next turn without waking (an owed reminder handed out at mount). */
  send?(message: UserMessage, target: 'next-turn' | 'next-step', wakeup: boolean): void
}

export interface MountedNode {
  readonly node: string
  readonly core_version: number
  readonly mutable_version: number
}

export interface NodeBinderDeps {
  readonly store: NodeStore
  readonly bindings: NodeBindings
  readonly logger: { warn: (format: string, ...args: unknown[]) => void }
  /** Whether a session is joined (§3: only a joined session binds). */
  readonly joined: (session: string) => boolean
  /** Every joined session now (reconcile works on the difference from the last reading). */
  readonly joinedList: () => readonly string[]
  /** Whether a session is archived (it never mounts and cannot bind). */
  readonly archived: (session: string) => boolean
  /** The live top-level session with this id, if any. */
  readonly live: (session: string) => BindableAgent | undefined
  /** The node's task context text, read at each assembly ('' = none). */
  readonly tasksText?: (node: string) => string
  /** Reminders owed to the node (finished while no session carried it); taken — and cleared — at mount. */
  readonly pendingReminders?: (node: string) => string[]
  /** N4: what `node_update_self` needs (absent = no tool). */
  readonly selfUpdate?: Omit<SelfUpdateDeps, 'onWritten'>
}

export interface NodeBinder {
  /**
   * Mount the session's bound node, if any. Never throws (it runs inside agent/created). A new session
   * (agent/created) takes the current versions; `atFrozen` — the plugin-load pass over sessions that are
   * already live — re-mounts at the versions the row recorded, so a plugin reload never changes a live
   * session's head (§5; #174). A recorded version that no longer reads back falls back to the current one.
   */
  mount(agent: BindableAgent, opts?: { atFrozen?: boolean }): void
  /** Take a live session's node sections off, keeping its binding row (an archived session). */
  suspend(session: string): void
  /** Forget a session's mount without touching its binding (cooling unload; the scope disposes itself). */
  forget(session: string): void
  /** What a live session currently carries (the frozen snapshot), if anything. */
  mounted(session: string): MountedNode | undefined
  /**
   * #174: whether the session's assembled system prompt still carries the two node sections. A
   * `complete` preset replaces the whole prompt and drops them though they stay mounted. Assembles
   * with the session's own scope, as the agent loop does; undefined when the session carries no node
   * or the assembly fails.
   */
  assembled(session: string): Promise<{ core: boolean; mutable: boolean } | undefined>
  bind(session: string, node: string, by: string): NodeResult<NodeBinding & { mounted: boolean }>
  unbind(session: string): NodeResult<true>
  /**
   * End the bindings of sessions that LEFT since the last reading (leave, JOIN_CAP eviction). Only
   * the difference counts: a joined.json that failed to parse reads as empty, and treating every
   * session as "left" on that reading would end every binding (the 3081 lesson). A failed write keeps
   * the leavers for the next reading (retry). A session that (re)joined and carries a binding row
   * mounts at once, if live. Never throws.
   */
  reconcile(): void
  /** End every binding to an archived node. */
  nodeArchived(node: string): void
  /** Dispose every mount this binder made (plugin unload). */
  disposeAll(): void
  /** Queue a follow-up turn on every live, mounted session carrying `node` (§6 reminder); how many got it. */
  remind(node: string, text: string): number
}

/** One §6 reminder as a user message; the sender label makes ui-chat render it as "来自 …" with the text. */
export function reminderMessage(node: string, text: string): UserMessage {
  return {
    id: MessageId(`a2a-node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`),
    role: 'user',
    content: [{ type: 'text', text }],
    // nodeReminder marks it HOST-built: a turn it starts is a local turn for node_update_self (N4). Remote
    // deliveries are relayed with a fixed source shape, so they cannot carry this field.
    source: { kind: 'a2a-relay', form: 'relay', senderSessionId: `节点 ${node} 的任务核对`, nodeReminder: true },
  }
}

export function createNodeBinder(d: NodeBinderDeps): NodeBinder {
  const mounts = new Map<string, { dispose: () => void; info: MountedNode; agent: BindableAgent }>()
  /** N4: the self-updates each mounted session wrote, echoed in its live context. */
  const selfNotes = new Map<string, string[]>()
  let seenJoined = new Set(d.joinedList())
  /**
   * Sessions that left but whose binding could not be deleted yet: retried at every join change, and
   * neither mounted nor re-bound meanwhile. In memory only: a plugin reload before the write goes
   * through forgets them, and a later re-join then revives the row (there is no boot sweep — the 3081
   * lesson — so this needs a failed write AND a reload to happen).
   */
  let pendingEnd = new Set<string>()

  const unmount = (session: string): void => {
    const m = mounts.get(session)
    selfNotes.delete(session)
    if (m === undefined) return
    mounts.delete(session)
    try { m.dispose() } catch (error) { d.logger.warn('a2a nodes: unmount of %s failed: %s', session, String(error)) }
  }

  /** Register the frozen texts on the session's own scope; throws on registry errors (callers catch). */
  /** One layer at a recorded pin: 0 = none (empty), a version = that version if it reads back, else current. */
  const layerAt = (name: string, layer: 'core' | 'mutable', pin: LayerPin): PromptVersion | undefined => {
    if (pin === undefined) return d.store.current(name, layer)
    if (pin.version === 0) return undefined
    const v = d.store.frozen(name, layer, pin.version, pin.sha256)
    if (v !== undefined) return v
    d.logger.warn('a2a nodes: %s %s v%s (frozen by a live session) does not read back — re-mounted at the current version, so this session\'s head changes', name, layer, String(pin.version))
    return d.store.current(name, layer)
  }

  const mountNode = (agent: BindableAgent, name: string, pin?: { core: LayerPin; mutable: LayerPin }): MountedNode | undefined => {
    const session = String(agent.id)
    const node = d.store.get(name)
    if (node === undefined) {
      d.logger.warn('a2a nodes: session %s is bound to %s, which is not on the roster — no node sections', session, name)
      return undefined
    }
    const core = pin !== undefined ? layerAt(name, 'core', pin.core) : d.store.current(name, 'core')
    const mutable = pin !== undefined ? layerAt(name, 'mutable', pin.mutable) : d.store.current(name, 'mutable')
    if (pin === undefined && node.prompt.core_version > 0 && core === undefined) d.logger.warn('a2a nodes: %s core v%s fails its sha check — mounted without it', name, String(node.prompt.core_version))
    if (pin === undefined && node.prompt.mutable_version > 0 && mutable === undefined) d.logger.warn('a2a nodes: %s mutable v%s fails its sha check — mounted without it', name, String(node.prompt.mutable_version))
    // Frozen here: the providers return these strings for the whole life of this mount.
    const coreText = renderCore(node, core)
    const mutableText = renderMutable(mutable)
    unmount(session)
    const sp = agent.ctx.get('systemPrompt') as {
      section: (s: { name: string; order: number; text: string }) => () => void
      context: (c: { name: string; order: number; text: string }) => () => void
      variable: (name: string, provider: () => string | undefined) => () => void
    } | undefined
    const tools = agent.ctx.get('tools') as { register: (definition: unknown) => () => void } | undefined
    if (sp === undefined) throw new Error('systemPrompt is not reachable from this session scope')
    const disposers: Array<() => void> = []
    try {
      disposers.push(sp.variable(NODE_PROMPT.mutable.variable, () => mutableText))
      disposers.push(sp.variable(NODE_PROMPT.core.variable, () => coreText))
      disposers.push(sp.section({ name: NODE_PROMPT.mutable.section, order: NODE_PROMPT.mutable.order, text: `{{${NODE_PROMPT.mutable.variable}}}` }))
      disposers.push(sp.section({ name: NODE_PROMPT.core.section, order: NODE_PROMPT.core.order, text: `{{${NODE_PROMPT.core.variable}}}` }))
      if (d.tasksText !== undefined) {
        const tasksText = d.tasksText
        // Live, unlike the two sections: a provider that never throws (assembly must not fail on it).
        disposers.push(sp.variable(NODE_PROMPT.tasks.variable, () => { try { return tasksText(name) } catch { return '' } }))
        disposers.push(sp.context({ name: NODE_PROMPT.tasks.context, order: NODE_PROMPT.tasks.order, text: `{{${NODE_PROMPT.tasks.variable}}}` }))
      }
      if (d.selfUpdate !== undefined && tools !== undefined) {
        // A fresh mount is a fresh session view: its notes start empty (the frozen layer already has the writes).
        selfNotes.set(session, [])
        const notesOf = (): string => {
          const notes = selfNotes.get(session) ?? []
          const record = d.store.get(name)?.prompt
          // The CAS sha node_update_self needs (live: it moves with every write, by this session or another).
          const head = ['## 节点自记（a2a:node:self）', '', `节点自记当前版本 v${String(record?.mutable_version ?? 0)}，sha256 ${record?.mutable_sha256 === '' || record === undefined ? '（尚无版本，写入时传空串）' : record.mutable_sha256}。`]
          return notes.length === 0 ? head.join('\n') : [...head, '', '本会话已记录的更新（从下一个会话起生效；本会话的「节点自记」段仍是挂载时的版本）：', '', ...notes].join('\n')
        }
        disposers.push(sp.variable(NODE_PROMPT.self.variable, notesOf))
        disposers.push(sp.context({ name: NODE_PROMPT.self.context, order: NODE_PROMPT.self.order, text: `{{${NODE_PROMPT.self.variable}}}` }))
        disposers.push(tools.register(selfUpdateTool({
          ...d.selfUpdate,
          onWritten: (s, v, section) => { selfNotes.get(s)?.push(`- v${String(v.version)}：${section}（${v.reason.slice(0, 80)}）`) },
        }, name, session)))
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) try { dispose() } catch { /* already gone */ }
      throw error
    }
    const info: MountedNode = { node: name, core_version: core?.version ?? 0, mutable_version: mutable?.version ?? 0 }
    mounts.set(session, { dispose: () => { for (const dispose of disposers.reverse()) dispose() }, info, agent })
    // Owed reminders ride the session's next turn; handing them out must never fail the mount.
    if (d.pendingReminders !== undefined) {
      try {
        for (const text of d.pendingReminders(name)) {
          const message = reminderMessage(name, text)
          if (agent.send !== undefined) agent.send(message, 'next-turn', false)
          else agent.followup?.(message)
        }
      } catch (error) {
        d.logger.warn('a2a nodes: owed reminders for %s on %s failed: %s', name, session, String(error))
      }
    }
    const recorded = d.bindings.setFrozen(session, { version: info.core_version, sha256: core?.sha256 ?? '' }, { version: info.mutable_version, sha256: mutable?.sha256 ?? '' })
    if (!recorded.ok && recorded.code !== 'not-found') d.logger.warn('a2a nodes: could not record the versions %s froze (%s) — a plugin reload may re-mount it at the previously recorded ones', session, recorded.error)
    return info
  }

  const binder: NodeBinder = {
    mount(agent, opts) {
      const session = String(agent.id)
      try {
        const binding = d.bindings.get(session)
        if (binding === undefined || !d.joined(session) || d.archived(session) || pendingEnd.has(session)) return
        mountNode(agent, binding.node, opts?.atFrozen === true ? { core: pinOf(binding.core_version, binding.core_sha256), mutable: pinOf(binding.mutable_version, binding.mutable_sha256) } : undefined)
      } catch (error) {
        d.logger.warn('a2a nodes: mounting node sections on %s failed (session opens without them): %s', session, String(error))
      }
    },
    suspend(session) {
      unmount(session)
    },
    forget(session) {
      mounts.delete(session)
    },
    mounted(session) {
      return mounts.get(session)?.info
    },
    async assembled(session) {
      const mount = mounts.get(session)
      const sp = mount?.agent.ctx.get('systemPrompt') as { assemble?: (c: { agent: unknown; scope: unknown }) => Promise<{ sections: Array<{ name: string }> }> } | undefined
      if (mount === undefined || sp?.assemble === undefined) return undefined
      try {
        // The agent loop's own assembly context (dsh-agent assembleContextFor): the agent is the scope.
        const names = new Set((await sp.assemble({ agent: mount.agent, scope: mount.agent })).sections.map(s => s.name))
        return { core: names.has(NODE_PROMPT.core.section), mutable: names.has(NODE_PROMPT.mutable.section) }
      } catch {
        return undefined
      }
    },
    bind(session, name, by) {
      if (typeof session !== 'string' || session === '') return fail('bad-request', 'session is required')
      if (!d.joined(session)) return fail('conflict', `session ${session} is not joined — only a joined session carries a node (§3)`)
      if (d.archived(session)) return fail('conflict', `session ${session} is archived — an archived session carries no node (§3)`)
      if (pendingEnd.has(session)) {
        // Retry the pending end here: once the a2a home is writable again, bind goes through.
        const ended = d.bindings.deleteWhere(b => b.session === session)
        if (!ended.ok) return fail('conflict', `session ${session} left the network and its old binding is still being ended (a write failed) — retry once the a2a home is writable`)
        pendingEnd.delete(session)
      }
      if (d.store.get(name) === undefined) return fail('not-found', `no node ${name}`)
      const existing = d.bindings.get(session)
      if (existing !== undefined && existing.node !== name) return fail('conflict', `session ${session} already carries ${existing.node} — unbind it first (one node per session)`)
      let saved = existing
      if (saved === undefined) {
        const result = d.bindings.set(session, name, by)
        if (!result.ok) return result
        saved = result.value
      }
      const agent = d.live(session)
      // Already carrying this node: keep the frozen snapshot (a re-bind must not change the head mid-session).
      if (existing !== undefined && mounts.get(session)?.info.node === name) return { ok: true, value: { ...existing, mounted: true } }
      let mounted = false
      if (agent !== undefined) {
        try {
          mounted = mountNode(agent, name) !== undefined
        } catch (error) {
          d.logger.warn('a2a nodes: binding %s → %s saved, mount failed: %s', session, name, String(error))
        }
      }
      return { ok: true, value: { ...saved, mounted } }
    },
    unbind(session) {
      const done = d.bindings.delete(session)
      if (!done.ok) return done
      unmount(session)
      return done
    },
    reconcile() {
      try {
        const now = new Set(d.joinedList())
        // A leave ends the binding even if the session re-joined before the write went through.
        const toEnd = new Set([...[...seenJoined].filter(id => !now.has(id)), ...pendingEnd])
        const arrived = [...now].filter(id => !seenJoined.has(id))
        seenJoined = now
        if (toEnd.size > 0) {
          for (const id of toEnd) unmount(id)
          const gone = d.bindings.deleteWhere(b => toEnd.has(b.session))
          if (gone.ok) {
            pendingEnd = new Set()
          } else {
            d.logger.warn('a2a nodes: could not end bindings of sessions that left (retried at the next change): %s', gone.error)
            pendingEnd = toEnd
          }
        }
        // A session that (re)joined with a surviving row mounts now, not at its next publish.
        for (const id of arrived) {
          const agent = d.live(id)
          if (agent !== undefined && !mounts.has(id)) binder.mount(agent)
        }
      } catch (error) {
        d.logger.warn('a2a nodes: reconcile failed: %s', String(error))
      }
    },
    nodeArchived(node) {
      const gone = d.bindings.deleteWhere(b => b.node === node)
      if (!gone.ok) d.logger.warn('a2a nodes: archived %s, but its bindings stay: %s', node, gone.error)
      for (const [session, m] of [...mounts]) if (m.info.node === node) unmount(session)
    },
    disposeAll() {
      for (const session of [...mounts.keys()]) unmount(session)
    },
    remind(node, text) {
      let reached = 0
      for (const [session, m] of mounts) {
        if (m.info.node !== node) continue
        const agent = d.live(session)
        if (agent?.followup === undefined) continue
        try {
          agent.followup(reminderMessage(node, text))
          reached++
        } catch (error) {
          d.logger.warn('a2a nodes: reminder to %s failed: %s', session, String(error))
        }
      }
      return reached
    },
  }
  return binder
}
