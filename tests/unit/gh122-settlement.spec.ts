/**
 * #122 (#114 S4): who may settle a task. The pure judgement (every chain
 * role and refusal reason, including the #61 shape) and the ledger's use
 * of it: observe settles and records, enforce keeps the row owed, an echo
 * is judged as weak evidence, and the refusal ring and settledBy persist.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAuthorization, judgeSettlement, type Settler, type SettlementFacts } from '../../src/task-auth.ts'
import { SETTLEMENT_REFUSAL_CAP, TaskLedger, type SettlementJudge, type TaskRecord } from '../../src/task-ledger.ts'

const HOST = 'dsh-host-9c53bf95'
const TARGET = 'dsh/414d2b90'
const auth = buildAuthorization({ ok: true, via: 'cli-deposit', rule: 'cli-deposit', basis: [] }, {
  caller: 'review-seat/f62b3c7aa9f44276', proof: 'origin-claim', claim: { caller: 'review-seat/f62b3c7aa9f44276', origin: 'http://h:1' },
  ingress: 'wire', allowlistVersion: 'al1:0123456789abcdef', target: TARGET, receiptTarget: 'review-seat/f62b3c7aa9f44276', receivedAt: 1,
})
const inbound = { team: TARGET, peer: 'local:review-seat/f62b3c7aa9f44276', direction: 'inbound' as const, auth }
const outbound = { team: 'dsh/bbbbbbbb', peer: 'http://100.75.181.127:13080', direction: 'outbound' as const }
const facts = (extra: Partial<SettlementFacts> = {}): SettlementFacts => ({ hostLabel: HOST, membersOf: team => (team === 'dsh/canvas/ops' ? ['aaaa-1', 'dsh/aaaaaaaa', 'qa/11112222'] : undefined), ...extra })
const local = (caller: string): Settler => ({ caller, proof: 'in-process', ingress: 'local' })
const wire = (caller: string, proof: Settler['proof'] = 'origin-claim', claimOrigin?: string): Settler => ({ caller, proof, ingress: 'wire', ...(claimOrigin !== undefined ? { claimOrigin } : {}) })

describe('#122 judgeSettlement', () => {
  it('legacy: an inbound row born before S2 is allowed and labelled', () => {
    expect(judgeSettlement({ ...inbound, auth: undefined }, wire('anyone'), facts())).toEqual({ ok: true, role: 'legacy' })
  })

  it('target: a LOCAL row\'s target settles in-process only; a REMOTE row\'s target needs a covering claim from the row\'s peer origin', () => {
    expect(judgeSettlement(inbound, local(TARGET), facts())).toEqual({ ok: true, role: 'target' })
    // Review of PR #140 P1-1: a self-signed zone card naming the local target over the wire is off-chain.
    expect(judgeSettlement(inbound, wire(TARGET, 'origin-claim', 'http://impostor:1'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    expect(judgeSettlement(outbound, wire('dsh/bbbbbbbb', 'origin-claim', 'http://100.75.181.127:13080'), facts())).toEqual({ ok: true, role: 'target' })
    // Review of PR #140 P1-3: the right name from another origin is not the peer.
    expect(judgeSettlement(outbound, wire('dsh/bbbbbbbb', 'origin-claim', 'http://impostor:1'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    expect(judgeSettlement(outbound, wire('dsh/bbbbbbbb', 'origin-claim'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    expect(judgeSettlement(outbound, wire('dsh/bbbbbbbb', 'legacy-window'), facts())).toEqual({ ok: false, reason: 'settler-unverified' })
    expect(judgeSettlement(outbound, wire('dsh/bbbbbbbb', 'claim-mismatch', 'http://100.75.181.127:13080'), facts())).toEqual({ ok: false, reason: 'settler-unverified' })
    expect(judgeSettlement(outbound, local('dsh/bbbbbbbb'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    const localRow = { ...outbound, peer: 'local' }
    expect(judgeSettlement(localRow, local('dsh/bbbbbbbb'), facts())).toEqual({ ok: true, role: 'target' })
    expect(judgeSettlement(localRow, wire('dsh/bbbbbbbb', 'origin-claim', 'http://x'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
  })

  it('target-member: a current member of the canvas team, under the same where-it-lives rule', () => {
    const row = { ...outbound, team: 'dsh/canvas/ops' }
    expect(judgeSettlement(row, wire('qa/11112222', 'origin-claim', 'http://100.75.181.127:13080'), facts())).toEqual({ ok: true, role: 'target-member' })
    expect(judgeSettlement(row, wire('dsh/aaaaaaaa', 'origin-claim', 'http://100.75.181.127:13080'), facts())).toEqual({ ok: true, role: 'target-member' })
    expect(judgeSettlement(row, wire('dsh/aaaaaaaa', 'origin-claim', 'http://impostor:1'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    expect(judgeSettlement(row, wire('dsh/zzzzzzzz', 'origin-claim', 'http://100.75.181.127:13080'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
  })

  it('review of PR #140 P2-1: an auto-receipt for a bare zone team names one of that zone\'s faces', () => {
    expect(judgeSettlement({ ...inbound, auth: { ...auth, target: 'dsh' } }, local(HOST), facts({ onBehalfOf: 'dsh/01234567' }))).toEqual({ ok: true, role: 'host-face' })
    expect(judgeSettlement({ ...outbound, team: 'cargo' }, wire('cargo-host', 'claim-mismatch', 'http://100.75.181.127:13080'), facts({ onBehalfOf: 'cargo/89abcdef' }))).toEqual({ ok: true, role: 'host-face' })
    expect(judgeSettlement({ ...outbound, team: 'cargo' }, wire('cargo-host', 'claim-mismatch', 'http://100.75.181.127:13080'), facts({ onBehalfOf: 'cargox/89abcdef' }))).toEqual({ ok: false, reason: 'on-behalf-mismatch' })
  })

  it('host-face: the target\'s host on its behalf — locally by this host\'s label, across hosts by a claim from the row\'s peer origin', () => {
    expect(judgeSettlement(inbound, local(HOST), facts({ onBehalfOf: TARGET }))).toEqual({ ok: true, role: 'host-face' })
    expect(judgeSettlement(inbound, local(HOST), facts({ onBehalfOf: 'dsh/zzzzzzzz' }))).toEqual({ ok: false, reason: 'on-behalf-mismatch' })
    expect(judgeSettlement(outbound, wire('dsh-host-b', 'claim-mismatch', 'http://100.75.181.127:13080'), facts({ onBehalfOf: 'dsh/bbbbbbbb' }))).toEqual({ ok: true, role: 'host-face' })
    expect(judgeSettlement(outbound, wire('dsh-host-b', 'claim-mismatch', 'http://elsewhere:1'), facts({ onBehalfOf: 'dsh/bbbbbbbb' }))).toEqual({ ok: false, reason: 'settler-off-chain' })
  })

  it('compat: an older host\'s auto-receipt (no onBehalfOf) with a claim from the row\'s peer origin', () => {
    expect(judgeSettlement(outbound, wire('dsh-host-b', 'claim-mismatch', 'http://100.75.181.127:13080'), facts())).toEqual({ ok: true, role: 'compat' })
  })

  it('#61 shape: the target host\'s own label settling WITHOUT onBehalfOf, or anyone else, is off-chain; an echo is echo-off-chain', () => {
    expect(judgeSettlement(inbound, local(HOST), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    expect(judgeSettlement(inbound, wire('dsh/99999999'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    expect(judgeSettlement(inbound, wire('dsh/99999999'), facts({ echo: true }))).toEqual({ ok: false, reason: 'echo-off-chain' })
  })
})

describe('#122 the ledger under a judge', () => {
  const judgeOf = (enforce: boolean, ok: boolean): SettlementJudge => ({
    enforce,
    settler: { caller: 'dsh/99999999', proof: 'origin-claim', ingress: 'wire' },
    check: (_row: TaskRecord) => (ok ? { ok: true, role: 'target' } : { ok: false, reason: 'settler-off-chain' }),
  })

  it('observe: an off-chain receipt still settles, labelled off-chain, and is recorded as would-refuse', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-o', 'dsh/bbbbbbbb', 'local')
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-o done', judgeOf(false, false))).toBeDefined()
    expect(ledger.archive()[0]).toMatchObject({ taskId: 'direct-o', settledBy: { caller: 'dsh/99999999', chain_role: 'off-chain' } })
    expect(ledger.settlementRefusals()[0]).toMatchObject({ taskId: 'direct-o', reason: 'settler-off-chain', enforced: false, head: '[A2A receipt] task direct-o done' })
  })

  it('enforce: an off-chain receipt leaves the row owed and is recorded as refused; an on-chain one settles with its role', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-e', 'dsh/bbbbbbbb', 'local')
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-e done', judgeOf(true, false))).toBeUndefined()
    expect(ledger.find('direct-e')?.status).toBe('pending')
    expect(ledger.settlementRefusals()[0]).toMatchObject({ taskId: 'direct-e', enforced: true })
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-e done', judgeOf(true, true))).toBeDefined()
    expect(ledger.archive()[0]?.settledBy).toEqual({ caller: 'dsh/99999999', chain_role: 'target' })
  })

  it('an echo is judged too; under enforce an off-chain echo settles nothing', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-x', 'dsh/bbbbbbbb', 'local')
    expect(ledger.resolveEcho('about task direct-x: all good', judgeOf(true, false))).toEqual([])
    expect(ledger.find('direct-x')).toBeDefined()
    expect(ledger.resolveEcho('about task direct-x: all good', judgeOf(false, false))).toEqual(['direct-x'])
    expect(ledger.archive()[0]?.settledBy?.chain_role).toBe('off-chain')
  })

  it('no judge: settles exactly as before (no settledBy, no ring entry)', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-n', 'dsh/bbbbbbbb', 'local')
    ledger.resolveFromMessage('[A2A receipt] task direct-n done')
    expect(ledger.archive()[0]).not.toHaveProperty('settledBy')
    expect(ledger.settlementRefusals()).toEqual([])
  })

  it('review of PR #140 P2-3: a late off-chain receipt under enforce marks lateness only — the settled summary and outcome stay', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-l', 'dsh/bbbbbbbb', 'local')
    ledger.resolveFromMessage('[A2A receipt] task direct-l genuine answer', judgeOf(true, true))
    const before = ledger.archive()[0]!
    expect(ledger.resolveFromMessage('[A2A receipt] task direct-l forged rewrite\n{"outcome":"failed"}', judgeOf(true, false))).toBeUndefined()
    const after = ledger.archive()[0]!
    expect(after.summary).toBe(before.summary)
    expect(after.outcome).toBe(before.outcome)
    expect(after.settledBy).toEqual(before.settledBy)
    expect(after.lateReceiptAt).toBeDefined()
    expect(ledger.settlementRefusals()[0]).toMatchObject({ taskId: 'direct-l', enforced: true })
  })

  it('review of PR #140 P2-4: repeats fold into one entry with a count, so one row\'s flood cannot push other evidence out', () => {
    const ledger = new TaskLedger('')
    ledger.track('direct-keep', 'dsh/bbbbbbbb', 'local')
    ledger.resolveFromMessage('[A2A receipt] task direct-keep x', judgeOf(true, false))
    ledger.track('direct-flood', 'dsh/bbbbbbbb', 'local')
    for (let i = 0; i < SETTLEMENT_REFUSAL_CAP * 2; i += 1) ledger.resolveFromMessage('[A2A receipt] task direct-flood x', judgeOf(true, false))
    const ring = ledger.settlementRefusals()
    expect(ring).toHaveLength(2)
    expect(ring[0]).toMatchObject({ taskId: 'direct-flood', count: SETTLEMENT_REFUSAL_CAP * 2 })
    expect(ring[1]).toMatchObject({ taskId: 'direct-keep', count: 1 })
    expect(ledger.settlementRefusalsTotal()).toBe(SETTLEMENT_REFUSAL_CAP * 2 + 1)
  })

  it('review of PR #140 P3: an oversized caller is cut on write and an oversized one refused on restore', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-s4cap-')), 'a2a', 'tasks.json')
    const ledger = new TaskLedger(path)
    ledger.track('direct-c', 'dsh/bbbbbbbb', 'local')
    const big: SettlementJudge = { ...judgeOf(false, false), settler: { caller: 'x'.repeat(5000), proof: 'none', ingress: 'wire' } }
    ledger.resolveFromMessage('[A2A receipt] task direct-c x', big)
    expect(ledger.settlementRefusals()[0]?.settler.caller).toHaveLength(256)
    expect(ledger.archive()[0]?.settledBy?.caller).toHaveLength(256)
    const again = new TaskLedger(path)
    expect(again.archive()[0]?.settledBy?.caller).toHaveLength(256)
    expect(again.settlementRefusals()).toHaveLength(1)
  })

  it('the ring is bounded, and it and settledBy survive a restart; a malformed entry is dropped', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-s4-')), 'a2a', 'tasks.json')
    const ledger = new TaskLedger(path)
    for (let i = 0; i < SETTLEMENT_REFUSAL_CAP + 5; i += 1) {
      ledger.track(`direct-${String(i)}`, 'dsh/bbbbbbbb', 'local')
      ledger.resolveFromMessage(`[A2A receipt] task direct-${String(i)} done`, judgeOf(false, false))
    }
    expect(ledger.settlementRefusals()).toHaveLength(SETTLEMENT_REFUSAL_CAP)
    const again = new TaskLedger(path)
    expect(again.settlementRefusals()).toEqual(ledger.settlementRefusals())
    expect(again.archive()[0]?.settledBy).toEqual({ caller: 'dsh/99999999', chain_role: 'off-chain' })
  })
})
