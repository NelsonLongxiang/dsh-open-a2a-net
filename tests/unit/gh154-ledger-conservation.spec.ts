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

  it('review P1: a present-but-invalid conservation block is damage, never a silent re-seed', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-dmg-'))
    const writeVariant = (name: string, block: unknown): string => {
      const path = join(home, name)
      writeFileSync(path, JSON.stringify({ tasks: [{ taskId: 'direct-z0001', team: 'dsh/target', peer: 'peer', startedAt: 1, status: 'pending' }], conservation: block }))
      return path
    }
    // Partial, negative, fractional, non-integer trim, out-of-bounds trim.
    for (const [name, block] of [
      ['partial.json', { trackedTotal: 2 }],
      ['negative.json', { trackedTotal: -1, archivedByEnd: { receipt: 1, echo: 0, abandoned: 0, cancelled: 0, evicted: 0 }, archiveTrimmed: 0, restoreTrimmed: 0 }],
      ['fractional.json', { trackedTotal: 2.5, archivedByEnd: { receipt: 1, echo: 0, abandoned: 0, cancelled: 0, evicted: 0 }, archiveTrimmed: 0, restoreTrimmed: 0 }],
      ['trim-999.json', { trackedTotal: 2, archivedByEnd: { receipt: 1, echo: 0, abandoned: 0, cancelled: 0, evicted: 0 }, archiveTrimmed: 999, restoreTrimmed: 0 }],
    ] as Array<[string, unknown]>) {
      const ledger = new TaskLedger(writeVariant(name, block))
      const verdict = ledger.conservation()
      expect(verdict.conserved, name).toBe(false)
      expect(verdict.damaged, name).toBe('conservation-block-invalid')
      // The row still loads — routing never depends on the verdict.
      expect(ledger.list()).toHaveLength(1)
    }
  })

  it('review P1: an unreadable snapshot never reports a healthy empty ledger', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-json-'))
    const path = join(home, 'tasks.json')
    writeFileSync(path, '{not json')
    const ledger = new TaskLedger(path)
    const verdict = ledger.conservation()
    expect(verdict.conserved).toBe(false)
    expect(verdict.damaged).toBe('snapshot-unreadable')
    expect(verdict.trackedTotal).toBe(0)
  })

  it('review P2: legacy archive rows without endedBy bootstrap through the classifier', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-legacy-'))
    const path = join(home, 'tasks.json')
    // A pre-gh#31 archive row: no endedBy, plain summary → classified receipt.
    writeFileSync(path, JSON.stringify({
      tasks: [{ taskId: 'direct-y0001', team: 'dsh/target', peer: 'peer', startedAt: 1, status: 'pending' }],
      archived: [{ taskId: 'direct-y0002', team: 'dsh/target', peer: 'peer', startedAt: 1, resolvedAt: 2, summary: 'done' }],
    }))
    const ledger = new TaskLedger(path)
    const verdict = ledger.conservation()
    expect(verdict.conserved, JSON.stringify(verdict)).toBe(true)
    expect(verdict.archivedByEnd.receipt).toBe(1)
    expect(verdict.trackedTotal).toBe(2)
  })

  it('review r2 P1: a damage marker survives mutation, persist, and restart', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-sticky-'))
    const path = join(home, 'tasks.json')
    writeFileSync(path, JSON.stringify({
      tasks: [{ taskId: 'direct-s0001', team: 'dsh/target', peer: 'peer', startedAt: 1, status: 'pending' }],
      conservation: { trackedTotal: 1 },
    }))
    const damaged = new TaskLedger(path)
    expect(damaged.conservation().conserved).toBe(false)
    // Normal work after the damaged load: the row + new work persist WITH the marker.
    damaged.track('direct-s0002', 'dsh/target', 'peer')
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as { conservation?: { damaged?: string } }
    expect(persisted.conservation?.damaged).toBe('conservation-block-invalid')
    // Restart: the marker reloads, the verdict stays red — no re-baseline.
    const reloaded = new TaskLedger(path)
    const verdict = reloaded.conservation()
    expect(verdict.conserved).toBe(false)
    expect(verdict.damaged).toBe('conservation-block-invalid')
    // Rows stay loadable — routing never depends on the verdict.
    expect(reloaded.list().length).toBe(2)
  })

  it('review r3 P1: top-level array and missing tasks never become a healthy ledger', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-shape3-'))
    const verdictFor = (name: string, text: string) => {
      const path = join(home, name)
      writeFileSync(path, text)
      return new TaskLedger(path).conservation()
    }
    for (const [name, text] of [['arr.json', '[]'], ['obj.json', '{}']] as Array<[string, string]>) {
      const verdict = verdictFor(name, text)
      expect(verdict.conserved, name).toBe(false)
      expect(verdict.damaged, name).toBe('snapshot-shape-invalid')
    }
    // After a normal mutation both persist with the marker and stay red on reload.
    const path = join(home, 'arr.json')
    writeFileSync(path, '[]')
    const ledger = new TaskLedger(path)
    ledger.track('direct-q0001', 'dsh/target', 'peer')
    const reloaded = new TaskLedger(path)
    expect(reloaded.conservation().conserved).toBe(false)
    expect(reloaded.conservation().damaged).toBe('snapshot-shape-invalid')
  })

  it('review r3 P1: malformed row entries refuse the verdict while parseable rows load', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-rows-'))
    const path = join(home, 'tasks.json')
    writeFileSync(path, JSON.stringify({
      tasks: [
        { taskId: 'direct-w0001', team: 'dsh/target', peer: 'peer', startedAt: 1, status: 'pending' },
        { team: 'missing-id' },
      ],
    }))
    const ledger = new TaskLedger(path)
    expect(ledger.list()).toHaveLength(1)
    const verdict = ledger.conservation()
    expect(verdict.conserved).toBe(false)
    expect(verdict.damaged).toBe('row-shape-invalid')
    // The marker persists across mutation and reload.
    ledger.track('direct-w0002', 'dsh/target', 'peer')
    const reloaded = new TaskLedger(path)
    expect(reloaded.conservation().damaged).toBe('row-shape-invalid')
    expect(reloaded.conservation().conserved).toBe(false)
  })

  it('review r3 P2: an undercounted trackedTotal stays red, never repaired upward', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-under-'))
    const path = join(home, 'tasks.json')
    writeFileSync(path, JSON.stringify({
      tasks: [
        { taskId: 'direct-u0001', team: 'dsh/target', peer: 'peer', startedAt: 1, status: 'pending' },
        { taskId: 'direct-u0002', team: 'dsh/target', peer: 'peer', startedAt: 2, status: 'pending' },
      ],
      conservation: { trackedTotal: 1, archivedByEnd: { receipt: 0, echo: 0, abandoned: 0, cancelled: 0, evicted: 0 }, archiveTrimmed: 0, restoreTrimmed: 0 },
    }))
    const verdict = new TaskLedger(path).conservation()
    expect(verdict.trackedTotal).toBe(1)
    // Undercount: tracked (1) < accounted (2 owed) — the identity stays red,
    // delta negative; the rows prove more work than the block admits.
    expect(verdict.delta).toBe(-1)
    expect(verdict.conserved).toBe(false)
  })

  it('review r3 P2: a valid block keeps persisted restore cuts PLUS this load\'s cuts', () => {
    const home = mkdtempSync(join(tmpdir(), 'gh154-cuts-'))
    const path = join(home, 'tasks.json')
    const rows = Array.from({ length: 70 }, (_, i) => ({ taskId: `direct-k${String(i).padStart(4, '0')}`, team: 'dsh/target', peer: 'peer', startedAt: i, status: 'pending' }))
    writeFileSync(path, JSON.stringify({
      tasks: rows,
      conservation: { trackedTotal: 70, archivedByEnd: { receipt: 0, echo: 0, abandoned: 0, cancelled: 0, evicted: 0 }, archiveTrimmed: 0, restoreTrimmed: 0 },
    }))
    const verdict = new TaskLedger(path).conservation()
    expect(verdict.owed).toBe(64)
    expect(verdict.restoreTrimmed).toBe(6)
    expect(verdict.conserved, JSON.stringify(verdict)).toBe(true)
  })
})
