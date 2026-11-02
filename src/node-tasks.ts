/**
 * Node task pointers (docs/design/node-identity.md §2 "任务指针", §5 task context, §6; slice N6).
 *
 * - A pointer is `owner/repo#n` plus a CACHED state — GitHub is the truth
 *   (`open` / `merged` / `closed` / `declined`; `unknown` until a check
 *   answers). Each records the node's `core_version` and `mutable_version`
 *   when it was tracked (§6 归因).
 * - Kept in `node-tasks.json` under the a2a home, beside the roster rather
 *   than inside it: a cache that changes on every check must not rewrite
 *   the identity roster. The newest 64 per node stay — finished pointers are
 *   evicted before open ones — and evicted ones are appended to
 *   `node-tasks-archive.jsonl`.
 * - Checks: once when a pointer is tracked, a full pass right after the
 *   plugin loads, and a full pass every 12 hours. Finished pointers are not
 *   re-checked (a re-opened issue keeps reading finished — the cost of not
 *   polling finished work). One check per ref at a time; a finished state
 *   is never walked back to open by a late answer. A probe that cannot
 *   answer marks the check `unknown` and keeps the last known state.
 * - Reminder (§6 主触发): a pointer that finished AFTER it was tracked —
 *   it was `open` here, or GitHub's merged_at / closed_at is later than
 *   `since` — calls `onSettled` once. A pointer that finished before it
 *   was tracked, or whose finish time cannot be told, does not remind; an
 *   unknown state never does. A reminder that reached no session (a cold
 *   host boot: the load-time pass runs before any session is live) is kept
 *   as `remind_pending` and handed out the next time the node mounts on a
 *   session (`takePending`), so a merge during downtime is not swallowed.
 *   The finish-time comparison trusts the host clock; skew of a few minutes
 *   can add or drop a reminder for a pointer whose first check failed.
 * - After the plugin unloads (`dispose`), a check still in flight neither
 *   writes nor reminds: a newer instance owns the file by then.
 * - A file that does not parse is left in place and the table is read-only;
 *   malformed rows are backed up before the next write drops them (as the
 *   roster and the bindings table do).
 * @module @nelsonlongxiang/dsh-open-a2a-net/node-tasks
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TASK_REF, type GithubProbe, type TaskFact, type TaskState } from './node-github.ts'
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
  /** A reminder is owed: it finished, but no live session carried the node at the time. */
  readonly remind_pending?: true
}

/** The §6 reminder for a pointer that finished. */
export function settledReminder(p: TaskPointer): string {
  const verb = p.state === 'merged' ? '合并' : p.state === 'declined' ? '被拒' : '关闭'
  return `[节点复盘] ${p.ref} 已${verb}。这件事告一段落：按需更新节点自记（当前状态、执行要点、已知陷阱、当前重点）。`
}

const FINISHED: ReadonlySet<string> = new Set(['merged', 'closed', 'declined'])
const STATES: ReadonlySet<string> = new Set(['open', 'merged', 'closed', 'declined', 'unknown'])
/** ISO-8601 instants only: a hand-edited `since` must not carry text into the task context. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const chars = (text: string): number => [...text].length
const fail = <T>(code: 'bad-request' | 'not-found' | 'conflict' | 'unavailable', error: string): NodeResult<T> => ({ ok: false, code, error })

function pointerOf(raw: unknown): TaskPointer | undefined {
  const r = raw as Partial<TaskPointer> | null
  if (r === null || typeof r !== 'object' || typeof r.ref !== 'string' || !TASK_REF.test(r.ref) || typeof r.state !== 'string' || !STATES.has(r.state)) return undefined
  if (typeof r.since !== 'string' || !ISO.test(r.since)) return undefined
  const n = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0
  return {
    ref: r.ref, state: r.state, check: r.check === 'ok' || r.check === 'unknown' ? r.check : 'pending',
    since: r.since, checked_at: typeof r.checked_at === 'string' && ISO.test(r.checked_at) ? r.checked_at : '',
    core_version: n(r.core_version), mutable_version: n(r.mutable_version), by: typeof r.by === 'string' ? r.by.slice(0, 80) : '',
    ...(r.remind_pending === true && FINISHED.has(r.state) ? { remind_pending: true as const } : {}),
  }
}

/** Whether a fresh answer means the pointer finished after it was tracked (see the module note). */
function finishedSinceTracked(before: TaskPointer, fact: TaskFact): boolean {
  if (!FINISHED.has(fact.state) || FINISHED.has(before.state)) return false
  if (before.state === 'open') return true
  const at = fact.finishedAt === undefined ? Number.NaN : Date.parse(fact.finishedAt)
  const since = Date.parse(before.since)
  return Number.isFinite(at) && Number.isFinite(since) && at >= since
}

