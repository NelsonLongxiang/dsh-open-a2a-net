/**
 * #121 (#114 S3): outbound ledger rows record their real sender. Covers the
 * birth of the field on both outbound tracks, its survival through every
 * archive path, the restore allowlist (round trip, malformed sender dropped
 * whole while the row survives), and a pre-field tasks.json loading unchanged.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SENDER_ID_CAP, TASK_CAP, TaskLedger, parseSender, type Sender } from '../../src/task-ledger.ts'

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-sender-')), 'a2a', 'tasks.json')
}

function writeSnapshot(path: string, snapshot: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(snapshot))
}

const SEAT: Sender = { kind: 'session', id: 'dsh/1a2b3c4d' }

describe('#121 sender on outbound rows', () => {
  it('track and trackReceiptless carry the sender; omitting it leaves the field absent', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-a', 'ops', 'local', undefined, undefined, SEAT)
    ledger.trackReceiptless('direct-b', 'ops', 'http://peer', undefined, undefined, { kind: 'host', id: 'dsh' })
    ledger.track('direct-c', 'ops', 'local')
    const byId = new Map(ledger.list().map(row => [row.taskId, row]))
    expect(byId.get('direct-a')?.sender).toEqual(SEAT)
    expect(byId.get('direct-b')?.sender).toEqual({ kind: 'host', id: 'dsh' })
    expect(byId.get('direct-c')).not.toHaveProperty('sender')
  })

  it('inbound rows carry no sender (their originator is the caller, not this host)', () => {
    const ledger = new TaskLedger('')
    ledger.trackInbound('direct-in', 'dsh/1a2b3c4d', 'dsh/99999999')
    expect(ledger.list()[0]).not.toHaveProperty('sender')
  })

  it('every archive path keeps the sender: receipt, echo, abandon, cancel, eviction', () => {
    const ledger = new TaskLedger('')
    for (const id of ['direct-r', 'direct-e', 'direct-ab', 'direct-ca']) ledger.track(id, 'ops', 'local', undefined, undefined, SEAT)
    ledger.resolveFromMessage('[A2A receipt] task direct-r done')
    ledger.resolveEcho('about task direct-e: finished')
    ledger.abandon('direct-ab')
    ledger.cancel('direct-ca')
    ledger.track('direct-old', 'ops', 'local', undefined, undefined, { kind: 'bridge', id: 'dsh/feedf00d' })
    for (let i = 0; i < TASK_CAP; i++) ledger.track(`direct-fill-${String(i)}`, 'ops', 'local')
    const archived = new Map(ledger.archive().map(row => [row.taskId, row]))
    for (const id of ['direct-r', 'direct-e', 'direct-ab', 'direct-ca']) expect(archived.get(id)?.sender).toEqual(SEAT)
    expect(archived.get('direct-old')?.endedBy).toBe('evicted')
    expect(archived.get('direct-old')?.sender).toEqual({ kind: 'bridge', id: 'dsh/feedf00d' })
  })
})

describe('#121 restore allowlist', () => {
  it('round-trips the sender on owed and archived rows', () => {
    const path = ledgerPath()
    const first = new TaskLedger(path)
    first.track('direct-p', 'ops', 'local', undefined, undefined, SEAT)
    first.track('direct-s', 'ops', 'http://peer', undefined, undefined, { kind: 'host', id: 'dsh' })
    first.resolveFromMessage('[A2A receipt] task direct-s ok')
    const second = new TaskLedger(path)
    expect(second.list().find(row => row.taskId === 'direct-p')?.sender).toEqual(SEAT)
    expect(second.archive().find(row => row.taskId === 'direct-s')?.sender).toEqual({ kind: 'host', id: 'dsh' })
  })

  it('drops a malformed sender whole and keeps the row, in all three restore branches', () => {
    const bad: unknown[] = [
      'dsh/1a2b3c4d',
      null,
      [],
      { kind: 'home', id: 'dsh' },
      { kind: 'session' },
      { kind: 'session', id: '' },
      { kind: 'session', id: 7 },
      { kind: 'session', id: 'x'.repeat(SENDER_ID_CAP + 1) },
      { kind: 'host', id: 'dsh-host', face: '' },
      { kind: 'host', id: 'dsh-host', face: 7 },
      { kind: 'host', id: 'dsh-host', face: 'x'.repeat(SENDER_ID_CAP + 1) },
    ]
    const path = ledgerPath()
    writeSnapshot(path, {
      tasks: [
        ...bad.map((sender, i) => ({ taskId: `direct-p${String(i)}`, team: 'ops', peer: 'local', startedAt: Date.now(), status: 'pending', sender })),
        // Legacy two-state inline 'resolved' row: migrates into the archive.
        { taskId: 'direct-legacy', team: 'ops', peer: 'local', startedAt: 1, resolvedAt: 2, status: 'resolved', sender: { kind: 'session', id: '' } },
      ],
      archived: bad.map((sender, i) => ({ taskId: `direct-a${String(i)}`, team: 'ops', peer: 'local', startedAt: 1, resolvedAt: 2, sender })),
    })
    const ledger = new TaskLedger(path)
    expect(ledger.list()).toHaveLength(bad.length)
    for (const row of ledger.list()) expect(row).not.toHaveProperty('sender')
    expect(ledger.archive()).toHaveLength(bad.length + 1)
    for (const row of ledger.archive()) expect(row).not.toHaveProperty('sender')
  })

  it('round-trips a host sender\'s borrowed face', () => {
    const path = ledgerPath()
    new TaskLedger(path).track('direct-f', 'ops', 'local', undefined, undefined, { kind: 'host', id: 'dsh-host-1a2b3c4d', face: 'dsh/aaaabbbb' })
    expect(new TaskLedger(path).list()[0]?.sender).toEqual({ kind: 'host', id: 'dsh-host-1a2b3c4d', face: 'dsh/aaaabbbb' })
  })

  it('never restores a sender onto an inbound row, in all three restore branches', () => {
    const path = ledgerPath()
    writeSnapshot(path, {
      tasks: [
        { taskId: 'direct-in', team: 'ops', peer: 'local:dsh/99999999', startedAt: Date.now(), direction: 'inbound', status: 'pending', sender: SEAT },
        { taskId: 'direct-in-legacy', team: 'ops', peer: 'local', startedAt: 1, resolvedAt: 2, direction: 'inbound', status: 'resolved', sender: SEAT },
      ],
      archived: [{ taskId: 'direct-in-arch', team: 'ops', peer: 'local', startedAt: 1, resolvedAt: 2, direction: 'inbound', sender: SEAT }],
    })
    const ledger = new TaskLedger(path)
    expect(ledger.list()[0]).not.toHaveProperty('sender')
    expect(ledger.archive()).toHaveLength(2)
    for (const row of ledger.archive()) expect(row).not.toHaveProperty('sender')
  })

  it('a restored sender keeps only kind and id (extra keys never ride along)', () => {
    const path = ledgerPath()
    writeSnapshot(path, { tasks: [{ taskId: 'direct-x', team: 'ops', peer: 'local', startedAt: Date.now(), status: 'pending', sender: { kind: 'session', id: 'dsh/1a2b3c4d', extra: 'drop me' } }] })
    expect(new TaskLedger(path).list()[0]?.sender).toEqual(SEAT)
  })

  it('a pre-#121 tasks.json loads unchanged and persists without inventing a sender', () => {
    const path = ledgerPath()
    const legacy = {
      tasks: [
        { taskId: 'direct-old1', team: 'ops', peer: 'http://peer', startedAt: Date.now(), direction: 'outbound', contextId: 'ctx-1', brief: 'hello', status: 'pending' },
        { taskId: 'direct-old2', team: 'dsh/1a2b3c4d', peer: 'local:dsh/99999999', startedAt: Date.now(), direction: 'inbound', status: 'pending' },
      ],
      archived: [
        { taskId: 'direct-old3', team: 'ops', peer: 'local', startedAt: 1, resolvedAt: 2, summary: 'done', outcome: 'completed', endedBy: 'receipt', direction: 'outbound' },
      ],
    }
    writeSnapshot(path, legacy)
    const ledger = new TaskLedger(path)
    expect(ledger.list()).toEqual(legacy.tasks)
    expect(ledger.archive()).toEqual(legacy.archived)
    // A write (new row) re-persists the legacy rows byte-for-byte as objects.
    ledger.track('direct-new', 'ops', 'local', undefined, undefined, SEAT)
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as { tasks: unknown[]; archived: unknown[] }
    expect(persisted.tasks.slice(1)).toEqual(legacy.tasks)
    expect(persisted.archived).toEqual(legacy.archived)
  })
})

describe('#121 parseSender', () => {
  it('accepts exactly the three kinds with a bounded non-empty id', () => {
    expect(parseSender({ kind: 'session', id: 'dsh/1a2b3c4d' })).toEqual(SEAT)
    expect(parseSender({ kind: 'host', id: 'dsh' })).toEqual({ kind: 'host', id: 'dsh' })
    expect(parseSender({ kind: 'bridge', id: 'x'.repeat(SENDER_ID_CAP) })).toEqual({ kind: 'bridge', id: 'x'.repeat(SENDER_ID_CAP) })
    expect(parseSender(undefined)).toBeUndefined()
    expect(parseSender({ kind: 'cli', id: 'scout/0123456789abcdef' })).toBeUndefined()
    expect(parseSender({ kind: 'host', id: 'dsh-host', face: 'dsh/aaaabbbb' })).toEqual({ kind: 'host', id: 'dsh-host', face: 'dsh/aaaabbbb' })
  })
})
