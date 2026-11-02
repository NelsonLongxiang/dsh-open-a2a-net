/**
 * Node self-update (docs/design/node-identity.md §6; slice N4): the
 * `node_update_self` tool a session carrying a node may call to write ONE
 * section of its node's mutable layer, and the human review queue.
 *
 * - Only bound sessions get the tool (it is registered with the node's
 *   sections at mount). Its parameters cannot name, role, team or touch the
 *   core layer: one of the four mutable sections, text, reason, CAS sha.
 * - Remote turns cannot write (§6, H2): when the current turn's input did
 *   not all come from this host (a person here, a host-generated node
 *   reminder, the harness's own notices), the write is refused and parked
 *   in the review queue, where a human approves or rejects it through the
 *   apiKey-gated nodes face. The judgement is fail-closed: an unknown
 *   message source counts as remote. Its boundary, stated honestly: it
 *   reads the turn's INPUT messages only — remote text the model read
 *   through tools inside a local turn, or that sits in earlier turns'
 *   history, is not detected.
 * - Daily cap: at most {@link SELF_UPDATE_DAILY_MAX} node writes per node
 *   per UTC day; beyond that the call is refused (not queued).
 * - Each write freezes a full mutable version through the store (quota,
 *   CAS, max+1), attributed `by: node:<session>`, `via: node-tool`; the
 *   session's frozen prompt does not change — the write is echoed in a live
 *   runtime context instead (§5).
 * @module @nelsonlongxiang/dsh-open-a2a-net/node-self
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MUTABLE_SECTIONS, QUOTA, type NodeResult, type NodeStore, type PromptVersion } from './node-store.ts'

export const SELF_UPDATE_DAILY_MAX = 8
/** Queued remote writes awaiting a human, across all nodes. */
export const REVIEW_QUEUE_MAX = 64

/**
 * Input sources that are THIS host: a person at this host's UI or RPC (`user`), and the harness's own
 * notices. Everything else — `a2a-relay` deliveries above all, and any kind not listed — is remote.
 */
const LOCAL_SOURCES: ReadonlySet<string> = new Set(['user', 'model-selection', 'tool-registry', 'ptc-mode', 'system-prompt'])

/**
 * Whether the current turn's input came from this host only. The turn is everything after the last
 * `turn/start`; a node reminder is local only when the HOST built it (`nodeReminder: true` on an
 * `a2a-relay` source — remote deliveries are relayed by this host with a fixed source shape, so a
 * remote caller cannot set that field). No turn start, or a turn without any input, is not local.
 */
export function turnSource(events: readonly unknown[]): { local: true } | { local: false; via: string } {
  let start = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if ((events[i] as { type?: unknown } | null)?.type === 'turn/start') { start = i; break }
  }
  if (start < 0) return { local: false, via: 'no-turn' }
  let inputs = 0
  for (const event of events.slice(start + 1)) {
    const e = event as { type?: unknown; data?: { source?: { kind?: unknown; nodeReminder?: unknown } } } | null
    if (e?.type !== 'user/message') continue
    inputs++
    const kind = e.data?.source?.kind
    if (typeof kind !== 'string') return { local: false, via: 'unknown' }
    if (kind === 'a2a-relay' && e.data?.source?.nodeReminder === true) continue
    if (!LOCAL_SOURCES.has(kind)) return { local: false, via: kind }
  }
  return inputs > 0 ? { local: true } : { local: false, via: 'no-input' }
}

export interface ReviewItem {
  readonly id: string
  readonly node: string
  readonly section: string
  readonly text: string
  readonly reason: string
  readonly expected_sha256: string
  readonly session: string
  /** Why it was parked: the remote source kind of the turn. */
  readonly via: string
  readonly at: string
}

const fail = <T>(code: 'bad-request' | 'not-found' | 'conflict' | 'quota' | 'unavailable', error: string): NodeResult<T> => ({ ok: false, code, error })

