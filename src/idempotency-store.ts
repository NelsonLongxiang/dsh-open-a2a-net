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
 * Persistence at `<dsh-home>/a2a/idempotency.json`; TTL prunes lazily on
 * every entry point (no timers — this host restarts too often), capacity
 * evicts oldest-inserted first, and every failure degrades to memory-only.
 * Never throws: orchestrator settlement paths fire here repeatedly under
 * conditions nobody can predict.
 * @module @nelsonlongxiang/dsh-open-a2a-net/idempotency-store
 */

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

/** The three claim verdicts; stable vocabulary per the consumer contract. */
export type ClaimVerdict = 'fresh' | 'replay' | 'conflict'

interface ClaimedKey {
  readonly fingerprint: string
  readonly at: number
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
  readonly entries?: ReadonlyArray<{ readonly taskId: string; readonly fingerprint: string; readonly at: number }>
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
      // Sliding refresh: a hammering duplicate cannot out-wait the window
      // while spamming; only genuinely aged keys re-open.
      return 'replay'
    }
    if (this.rows.size >= this.cap) this.evictOldest()
    this.rows.set(taskId, { fingerprint, at: this.now() })
    this.persist()
    return 'fresh'
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
        this.rows.set(entry.taskId, { fingerprint: entry.fingerprint, at: entry.at })
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
