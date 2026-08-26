/**
 * Task-ledger unit tests: pending registration, receipt correlation
 * (`[A2A receipt] task <id> …`), unknown-id tolerance, bounded growth,
 * whole-file persistence semantics, the lazy stale-TTL dead-letter tier
 * (nudge disarm + late-receipt revival), the settled archive's bound, and
 * legacy two-state file migration.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARCHIVE_CAP, TASK_CAP, TaskLedger } from '../src/task-ledger.ts'

/** A fresh persistence path under a per-test directory. */
function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-tasks-')), 'a2a', 'tasks.json')
}

/** A real-clock pause past an injected short TTL so lazy sweeps observe age. */
async function tickPastTtl(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

describe('TaskLedger registration and listing', () => {
  it('tracks a pending task with its routing facts, most recent first', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    ledger.track('direct-bb', 'dsh', 'http://peer')
    const tasks = ledger.list()
    expect(tasks).toHaveLength(2)
    expect(tasks[0]?.taskId).toBe('direct-bb')
    expect(tasks[0]?.status).toBe('pending')
    expect(tasks[0]?.team).toBe('dsh')
    expect(tasks[0]?.peer).toBe('http://peer')
    expect(tasks[1]?.taskId).toBe('direct-aa')
    expect(typeof tasks[1]?.startedAt).toBe('number')
  })

  it('keeps the first record when the same task id is tracked twice', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    const first = ledger.list()[0]?.startedAt
    ledger.track('direct-aa', 'other-team', 'http://peer')
    const record = ledger.list()[0]
    expect(ledger.list()).toHaveLength(1)
    expect(record?.team).toBe('team/x')
    expect(record?.startedAt).toBe(first)
  })

  it('keeps the follow-up context id on the record, omitting an empty one', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local', 'ctx-7f')
    ledger.track('direct-bb', 'dsh', 'http://peer', '')
    expect(ledger.list().find(task => task.taskId === 'direct-aa')?.contextId).toBe('ctx-7f')
    expect(ledger.list().find(task => task.taskId === 'direct-bb')?.contextId).toBeUndefined()
  })
})

describe('TaskLedger receipt correlation', () => {
  it('resolves a pending task from a receipt message, archiving the summary', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-aa tests green on 0.6.0')).toBe(true)
    expect(ledger.list()).toEqual([])
    const settled = ledger.archive()[0]
    expect(settled?.taskId).toBe('direct-aa')
    expect(settled?.summary).toBe('tests green on 0.6.0')
    expect(typeof settled?.resolvedAt).toBe('number')
  })

  it('ignores messages that are not receipts and receipts for unknown tasks', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    expect(ledger.resolveFromMessage('an ordinary routed message')).toBe(false)
    expect(ledger.resolveFromMessage('[A2A direct] (task direct-aa) from "peer" sent:\n\nhello')).toBe(false)
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-zz never tracked')).toBe(false)
    expect(ledger.list()[0]?.status).toBe('pending')
  })

  it('refreshes an archived task when its receipt arrives again', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    ledger.resolveFromMessage('[A2A receipt] task direct-aa first attempt')
    ledger.resolveFromMessage('[A2A receipt] task direct-aa second attempt')
    expect(ledger.list()).toEqual([])
    expect(ledger.archive()).toHaveLength(1)
    expect(ledger.archive()[0]?.summary).toBe('second attempt')
  })

  it('truncates a very long receipt summary in the archive', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    ledger.resolveFromMessage(`[A2A receipt] task direct-aa ${'x'.repeat(500)}`)
    expect(ledger.archive()[0]?.summary?.length).toBeLessThanOrEqual(200)
  })
})

describe('TaskLedger bounds and persistence', () => {
  it('bounds the owed book at TASK_CAP tasks, evicting the oldest unsettled row', () => {
    const ledger = new TaskLedger('')
    for (let index = 0; index < TASK_CAP + 5; index++) ledger.track(`direct-${String(index)}`, 'dsh', 'local')
    expect(ledger.list()).toHaveLength(TASK_CAP)
    expect(ledger.list()[0]?.taskId).toBe(`direct-${String(TASK_CAP + 4)}`)
    expect(ledger.list().some(entry => entry.taskId === 'direct-0')).toBe(false)
  })

  it('persists the ledger across instances and reloads it on construction', () => {
    const path = ledgerPath()
    const ledger = new TaskLedger(path)
    ledger.track('direct-aa', 'team/x', 'local', 'ctx-7f')
    ledger.resolveFromMessage('[A2A receipt] task direct-aa done')
    const reloaded = new TaskLedger(path)
    expect(reloaded.list()).toEqual([])
    const record = reloaded.archive()[0]
    expect(record?.taskId).toBe('direct-aa')
    expect(record?.summary).toBe('done')
    expect(record?.contextId).toBe('ctx-7f')
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ archived: [{ taskId: 'direct-aa' }] })
  })

  it('degrades to empty when the persisted file is corrupt', () => {
    const path = ledgerPath()
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'not json', 'utf8')
    const ledger = new TaskLedger(path)
    expect(ledger.list()).toEqual([])
  })
})

