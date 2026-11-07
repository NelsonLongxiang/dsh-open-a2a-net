// @vitest-environment node
/** superagent p1-mailbox-owes (D-5): evictInbound archives only the pending row the per-target cap counts for that identity. */
import { describe, expect, it } from 'vitest'
import { TaskLedger } from '../../src/task-ledger.ts'

describe('TaskLedger.evictInbound (p1-mailbox-owes)', () => {
  it('archives the identity\'s pending inbound or same-host local row as evicted, and nothing else', () => {
    const ledger = new TaskLedger('')
    ledger.trackInbound('in-1', 'cli/a1b2c3d4e5f60718', 'caller', 'ctx', true, 'owed')
    ledger.track('out-1', 'cli/a1b2c3d4e5f60718', 'http://peer.test', 'ctx', 'remote debt')
    ledger.track('loc-1', 'cli/a1b2c3d4e5f60718', 'local', 'ctx', 'same-host debt')
    // An outbound row to a remote peer is the caller's own debt, not a slot this host counts: untouched.
    expect(ledger.evictInbound('out-1', 'cli/a1b2c3d4e5f60718')).toBe(false)
    // Another identity's name never evicts this one's row.
    expect(ledger.evictInbound('in-1', 'cli/0000000000000000')).toBe(false)
    expect(ledger.evictInbound('none', 'cli/a1b2c3d4e5f60718')).toBe(false)
    expect(ledger.evictInbound('in-1', 'cli/a1b2c3d4e5f60718')).toBe(true)
    expect(ledger.evictInbound('loc-1', 'cli/a1b2c3d4e5f60718')).toBe(true)
    expect(ledger.evictInbound('in-1', 'cli/a1b2c3d4e5f60718')).toBe(false)
    expect(ledger.list().map(r => r.taskId)).toEqual(['out-1'])
    const archived = ledger.archive()
    expect(archived.find(r => r.taskId === 'in-1')).toMatchObject({ endedBy: 'evicted', summary: 'mailbox-evicted', direction: 'inbound' })
    expect(archived.find(r => r.taskId === 'loc-1')).toMatchObject({ endedBy: 'evicted', summary: 'mailbox-evicted' })
  })
})
