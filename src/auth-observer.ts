/**
 * Allowlist change observer (gh#114 S6, design docs/design/114-task-authorization.md §5).
 *
 * When the records admission reads change — joins, canvas membership, roster
 * declarations, CLI deposits, peer seeds — the allowlist version (§2.3)
 * moves. This module keeps the version history and, on every move, re-judges
 * the unsettled tasks that carry an authorization record against the CURRENT
 * records, producing an "affected tasks" list.
 *
 * OBSERVE MODE ONLY. Nothing here cancels a task, changes a row's state,
 * nudges a session or blocks a receipt: the judgement is a pure read and its
 * output is a record. Enforcing it (revalidate before resume, design §5 last
 * paragraph) needs its own owner ruling.
 *
 * Persistence at `<dsh-home>/a2a/auth-versions.json`, two rings of
 * {@link AUTH_HISTORY_CAP}: the version history `{version, at, cause, inputs}`
 * and the affected-task entries. A corrupt file is dropped whole; malformed
 * entries are dropped one by one. No timers: the host calls {@link observe}
 * lazily and at its known change points.
 * @module @nelsonlongxiang/dsh-open-a2a-net/auth-observer
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Admission, TaskAuthorization } from './task-auth.ts'

/** Ring size of both the version history and the affected-task entries. */
export const AUTH_HISTORY_CAP = 32

/** Longest refusal text kept on an affected task (the faces' texts fit; a longer one is cut, flagged by `…`). */
export const AFFECTED_REASON_CAP = 400

/** One recorded allowlist version and what it hashed. */
export interface AuthVersionEntry {
  readonly version: string
  readonly at: number
  /** Why it was observed: `boot`, `joined`, `canvas`, `roster`, or `lazy` (a read noticed a change no hook reported — CLI expiry, config). */
  readonly cause: string
  /** The canonical inputs (task-auth.ts canonicalAllowlist), parsed. */
  readonly inputs: unknown
}

/**
 * One task's re-judgement. `basis-changed`: still admitted, but on teams that
 * no longer overlap the record's; `would-revoke`: today's records refuse the
 * caller — `reason` is that refusal text.
 */
export interface AffectedTask {
  readonly taskId: string
  readonly direction: 'inbound' | 'outbound'
  readonly caller: string
  readonly target: string
  readonly verdict: 'basis-changed' | 'would-revoke'
  readonly reason: string
}

/** One observation that found affected tasks. */
export interface AffectedEntry {
  readonly at: number
  /** The previously recorded version; null when there was no history yet. */
  readonly from_version: string | null
  readonly to_version: string
  readonly cause: string
  readonly tasks: readonly AffectedTask[]
}

/** The minimum of a ledger row the judgement reads. */
export interface JudgedRow {
  readonly taskId: string
  readonly direction?: 'inbound' | 'outbound'
  readonly auth?: TaskAuthorization
}

/**
 * Re-judge rows against today's records — pure: `judge` must be a read-only
 * admission decision (task-auth.ts callerAdmission over the live records).
 * A row is judged when it carries a record and either was born under another
 * version than `version` or `cacheResting(row)` says its admission rests on
 * the peer-card cache (`peer-org`, which the version does not hash; by
 * default: the birth record's `via`).
 * @returns the affected rows, in ledger order; unaffected rows are omitted.
 */
export function judgeAffected(rows: readonly JudgedRow[], version: string, judge: (caller: string, target: string) => Admission, cacheResting: (row: JudgedRow) => boolean = bornOnCache): AffectedTask[] {
  const affected: AffectedTask[] = []
  for (const row of rows) {
    const outcome = judgeRow(row, version, judge, cacheResting)
    if (outcome?.task !== undefined) affected.push(outcome.task)
  }
  return affected
}

const bornOnCache = (row: JudgedRow): boolean => row.auth?.via === 'peer-org'