function itemOf(raw: unknown): ReviewItem | undefined {
  const r = raw as Partial<ReviewItem> | null
  if (r === null || typeof r !== 'object') return undefined
  const keys = ['id', 'node', 'section', 'text', 'reason', 'expected_sha256', 'session', 'via', 'at'] as const
  if (!keys.every(k => typeof r[k] === 'string')) return undefined
  if (!(MUTABLE_SECTIONS as readonly string[]).includes(r.section as string)) return undefined
  return r as ReviewItem
}

/** The human review queue for remote-turn self-updates (`node-review.json`; corrupt = kept in place, read-only). */
export class NodeReviewQueue {
  private items: ReviewItem[] = []
  private readOnlyReason = ''

  constructor(private readonly root: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.restore()
  }

  private get file(): string { return join(this.root, 'node-review.json') }

  private restore(): void {
    if (this.root === '' || !existsSync(this.file)) return
    let raw: unknown
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')) } catch { raw = undefined }
    const list = (raw as { items?: unknown } | null | undefined)?.items
    if (!Array.isArray(list)) {
      const aside = `${this.file}.corrupt-${this.now().replace(/[:.]/g, '-')}`
      try { copyFileSync(this.file, aside) } catch { /* the original stays in place either way */ }
      this.readOnlyReason = `node-review.json is unreadable (copy kept at ${aside}); repair it, then restart`
      return
    }
    for (const raw of list) {
      const item = itemOf(raw)
      if (item !== undefined && !this.items.some(i => i.id === item.id)) this.items.push(item)
    }
  }

  private commit(items: ReviewItem[]): NodeResult<true> {
    if (this.readOnlyReason !== '') return fail('unavailable', `the review queue is read-only: ${this.readOnlyReason}`)
    if (this.root !== '') {
      try {
        mkdirSync(this.root, { recursive: true })
        const tmp = `${this.file}.${String(process.pid)}.tmp`
        writeFileSync(tmp, JSON.stringify({ items }), { mode: 0o600 })
        renameSync(tmp, this.file)
      } catch (error) {
        return fail('unavailable', `could not persist node-review.json: ${String(error)}`)
      }
    }
    this.items = items
    return { ok: true, value: true }
  }

  get readOnly(): string { return this.readOnlyReason }
  list(node?: string): readonly ReviewItem[] { return node === undefined ? this.items : this.items.filter(i => i.node === node) }
  get(id: string): ReviewItem | undefined { return this.items.find(i => i.id === id) }

  add(input: Omit<ReviewItem, 'id' | 'at'>): NodeResult<ReviewItem> {
    if (this.items.length >= REVIEW_QUEUE_MAX) return fail('quota', `the review queue is full (${String(REVIEW_QUEUE_MAX)} items) — a human must clear it first`)
    const item: ReviewItem = { ...input, id: `rv-${randomBytes(6).toString('hex')}`, at: this.now() }
    const done = this.commit([...this.items, item])
    return done.ok ? { ok: true, value: item } : done
  }

  remove(id: string): NodeResult<true> {
    if (this.get(id) === undefined) return fail('not-found', `no review item ${id}`)
    return this.commit(this.items.filter(i => i.id !== id))
  }

  /** A node archived: its pending items go with it. */
  dropNode(node: string): void {
    if (this.items.some(i => i.node === node)) this.commit(this.items.filter(i => i.node !== node))
  }
}

/** Node writes (`by: node:…`) frozen for `node` on the UTC day of `now`. */
export function nodeWritesToday(store: NodeStore, node: string, now: string): number {
  const day = now.slice(0, 10)
  let n = 0
  for (const version of store.versions(node, 'mutable')) {
    const v = store.version(node, 'mutable', version)
    if (v !== undefined && typeof v.by === 'string' && v.by.startsWith('node:') && typeof v.at === 'string' && v.at.slice(0, 10) === day) n++
  }
  return n
}

export interface SelfUpdateDeps {
  readonly store: NodeStore
  readonly queue: NodeReviewQueue
  /** The calling session's event log (to judge where this turn's input came from). */
  readonly events: (agent: unknown) => readonly unknown[]
  readonly now?: () => string
  /** A write went through (the binder echoes it in the session's live context). */
  readonly onWritten: (session: string, version: PromptVersion, section: string) => void
}

