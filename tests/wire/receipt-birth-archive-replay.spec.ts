/** #805: real HTTP replay after terminal evidence leaves the bounded archive. Synthetic homes only. */
import { afterEach, describe, expect, it, vi } from 'vitest'
afterEach(() => vi.restoreAllMocks())
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TaskLedger, ARCHIVE_CAP } from '../../src/task-ledger.ts'
import { bootNode } from '../mesh/harness.ts'

const options = { name: 'archive-replay', session: 'archive-replay', team: 'archive-test', silent: true,
  teamScopeRouting: false, teamScopeInfo: false, originClaimWindow: true, asyncNudgeDelayMs: 0 }
const body = { team: 'archive-test', message: 'one bounded synthetic work item', caller_session: 'test-runner', task_id: 'archive-replay-original', wait: false }
const post = (base: string, payload = body) => fetch(base + '/a2a/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

describe('#805 HTTP replay across archive rotation', () => {
  it.each([false, true])('retained terminal proof yields replay rejection after restart (legacy proof removed: %s)', async legacyUnknown => {
    const disableProof = process.env.A2A_TEST_DISABLE_TERMINAL_PROOF === '1'
    if (disableProof) vi.spyOn(TaskLedger.prototype as any, 'recordTerminalDelivery').mockImplementation(() => {})
    const first = await bootNode(options)
    const home = first.home
    try {
      const response = await post(first.baseUrl), data = await response.json()
      expect(response.status, JSON.stringify(data)).toBe(200)
      expect(data.delivered).toBe(true)
      expect(first.steered).toHaveLength(1)
    } finally { await first.dispose() }
    const path = join(home, 'a2a', 'tasks.json'), ledger = new TaskLedger(path)
    expect(ledger.find(body.task_id)).toBeDefined()
    expect(ledger.resolveFromMessage('[A2A receipt] task ' + body.task_id + ' completed synthetic work')).toBeDefined()
    for (let i = 0; i < ARCHIVE_CAP; i++) {
      const id = 'archive-rotation-' + i
      ledger.track(id, 'other/aaaaaaaa', 'https://peer.invalid')
      ledger.resolveFromMessage('[A2A receipt] task ' + id + ' completed')
    }
    expect(ledger.archive().some(row => row.taskId === body.task_id)).toBe(false)
    const before = ledger.deliveryFor(body.task_id)!
    expect(before).toBeDefined()
    if (legacyUnknown) {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      delete raw.taskDeliveries.find((row: any) => row.taskId === body.task_id).terminalRecorded
      writeFileSync(path, JSON.stringify(raw))
    }
    const restarted = await bootNode({ ...options, home })
    try {
      const response = await post(restarted.baseUrl), data = await response.json()
      expect(restarted.steered).toHaveLength(0)
      if (legacyUnknown) {
        // #824 (merged next/0.8) released the evicted settled row, so the replay is refused as one (it was accepted with
        // failed bookkeeping before); either way nothing is steered.
        expect(response.status, JSON.stringify(data)).toBe(409)
        expect(data).toMatchObject({ code: -32003, replay: true })
      } else {
        expect(response.status, JSON.stringify(data)).toBe(409)
        expect(data).toMatchObject({ code: -32003, replay: true })
        expect(data.receiverBookkeeping).toBeUndefined()
      }
      const after = new TaskLedger(path)
      expect(after.deliveryFor(body.task_id)).toMatchObject({ messageId: before.messageId, fingerprint: before.fingerprint })
      expect(after.find(body.task_id)).toBeUndefined()
      const changed = await post(restarted.baseUrl, { ...body, message: 'changed original payload' }), conflict = await changed.json()
      expect(changed.status, JSON.stringify(conflict)).toBe(409)
      expect(conflict.code).toBe(-32002)
      expect(restarted.steered).toHaveLength(0)
    } finally { await restarted.dispose() }
  })
})