/** The part of a Cordis context the table schedules on. */
export interface TaskSchedule {
  readonly timer: { interval(cb: () => void, ms: number): unknown; timeout(cb: () => void, ms: number): unknown }
  effect(execute: () => () => void, label?: string): unknown
}

export interface NodeTasksDeps {
  readonly probe: GithubProbe
  readonly logger: { warn: (format: string, ...args: unknown[]) => void }
  /** A pointer finished after it was tracked (§6 主触发); returns how many sessions got the reminder. */
  readonly onSettled: (node: string, pointer: TaskPointer) => number
  readonly now?: () => string
}

export class NodeTasks {
  private table: Record<string, TaskPointer[]> = {}
  private readOnlyReason = ''
  private running: Promise<void> | undefined
  private readonly inflight = new Map<string, Promise<void>>()
  private disposed = false
  private readonly now: () => string

  /** @param root - the `<home>/a2a` directory; '' keeps the table in memory (tests). */
  constructor(private readonly root: string, private readonly d: NodeTasksDeps) {
    this.now = d.now ?? (() => new Date().toISOString())
    this.restore()
  }

  private get file(): string { return join(this.root, 'node-tasks.json') }
  private stamp(): string { return this.now().replace(/[:.]/g, '-') }

  private restore(): void {
    if (this.root === '' || !existsSync(this.file)) return
    let raw: unknown
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')) } catch { raw = undefined }
    const tasks = (raw as { tasks?: unknown } | null | undefined)?.tasks
    if (raw === null || typeof raw !== 'object' || tasks === null || typeof tasks !== 'object' || Array.isArray(tasks)) {
      const aside = `${this.file}.corrupt-${this.stamp()}`
      try { copyFileSync(this.file, aside) } catch { /* the original stays in place either way */ }
      this.readOnlyReason = `node-tasks.json is unreadable (copy kept at ${aside}); repair it, then restart`
      return
    }
    let dropped = 0
    for (const [node, list] of Object.entries(tasks as Record<string, unknown>)) {
      if (!Array.isArray(list)) { dropped++; continue }
      const kept: TaskPointer[] = []
      for (const raw of list) {
        const p = pointerOf(raw)
        if (p === undefined || kept.some(k => k.ref === p.ref)) dropped++
        else kept.push(p)
      }
      this.table[node] = kept
    }
    // The next commit rewrites the table without the dropped rows: keep the original first.
    if (dropped > 0) {
      try { copyFileSync(this.file, `${this.file}.dropped-${this.stamp()}`) } catch { /* best effort; the rows were unusable either way */ }
    }
  }

