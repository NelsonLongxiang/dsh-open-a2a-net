/**
 * Fix 1 + 2 tests: resolveCallerLabel priority (joined > initiator face >
 * session label) + trackReceiptless (the ghost-debt stop at the ledger level).
 * The route-integration surface is covered by apply.spec (the state-route
 * receiptless expectation flip) and receipt-autosend/ladder specs.
 */

import { describe, expect, it } from 'vitest'
import { resolveCallerLabel } from '../src/index.ts'
import { TaskLedger } from '../src/task-ledger.ts'

describe('resolveCallerLabel (fix 1: 能发即能收)', () => {
  it('the initiator face resolves to the NODE team — never a session label', () => {
    expect(resolveCallerLabel({ joined: false, initiatorFace: true, nodeTeam: 'dsh', sessionLabel: 'session-abc12345' })).toBe('dsh')
  })

  it('the joined session resolves to its node team', () => {
    expect(resolveCallerLabel({ joined: true, initiatorFace: false, nodeTeam: 'dsh', joinedTeam: 'dsh/agent-1', sessionLabel: 'session-abc12345' })).toBe('dsh/agent-1')
  })

  it('a guest keeps the session label — unroutable, fix 2 handles the ledger', () => {
    expect(resolveCallerLabel({ joined: false, initiatorFace: false, nodeTeam: 'dsh', sessionLabel: 'session-guest000' })).toBe('session-guest000')
  })

  it('joined wins over initiatorFace when both apply', () => {
    expect(resolveCallerLabel({ joined: true, initiatorFace: true, nodeTeam: 'dsh', joinedTeam: 'dsh/agent-1' })).toBe('dsh/agent-1')
  })
})

describe('fix 2: trackReceiptless (the ghost-debt stop at the ledger level)', () => {
  it('registers the row visible but receiptExpected:false — never counted as owed', () => {
    const ledger = new TaskLedger('', { now: () => 1_000 })
    ledger.trackReceiptless('task-ghost', 'dsh/agent-1', 'local')
    const rows = ledger.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.receiptExpected).toBe(false)
    expect(rows[0]?.status).toBe('pending')
    ledger.track('task-owed', 'dsh/agent-1', 'peer-1')
    expect(ledger.list().find(entry => entry.taskId === 'task-owed')?.receiptExpected).not.toBe(false)
  })
})
