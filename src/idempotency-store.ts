/**
 * Server-side idempotency key uniqueness (work-order P3 / B3 ruling).
 *
 * Caller-born task ids are single-use by contract; until now the server only
 * deduped its own ledger rows. This store closes the execution-side gap: the
 * FIRST claim of a key inside the TTL window executes, a same-key replay of
 * the identical payload answers `replay` (the prior attempt owns whatever
 * outcome it produced — never re-steer, never double-bill), and a same-key
 * DIFFERENT payload is a hard `conflict`. All three verdicts are plain data;
 * the endpoint maps them to 200/409(-32003)/409(-32002).
 *
 * W7 slice 2: the claim row now also RETAINS the prior attempt's settled
 * outcome (when a settlement hook recorded one), and {@link query} answers
 * the read-only `/a2a/query` surface — the retrieval half of the S1
 * recovery row. The fingerprint that guards a claim is the same value that
 * authorizes a query: presenting {@link peerPayloadFingerprint} of the
 * original submit means holding the original payload.
 *
 * Persistence at `<dsh-home>/a2a/idempotency.json`; TTL prunes lazily on
 * every entry point (no timers — this host restarts too often), capacity
 * evicts oldest-inserted first, and every failure degrades to memory-only.
 * Never throws: orchestrator settlement paths fire here repeatedly under
 * conditions nobody can predict.
 * @module @nelsonlongxiang/dsh-open-a2a-net/idempotency-store
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** How long one claimed key blocks re-execution. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000

/** Capacity before oldest-inserted eviction (a window, not an archive). */
export const IDEMPOTENCY_CAP = 256

/** Wire code: same key came back with a DIFFERENT payload inside the window. */
export const WIRE_ERROR_IDEMPOTENCY_CONFLICT = -32002

/** Wire code: exact replay — refused so the prior run stays authoritative. */
export const WIRE_ERROR_REPLAY_REJECTED = -32003

/** Cap on one stored outcome text; truncation is flagged, never silent. */
export const OUTCOME_TEXT_CAP = 65_536

/** The three claim verdicts; stable vocabulary per the consumer contract. */
export type ClaimVerdict = 'fresh' | 'replay' | 'conflict'

/**
 * The payload fingerprint of one A2A submit — the shared implementation the
 * gate claims with, the query endpoint re-verifies with, and the caller-side
 * bridge face recomputes from the exact submit fields. ONE implementation by
 * contract (W7 slice 2): any drift across those three roles would turn
 * honest outcome queries into phantom payload-mismatch verdicts. The field
 * order below IS the wire format; do not reorder.
 */
export function peerPayloadFingerprint(input: {
  readonly caller: string
  readonly message: string
  readonly noWait: boolean
  readonly team: string
}): string {
  return createHash('sha256')
    .update(JSON.stringify({ caller: input.caller, message: input.message, noWait: input.noWait, team: input.team }))
    .digest('hex')
}

/** The settled outcome of the execution that earned a claim (W7 slice 2). */
export interface TaskOutcome {
  readonly status: 'completed' | 'failed'
  /** The settled round text (completed rows). */
  readonly reply?: string
  /** The failure prose (failed rows). */
  readonly error?: string
  /** True when the stored text was cut to {@link OUTCOME_TEXT_CAP}. */
  readonly truncated?: boolean
}

/**
 * The read-only answer for one outcome lookup. `pending` honestly means
 * "in flight OR the outcome was never registered" — the two are
 * indistinguishable from outside, and the answer pretends otherwise for
 * neither (old snapshots restored without outcomes, hooks that never fire
 * for a delivery mode, all land here).
 */
