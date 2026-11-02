/**
 * Node task pointers (docs/design/node-identity.md §2 "任务指针", §5 task context, §6; slice N6).
 *
 * - A pointer is `owner/repo#n` plus a CACHED state — GitHub is the truth
 *   (`open` / `merged` / `closed` / `declined`; `unknown` until a check
 *   answers). Each records the node's `core_version` and `mutable_version`
 *   when it was tracked (§6 归因).
 * - Kept in `node-tasks.json` under the a2a home, beside the roster rather
 *   than inside it: a cache that changes on every check must not rewrite
 *   the identity roster. The newest 64 per node stay; older ones are
 *   appended to `node-tasks-archive.jsonl`.
 * - Checks: once when a pointer is tracked, and a full pass on a timer
 *   (twice a day). A probe that cannot answer marks the check `unknown` and
 *   keeps the last known state; it never invents one.
 * - Reminder: only a pointer that was `open` and is now finished (merged /
 *   closed / declined) calls `onSettled` — a pointer first seen finished
 *   ended before it was tracked, and an unknown state never reminds.
 * - A file that does not parse is left in place and the table is read-only
 *   (as the roster and the bindings table are).
 * @module @nelsonlongxiang/dsh-open-a2a-net/node-tasks
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TASK_REF, type GithubProbe, type TaskState } from './node-github.ts'
import type { NodeResult } from './node-store.ts'

export const TASK_KEEP = 64
/** §5: the task context is generated, so it is truncated (not refused) at this many characters. */
export const TASKS_CONTEXT_MAX = 1500
/** §6 / §8-8: the full check runs twice a day. */
export const TASKS_CHECK_MS = 12 * 60 * 60 * 1000

export interface TaskPointer {
  readonly ref: string
  readonly state: TaskState | 'unknown'
  /** Whether the last check answered ('ok') or could not ('unknown': no credential, offline, …). */
  readonly check: 'ok' | 'unknown' | 'pending'
  readonly since: string
  readonly checked_at: string
  readonly core_version: number
  readonly mutable_version: number
  readonly by: string
}

const FINISHED: ReadonlySet<string> = new Set(['merged', 'closed', 'declined'])
const STATES: ReadonlySet<string> = new Set(['open', 'merged', 'closed', 'declined', 'unknown'])
const chars = (text: string): number => [...text].length
const fail = <T>(code: 'bad-request' | 'not-found' | 'conflict' | 'unavailable', error: string): NodeResult<T> => ({ ok: false, code, error })

function pointerOf(raw: unknown): TaskPointer | undefined {
  const r = raw as Partial<TaskPointer> | null
  if (r === null || typeof r !== 'object' || typeof r.ref !== 'string' || !TASK_REF.test(r.ref) || typeof r.state !== 'string' || !STATES.has(r.state)) return undefined
  const n = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0
  const s = (v: unknown): string => typeof v === 'string' ? v : ''
  return {
    ref: r.ref, state: r.state, check: r.check === 'ok' || r.check === 'unknown' ? r.check : 'pending',
    since: s(r.since), checked_at: s(r.checked_at), core_version: n(r.core_version), mutable_version: n(r.mutable_version), by: s(r.by),
  }
}

export interface NodeTasksDeps {
  readonly probe: GithubProbe
  readonly logger: { warn: (format: string, ...args: unknown[]) => void }
  /** A pointer that was open has finished (§6 主触发). */
  readonly onSettled: (node: string, pointer: TaskPointer) => void
  readonly now?: () => string
}

export class NodeTasks {
  private table: Record<string, TaskPointer[]> = {}
  private readOnlyReason = ''
  private running: Promise<void> | undefined
  private readonly now: () => string

  /** @param root - the `<home>/a2a` directory; '' keeps the table in memory (tests). */
  constructor(private readonly root: string, private readonly d: NodeTasksDeps) {
    this.now = d.now ?? (() => new Date().toISOString())
    this.restore()
  }

  private get file(): string { return join(this.root, 'node-tasks.json') }