/** One row's re-judgement: undefined when the row is not judged; `task` only when it is affected. */
function judgeRow(row: JudgedRow, version: string, judge: (caller: string, target: string) => Admission, cacheResting: (row: JudgedRow) => boolean): { admission: Admission; task?: AffectedTask } | undefined {
  const auth = row.auth
  if (auth === undefined) return undefined
  if (auth.allowlist_version === version && !cacheResting(row)) return undefined
  const verdict = judge(auth.caller, auth.target)
  const base = { taskId: row.taskId, direction: row.direction ?? 'inbound', caller: auth.caller, target: auth.target }
  if (!verdict.ok) {
    const reason = verdict.refusal.length <= AFFECTED_REASON_CAP ? verdict.refusal : `${verdict.refusal.slice(0, AFFECTED_REASON_CAP - 1)}…`
    return { admission: verdict, task: { ...base, verdict: 'would-revoke', reason } }
  }
  if (basisHolds(auth.basis, auth.admission_rule, verdict)) return { admission: verdict }
  return { admission: verdict, task: { ...base, verdict: 'basis-changed', reason: `admitted by ${verdict.rule} on [${verdict.basis.join(', ')}], was ${auth.admission_rule} on [${auth.basis.join(', ')}]` } }
}

/**
 * The dedupe key of a report: `would-revoke` is one state whatever the
 * refusal text (one /leave writes three stores, each worded differently);
 * `basis-changed` is keyed by the new rule and basis its reason names.
 */
const reportKey = (task: AffectedTask): string => (task.verdict === 'would-revoke' ? 'would-revoke' : `basis-changed\n${task.reason}`)

/**
 * Whether today's admission still rests on the record's basis: the shared
 * teams overlap, or — for basis-less rules (host-face, node-fact,
 * cli-deposit, scope-off) — the same rule admits again.
 */
function basisHolds(was: readonly string[], wasRule: string, now: Extract<Admission, { ok: true }>): boolean {
  if (was.length === 0 && now.basis.length === 0) return now.rule === wasRule
  return was.some(team => now.basis.includes(team))
}

/** What one {@link AuthObserver.observe} call needs from the host. */
export interface ObserveInput {
  readonly version: string
  /** The canonical inputs the version hashed (recorded with a new version). */
  readonly inputs: () => unknown
  readonly cause: string
  readonly rows: () => readonly JudgedRow[]
  readonly judge: (caller: string, target: string) => Admission
}

interface Snapshot {
  readonly versions?: unknown
  readonly affected?: unknown
}

/**
 * The persisted observer. One instance per host; every entry point is
 * total and never throws (an unwritable home degrades to memory-only).
 */
export class AuthObserver {
  private versions: AuthVersionEntry[] = []
  private affected: AffectedEntry[] = []
  /**
   * The last report per task ({@link reportKey}), so a task still affected
   * the same way is not listed again — on a peer-org recheck poll, nor on a
   * later unrelated version move. A task judged unaffected is forgotten, so
   * a relapse reports again; a task gone from the rows is pruned.
   * Boot-local by design: after a restart the next version change reports
   * afresh.
   */
  private readonly reported = new Map<string, string>()
  /**
   * The rule of each task's latest passing judgement. Whether a row rests on
   * the peer-card cache is read from here first, the birth record second: a
   * row born remote-ref-samezone that today passes only through `peer-org`
   * is rechecked like one born there (and stops being once a firm rule
   * admits it again).
   */
  private readonly lastRule = new Map<string, string>()

  constructor(private readonly path: string, private readonly now: () => number = Date.now) {
    this.restore()
  }

  /** The version history, newest first. */
  history(): readonly AuthVersionEntry[] {
    return [...this.versions]
  }

  /** The affected-task entries, newest first. */
  entries(): readonly AffectedEntry[] {
    return [...this.affected]
  }

  /**
   * Record the current version when it moved, and re-judge.
   * - Version moved: append it to the history; judge every row born under
   *   another version and every cache-resting row.
   * - Version unchanged: only cache-resting rows are re-judged.
   * - Cause `boot`: cache-resting rows are not judged at all — the peer-card
   *   cache is empty at boot, so every one of them would read as refused.
   *   The first read after boot (`lazy`) rechecks them.
   * Either way a task is reported only when its report differs from the
   * last one for it ({@link reportKey}).
   * @returns the new affected entry, or undefined when nothing was affected.
   */
  observe(input: ObserveInput): AffectedEntry | undefined {
    try {
      const last = this.versions[0]?.version ?? null
      const moved = last !== input.version
      if (moved) {
        this.versions = [{ version: input.version, at: this.now(), cause: input.cause, inputs: input.inputs() }, ...this.versions].slice(0, AUTH_HISTORY_CAP)
      }
      const all = input.rows()
      this.prune(all)
      const cacheResting = (row: JudgedRow): boolean => {
        const rule = this.lastRule.get(row.taskId)
        return rule !== undefined ? rule === 'peer-org' : bornOnCache(row)
      }
      const coldCache = input.cause === 'boot'
      const rows = all.filter(row => (coldCache ? !cacheResting(row) : moved || cacheResting(row)))
      const tasks: AffectedTask[] = []
      for (const row of rows) {
        const outcome = judgeRow(row, input.version, input.judge, cacheResting)
        if (outcome === undefined) continue
        if (outcome.admission.ok) this.lastRule.set(row.taskId, outcome.admission.rule)
        if (outcome.task === undefined) {
          this.reported.delete(row.taskId)
          continue
        }
        const key = reportKey(outcome.task)
        if (this.reported.get(row.taskId) === key) continue
        this.reported.set(row.taskId, key)
        tasks.push(outcome.task)
      }
      if (tasks.length === 0) {
        if (moved) this.persist()
        return undefined
      }
      const entry: AffectedEntry = { at: this.now(), from_version: moved ? last : input.version, to_version: input.version, cause: moved ? input.cause : 'peer-org-recheck', tasks }
      this.affected = [entry, ...this.affected].slice(0, AUTH_HISTORY_CAP)
      this.persist()
      return entry
    } catch {
      // Observation is bookkeeping: a failure here must never reach routing.
      return undefined
    }
  }

