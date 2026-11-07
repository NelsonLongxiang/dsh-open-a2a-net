/**
 * #139 (#114 S4 remainder, before S7 enforce): the settlement judgement
 * reads the peer by its card key (not one spelling of its address), the
 * peer host's process label once recorded (the scope-off residual of N1),
 * and the member that actually received the task (`deliveredTo`). The
 * ledger carries those facts from birth to archive and restores them only
 * in shape; an outbound local row keeps its in-process admission.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAuthorization, judgeSettlement, localCandidateAdmission, type AdmissionRecords, type Settler, type SettlementFacts } from '../../src/task-auth.ts'
import { TaskLedger } from '../../src/task-ledger.ts'
import { withSettlementField } from '../../src/faces/wire.ts'
import { withResponseFields } from '../../src/response-fields.ts'

const HOST = 'dsh-host-9c53bf95'
const KEY = 'MCowBQYDK2VwAyEApeerKeyBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb='
const TAILSCALE = 'http://100.64.0.10:13080'
const LAN = 'http://192.168.1.5:13080'
const facts = (extra: Partial<SettlementFacts> = {}): SettlementFacts => ({ hostLabel: HOST, membersOf: team => (team === 'dsh/canvas/ops' ? ['dsh/aaaaaaaa', 'qa/11112222', 'qa/33334444'] : undefined), ...extra })
const wire = (caller: string, claimOrigin: string, claimKey?: string, proof: Settler['proof'] = 'origin-claim'): Settler => ({ caller, proof, ingress: 'wire', claimOrigin, ...(claimKey !== undefined ? { claimKey } : {}) })
const local = (caller: string): Settler => ({ caller, proof: 'in-process', ingress: 'local' })

describe('#139 judgeSettlement', () => {
  it('N2 / P2-2: the peer dialed over Tailscale signs with its LAN URL — the card key, not the spelling, names it', () => {
    const row = { team: 'qa/11112222', peer: TAILSCALE, direction: 'outbound' as const, peerKey: KEY }
    expect(judgeSettlement(row, wire('qa/11112222', LAN, KEY), facts())).toEqual({ ok: true, role: 'target' })
    // Another key from the same spelling-mismatched origin is not the peer.
    expect(judgeSettlement(row, wire('qa/11112222', LAN, 'MCowBQYDK2VwAyEAother='), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    // A row born before the field keeps the origin rule (and its false positive).
    const { peerKey: _drop, ...older } = row
    expect(judgeSettlement(older, wire('qa/11112222', LAN, KEY), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    // The key never upgrades an unproven caller.
    expect(judgeSettlement(row, wire('qa/11112222', LAN, KEY, 'claim-mismatch'), facts())).toEqual({ ok: false, reason: 'settler-unverified' })
    // Compat and host-face read the same peer test.
    expect(judgeSettlement({ ...row, peerHost: 'qa-host' }, wire('qa-host', LAN, KEY, 'claim-mismatch'), facts())).toEqual({ ok: true, role: 'compat' })
    expect(judgeSettlement({ ...row, peerHost: 'qa-host' }, wire('qa-host', LAN, KEY, 'claim-mismatch'), facts({ onBehalfOf: 'qa/11112222' }))).toEqual({ ok: true, role: 'host-face' })
  })

  it('scope-off residual of N1: another bare label on the peer host is not its host face once the row knows the host', () => {
    const row = { team: 'qa/11112222', peer: TAILSCALE, direction: 'outbound' as const, peerKey: KEY, peerHost: 'qa-host' }
    // An unjoined session on the peer host signs with the host's zone claim but carries its own label.
    expect(judgeSettlement(row, wire('qa-host-cccccccc', TAILSCALE, KEY, 'claim-mismatch'), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    expect(judgeSettlement(row, wire('qa-host-cccccccc', TAILSCALE, KEY, 'claim-mismatch'), facts({ onBehalfOf: 'qa/11112222' }))).toEqual({ ok: false, reason: 'settler-off-chain' })
    expect(judgeSettlement(row, wire('qa-host', TAILSCALE, KEY, 'claim-mismatch'), facts({ onBehalfOf: 'qa/11112222' }))).toEqual({ ok: true, role: 'host-face' })
  })

  it('deliveredTo: only the member that received a canvas task answers for it (S5 review #7)', () => {
    const row = { team: 'dsh/canvas/ops', peer: TAILSCALE, direction: 'outbound' as const, peerKey: KEY, peerHost: 'qa-host', deliveredTo: 'qa/11112222' }
    expect(judgeSettlement(row, wire('qa/11112222', TAILSCALE, KEY), facts())).toEqual({ ok: true, role: 'target-member' })
    // Another current member of the canvas, same host, did not receive it.
    expect(judgeSettlement(row, wire('qa/33334444', TAILSCALE, KEY), facts())).toEqual({ ok: false, reason: 'settler-off-chain' })
    expect(judgeSettlement(row, wire('qa-host', TAILSCALE, KEY, 'claim-mismatch'), facts({ onBehalfOf: 'qa/33334444' }))).toEqual({ ok: false, reason: 'on-behalf-mismatch' })
    expect(judgeSettlement(row, wire('qa-host', TAILSCALE, KEY, 'claim-mismatch'), facts({ onBehalfOf: 'qa/11112222' }))).toEqual({ ok: true, role: 'host-face' })
    // A member removed after delivery still settled what it received.
    expect(judgeSettlement(row, wire('qa/11112222', TAILSCALE, KEY), facts({ membersOf: () => [] }))).toEqual({ ok: true, role: 'target-member' })
    // A row born before the field keeps the current-membership rule.
    const { deliveredTo: _drop, ...older } = row
    expect(judgeSettlement(older, wire('qa/33334444', TAILSCALE, KEY), facts())).toEqual({ ok: true, role: 'target-member' })
  })

  it('deliveredTo on an inbound bare-zone row: onBehalfOf must name the face that received it', () => {
    const auth = buildAuthorization({ ok: true, via: 'host-face', rule: 'host-face', basis: [] }, {
      caller: 'dsh', proof: 'in-process', ingress: 'local', allowlistVersion: 'al1:0123456789abcdef', target: 'dsh', receiptTarget: 'dsh', receivedAt: 1,
    })
    const row = { team: 'dsh', peer: 'local:dsh', direction: 'inbound' as const, auth, deliveredTo: 'dsh/01234567' }
    expect(judgeSettlement(row, local(HOST), facts({ onBehalfOf: 'dsh/01234567' }))).toEqual({ ok: true, role: 'host-face' })
    expect(judgeSettlement(row, local(HOST), facts({ onBehalfOf: 'dsh/89abcdef' }))).toEqual({ ok: false, reason: 'on-behalf-mismatch' })
  })
})

describe('#139 localCandidateAdmission', () => {
  const records = (zone: string): AdmissionRecords => ({
    zone, teamScopeRouting: true, id8: (id: string) => id.slice(-8), canvasTeamOf: (name: string) => `${zone}/canvas/${name}`,
    memberships: () => [], joined: () => [], canvasNames: () => [], canvasTeamsOf: () => [], canvasMembersOf: () => [], canvasRemoteMembersOf: () => [],
    peerOrgs: () => [], liveNodeIds: () => [], cliDeposited: () => false,
  } as unknown as AdmissionRecords)
  it('an ungated caller is recorded as local-exempt; the joined face keeps its shared-team verdict', () => {
    expect(localCandidateAdmission(records('dsh'), 'dsh', 'dsh/01234567')).toMatchObject({ ok: true, rule: 'local-exempt', via: 'host-face' })
    expect(localCandidateAdmission(records('dsh'), undefined, 'dsh/01234567')).toMatchObject({ ok: true, rule: 'local-exempt' })
    expect(localCandidateAdmission(records('dsh'), 'dsh/aaaaaaaa', 'dsh/01234567').ok).toBe(false)
  })
})

describe('#139 ledger routing facts', () => {
  const home = (): string => join(mkdtempSync(join(tmpdir(), 'gh139-')), 'tasks.json')
  const localAuth = buildAuthorization({ ok: true, via: 'host-face', rule: 'local-exempt', basis: [] }, {
    caller: 'dsh', proof: 'in-process', ingress: 'local', allowlistVersion: 'al1:0123456789abcdef', target: 'dsh/canvas/ops', receiptTarget: 'dsh', receivedAt: Date.now(),
  })

  it('births, archives and restores the facts; an outbound local row keeps its in-process admission', () => {
    const path = home()
    const ledger = new TaskLedger(path)
    ledger.track('direct-remote01', 'dsh/canvas/ops', TAILSCALE, undefined, 'b', undefined, { peerKey: KEY, peerHost: 'qa-host', deliveredTo: 'qa/11112222', auth: localAuth })
    ledger.track('direct-local001', 'dsh/canvas/ops', 'local', undefined, 'b', undefined, { auth: localAuth, deliveredTo: 'dsh/aaaaaaaa', peerKey: KEY })
    ledger.trackInbound('direct-inbnd01', 'dsh', 'dsh', undefined, true, 'b', undefined, 'dsh/01234567')
    const restored = new TaskLedger(path)
    // A remote row never carries a local admission; a local row never carries peer facts.
    expect(restored.find('direct-remote01')).toMatchObject({ peerKey: KEY, peerHost: 'qa-host', deliveredTo: 'qa/11112222' })
    expect(restored.find('direct-remote01')?.auth).toBeUndefined()
    expect(restored.find('direct-local001')).toMatchObject({ deliveredTo: 'dsh/aaaaaaaa', auth: { ingress: 'local', proof: 'in-process', admission_rule: 'local-exempt' } })
    expect(restored.find('direct-local001')?.peerKey).toBeUndefined()
    expect(restored.find('direct-inbnd01')?.deliveredTo).toBe('dsh/01234567')
    // The archive keeps them, so a late receipt is judged against the same facts.
    restored.resolveFromMessage('[A2A receipt] task direct-remote01 done')
    expect(restored.archive().find(r => r.taskId === 'direct-remote01')).toMatchObject({ peerKey: KEY, peerHost: 'qa-host', deliveredTo: 'qa/11112222' })
  })

  it('restore drops a fact out of shape, and a wire record or foreign target on an outbound row, whole', () => {
    const path = home()
    const ledger = new TaskLedger(path)
    ledger.track('direct-remote02', 'qa/11112222', TAILSCALE, undefined, 'b', undefined, { peerKey: KEY })
    ledger.track('direct-local002', 'dsh/canvas/ops', 'local', undefined, 'b', undefined, { auth: localAuth })
    ledger.track('direct-local003', 'dsh/canvas/ops', 'local', undefined, 'b', undefined, { auth: localAuth })
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { tasks: Array<Record<string, unknown>> }
    for (const row of raw.tasks) {
      if (row.taskId === 'direct-remote02') { row.peerKey = 'k'.repeat(300); row.peerHost = 7; row.deliveredTo = '' }
      if (row.taskId === 'direct-local002') row.auth = { ...(row.auth as object), ingress: 'wire', proof: 'legacy-window' }
      if (row.taskId === 'direct-local003') row.auth = { ...(row.auth as object), target: 'dsh/canvas/other' }
    }
    writeFileSync(path, JSON.stringify(raw))
    const restored = new TaskLedger(path)
    const remote = restored.find('direct-remote02')
    expect(remote).toBeDefined()
    expect([remote?.peerKey, remote?.peerHost, remote?.deliveredTo]).toEqual([undefined, undefined, undefined])
    expect(restored.find('direct-local002')?.auth).toBeUndefined()
    expect(restored.find('direct-local003')?.auth).toBeUndefined()
  })
})

describe('#139 withSettlementField', () => {
  const fakeRes = () => {
    const sent: { status?: number; headers?: Record<string, string | number>; body?: string } = {}
    const res = {
      writeHead(status: number, headers?: Record<string, string | number>) { sent.status = status; sent.headers = headers; return res },
      end(body?: string) { sent.body = body; return res },
    }
    return { res: res as never, sent }
  }
  const refusal = { status: 'refused' as const, reason: 'settler-off-chain' as const, task_id: 'direct-x' }

  it('adds the field to a JSON object body and fixes Content-Length', () => {
    const { res, sent } = fakeRes()
    withSettlementField(res, refusal)
    const body = JSON.stringify({ delivered: true })
    ;(res as { writeHead: (s: number, h: Record<string, string | number>) => void }).writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
    ;(res as { end: (b: string) => void }).end(body)
    expect(JSON.parse(String(sent.body))).toEqual({ delivered: true, settlement: refusal })
    expect(sent.headers?.['Content-Length']).toBe(Buffer.byteLength(String(sent.body)))
    expect(sent.status).toBe(200)
  })

  it('composes migration advice with settlement without losing either field or byte length', () => {
    const { res, sent } = fakeRes()
    const advice = { reason: 'use-file-channel', message: '文件不走会话消息' }
    withResponseFields(res, { advice })
    withSettlementField(res, refusal)
    const body = JSON.stringify({ delivered: true })
    ;(res as { writeHead: (s: number, h: Record<string, string | number>) => void }).writeHead(200, { 'Content-Length': Buffer.byteLength(body) })
    ;(res as { end: (b: string) => void }).end(body)
    expect(JSON.parse(String(sent.body))).toEqual({ delivered: true, advice, settlement: refusal })
    expect(sent.headers?.['Content-Length']).toBe(Buffer.byteLength(String(sent.body)))
  })

  it('leaves a non-object body unchanged', () => {
    const { res, sent } = fakeRes()
    withSettlementField(res, refusal)
    ;(res as { writeHead: (s: number, h: Record<string, string | number>) => void }).writeHead(200, { 'Content-Length': 2 })
    ;(res as { end: (b: string) => void }).end('[]')
    expect(sent.body).toBe('[]')
    expect(sent.headers?.['Content-Length']).toBe(2)
  })
})