describe('TaskLedger stale-TTL dead-letter tier', () => {
  it('sweeps an overdue pending task to dead-letter lazily and disarms isPending', async () => {
    const ledger = new TaskLedger('', { staleTtlMs: 30 })
    ledger.track('direct-old', 'dsh', 'local')
    expect(ledger.list()[0]?.status).toBe('pending')
    await tickPastTtl(45)
    const rows = ledger.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('dead')
    expect(typeof rows[0]?.deadAt).toBe('number')
    const deadAt = rows[0]?.deadAt
    await tickPastTtl(5)
    // Repeated reads must not move the marker (sweep idempotence).
    expect(ledger.list()[0]?.deadAt).toBe(deadAt)
    // A dead row disarms the async-nudge retry.
    expect(ledger.isPending('direct-old')).toBe(false)
  })

  it('a fresh pending task inside its TTL still counts as pending for the nudge', () => {
    const ledger = new TaskLedger('', { staleTtlMs: 60_000 })
    ledger.track('direct-new', 'dsh', 'local')
    expect(ledger.isPending('direct-new')).toBe(true)
  })

  it('a late receipt settles a dead-lettered row into the archive (revival)', async () => {
    const ledger = new TaskLedger('', { staleTtlMs: 20 })
    ledger.track('direct-zombie', 'dsh', 'local')
    await tickPastTtl(40)
    expect(ledger.list()[0]?.status).toBe('dead')
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-zombie arrived late')).toBe(true)
    expect(ledger.list()).toEqual([])
    expect(ledger.archive()).toHaveLength(1)
    expect(ledger.archive()[0]?.summary).toBe('arrived late')
  })
})

describe('TaskLedger settled-archive migration and bounds', () => {
  it('settling frees owed-book capacity instead of competing with history', () => {
    const ledger = new TaskLedger('')
    for (let index = 0; index < TASK_CAP; index++) ledger.track(`direct-${String(index)}`, 'dsh', 'local')
    ledger.resolveFromMessage(`[A2A receipt] task direct-${String(TASK_CAP - 1)} done`)
    ledger.track('direct-fresh', 'dsh', 'local')
    expect(ledger.list()).toHaveLength(TASK_CAP)
    expect(ledger.list().some(entry => entry.taskId === 'direct-fresh')).toBe(true)
    // The settled row survives in the archive while its slot was reused.
    expect(ledger.archive()).toHaveLength(1)
    expect(ledger.archive()[0]?.taskId).toBe(`direct-${String(TASK_CAP - 1)}`)
  })

  it('bounds the archive at ARCHIVE_CAP, evicting the oldest settlement', () => {
    const ledger = new TaskLedger('')
    for (let index = 0; index < ARCHIVE_CAP + 3; index++) {
      ledger.track(`direct-${String(index)}`, 'dsh', 'local')
      ledger.resolveFromMessage(`[A2A receipt] task direct-${String(index)} outcome ${String(index)}`)
    }
    expect(ledger.archive()).toHaveLength(ARCHIVE_CAP)
    expect(ledger.archive().some(entry => entry.taskId === 'direct-0')).toBe(false)
    expect(ledger.archive()[0]?.summary).toBe(`outcome ${String(ARCHIVE_CAP + 2)}`)
  })

  it('restores a legacy two-state file, migrating inline resolved rows into the archive', () => {
    const path = ledgerPath()
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify({
      tasks: [
        { taskId: 'direct-r', team: 't', peer: 'local', startedAt: 1, status: 'resolved', resolvedAt: 9, summary: 'legacy done' },
        { taskId: 'direct-p', team: 't', peer: 'local', startedAt: 2, status: 'pending' },
      ],
    }), 'utf8')
    const ledger = new TaskLedger(path)
    expect(ledger.list().map(entry => entry.taskId)).toEqual(['direct-p'])
    expect(ledger.archive().map(entry => entry.taskId)).toEqual(['direct-r'])
    expect(ledger.archive()[0]?.summary).toBe('legacy done')
  })

  it('persists all three tiers and restores a dead row without zombie revival', async () => {
    const path = ledgerPath()
    const ledger = new TaskLedger(path, { staleTtlMs: 20 })
    ledger.track('direct-dead', 'dsh', 'local')
    await tickPastTtl(40)
    ledger.list() // sweeps to dead and persists the marker
    ledger.track('direct-live', 'dsh', 'local')
    ledger.track('direct-settled', 'dsh', 'local')
    ledger.resolveFromMessage('[A2A receipt] task direct-settled kept')
    const reloaded = new TaskLedger(path)
    // The restored dead row stays dead — restore never resurrects tiers.
    expect(reloaded.list().map(entry => [entry.taskId, entry.status])).toEqual([
      ['direct-live', 'pending'],
      ['direct-dead', 'dead'],
    ])
    expect(reloaded.archive()[0]?.summary).toBe('kept')
  })
})
