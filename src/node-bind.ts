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
 *   (resume / clear / compact re-publish it), never mid-session — except a
 *   plugin hot reload, which re-mounts live sessions at the latest version
 *   (#174 tracks re-mounting at the frozen versions).
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
 * - The task-status context (`a2a:node:tasks`) and `node_update_self` need
 *   the task pointers (N6) and the self-update queue (N4); they land with
 *   those slices.
 * @module @nelsonlongxiang/dsh-open-a2a-net/node-bind
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { MUTABLE_SECTIONS, type NodeRecord, type NodeResult, type NodeStore, type PromptVersion } from './node-store.ts'

/** §5: section names, orders and the scoped variables that carry their frozen text. */
export const NODE_PROMPT = {
  mutable: { section: 'a2a:node:mutable', order: 10150, variable: 'a2a_node_mutable' },
  core: { section: 'a2a:node:core', order: 10180, variable: 'a2a_node_core' },
} as const

export interface NodeBinding {
  readonly session: string
  readonly node: string
  readonly by: string
  readonly at: string
}

const fail = <T>(code: 'bad-request' | 'not-found' | 'conflict' | 'unavailable', error: string): NodeResult<T> => ({ ok: false, code, error })

/**
 * Mutable text cannot leave its fence: the fence markers are neutralised and a line-leading ATX
 * heading marker (`#`…`######` then a space or the line end) is escaped — `#156` stays as written — so a note can never close the fence or forge a heading (e.g. a second 节点契约).
 */
export function fenceSafe(text: string): string {
  return text.replaceAll('<<<节点自记', '‹‹‹节点自记').replaceAll('节点自记>>>', '节点自记›››').replace(/^(\s*)(#{1,6})(?=\s|$)/gm, '$1\\$2')
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
      this.rows.push({ session: r.session, node: r.node, by: typeof r.by === 'string' ? r.by : '', at: typeof r.at === 'string' ? r.at : '' })
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
}

export interface NodeBinder {
  /** Mount the session's bound node, if any. Never throws (it runs inside agent/created). */
  mount(agent: BindableAgent): void
  /** Take a live session's node sections off, keeping its binding row (an archived session). */
  suspend(session: string): void
  /** Forget a session's mount without touching its binding (cooling unload; the scope disposes itself). */
  forget(session: string): void
  /** What a live session currently carries (the frozen snapshot), if anything. */
  mounted(session: string): MountedNode | undefined
  bind(session: string, node: string, by: string): NodeResult<NodeBinding & { mounted: boolean }>
  unbind(session: string): NodeResult<true>
  /**
   * End the bindings of sessions that LEFT since the last reading (leave, JOIN_CAP eviction). Only
   * the difference counts: a joined.json that failed to parse reads as empty, and treating every
   * session as "left" on that reading would end every binding (the 3081 lesson). Never throws.
   */
  reconcile(): void
  /** End every binding to an archived node. */
  nodeArchived(node: string): void
  /** Dispose every mount this binder made (plugin unload). */
  disposeAll(): void
}

export function createNodeBinder(d: NodeBinderDeps): NodeBinder {
  const mounts = new Map<string, { dispose: () => void; info: MountedNode }>()
  let seenJoined = new Set(d.joinedList())

  const unmount = (session: string): void => {
    const m = mounts.get(session)
    if (m === undefined) return
    mounts.delete(session)
    try { m.dispose() } catch (error) { d.logger.warn('a2a nodes: unmount of %s failed: %s', session, String(error)) }
  }

  /** Register the frozen texts on the session's own scope; throws on registry errors (callers catch). */
  const mountNode = (agent: BindableAgent, name: string): MountedNode | undefined => {
    const session = String(agent.id)
    const node = d.store.get(name)
    if (node === undefined) {
      d.logger.warn('a2a nodes: session %s is bound to %s, which is not on the roster — no node sections', session, name)
      return undefined
    }
    const core = d.store.current(name, 'core')
    const mutable = d.store.current(name, 'mutable')
    if (node.prompt.core_version > 0 && core === undefined) d.logger.warn('a2a nodes: %s core v%s fails its sha check — mounted without it', name, String(node.prompt.core_version))
    if (node.prompt.mutable_version > 0 && mutable === undefined) d.logger.warn('a2a nodes: %s mutable v%s fails its sha check — mounted without it', name, String(node.prompt.mutable_version))
    // Frozen here: the providers return these strings for the whole life of this mount.
    const coreText = renderCore(node, core)
    const mutableText = renderMutable(mutable)
    unmount(session)
    const sp = agent.ctx.get('systemPrompt') as {
      section: (s: { name: string; order: number; text: string }) => () => void
      variable: (name: string, provider: () => string | undefined) => () => void
    } | undefined
    if (sp === undefined) throw new Error('systemPrompt is not reachable from this session scope')
    const disposers: Array<() => void> = []
    try {
      disposers.push(sp.variable(NODE_PROMPT.mutable.variable, () => mutableText))
      disposers.push(sp.variable(NODE_PROMPT.core.variable, () => coreText))
      disposers.push(sp.section({ name: NODE_PROMPT.mutable.section, order: NODE_PROMPT.mutable.order, text: `{{${NODE_PROMPT.mutable.variable}}}` }))
      disposers.push(sp.section({ name: NODE_PROMPT.core.section, order: NODE_PROMPT.core.order, text: `{{${NODE_PROMPT.core.variable}}}` }))
    } catch (error) {
      for (const dispose of disposers.reverse()) try { dispose() } catch { /* already gone */ }
      throw error
    }
    const info: MountedNode = { node: name, core_version: core?.version ?? 0, mutable_version: mutable?.version ?? 0 }
    mounts.set(session, { dispose: () => { for (const dispose of disposers.reverse()) dispose() }, info })
    return info
  }

  return {
    mount(agent) {
      const session = String(agent.id)
      try {
        const binding = d.bindings.get(session)
        if (binding === undefined || !d.joined(session) || d.archived(session)) return
        mountNode(agent, binding.node)
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
    bind(session, name, by) {
      if (typeof session !== 'string' || session === '') return fail('bad-request', 'session is required')
      if (!d.joined(session)) return fail('conflict', `session ${session} is not joined — only a joined session carries a node (§3)`)
      if (d.archived(session)) return fail('conflict', `session ${session} is archived — an archived session carries no node (§3)`)
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
        const left = new Set([...seenJoined].filter(id => !now.has(id)))
        seenJoined = now
        if (left.size === 0) return
        const gone = d.bindings.deleteWhere(b => left.has(b.session))
        if (!gone.ok) {
          d.logger.warn('a2a nodes: could not end bindings of sessions that left: %s', gone.error)
          for (const id of left) unmount(id)
          return
        }
        for (const b of gone.value) unmount(b.session)
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
  }
}
