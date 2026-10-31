/**
 * #120 (#114 S2): the immutable authorization record of an inbound row —
 * one constructor, frozen; a strict all-or-nothing restore allowlist; born
 * on inbound rows only, kept by first-record-wins, carried through every
 * archive path; a pre-S2 tasks.json loads unchanged.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUTH_BASIS_CAP, AUTH_CLOCK_SKEW_MS, AUTH_STRING_CAP, buildAuthorization, claimCovers, parseAuthorization, type TaskAuthorization } from '../../src/task-auth.ts'
import { TaskLedger } from '../../src/task-ledger.ts'

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-auth-')), 'a2a', 'tasks.json')
}

function writeSnapshot(path: string, snapshot: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(snapshot))
}

const AUTH: TaskAuthorization = buildAuthorization(
  { ok: true, via: 'canvas-member', rule: 'canvas-shared', basis: ['dsh/canvas/ops', 'peer-org:dsh/canvas/far'] },
  {
    caller: 'dsh/aaaaaaaa', proof: 'origin-claim', claim: { caller: 'dsh', origin: 'http://100.75.181.127:13080' },
    ingress: 'wire', allowlistVersion: 'al1:0123456789abcdef', target: 'dsh/bbbbbbbb', receiptTarget: 'dsh/aaaaaaaa',
    receivedAt: 1_700_000_000_000, targetBusy: true,
  },
)

describe('#120 buildAuthorization / parseAuthorization', () => {
  it('builds a frozen record (nested values too) with via derived from the rule', () => {
    expect(AUTH).toEqual({
      v: 1, caller: 'dsh/aaaaaaaa', proof: 'origin-claim', claim: { caller: 'dsh', origin: 'http://100.75.181.127:13080' },
      ingress: 'wire', via: 'canvas-member', admission_rule: 'canvas-shared', basis: ['dsh/canvas/ops', 'peer-org:dsh/canvas/far'],
      allowlist_version: 'al1:0123456789abcdef', target: 'dsh/bbbbbbbb', receipt_target: 'dsh/aaaaaaaa', received_at: 1_700_000_000_000, target_busy: true,
    })
    expect(Object.isFrozen(AUTH)).toBe(true)
    expect(Object.isFrozen(AUTH.basis)).toBe(true)
    expect(Object.isFrozen(AUTH.claim)).toBe(true)
    const quiet = buildAuthorization({ ok: true, via: 'cli-deposit', rule: 'cli-deposit', basis: [] }, { caller: 'x', proof: 'legacy-window', ingress: 'wire', allowlistVersion: 'al1:0123456789abcdef', target: 't', receiptTarget: 'x', receivedAt: 1 })
    expect(quiet).not.toHaveProperty('claim')
    expect(quiet).not.toHaveProperty('target_busy')
  })

  it('round-trips through JSON exactly, including a claim-mismatch record', () => {
    expect(parseAuthorization(JSON.parse(JSON.stringify(AUTH)))).toEqual(AUTH)
    const mismatch = buildAuthorization({ ok: true, via: 'host-face', rule: 'host-face', basis: [] }, {
      caller: 'dsh', proof: 'claim-mismatch', claim: { caller: 'far', origin: 'http://far' }, ingress: 'wire',
      allowlistVersion: 'al1:0123456789abcdef', target: 'dsh/bbbbbbbb', receiptTarget: 'dsh', receivedAt: 1,
    })
    expect(parseAuthorization(JSON.parse(JSON.stringify(mismatch)))).toEqual(mismatch)
  })

  it('claimCovers: the same zone, or a handle under it — never a prefix without the slash', () => {
    expect(claimCovers('dsh', 'dsh')).toBe(true)
    expect(claimCovers('dsh/aaaaaaaa', 'dsh')).toBe(true)
    expect(claimCovers('ops-cli/a1b2c3d4e5f60718', 'ops-cli')).toBe(true)
    expect(claimCovers('dsh', 'far')).toBe(false)
    expect(claimCovers('dshx/aaaaaaaa', 'dsh')).toBe(false)
    expect(claimCovers('dsh', '')).toBe(false)
  })

  it('drops the whole record when any field is out of its closed set or bounds — never a partial adoption', () => {
    const json = JSON.parse(JSON.stringify(AUTH)) as Record<string, unknown>
    const bad: Array<Record<string, unknown>> = [
      { ...json, v: 2 },
      { ...json, proof: 'trust-me' },
      { ...json, ingress: 'relay' },
      { ...json, admission_rule: 'anyone' },
      { ...json, via: 'open' }, // via must be the rule's own basis
      { ...json, basis: 'dsh/canvas/ops' },
      { ...json, basis: Array.from({ length: AUTH_BASIS_CAP + 1 }, (_, i) => `t${String(i)}`) },
      { ...json, basis: [''] },
      { ...json, allowlist_version: 'al2:0123456789abcdef' },
      { ...json, target: '' },
      { ...json, caller: 'x'.repeat(AUTH_STRING_CAP + 1) },
      { ...json, received_at: -1 },
      { ...json, target_busy: false },
      { ...json, claim: undefined }, // origin-claim without its claim
      { ...json, proof: 'legacy-window' }, // a claim without origin-claim proof
      { ...json, claim: { caller: 'dsh' } },
      // Review of PR #134 P2: combinations admission could never have produced.
      { ...json, caller: '' }, // admission refuses anonymous callers
      { ...json, receipt_target: '' },
      { ...json, basis: [] }, // a shared-team rule with no shared team
      { ...json, basis: ['dsh/canvas/ops', 'dsh/canvas/ops'] },
      { ...json, admission_rule: 'cli-deposit', via: 'cli-deposit' }, // a non-shared rule with a basis
      { ...json, proof: 'in-process', claim: undefined }, // in-process on the wire
      { ...json, ingress: 'local' }, // local is in-process only
      { ...json, admission_rule: 'local-exempt', via: 'host-face', basis: [], proof: 'legacy-window', claim: undefined },
      { ...json, received_at: Date.now() + AUTH_CLOCK_SKEW_MS + 60_000 },
      { ...json, received_at: 1.5 },
      // Review of PR #134 P1: coverage, not the record, decides origin-claim vs claim-mismatch.
      { ...json, claim: { caller: 'far', origin: 'http://far' } },
      { ...json, proof: 'claim-mismatch' },
    ]
    for (const raw of bad) expect(parseAuthorization(raw), JSON.stringify(raw)).toBeUndefined()
    expect(parseAuthorization(null)).toBeUndefined()
    expect(parseAuthorization([AUTH])).toBeUndefined()
  })
})

describe('#120 auth on ledger rows', () => {
  it('is born on inbound rows; a replayed id keeps the first record', () => {
    const ledger = new TaskLedger('')
    ledger.trackInbound('direct-in', 'dsh/bbbbbbbb', 'dsh/aaaaaaaa', undefined, true, 'b', AUTH)
    const other = buildAuthorization({ ok: true, via: 'open', rule: 'scope-off', basis: [] }, { caller: 'dsh/zzzzzzzz', proof: 'none', ingress: 'wire', allowlistVersion: 'al1:ffffffffffffffff', target: 'dsh/bbbbbbbb', receiptTarget: 'dsh/zzzzzzzz', receivedAt: 2 })
    ledger.trackInbound('direct-in', 'dsh/bbbbbbbb', 'dsh/zzzzzzzz', undefined, true, 'b', other)
    expect(ledger.list()).toHaveLength(1)
    expect(ledger.list()[0]?.auth).toBe(AUTH)
    ledger.trackInbound('direct-plain', 'dsh/bbbbbbbb', 'dsh/aaaaaaaa')
    expect(ledger.list().find(r => r.taskId === 'direct-plain')).not.toHaveProperty('auth')
  })

  it('is carried through archiving (receipt, abandon) and round-trips persistence', () => {
    const path = ledgerPath()
    const first = new TaskLedger(path)
    first.trackInbound('direct-r', 'dsh/bbbbbbbb', 'dsh/aaaaaaaa', undefined, true, 'b', AUTH)
    first.trackInbound('direct-ab', 'dsh/bbbbbbbb', 'dsh/aaaaaaaa', undefined, true, 'b', AUTH)
    first.trackInbound('direct-live', 'dsh/bbbbbbbb', 'dsh/aaaaaaaa', undefined, true, 'b', AUTH)
    first.resolveFromMessage('[A2A receipt] task direct-r done')
    first.abandon('direct-ab')
    const archived = new Map(first.archive().map(row => [row.taskId, row]))
    expect(archived.get('direct-r')?.auth).toEqual(AUTH)
    expect(archived.get('direct-ab')?.auth).toEqual(AUTH)
    const second = new TaskLedger(path)
    expect(second.list().find(r => r.taskId === 'direct-live')?.auth).toEqual(AUTH)
    expect(new Map(second.archive().map(row => [row.taskId, row])).get('direct-r')?.auth).toEqual(AUTH)
  })

  it('restore drops a record that belongs to another row (target or receipt target differ)', () => {
    const path = ledgerPath()
    const good = JSON.parse(JSON.stringify(AUTH)) as Record<string, unknown>
    writeSnapshot(path, {
      tasks: [
        { taskId: 'direct-t', team: 'dsh/cccccccc', peer: 'local:dsh/aaaaaaaa', startedAt: Date.now(), status: 'pending', direction: 'inbound', auth: good },
        { taskId: 'direct-p', team: 'dsh/bbbbbbbb', peer: 'local:dsh/zzzzzzzz', startedAt: Date.now(), status: 'pending', direction: 'inbound', auth: good },
        { taskId: 'direct-ok', team: 'dsh/bbbbbbbb', peer: 'local:dsh/aaaaaaaa', startedAt: Date.now(), status: 'pending', direction: 'inbound', auth: good },
      ],
      archived: [],
    })
    const byId = new Map(new TaskLedger(path).list().map(row => [row.taskId, row]))
    expect(byId.get('direct-t')).not.toHaveProperty('auth')
    expect(byId.get('direct-p')).not.toHaveProperty('auth')
    expect(byId.get('direct-ok')?.auth).toEqual(AUTH)
  })

  it('restore drops a malformed record whole and keeps the row; outbound rows never take one; pre-S2 files load unchanged', () => {
    const path = ledgerPath()
    const good = JSON.parse(JSON.stringify(AUTH)) as Record<string, unknown>
    writeSnapshot(path, {
      tasks: [
        { taskId: 'direct-bad', team: 'dsh/bbbbbbbb', peer: 'local:dsh/aaaaaaaa', startedAt: Date.now(), status: 'pending', direction: 'inbound', auth: { ...good, proof: 'trust-me' } },
        { taskId: 'direct-out', team: 'ops', peer: 'local', startedAt: Date.now(), status: 'pending', auth: good },
        { taskId: 'direct-old', team: 'dsh/bbbbbbbb', peer: 'local:dsh/aaaaaaaa', startedAt: Date.now(), status: 'pending', direction: 'inbound' },
      ],
      archived: [],
    })
    const ledger = new TaskLedger(path)
    const byId = new Map(ledger.list().map(row => [row.taskId, row]))
    expect(byId.get('direct-bad')).toBeDefined()
    expect(byId.get('direct-bad')).not.toHaveProperty('auth')
    expect(byId.get('direct-out')).not.toHaveProperty('auth')
    expect(byId.get('direct-old')).not.toHaveProperty('auth')
    // The next write carries no trace of the dropped record.
    ledger.trackInbound('direct-new', 'dsh/bbbbbbbb', 'dsh/aaaaaaaa')
    expect(readFileSync(path, 'utf8')).not.toContain('trust-me')
  })
})
