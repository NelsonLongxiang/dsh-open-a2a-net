/**
 * #805/#806: real HTTP replay after terminal evidence leaves the bounded archive. Synthetic homes only.
 * The idempotency store is removed before the restart (as if its TTL had passed): with it in place the replay is already
 * refused there (409/-32003) whether or not #806's terminal proof exists, so only without it does this test reach the
 * ledger's own refusal — the proof kept on the delivery identity.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { TaskLedger, ARCHIVE_CAP } from '../../src/task-ledger.ts'
import { bootNode } from '../mesh/harness.ts'

const options = { name: 'archive-replay', session: 'archive-replay', team: 'archive-test', silent: true,
  teamScopeRouting: false, teamScopeInfo: false, originClaimWindow: true, asyncNudgeDelayMs: 0 }
const body = { team: 'archive-test', message: 'one bounded synthetic work item', caller_session: 'test-runner', task_id: 'archive-replay-original', wait: false }
const post = (base: string, payload = body) => fetch(base + '/a2a/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

describe('#805 HTTP replay across archive rotation, idempotency store gone', () => {
  it('the ledger refuses the replay from the retained terminal proof alone, after restart', async () => {
    const first = await bootNode(options)
    const home = first.home
    try {
      const response = await post(first.baseUrl), data = await response.json()
      expect(response.status, JSON.stringify(data)).toBe(200)
      expect(data.delivered).toBe(true)
      expect(first.steered).toHaveLength(1)
    } finally { await first.dispose() }
    const path = join(home, 'a2a', 'tasks.json'), ledger = new TaskLedger(path)
    expect(ledger.resolveFromMessage('[A2A receipt] task ' + body.task_id + ' completed synthetic work')).toBeDefined()
    for (let i = 0; i < ARCHIVE_CAP; i++) {
      const id = 'archive-rotation-' + i
      ledger.track(id, 'other/aaaaaaaa', 'https://peer.invalid')
      ledger.resolveFromMessage('[A2A receipt] task ' + id + ' completed')
    }
    expect(ledger.archive().some(row => row.taskId === body.task_id)).toBe(false)
    const before = ledger.deliveryFor(body.task_id)!
    expect(before).toMatchObject({ terminalRecorded: true })
    const idempotency = join(home, 'a2a', 'idempotency.json')
    expect(existsSync(idempotency)).toBe(true)
    rmSync(idempotency)
    const restarted = await bootNode({ ...options, home })
    try {
      const response = await post(restarted.baseUrl), data = await response.json()
      // Without #806's proof this same request is delivered again (delivered: true, consumed: true).
      expect(data.delivered, JSON.stringify(data)).toBeUndefined()
      expect(data).toMatchObject({ code: -32000, task_status: 'TASK_STATE_FAILED' })
      expect(String(data.error)).toMatch(/task delivery correspondence is terminal; no replay/)
      expect(restarted.steered).toHaveLength(0)
      const after = new TaskLedger(path)
      expect(after.deliveryFor(body.task_id)).toMatchObject({ messageId: before.messageId, fingerprint: before.fingerprint, terminalRecorded: true })
      expect(after.find(body.task_id)).toBeUndefined()
    } finally { await restarted.dispose() }
  })
})