export type SelfUpdateResult =
  | { ok: true; version: number; sha256: string }
  | { ok: false; error: string; queued?: string; code?: string }

/** One self-update call, decided. Pure over its deps (the tool below only adapts it). */
export function selfUpdate(d: SelfUpdateDeps, node: string, session: string, agent: unknown, args: Record<string, unknown>): SelfUpdateResult {
  const section = typeof args.section === 'string' ? args.section : ''
  if (!(MUTABLE_SECTIONS as readonly string[]).includes(section)) return { ok: false, code: 'bad-request', error: `section must be one of ${MUTABLE_SECTIONS.join(' / ')}` }
  if (typeof args.text !== 'string') return { ok: false, code: 'bad-request', error: 'text must be a string' }
  const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
  if (reason === '') return { ok: false, code: 'bad-request', error: 'reason is required' }
  const expected = typeof args.expected_sha256 === 'string' ? args.expected_sha256 : ''
  const source = turnSource(d.events(agent))
  if (!source.local) {
    const parked = d.queue.add({ node, section, text: args.text, reason, expected_sha256: expected, session, via: source.via })
    if (!parked.ok) return { ok: false, code: parked.code, error: `this turn's input came from outside this host (${source.via}); the write could not be queued for review: ${parked.error}` }
    return { ok: false, code: 'queued', queued: parked.value.id, error: `this turn's input came from outside this host (${source.via}), so the write was NOT applied: it waits for a human in the review queue (${parked.value.id})` }
  }
  const now = (d.now ?? (() => new Date().toISOString()))()
  if (nodeWritesToday(d.store, node, now) >= SELF_UPDATE_DAILY_MAX) return { ok: false, code: 'quota', error: `daily self-update cap reached (${String(SELF_UPDATE_DAILY_MAX)} per node per UTC day)` }
  const written = d.store.writeLayer(node, 'mutable', { [section]: args.text }, { expectedSha: expected, reason, by: `node:${session}`, via: 'node-tool' })
  if (!written.ok) return { ok: false, code: written.code, error: written.error }
  d.onWritten(session, written.value, section)
  return { ok: true, version: written.value.version, sha256: written.value.sha256 }
}

/** The tool registered on a bound session's own scope. */
export function selfUpdateTool(d: SelfUpdateDeps, node: string, session: string) {
  return defineTool({
    name: 'node_update_self',
    description:
      `Update one section of YOUR node's self-notes (node "${node}", the 节点自记 layer): 当前状态 / 执行要点 / 已知陷阱 / 当前重点. `
      + `Give the FULL new text of that section (≤${String(QUOTA.mutableSection)} characters), a reason, and the sha256 of the mutable layer you read `
      + '(the CAS guard; GET it from the nodes face or use the one this tool last returned). The new version takes effect from your next session; '
      + 'this session sees it as a runtime note. You cannot change your name, role, team or the 节点契约. A write in a turn whose input came from '
      + `outside this host is not applied — it is queued for a human. At most ${String(SELF_UPDATE_DAILY_MAX)} writes per node per day.`,
    parameters: {
      section: { type: 'string', required: true, enum: [...MUTABLE_SECTIONS], description: 'Which section to replace.' },
      text: { type: 'string', required: true, description: 'The full new text of that section.' },
      reason: { type: 'string', required: true, description: 'Why (recorded with the version).' },
      expected_sha256: { type: 'string', required: true, description: 'The current mutable layer sha256 ("" if the layer has no version yet).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          version: { type: 'number' },
          sha256: { type: 'string' },
          queued: { type: 'string', description: 'Review item id when the write was parked for a human.' },
          code: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok === true ? `节点自记已写入 v${String(value.version)}（sha256 ${String(value.sha256)}）` : `未写入：${String(value.error)}`,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'Node self-update', kind: 'other', rawInput: null }),
    execute: async (args, exec): Promise<SelfUpdateResult> => selfUpdate(d, node, session, (exec as { agent?: unknown } | undefined)?.agent, args as Record<string, unknown>),
  })
}
