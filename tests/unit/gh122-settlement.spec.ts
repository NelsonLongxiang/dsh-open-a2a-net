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

  it('target: the team the task went to (proven on the wire, or in-process)', () => {
    expect(judgeSettlement(inbound, local(TARGET), facts())).toEqual({ ok: true, role: 'target' })
    expect(judgeSettlement(outbound, wire('dsh/bbbbbbbb'), facts())).toEqual({ ok: true, role: 'target' })
    expect(judgeSettlement(outbound, wire('dsh/bbbbbbbb', 'legacy-window'), facts())).toEqual({ ok: false, reason: 'settler-unverified' })
    expect(judgeSettlement(outbound, wire('dsh/bbbbbbbb', 'claim-mismatch', 'http://x'), facts())).toEqual({ ok: false, reason: 'settler-unverified' })
  })

  it('target-member: a member of the canvas team (by session id or handle, local or remote)', () => {
    const row = { ...outbound, team: 'dsh/canvas/ops' }
    expect(judgeSettlement(row, wire('qa/11112222'), facts())).toEqual({ ok: true, role: 'target-member' })
    expect(judgeSettlement(row, wire('dsh/aaaaaaaa'), facts())).toEqual({ ok: true, role: 'target-member' })
    expect(judgeSettlement(row, wire('dsh/zzzzzzzz'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
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