  private commit(next: Record<string, TaskPointer[]>, archived: Array<{ node: string; pointer: TaskPointer }> = []): NodeResult<true> {
    if (this.disposed) return fail('unavailable', 'node tasks were unloaded')
    if (this.readOnlyReason !== '') return fail('unavailable', `node tasks are read-only: ${this.readOnlyReason}`)
    if (this.root !== '') {
      try {
        mkdirSync(this.root, { recursive: true })
        const tmp = `${this.file}.${String(process.pid)}.tmp`
        writeFileSync(tmp, JSON.stringify({ tasks: next }), { mode: 0o600 })
        // The archive is appended after the new table is staged and before it replaces the old one: a failed
        // staging write leaves no archive rows; a crash (or a failed rename) after the append leaves the pointer
        // in BOTH files — a duplicate, never a loss.
        for (const a of archived) appendFileSync(join(this.root, 'node-tasks-archive.jsonl'), `${JSON.stringify({ node: a.node, ...a.pointer, archived_at: this.now() })}\n`, { mode: 0o600 })
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

  /**
   * Run the checks on the plugin's context: one full pass right after load (a restart within 12 hours
   * would otherwise never check), one every 12 hours, and stop writing once the plugin unloads.
   */
  schedule(ctx: TaskSchedule): void {
    ctx.effect(() => () => { this.disposed = true }, 'a2a: node tasks')
    ctx.timer.timeout(() => { void this.checkAll() }, 0)
    ctx.timer.interval(() => { void this.checkAll() }, TASKS_CHECK_MS)
  }

  /** Track a pointer at the node's current versions; checks it once in the background. Re-tracking is a no-op. */
  track(node: string, ref: unknown, versions: { core: number; mutable: number }, by: string): NodeResult<TaskPointer> {
    if (typeof ref !== 'string' || !TASK_REF.test(ref)) return fail('bad-request', 'ref must be owner/repo#number')
    const list = this.list(node)
    const existing = list.find(p => p.ref === ref)
    if (existing !== undefined) return { ok: true, value: existing }
    const pointer: TaskPointer = { ref, state: 'unknown', check: 'pending', since: this.now(), checked_at: '', core_version: versions.core, mutable_version: versions.mutable, by }
    // Over the cap, finished pointers go first (oldest first), then the oldest open ones.
    const all = [pointer, ...list]
    const evict = new Set<string>()
    for (const p of [...all].reverse()) {
      if (all.length - evict.size <= TASK_KEEP) break
      if (FINISHED.has(p.state)) evict.add(p.ref)
    }
    for (const p of [...all].reverse()) {
      if (all.length - evict.size <= TASK_KEEP) break
      if (p !== pointer) evict.add(p.ref)
    }
    const done = this.commit({ ...this.table, [node]: all.filter(p => !evict.has(p.ref)) }, all.filter(p => evict.has(p.ref)).map(p => ({ node, pointer: p })))
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

  /** Check one pointer now; joins a check of the same pointer already in flight. Never throws. */
  check(node: string, ref: string): Promise<void> {
    const key = `${node}\u0000${ref}`
    const running = this.inflight.get(key)
    if (running !== undefined) return running
    const run = this.checkOnce(node, ref).finally(() => { this.inflight.delete(key) })
    this.inflight.set(key, run)
    return run
  }

  private async checkOnce(node: string, ref: string): Promise<void> {
    let fact: TaskFact | undefined
    try { fact = await this.d.probe(ref) } catch { fact = undefined }
    if (this.disposed) return
    // Re-read after the await: the pointer may have been untracked, or the node archived, meanwhile.
    const list = this.list(node)
    const before = list.find(p => p.ref === ref)
    if (before === undefined) return
    const after: TaskPointer = fact === undefined
      ? { ...before, check: 'unknown', checked_at: this.now() }
      // A finished state is final here: a late answer never walks it back.
      : { ...before, state: FINISHED.has(before.state) ? before.state : fact.state, check: 'ok', checked_at: this.now() }
    const done = this.commit({ ...this.table, [node]: list.map(p => p.ref === ref ? after : p) })
    if (!done.ok) {
      this.d.logger.warn('a2a nodes: checked %s for %s but could not record it: %s', ref, node, done.error)
      return
    }
    if (fact !== undefined && finishedSinceTracked(before, fact)) {
      let reached = 0
      try { reached = this.d.onSettled(node, after) } catch (error) { this.d.logger.warn('a2a nodes: reminder for %s failed: %s', ref, String(error)) }
      // Nobody carried the node right now (e.g. a cold boot): owe it to the next session that mounts it.
      if (reached === 0) this.setPending(node, ref, true)
    }
  }

  private setPending(node: string, ref: string, pending: boolean): void {
    const list = this.list(node)
    if (!list.some(p => p.ref === ref)) return
    const done = this.commit({ ...this.table, [node]: list.map(p => {
      if (p.ref !== ref) return p
      const { remind_pending: _drop, ...rest } = p
      return pending ? { ...rest, remind_pending: true as const } : rest
    }) })
    if (!done.ok) this.d.logger.warn('a2a nodes: could not record the owed reminder for %s: %s', ref, done.error)
  }

  /**
   * The reminders owed to `node`, cleared as they are handed out (one session gets each). A clear that
   * cannot be written still hands them out — a reminder may then repeat after a restart, never vanish.
   */
  takePending(node: string): TaskPointer[] {
    const owed = this.list(node).filter(p => p.remind_pending === true)
    for (const p of owed) this.setPending(node, p.ref, false)
    return owed
  }

  /** The full pass: every pointer not yet finished, one at a time. A pass already running is joined. */
  checkAll(): Promise<void> {
    this.running ??= (async () => {
      try {
        for (const [node, list] of Object.entries(this.table)) {
          for (const p of list) {
            if (this.disposed) return
            if (!FINISHED.has(p.state)) await this.check(node, p.ref)
          }
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
