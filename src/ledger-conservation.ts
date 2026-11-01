/**
 * The ledger's conservation machinery (gh#154): four lifetime counters plus
 * the durable damage marker, moved verbatim out of TaskLedger so each module
 * stays under the R-mod cap. Counting semantics live here; the ledger's
 * track / archiveSettled / restore / persist seams delegate.
 *
 * Identity: trackedTotal = |owed| + Σ archivedByEnd + restoreTrimmed.
 * Duplicates are checked by the ledger (it owns the rows); counters only
 * answer the count half. A persisted damage marker never clears on its own —
 * only an explicit reseed policy may clear it (none exists by design).
 * @module src/ledger-conservation
 */
import type { ArchiveEnd } from './task-ledger.ts'

const ARCHIVE_ENDS: readonly ArchiveEnd[] = ['receipt', 'echo', 'abandoned', 'cancelled', 'evicted']

/** The persisted conservation block (rides the ledger snapshot; absent = pre-#154 legacy). */
export interface ConservationSnapshot {
  readonly trackedTotal: number
  readonly archivedByEnd: Record<ArchiveEnd, number>
  readonly archiveTrimmed: number
  readonly restoreTrimmed: number
  /** review r2: a damage marker PERSISTS — restarts keep refusing conserved until an explicit reseed clears it. */
  readonly damaged?: string
}

/** One full conservation verdict (the /state projection). */
export interface ConservationVerdict {
  conserved: boolean
  delta: number
  trackedTotal: number
  owed: number
  archivedByEnd: Record<ArchiveEnd, number>
  archivedTotal: number
  archiveTrimmed: number
  restoreTrimmed: number
  duplicateTaskIds: string[]
  damaged?: string
}

/** The archive-row shape the bootstrap classifier reads (endedBy optional pre-gh#31; generic so the ledger passes its own row type). */
export type ArchiveClassifiable = { readonly endedBy?: ArchiveEnd }

const intAtLeast0 = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/** The parsed outcome of restoring counters from one snapshot. */
export type ConservationRestore =
  | { readonly kind: 'legacy' }
  | { readonly kind: 'valid'; readonly snapshot: ConservationSnapshot }
  | { readonly kind: 'damaged'; readonly reason: string }

/**
 * Restore-classify one snapshot's conservation block:
 * - absent block → legacy bootstrap from what the rows prove;
 * - present, fully valid (every field a non-negative integer, archiveTrimmed
 *   bounded by the lifetime archived total, optional damaged marker a
 *   non-empty string) → valid, counters load as persisted;
 * - anything else (partial, negative, fractional, null body, unbounded trim)
 *   → damaged: counters stay zero and the verdict refuses conserved.
 */
export function classifyConservationBlock(raw: unknown): ConservationRestore {
  if (raw === undefined) return { kind: 'legacy' }
  if (raw === null || typeof raw !== 'object') return { kind: 'damaged', reason: 'conservation-block-invalid' }
  const saved = raw as Record<string, unknown>
  const trackedOk = intAtLeast0(saved.trackedTotal)
  const trimmedOk = intAtLeast0(saved.archiveTrimmed)
  const restoreOk = intAtLeast0(saved.restoreTrimmed)
  const byEndRaw = saved.archivedByEnd
  const byEnd = byEndRaw !== null && typeof byEndRaw === 'object' ? byEndRaw as Record<string, unknown> : undefined
  const byEndOk = byEnd !== undefined && ARCHIVE_ENDS.every(key => intAtLeast0(byEnd[key]))
  if (!(trackedOk && trimmedOk && restoreOk && byEndOk)) return { kind: 'damaged', reason: 'conservation-block-invalid' }
  const archivedByEnd = {} as Record<ArchiveEnd, number>
  let archivedTotal = 0
  for (const key of ARCHIVE_ENDS) {
    archivedByEnd[key] = byEnd![key] as number
    archivedTotal += byEnd![key] as number
  }
  if ((saved.archiveTrimmed as number) > archivedTotal) return { kind: 'damaged', reason: 'conservation-block-invalid' }
  const damaged = saved.damaged
  if (damaged !== undefined && (typeof damaged !== 'string' || damaged === '')) return { kind: 'damaged', reason: 'conservation-block-invalid' }
  return { kind: 'valid', snapshot: { trackedTotal: saved.trackedTotal as number, archivedByEnd, archiveTrimmed: saved.archiveTrimmed as number, restoreTrimmed: saved.restoreTrimmed as number, ...(typeof damaged === 'string' ? { damaged } : {}) } }
}