export type StoredQueryVerdict =
  | { readonly found: false; readonly reason: 'unknown-task' | 'payload-mismatch' }
  | { readonly found: true; readonly status: 'pending' }
  | {
    readonly found: true
    readonly status: 'completed'
    readonly reply: string
    /** Settle time (epoch ms); the endpoint maps it to wire ISO. */
    readonly settledAt: number
    readonly truncated?: boolean
  }
  | {
    readonly found: true
    readonly status: 'failed'
    readonly error: string
    /** Settle time (epoch ms); the endpoint maps it to wire ISO. */
    readonly settledAt: number
    readonly truncated?: boolean
  }

interface ClaimedKey {
  readonly fingerprint: string
  readonly at: number
  readonly outcome?: TaskOutcome
  readonly settledAt?: number
}

export interface IdempotencyOptions {
  /** TTL override (tests inject short windows); defaults to {@link IDEMPOTENCY_TTL_MS}. */
  ttlMs?: number
  /** Capacity override; defaults to {@link IDEMPOTENCY_CAP}. */
  cap?: number
  /** Clock injection for deterministic expiry tests. */
  now?: () => number
}

interface Snapshot {
  readonly entries?: ReadonlyArray<{
    readonly taskId: string
    readonly fingerprint: string
    readonly at: number
    readonly outcome?: TaskOutcome
    readonly settledAt?: number
  }>
}

/** Cap the stored text; truncation is flagged, never silent. */
function capOutcome(outcome: TaskOutcome): TaskOutcome {
  const text = outcome.reply ?? outcome.error
  if (text === undefined || text.length <= OUTCOME_TEXT_CAP) return outcome
  return outcome.reply !== undefined
    ? { ...outcome, reply: outcome.reply.slice(0, OUTCOME_TEXT_CAP), truncated: true }
    : { ...outcome, error: outcome.error!.slice(0, OUTCOME_TEXT_CAP), truncated: true }
}

/** A corrupt persisted outcome degrades to no-outcome (pending), never blocks restore. */
function restoreOutcome(raw: unknown): TaskOutcome | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as Partial<TaskOutcome>
  if (candidate.status !== 'completed' && candidate.status !== 'failed') return undefined
  return {
    status: candidate.status,
    ...(typeof candidate.reply === 'string' ? { reply: candidate.reply } : {}),
    ...(typeof candidate.error === 'string' ? { error: candidate.error } : {}),
    ...(candidate.truncated === true ? { truncated: true } : {}),
  }
}

export class IdempotencyStore {
  private readonly rows = new Map<string, ClaimedKey>()
  private readonly ttlMs: number
  private readonly cap: number
  private readonly now: () => number

  /**
   * @param path - persistence file; empty string keeps the store memory-only.
   * @param options - TTL/capacity/clock overrides for tests.
   */
  constructor(private readonly path: string, options?: IdempotencyOptions) {
    this.ttlMs = options?.ttlMs ?? IDEMPOTENCY_TTL_MS
    this.cap = options?.cap ?? IDEMPOTENCY_CAP
    this.now = options?.now ?? (() => Date.now())
    this.restore()
  }

