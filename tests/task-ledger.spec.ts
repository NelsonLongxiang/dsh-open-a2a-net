/**
 * Task-ledger unit tests: pending registration, receipt correlation
 * (`[A2A receipt] task <id> …`), unknown-id tolerance, bounded growth, and
 * whole-file persistence semantics.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TASK_CAP, TaskLedger } from '../src/task-ledger.ts'

/** A fresh persistence path under a per-test directory. */
function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-tasks-')), 'a2a', 'tasks.json')
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
})

describe('TaskLedger receipt correlation', () => {
  it('resolves a pending task from a receipt message and keeps the summary', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-aa tests green on 0.6.0')).toBe(true)
    const record = ledger.list()[0]
    expect(record?.status).toBe('resolved')
    expect(record?.summary).toBe('tests green on 0.6.0')
    expect(typeof record?.resolvedAt).toBe('number')
  })

  it('ignores messages that are not receipts and receipts for unknown tasks', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    expect(ledger.resolveFromMessage('an ordinary routed message')).toBe(false)
    expect(ledger.resolveFromMessage('[A2A direct] (task direct-aa) from "peer" sent:\n\nhello')).toBe(false)
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-zz never tracked')).toBe(false)
    expect(ledger.list()[0]?.status).toBe('pending')
  })

  it('refreshes a resolved task when its receipt arrives again', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    ledger.resolveFromMessage('[A2A receipt] task direct-aa first attempt')
    ledger.resolveFromMessage('[A2A receipt] task direct-aa second attempt')
    expect(ledger.list()).toHaveLength(1)
    expect(ledger.list()[0]?.summary).toBe('second attempt')
  })

  it('truncates a very long receipt summary', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-aa', 'team/x', 'local')
    ledger.resolveFromMessage(`[A2A receipt] task direct-aa ${'x'.repeat(500)}`)
    expect(ledger.list()[0]?.summary?.length).toBeLessThanOrEqual(200)
  })
})

describe('TaskLedger bounds and persistence', () => {
  it('bounds the ledger at TASK_CAP tasks, evicting the oldest', () => {
    const ledger = new TaskLedger('')
    for (let index = 0; index < TASK_CAP + 5; index++) ledger.track(`direct-${String(index)}`, 'dsh', 'local')
    expect(ledger.list()).toHaveLength(TASK_CAP)
    expect(ledger.list()[0]?.taskId).toBe(`direct-${String(TASK_CAP + 4)}`)
    expect(ledger.list().some(entry => entry.taskId === 'direct-0')).toBe(false)
  })

  it('persists the ledger across instances and reloads it on construction', () => {
    const path = ledgerPath()
    const ledger = new TaskLedger(path)
    ledger.track('direct-aa', 'team/x', 'local')
    ledger.resolveFromMessage('[A2A receipt] task direct-aa done')
    const reloaded = new TaskLedger(path)
    const record = reloaded.list()[0]
    expect(record?.taskId).toBe('direct-aa')
    expect(record?.status).toBe('resolved')
    expect(record?.summary).toBe('done')
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ tasks: [{ taskId: 'direct-aa' }] })
  })

  it('degrades to empty when the persisted file is corrupt', () => {
    const path = ledgerPath()
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'not json', 'utf8')
    const ledger = new TaskLedger(path)
    expect(ledger.list()).toEqual([])
  })
})