/** The counters themselves — one mutable holder the ledger owns. */
export class ConservationCounters {
  trackedTotal = 0
  readonly archivedByEnd: Record<ArchiveEnd, number> = { receipt: 0, echo: 0, abandoned: 0, cancelled: 0, evicted: 0 }
  archiveTrimmed = 0
  restoreTrimmed = 0
  damaged: string | undefined

  /** Legacy bootstrap: the kept rows plus this load's cuts are all the snapshot proves. */
  legacyBootstrap<T extends { readonly endedBy?: ArchiveEnd }>(owedCount: number, archive: readonly T[], restoreTrimmed: number, classify: (row: T) => ArchiveEnd): void {
    this.trackedTotal = owedCount + archive.length + restoreTrimmed
    this.archiveTrimmed = 0
    this.restoreTrimmed = restoreTrimmed
    for (const row of archive) this.archivedByEnd[classify(row)] += 1
  }

  /** Valid-block load: counters EXACTLY as persisted (review P2: an undercount stays red — never repaired upward); restoreTrimmed ADDS this load's cuts to the persisted lifetime (review P2: neither overwrite nor max). */
  loadFrom(snapshot: ConservationSnapshot, owedCount: number, archiveCount: number): void {
    this.trackedTotal = snapshot.trackedTotal
    this.archiveTrimmed = snapshot.archiveTrimmed
    this.restoreTrimmed += snapshot.restoreTrimmed
    for (const key of ARCHIVE_ENDS) this.archivedByEnd[key] = snapshot.archivedByEnd[key]
    if (snapshot.damaged !== undefined) this.damaged = snapshot.damaged
    void owedCount
    void archiveCount
  }

  /** The persisted shape (damaged rides along once stamped). */
  toSnapshot(): ConservationSnapshot {
    return {
      trackedTotal: this.trackedTotal,
      archivedByEnd: { ...this.archivedByEnd },
      archiveTrimmed: this.archiveTrimmed,
      restoreTrimmed: this.restoreTrimmed,
      ...(this.damaged !== undefined ? { damaged: this.damaged } : {}),
    }
  }

  /** The verdict's count half (the ledger supplies rows, owed count, duplicates). */
  verdict(owedCount: number, archiveCount: number, duplicateTaskIds: string[]): ConservationVerdict {
    const archivedTotal = ARCHIVE_ENDS.reduce((n, key) => n + this.archivedByEnd[key], 0)
    const delta = this.trackedTotal - (owedCount + archivedTotal + this.restoreTrimmed)
    // review P2: the archive lost rows only to its live cap or to the load cut.
    const archiveLoss = archivedTotal - archiveCount - this.archiveTrimmed
    const trimConsistent = archiveLoss >= 0 && archiveLoss <= this.restoreTrimmed
    const damaged = this.damaged !== undefined ? this.damaged : trimConsistent ? undefined : 'archive-trim-inconsistent'
    return {
      conserved: duplicateTaskIds.length === 0 && delta === 0 && damaged === undefined,
      delta,
      trackedTotal: this.trackedTotal,
      owed: owedCount,
      archivedByEnd: { ...this.archivedByEnd },
      archivedTotal,
      archiveTrimmed: this.archiveTrimmed,
      restoreTrimmed: this.restoreTrimmed,
      duplicateTaskIds,
      ...(damaged !== undefined ? { damaged } : {}),
    }
  }
}
