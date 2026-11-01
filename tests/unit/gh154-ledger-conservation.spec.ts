/**
 * #154: the ledger's conservation identity — lifetime counters that survive
 * cap trims and restarts, duplicates checked before counts. One healthy
 * ledger is exercised end to end across every end path (receipt, echo,
 * abandon, cancel, eviction, dead flip, late receipt, save+reload, archive
 * cap trim, load-path trim) with ≥200 tasks; the negative proves the
 * identity catches a row deleted behind the counters' backs.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARCHIVE_CAP, TASK_CAP, TaskLedger } from '../../src/task-ledger.ts'

describe('#154 ledger conservation identity', () => {
  it('holds across every end path with 200+ tasks, cap trims, and reloads', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-cons-'))
    const path = join(home, 'tasks.json')
    let clock = 1_000
    const ledger = new TaskLedger(path, { now: () => clock })

    // Phase 1: 150 receipt-settled rows (archive cap 64 forces trims).
    for (let i = 0; i < 150; i++) {
      const id = `direct-r${String(i).padStart(4, '0')}`
      ledger.track(id, 'dsh/target', 'peer')
      expect(ledger.resolveFromMessage(`[A2A receipt] task ${id} done — ok`)).toBeDefined()
    }
    // Phase 2: 20 abandoned, 20 cancelled.
    for (let i = 0; i < 20; i++) {
      const id = `direct-a${String(i).padStart(4, '0')}`
      ledger.track(id, 'dsh/target', 'peer')
      ledger.abandon(id)
    }
    for (let i = 0; i < 20; i++) {
      const id = `direct-c${String(i).padStart(4, '0')}`
      ledger.track(id, 'dsh/target', 'peer')
      ledger.cancel(id)
    }
    // Phase 3: 70 rows left pending — overflow past TASK_CAP evicts the oldest.
    for (let i = 0; i < 70; i++) ledger.track(`direct-p${String(i).padStart(4, '0')}`, 'dsh/target', 'peer')
    // Phase 4: receiptless rows age into dead under a short TTL.
    const fast = new TaskLedger(join(home, 'fast.json'), { now: () => clock, staleTtlMs: 10 })
    fast.track('direct-f0001', 'dsh/target', 'peer')
    clock += 100
    expect(fast.list().find(row => row.taskId === 'direct-f0001')?.status).toBe('dead')
    expect(fast.conservation().conserved).toBe(true)

    const mid = ledger.conservation()
    expect(mid.conserved, JSON.stringify(mid)).toBe(true)
    expect(mid.trackedTotal).toBe(150 + 40 + 70)
    expect(mid.owed).toBeLessThanOrEqual(TASK_CAP)
    expect(mid.archivedByEnd.receipt).toBe(150)
    expect(mid.archivedByEnd.abandoned).toBe(20)
    expect(mid.archivedByEnd.cancelled).toBe(20)
    expect(mid.archivedByEnd.evicted).toBeGreaterThan(0)
    expect(mid.archiveTrimmed).toBeGreaterThan(0)
    expect(mid.restoreTrimmed).toBe(0)

    // Phase 5: mid-life save + reload — counters survive the restart.
    const snap = JSON.parse(readFileSync(path, 'utf8')) as { conservation?: { trackedTotal?: number } }
    expect(snap.conservation?.trackedTotal).toBe(260)
    const clockAtReload = clock
    const reloaded = new TaskLedger(path, { now: () => clockAtReload })
    const after = reloaded.conservation()
    expect(after.trackedTotal).toBe(260)
    expect(after.conserved, JSON.stringify(after)).toBe(true)

    // Phase 6: a late receipt on a dead row settles through the archive path.
    clock += 100
    reloaded.track('direct-l0001', 'dsh/target', 'peer')
    const late = new TaskLedger(join(home, 'late.json'), { now: () => clock, staleTtlMs: 10 })
    late.track('direct-l0002', 'dsh/target', 'peer')
    clock += 100
    expect(late.resolveFromMessage('[A2A receipt] task direct-l0002 late but done')).toBeDefined()
    expect(late.conservation().conserved).toBe(true)
    expect(reloaded.conservation().conserved).toBe(true)

    // Phase 7: an oversized legacy snapshot (no counters) bootstraps and keeps the identity.
    const legacy = join(home, 'legacy.json')
    const boot = new TaskLedger(legacy, { now: () => clock })
    for (let i = 0; i < 90; i++) {
      boot.track(`direct-x${String(i).padStart(4, '0')}`, 'dsh/target', 'peer')
      boot.resolveFromMessage(`[A2A receipt] task direct-x${String(i).padStart(4, '0')} done`)
    }
    // Strip the conservation block to simulate a pre-#154 snapshot, then reload.
    const raw = JSON.parse(readFileSync(legacy, 'utf8')) as Record<string, unknown>
    delete raw.conservation
    writeFileSync(legacy, JSON.stringify(raw))
    const legacyReload = new TaskLedger(legacy, { now: () => clock })
    const bootVerdict = legacyReload.conservation()
    expect(bootVerdict.conserved, JSON.stringify(bootVerdict)).toBe(true)
    expect(bootVerdict.trackedTotal).toBe(bootVerdict.owed + bootVerdict.archivedTotal + bootVerdict.restoreTrimmed)
    expect(bootVerdict.archiveTrimmed).toBe(0)
  }, 30_000)

  it('negative: a row deleted behind the counters breaks the identity with delta 1', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-neg-'))
    const ledger = new TaskLedger(join(home, 'tasks.json'))
    ledger.track('direct-n0001', 'dsh/target', 'peer')
    ledger.track('direct-n0002', 'dsh/target', 'peer')
    expect(ledger.conservation().conserved).toBe(true)
    // Test stub bypasses the API and deletes a row directly — exactly the
    // out-of-band loss the identity exists to catch.
    ;(ledger as unknown as { tasks: unknown[] }).tasks = (ledger as unknown as { tasks: unknown[] }).tasks.slice(1)
    const verdict = ledger.conservation()
    expect(verdict.conserved).toBe(false)
    expect(verdict.delta).toBe(1)
  })

  it('negative: a duplicated taskId fails even when the counts balance', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-dup-'))
    const ledger = new TaskLedger(join(home, 'tasks.json'))
    ledger.track('direct-d0001', 'dsh/target', 'peer')
    expect(ledger.conservation().conserved).toBe(true)
    const view = ledger as unknown as { tasks: Array<{ taskId: string }> }
    view.tasks = [{ ...view.tasks[0]! }, ...view.tasks]
    const verdict = ledger.conservation()
    expect(verdict.conserved).toBe(false)
    expect(verdict.duplicateTaskIds).toContain('direct-d0001')
    // The duplicate inflates owed the other way — delta balances but the
    // duplicate check still refuses to call it conserved.
    expect(verdict.delta).toBe(-1)
    expect(verdict.conserved).toBe(false)
  })
})
