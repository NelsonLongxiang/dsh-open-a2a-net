// @vitest-environment node
/**
 * #881 v2 second slice: the delivery pipeline (policy, audit row on disk, restricted mark on disk, authorization rechecked,
 * dedicated rendering), the restricted-session store, the member-turn paraphrase block and the log backstop.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 25_000 })
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Trigger } from '../../src/superagent/upstream/dsh-superagent/src/core/index.ts'
import { formatReceipt } from '../../src/receipt.ts'
import { RESULT_UNAVAILABLE } from '../../src/superagent/host/outbound-results.ts'
import { AUDIT_PER_HOUR, RESTRICTED_TURN_TEXT, ResultAudit, renderResultBody, type DisclosurePolicy } from '../../src/superagent/host/outbound-disclosure.ts'
import { outboundBodyMeta } from '../../src/superagent/host/tools.ts'
import { SessionTaint, sessionSource } from '../../src/node-self.ts'

const canvasOf = (local: readonly string[]) => (name: string) => name === 'team' ? { local, remote: [] } : undefined
const wb = (id: string): Trigger => ({ id, source: 'workbench', threads: [{ source: 'workbench', id: 't1' }], actor: { source: 'workbench', id: 'owner' }, human: true, addressed: 'direct',
  at: '2026-11-24T00:00:01Z', text: 'request ' + id, channel: { source: 'workbench', thread: 't1', address: { trigger: id } }, meta: {} })
const T = 'direct-out000001', SENDER = 'superagent-team/0123456789abcdef', BODY = 'line two secret'
const wire = (r: string) => `[A2A direct] (task in-1) verified caller dsh/aaaaaaaa (routed to dsh/canvas/team) sent:\n\n${r}`
const receipt = () => ({ id: 'a2a:dsh/aaaaaaaa:in-1', source: 'a2a', threads: [{ source: 'a2a', id: 'in-1' }], actor: { source: 'a2a', id: 'dsh/aaaaaaaa' }, human: false, addressed: 'direct',
  at: '2026-11-24T00:00:05Z', text: wire(formatReceipt(T, 'done', { outcome: 'completed' }) + '\n' + BODY), meta: { taskId: 'in-1', receiptFor: T, proof: 'cli-identity', settlement: 'settled' } }) as never
const ALLOW: DisclosurePolicy = () => ({ allow: true, rule: 'test' })

async function team(extra: Record<string, unknown> = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const home = mkdtempSync(join(tmpdir(), 'sa-disc-'))
  const deps = { canvasTeam: canvasOf(['session-r', 'session-m', 'session-o']), home, logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {}, sessionLoaded: () => true }
  const first = new SuperagentHost(deps as never)
  expect(first.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  first.engine.receive(wb('1')); first.pass()
  expect(routeItem(first, { trigger_id: '1', kind: 'accept', title: '调研', scope: 's', reason: 'asked' })).toMatchObject({ ok: true })
  const ticketId = first.store.tickets.list()[0]!.id
  const dir = join(home, 'superagent'); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'outbound.json'), JSON.stringify({ c1: { card: 'c1', ticketId, address: 'dsh/canvas/other', text: '原文', by: 'session-r', at: '2026-11-24T00:00:02Z', state: 'sent', task: T,
    approval: { at: '2026-11-24T00:00:02Z', team: 'team', message: '原文' }, attempts: [{ task: T, sender: SENDER, at: '2026-11-24T00:00:03Z', phase: 'dispatching', delivery: 'accepted' }] } }))
  const calls: string[] = []
  const restricted = new Set<string>()
  const host = new SuperagentHost({ ...deps, restrict: (s: string) => { calls.push('restrict:' + s); restricted.add(s); return true }, restricted: (s: string) => restricted.has(s), ...extra } as never)
  ;(host as unknown as { outbound: { received(t: never): void } }).outbound.received(receipt())
  return { host, home, dir, ticketId, calls, restricted }
}

describe('#881 v2 slice 2: delivery only through policy, audit, restricted mark and a recheck', () => {
  it('no policy installed: the router gets policy-withheld, no body, no audit row, no restricted mark', async () => {
    const t = await team()
    const out = t.host.outboundResult('session-r', t.ticketId, T)
    expect(out).toMatchObject({ ok: true, status: 'unavailable', reason: 'policy', hasBody: true })
    expect(out).not.toHaveProperty('body')
    expect(existsSync(join(t.dir, 'outbound-result-audit.json'))).toBe(false)
    expect(t.calls).toEqual([])
  })
  it('with a policy: the audit row is on disk before the session is marked, then the rendered body is returned', async () => {
    let auditSeenAtMark = false
    const t = await team({ disclosure: ALLOW, restrict: (s: string) => { auditSeenAtMark = existsSync(join(t.dir, 'outbound-result-audit.json')); t.restricted.add(s); return true }, restricted: (s: string) => t.restricted.has(s) })
    const out = t.host.outboundResult('session-r', t.ticketId, T) as { body?: string; status?: string }
    expect(out.status).toBe('ready')
    expect(auditSeenAtMark).toBe(true)
    expect(out.body!.split('\n')[0]).toBe(`[A2A outbound result] ticket ${t.ticketId} task ${T} outcome completed`)
    expect(out.body).toContain('受限内容')
    expect(out.body).toContain(BODY)
    const rows = (JSON.parse(readFileSync(join(t.dir, 'outbound-result-audit.json'), 'utf8')) as { rows: Array<{ session: string; rule: string; role: string }> }).rows
    expect(rows).toMatchObject([{ session: 'session-r', rule: 'test', role: 'router' }])
    expect(t.restricted.has('session-r')).toBe(true)
  })
  it('an audit that cannot be written withholds the body and never marks the session', async () => {
    const t = await team({ disclosure: ALLOW })
    mkdirSync(join(t.dir, 'outbound-result-audit.json'))
    expect(t.host.outboundResult('session-r', t.ticketId, T)).toMatchObject({ status: 'unavailable', reason: 'audit' })
    expect(t.calls).toEqual([])
  })
  it('the hourly audit quota withholds the next body', async () => {
    const t = await team({ disclosure: ALLOW })
    for (let i = 0; i < AUDIT_PER_HOUR; i++) expect(t.host.outboundResult('session-r', t.ticketId, T)).toMatchObject({ status: 'ready' })
    expect(t.host.outboundResult('session-r', t.ticketId, T)).toMatchObject({ status: 'unavailable', reason: 'audit' })
  })
  it('a restricted mark that cannot be written withholds the body', async () => {
    const t = await team({ disclosure: ALLOW, restrict: () => false })
    const out = t.host.outboundResult('session-r', t.ticketId, T)
    expect(out).toMatchObject({ status: 'unavailable', reason: 'storage' })
    expect(out).not.toHaveProperty('body')
  })
  it('authorization lost while the mark is written: the one refusal, no body', async () => {
    const t = await team({ disclosure: ALLOW })
    const real = t.host.executor.bindingFor.bind(t.host.executor)
    let bound = true
    vi.spyOn(t.host.executor, 'bindingFor').mockImplementation((m: string, id: string) => (m === 'session-m' && id === t.ticketId ? (bound ? {} as never : undefined) : real(m, id)))
    const host2 = t.host as unknown as { d: { restrict: (s: string) => boolean } }
    const original = host2.d.restrict
    host2.d.restrict = (s: string) => { bound = false; return original(s) }
    expect(t.host.outboundResult('session-m', t.ticketId, T)).toEqual(RESULT_UNAVAILABLE)
  })
  it('an observer never gets a body, even with a policy', async () => {
    const t = await team({ disclosure: ALLOW })
    vi.spyOn(t.host, 'isObserver').mockImplementation((s: string) => s === 'session-o')
    expect(t.host.outboundResult('session-o', t.ticketId, T)).toEqual({ ok: true, status: 'ready' })
    expect(t.calls).toEqual([])
  })
  it('a delivery adds nothing to the team state (reports): no rendered body, no audit, state unchanged', async () => {
    // The #882 answer note (and its 2000-character clip in state().outbound) is the existing protocol, outside this read path.
    const t = await team({ disclosure: ALLOW })
    const state = () => JSON.stringify((t.host as unknown as { state(): unknown }).state())
    const before = state()
    expect((t.host.outboundResult('session-r', t.ticketId, T) as { body?: string }).body).toBeDefined()
    const after = state()
    expect(after).toBe(before)
    expect(after).not.toContain('[A2A outbound result]')
    expect(after).not.toContain('outbound-result-audit')
  })
})

describe('#881 v2 slice 2: a restricted session is not paraphrased; its turn end is kept', () => {
  it('memberTurn text is replaced, quiet is kept', async () => {
    const t = await team({ memberTurn: () => ({ quiet: false, text: 'I read: ' + BODY }) })
    const turnOf = (id: string) => (t.host as unknown as { turnOf(id: string): { quiet: boolean; text: string } }).turnOf(id)
    expect(turnOf('session-m').text).toContain(BODY)
    t.restricted.add('session-m')
    expect(turnOf('session-m')).toMatchObject({ quiet: false, text: RESTRICTED_TURN_TEXT })
  })
})

describe('#881 v2 slice 2: pieces', () => {
  it('the tool meta marks only an outbound_result that carried a body', () => {
    expect(outboundBodyMeta({ kind: 'outbound_result' }, { ok: true, body: 'x' })).toEqual({ a2aOutboundBody: true })
    expect(outboundBodyMeta({ kind: 'outbound_result' }, { ok: true, status: 'ready' })).toEqual({ a2aOutboundBody: false })
    expect(outboundBodyMeta({ kind: 'ticket' }, { ok: true, body: 'x' })).toEqual({ a2aOutboundBody: false })
  })
  it('the log backstop: a tool result marked as carrying a body is remote evidence', () => {
    const local = { type: 'user/message', data: { source: { kind: 'user' } } }
    expect(sessionSource([local])).toEqual({ local: true })
    expect(sessionSource([local, { type: 'tool/result', data: { message: { toolCallId: 'c' }, meta: { a2aOutboundBody: true } } }])).toEqual({ local: false, via: 'outbound-result', evidence: true })
    expect(sessionSource([local, { type: 'tool/result', data: { message: { toolCallId: 'c' }, meta: { a2aOutboundBody: false } } }])).toEqual({ local: true })
  })
  it('a restricted mark is on disk, survives a restart and taints the session', () => {
    const root = mkdtempSync(join(tmpdir(), 'taint-'))
    const a = new SessionTaint(root)
    expect(a.isRestricted('s1')).toBe(false)
    expect(a.markRestricted('s1')).toBe(true)
    const b = new SessionTaint(root)
    expect(b.isRestricted('s1')).toBe(true)
    expect(b.of('s1')).toBe('outbound-result')
    expect(b.isRestricted('s2')).toBe(false)
  })
  it('a mark that cannot be written is refused and not held in memory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'taint-'))
    writeFileSync(join(parent, 'file'), 'x')
    const a = new SessionTaint(join(parent, 'file', 'a2a'))
    expect(a.markRestricted('s1')).toBe(false)
    expect(a.isRestricted('s1')).toBe(false)
  })
  it('a damaged restricted list fails closed: everyone reads restricted and nothing new is marked', () => {
    const root = mkdtempSync(join(tmpdir(), 'taint-'))
    writeFileSync(join(root, 'node-taint.json'), JSON.stringify({ sessions: [], restricted: [7] }))
    const a = new SessionTaint(root)
    expect(a.isRestricted('anyone')).toBe(true)
    expect(a.markRestricted('s1')).toBe(false)
  })
  it('an unreadable audit fails closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-'))
    writeFileSync(join(dir, 'a.json'), '{broken')
    expect(new ResultAudit({ path: join(dir, 'a.json'), now: () => 1, logger: { warn: () => {} } }).record({ session: 's', role: 'router', ticketId: 't', task: 'k', bodyHash: 'h', rule: 'r' })).toBe('failed')
  })
  it('the rendering keeps the header first and marks a cut body', () => {
    const text = renderResultBody({ ticketId: 't', task: 'k', clipped: true, text: '[A2A outbound result] ticket x task y' })
    expect(text.split('\n')[0]).toBe('[A2A outbound result] ticket t task k (cut at 8 KiB)')
  })
})