  /** Forget the per-task memory of tasks no longer among the unsettled rows. */
  private prune(rows: readonly JudgedRow[]): void {
    const live = new Set(rows.map(row => row.taskId))
    for (const map of [this.reported, this.lastRule]) {
      for (const taskId of map.keys()) if (!live.has(taskId)) map.delete(taskId)
    }
  }

  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as Snapshot | null
      const versions = Array.isArray(snapshot?.versions) ? snapshot.versions : []
      const affected = Array.isArray(snapshot?.affected) ? snapshot.affected : []
      this.versions = versions.map(parseVersion).filter((entry): entry is AuthVersionEntry => entry !== undefined).slice(0, AUTH_HISTORY_CAP)
      this.affected = affected.map(parseAffected).filter((entry): entry is AffectedEntry => entry !== undefined).slice(0, AUTH_HISTORY_CAP)
    } catch {
      // A corrupt file is dropped whole: the next observation starts a fresh history.
      this.versions = []
      this.affected = []
    }
  }

  private persist(): void {
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      // tmp + rename: a crash mid-write leaves the previous file, never a torn one.
      const tmp = `${this.path}.${String(process.pid)}.tmp`
      writeFileSync(tmp, JSON.stringify({ versions: this.versions, affected: this.affected }), { mode: 0o600 })
      renameSync(tmp, this.path)
    } catch {
      // An unwritable home must not break routing; the history degrades to memory-only.
    }
  }
}

const VERSION_SHAPE = /^al1:[0-9a-f]{16}$/
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const finiteTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const shortString = (v: unknown, cap = 256): v is string => typeof v === 'string' && v !== '' && v.length <= cap

function parseVersion(raw: unknown): AuthVersionEntry | undefined {
  if (!isRecord(raw)) return undefined
  if (typeof raw.version !== 'string' || !VERSION_SHAPE.test(raw.version) || !finiteTime(raw.at) || !shortString(raw.cause, 64)) return undefined
  return { version: raw.version, at: raw.at, cause: raw.cause, inputs: raw.inputs ?? null }
}

function parseAffected(raw: unknown): AffectedEntry | undefined {
  if (!isRecord(raw) || !finiteTime(raw.at) || !shortString(raw.cause, 64)) return undefined
  if (typeof raw.to_version !== 'string' || !VERSION_SHAPE.test(raw.to_version)) return undefined
  if (raw.from_version !== null && (typeof raw.from_version !== 'string' || !VERSION_SHAPE.test(raw.from_version))) return undefined
  if (!Array.isArray(raw.tasks)) return undefined
  const tasks: AffectedTask[] = []
  for (const task of raw.tasks) {
    if (!isRecord(task)) return undefined
    if (!shortString(task.taskId) || !shortString(task.caller) || !shortString(task.target)) return undefined
    if (task.direction !== 'inbound' && task.direction !== 'outbound') return undefined
    if (task.verdict !== 'basis-changed' && task.verdict !== 'would-revoke') return undefined
    if (!shortString(task.reason, AFFECTED_REASON_CAP + 200)) return undefined
    tasks.push({ taskId: task.taskId, direction: task.direction, caller: task.caller, target: task.target, verdict: task.verdict, reason: task.reason })
  }
  return { at: raw.at, from_version: raw.from_version, to_version: raw.to_version, cause: raw.cause, tasks }
}
