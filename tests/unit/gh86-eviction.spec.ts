/**
 * gh#86 (chief order direct-4f596524): the owed book's TASK_CAP overflow
 * is VISIBLE — the oldest pending rows land in the archive as 'evicted',
 * never silently dropped. The review seat's recommendation, chief-endorsed.
 * L8 criterion: zero silently-dropped rows over any window.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TASK_CAP, TaskLedger, archivedEndedBy } from '../../src/task-ledger.ts'

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-gh86-')), 'a2a', 'tasks.json')
}

describe('gh#86: TASK_CAP overflow is visible eviction', () => {
  it('overflow rows land in the archive as endedBy=evicted, not silently dropped', () => {
    const ledger = new TaskLedger(ledgerPath())
    // Fill the owed book to the cap.
    for (let i = 0; i < TASK_CAP; i++) ledger.track(`direct-fill-${i}`, 'team/x', 'local')
    expect(ledger.list()).toHaveLength(TASK_CAP)
    // Overflow: adding one more pushes the OLDEST row out — into the archive.
    ledger.track('direct-new', 'team/x', 'local')
    expect(ledger.list()).toHaveLength(TASK_CAP)
    // The oldest row (direct-fill-0) is in the archive with endedBy 'evicted'.
    const archived = ledger.archive()
    expect(archived.length).toBe(1)
    expect(archived[0]!.taskId).toBe('direct-fill-0')
    expect(archived[0]!.endedBy).toBe('evicted')
    expect(archivedEndedBy(archived[0]!)).toBe('evicted')
    // The newest row IS in the owed book (not evicted).
    expect(ledger.list().some(t => t.taskId === 'direct-new')).toBe(true)
    // The oldest row is NOT silently gone — total = TASK_CAP (owed) + 1 (archived).
    expect(ledger.list().length + ledger.archive().length).toBe(TASK_CAP + 1)
  })

  it('multiple overflow rows all land as evicted (a burst over the cap)', () => {
    const ledger = new TaskLedger('')
    for (let i = 0; i < TASK_CAP + 5; i++) ledger.track(`direct-burst-${i}`, 'dsh', 'local')
    // 5 rows evicted to the archive; the owed book stays at TASK_CAP.
    expect(ledger.list()).toHaveLength(TASK_CAP)
    const archived = ledger.archive()
    expect(archived).toHaveLength(5)
    for (const row of archived) expect(row.endedBy).toBe('evicted')
    // The evicted rows are the OLDEST (burst-0 through burst-4).
    const ids = archived.map(r => r.taskId).sort()
    expect(ids).toEqual(['direct-burst-0', 'direct-burst-1', 'direct-burst-2', 'direct-burst-3', 'direct-burst-4'])
  })

  it('eviction preserves the row context (team, peer, brief, direction) for audit', () => {
    const ledger = new TaskLedger('')
    for (let i = 0; i < TASK_CAP; i++) ledger.track(`direct-ctx-${i}`, 'team/ctx', 'http://peer:13080', 'ctx-abc', 'test brief')
    ledger.track('direct-over', 'team/ctx', 'http://peer:13080')
    const evicted = ledger.archive()[0]!
    expect(evicted.team).toBe('team/ctx')
    expect(evicted.peer).toBe('http://peer:13080')
    expect(evicted.brief).toBe('test brief')
    expect(evicted.direction).toBe('outbound')
  })
})