  /**
   * Claim or inspect one key against a payload fingerprint.
   * @returns `'fresh'` when the key may execute now (and is recorded),
   * `'replay'` when the identical fingerprint was already claimed inside the
   * window, `'conflict'` when the key exists with a different fingerprint.
   */
  claim(taskId: string, fingerprint: string): ClaimVerdict {
    if (taskId === '') return 'fresh'
    this.prune(this.now())
    const existing = this.rows.get(taskId)
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) return 'conflict'
      // Fixed window from the first claim: a replay does NOT refresh `at`,
      // so only genuinely aged keys re-open (the comment previously claimed
      // a sliding refresh the code never performed — W7 slice-2 §2.3 kept
      // the behavior and fixed the prose).
      return 'replay'
    }
    if (this.rows.size >= this.cap) this.evictOldest()
    this.rows.set(taskId, { fingerprint, at: this.now() })
    this.persist()
    return 'fresh'
  }

  /**
   * Attach the settled outcome to an existing claim (W7 slice 2). First
   * write wins: the sync / detached-bridge / receipt hooks are mutually
   * exclusive by wait semantics today, so a second write would only ever
   * mean a future hook bug — ignore it instead of flip-flopping the record.
   * Unknown or already-settled ids answer `false`. Never throws.
   * @returns whether the outcome was recorded.
   */
  recordOutcome(taskId: string, outcome: TaskOutcome, settledAt: number = this.now()): boolean {
    if (taskId === '') return false
    this.prune(this.now())
    const existing = this.rows.get(taskId)
    if (existing === undefined || existing.outcome !== undefined) return false
    this.rows.set(taskId, {
      fingerprint: existing.fingerprint,
      at: existing.at,
      settledAt,
      outcome: capOutcome(outcome),
    })
    this.persist()
    return true
  }

  /**
   * Read-only outcome lookup for the `/a2a/query` surface (W7 slice 2).
   * The caller must present the task id AND the original payload's
   * fingerprint — the fingerprint match is the authorization, and a
   * mismatch is a plain negative answer, never the frozen -32002 conflict
   * vocabulary (queries do not produce conflicts). Empty or unknown ids
   * answer unknown-task. Never claims, never throws; the only write it may
   * perform is the shared lazy TTL prune.
   */
  query(taskId: string, fingerprint: string): StoredQueryVerdict {
    if (taskId === '') return { found: false, reason: 'unknown-task' }
    this.prune(this.now())
    const existing = this.rows.get(taskId)
    if (existing === undefined) return { found: false, reason: 'unknown-task' }
    if (existing.fingerprint !== fingerprint) return { found: false, reason: 'payload-mismatch' }
    if (existing.outcome === undefined || existing.settledAt === undefined) return { found: true, status: 'pending' }
    const truncation = existing.outcome.truncated === true ? { truncated: true } : {}
    return existing.outcome.status === 'completed'
      ? { found: true, status: 'completed', reply: existing.outcome.reply ?? '', settledAt: existing.settledAt, ...truncation }
      : { found: true, status: 'failed', error: existing.outcome.error ?? '', settledAt: existing.settledAt, ...truncation }
  }

  /** Whether one key currently sits inside the window (diagnostics). */
  has(taskId: string): boolean {
    this.prune(this.now())
    return this.rows.has(taskId)
  }

  /** Drop expired keys; runs on every entry point, never timer-driven. */
  private prune(now: number): void {
    let changed = false
    for (const [key, entry] of this.rows) {
      if (now - entry.at > this.ttlMs) {
        this.rows.delete(key)
        changed = true
      }
    }
    if (changed) this.persist()
  }

  /** Capacity guard: Map iteration order = insertion order, so first key dies. */
  private evictOldest(): void {
    const oldest = this.rows.keys().next()
    if (oldest.done !== true) {
      this.rows.delete(oldest.value)
    }
  }

  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Snapshot> | null
      const entries = snapshot?.entries
      if (!Array.isArray(entries)) return
      for (const raw of entries) {
        const entry = raw as Partial<ClaimedKey> & { taskId?: unknown }
        if (typeof entry?.taskId !== 'string' || entry.taskId === '') continue
        if (typeof entry.fingerprint !== 'string' || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) continue
        const outcome = restoreOutcome(entry.outcome)
        const settledAt = typeof entry.settledAt === 'number' && Number.isFinite(entry.settledAt) ? entry.settledAt : undefined
        this.rows.set(entry.taskId, {
          fingerprint: entry.fingerprint,
          at: entry.at,
          ...(outcome !== undefined && settledAt !== undefined ? { outcome, settledAt } : {}),
        })
      }
      this.prune(this.now())
    } catch {
      // A corrupt window file must never block routing: start fresh instead.
    }
  }

  private persist(): void {
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const entries = [...this.rows].map(([taskId, entry]) => ({ taskId, ...entry }))
      writeFileSync(this.path, JSON.stringify({ entries }), { mode: 0o600 })
    } catch {
      // Unwritable home: degrade to memory-only, routing continues.
    }
  }
}