  private restore(): void {
    if (this.root === '' || !existsSync(this.file)) return
    let raw: unknown
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')) } catch { raw = undefined }
    const tasks = (raw as { tasks?: unknown } | null | undefined)?.tasks
    if (raw === null || typeof raw !== 'object' || tasks === null || typeof tasks !== 'object' || Array.isArray(tasks)) {
      const aside = `${this.file}.corrupt-${this.now().replace(/[:.]/g, '-')}`
      try { copyFileSync(this.file, aside) } catch { /* the original stays in place either way */ }
      this.readOnlyReason = `node-tasks.json is unreadable (copy kept at ${aside}); repair it, then restart`
      return
    }
    for (const [node, list] of Object.entries(tasks as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const kept: TaskPointer[] = []
      for (const raw of list) {
        const p = pointerOf(raw)
        if (p !== undefined && !kept.some(k => k.ref === p.ref)) kept.push(p)
      }
      this.table[node] = kept
    }
  }

  private commit(next: Record<string, TaskPointer[]>, archived: Array<{ node: string; pointer: TaskPointer }> = []): NodeResult<true> {
    if (this.readOnlyReason !== '') return fail('unavailable', `node tasks are read-only: ${this.readOnlyReason}`)
    if (this.root !== '') {
      try {
        mkdirSync(this.root, { recursive: true })
        // The archive first: a pointer leaves the table only once it is written elsewhere.
        for (const a of archived) appendFileSync(join(this.root, 'node-tasks-archive.jsonl'), `${JSON.stringify({ node: a.node, ...a.pointer, archived_at: this.now() })}\n`, { mode: 0o600 })
        const tmp = `${this.file}.${String(process.pid)}.tmp`
        writeFileSync(tmp, JSON.stringify({ tasks: next }), { mode: 0o600 })
        renameSync(tmp, this.file)
      } catch (error) {
        return fail('unavailable', `could not persist node-tasks.json: ${String(error)}`)
      }
    }
    this.table = next
    return { ok: true, value: true }
  }

  get readOnly(): string { return this.readOnlyReason }
  list(node: string): readonly TaskPointer[] { return this.table[node] ?? [] }

  /** Track a pointer at the node's current versions; checks it once in the background. Re-tracking is a no-op. */
  track(node: string, ref: unknown, versions: { core: number; mutable: number }, by: string): NodeResult<TaskPointer> {
    if (typeof ref !== 'string' || !TASK_REF.test(ref)) return fail('bad-request', 'ref must be owner/repo#number')
    const list = this.list(node)
    const existing = list.find(p => p.ref === ref)
    if (existing !== undefined) return { ok: true, value: existing }
    const pointer: TaskPointer = { ref, state: 'unknown', check: 'pending', since: this.now(), checked_at: '', core_version: versions.core, mutable_version: versions.mutable, by }
    const all = [pointer, ...list]
    const kept = all.slice(0, TASK_KEEP)
    const done = this.commit({ ...this.table, [node]: kept }, all.slice(TASK_KEEP).map(p => ({ node, pointer: p })))
    if (!done.ok) return done
    void this.check(node, ref)
    return { ok: true, value: pointer }
  }

  untrack(node: string, ref: unknown): NodeResult<true> {
    const list = this.list(node)
    if (typeof ref !== 'string' || !list.some(p => p.ref === ref)) return fail('not-found', `${node} does not track ${String(ref)}`)
    return this.commit({ ...this.table, [node]: list.filter(p => p.ref !== ref) })
  }

  /** An archived node's pointers move to the archive file. */
  dropNode(node: string): void {
    const list = this.list(node)
    if (list.length === 0) return
    const next = { ...this.table }
    delete next[node]
    const done = this.commit(next, list.map(pointer => ({ node, pointer })))
    if (!done.ok) this.d.logger.warn('a2a nodes: could not archive the task pointers of %s: %s', node, done.error)
  }

  /** Check one pointer now. Never throws. */
  async check(node: string, ref: string): Promise<void> {
    let state: TaskState | undefined
    try { state = await this.d.probe(ref) } catch { state = undefined }
    // Re-read after the await: the table may have changed meanwhile.
    const list = this.list(node)
    const before = list.find(p => p.ref === ref)
    if (before === undefined) return
    const after: TaskPointer = state === undefined
      ? { ...before, check: 'unknown', checked_at: this.now() }
      : { ...before, state, check: 'ok', checked_at: this.now() }
    const done = this.commit({ ...this.table, [node]: list.map(p => p.ref === ref ? after : p) })
    if (!done.ok) {
      this.d.logger.warn('a2a nodes: checked %s for %s but could not record it: %s', ref, node, done.error)
      return
    }
    if (before.state === 'open' && state !== undefined && FINISHED.has(state)) {
      try { this.d.onSettled(node, after) } catch (error) { this.d.logger.warn('a2a nodes: reminder for %s failed: %s', ref, String(error)) }
    }
  }

  /** The full pass: every pointer not yet finished, one at a time. A pass already running is joined. */
  checkAll(): Promise<void> {
    this.running ??= (async () => {
      try {
        for (const [node, list] of Object.entries(this.table)) {
          for (const p of list) if (!FINISHED.has(p.state)) await this.check(node, p.ref)
        }
      } finally {
        this.running = undefined
      }
    })()
    return this.running
  }

  /** §5 task context: open first, then newest; truncated (never refused) at {@link TASKS_CONTEXT_MAX}. '' when none. */
  render(node: string): string {
    const list = [...this.list(node)].sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || (a.since < b.since ? 1 : a.since > b.since ? -1 : 0))
    if (list.length === 0) return ''
    const head = '## 节点任务（a2a:node:tasks）\n\n以 GitHub 为准，这里是缓存：「未知」表示这次没能核对（没有凭证或离线）。'
    const label = (p: TaskPointer): string => p.state === 'unknown' ? '未知' : p.check === 'unknown' ? `${p.state}（未能核对）` : p.state
    const lines = list.map(p => `- ${label(p)}　${p.ref}（自 ${p.since.slice(0, 10)}，契约 v${String(p.core_version)} / 自记 v${String(p.mutable_version)}）`)
    const out = [head, '']
    let used = chars(head) + 2
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string
      const rest = lines.length - i - 1
      const tail = rest > 0 ? chars(`\n另有 ${String(rest)} 条，见 GitHub。`) : 0
      if (used + chars(line) + 1 + tail > TASKS_CONTEXT_MAX) {
        out.push(`另有 ${String(lines.length - i)} 条，见 GitHub。`)
        break
      }
      out.push(line)
      used += chars(line) + 1
    }
    return out.join('\n')
  }
}
