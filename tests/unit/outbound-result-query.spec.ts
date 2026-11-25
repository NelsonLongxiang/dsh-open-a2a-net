// @vitest-environment node
/**
 * #881 v2 first slice, on a real SuperagentHost: a ledger-settled final receipt on the current attempt records a result;
 * `outboundResult` serves its status by role (router, truly bound member, observer status only) and refuses everything
 * else with one fixed shape. No body is ever served in this slice.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 25_000 })
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Trigger } from '../../src/superagent/upstream/dsh-superagent/src/core/index.ts'
import { formatReceipt } from '../../src/receipt.ts'
import { RESULT_UNAVAILABLE } from '../../src/superagent/host/outbound-results.ts'
import { translate } from '../../src/superagent/a2a-watch.ts'

const canvasOf = (local: readonly string[]) => (name: string) => name === 'team' ? { local, remote: [] } : undefined
const wb = (id: string): Trigger => ({ id, source: 'workbench', threads: [{ source: 'workbench', id: 't1' }], actor: { source: 'workbench', id: 'owner' }, human: true, addressed: 'direct',
  at: '2026-11-24T00:00:01Z', text: 'request ' + id, channel: { source: 'workbench', thread: 't1', address: { trigger: id } }, meta: {} })
const T = 'direct-out000001', OLD = 'direct-out000000', SENDER = 'superagent-team/0123456789abcdef'
const wire = (r: string) => `[A2A direct] (task in-1) verified caller dsh/aaaaaaaa (routed to dsh/canvas/team) sent:\n\n${r}`
const receipt = (over: Record<string, unknown> = {}, text = wire(formatReceipt(T, 'done', { outcome: 'completed' }) + '\nline two')) => ({ id: 'a2a:dsh/aaaaaaaa:in-1', source: 'a2a', threads: [{ source: 'a2a', id: 'in-1' }],
  actor: { source: 'a2a', id: 'dsh/aaaaaaaa' }, human: false, addressed: 'direct', at: '2026-11-24T00:00:05Z', text, meta: { taskId: 'in-1', receiptFor: T, proof: 'cli-identity', settlement: 'settled', ...over } }) as never

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const home = mkdtempSync(join(tmpdir(), 'sa-result-'))
  const host = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m', 'session-o']), home, logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, sessionLoaded: () => true } as never)
  expect(host.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  host.engine.receive(wb('1')); host.pass()
  expect(routeItem(host, { trigger_id: '1', kind: 'accept', title: '调研', scope: 's', reason: 'asked' })).toMatchObject({ ok: true })
  return { host, home, ticketId: host.store.tickets.list()[0]!.id }
}
function seed(home: string, ticketId: string, over: Record<string, unknown> = {}) {
  const dir = join(home, 'superagent'); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'outbound.json'), JSON.stringify({ c1: { card: 'c1', ticketId, address: 'dsh/canvas/other', text: '原文', by: 'session-r', at: '2026-11-24T00:00:02Z', state: 'sent', task: T,
    approval: { at: '2026-11-24T00:00:02Z', team: 'team', message: '原文' },
    attempts: [{ task: OLD, sender: SENDER, at: '2026-11-24T00:00:02Z', phase: 'dispatching', delivery: 'not-sent' }, { task: T, sender: SENDER, at: '2026-11-24T00:00:03Z', phase: 'dispatching', delivery: 'accepted' }], ...over } }))
}
async function seeded(over: Record<string, unknown> = {}) {
  const t = await team()
  seed(t.home, t.ticketId, over)
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const host = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m', 'session-o']), home: t.home, logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, sessionLoaded: () => true } as never)
  return { ...t, host }
}
const receive = (host: unknown, trigger: never) => (host as { outbound: { received(t: never): void } }).outbound.received(trigger)

describe('#881 v2: recording a verified outbound result', () => {
  it('a settled final receipt on the current attempt records a result in 0o600 files; the router reads ready', async () => {
    const t = await seeded()
    expect(t.host.outboundResult('session-r', t.ticketId, T)).toEqual({ ok: true, status: 'pending' })
    receive(t.host, receipt())
    for (const f of ['outbound-results.json', 'outbound-bodies.json']) expect(statSync(join(t.home, 'superagent', f)).mode & 0o777).toBe(0o600)
    const out = t.host.outboundResult('session-r', t.ticketId, T)
    // Slice 2: the body is stored, but with no disclosure policy installed it is withheld.
    expect(out).toMatchObject({ ok: true, status: 'unavailable', reason: 'policy', hasBody: true, outcome: 'completed', sourceCompleteness: 'complete' })
    expect(JSON.stringify(out)).not.toContain('line two')
  })
  it('a receipt the ledger did not settle records nothing', async () => {
    const t = await seeded()
    receive(t.host, receipt({ settlement: 'refused', settlementReason: 'settler-off-chain' }))
    expect(existsSync(join(t.home, 'superagent', 'outbound-results.json'))).toBe(false)
    expect(t.host.outboundResult('session-r', t.ticketId, T)).toEqual({ ok: true, status: 'pending' })
  })
  it('a cut mailbox text keeps no body and says the source was cut', async () => {
    const t = await seeded()
    receive(t.host, receipt({ truncated: true }))
    expect(t.host.outboundResult('session-r', t.ticketId, T)).toMatchObject({ ok: true, status: 'unavailable', reason: 'source-truncated', hasBody: false })
  })
  it('a receipt for the record task whose latest attempt is another one records nothing', async () => {
    const t = await seeded({ attempts: [{ task: T, sender: SENDER, at: '2026-11-24T00:00:02Z', phase: 'dispatching', delivery: 'accepted' }, { task: OLD, sender: SENDER, at: '2026-11-24T00:00:03Z', phase: 'dispatching', delivery: 'unknown' }] })
    receive(t.host, receipt())
    expect(existsSync(join(t.home, 'superagent', 'outbound-results.json'))).toBe(false)
  })
  it('no approval (a legacy request) records nothing: answered without proof reads unavailable', async () => {
    const t = await seeded({ approval: undefined })
    receive(t.host, receipt())
    expect(existsSync(join(t.home, 'superagent', 'outbound-results.json'))).toBe(false)
    expect(t.host.outboundResult('session-r', t.ticketId, T)).toMatchObject({ ok: true, status: 'unavailable', reason: 'source-unproven' })
  })
})

describe('#881 v2: the two read tools serve kind outbound_result first', () => {
  it('superagent_read for the router and a2a_ticket_read for an observer; a wrong id is the one refusal, never a wrongId hint; kind outbound unchanged', async () => {
    const t = await seeded(); receive(t.host, receipt())
    vi.spyOn(t.host, 'isObserver').mockImplementation((s: string) => s === 'session-o')
    const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
    const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, unknown>> }>()
    registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (t.host.roleOf(id) !== undefined ? t.host : undefined))
    const as = (id: string) => ({ agent: { id }, signal: new AbortController().signal })
    const sread = registered.get('superagent_read')!, tread = registered.get('a2a_ticket_read')!
    expect(await sread.execute({ kind: 'outbound_result', ticket_id: t.ticketId, task_id: T }, as('session-r'))).toMatchObject({ ok: true, status: 'unavailable', reason: 'policy', hasBody: true })
    expect(await sread.execute({ kind: 'outbound_result', ticket_id: t.ticketId.slice(0, -1), task_id: T }, as('session-r'))).toEqual(RESULT_UNAVAILABLE)
    expect(await tread.execute({ kind: 'outbound_result', ticket_id: t.ticketId, task_id: T }, as('session-o'))).toEqual({ ok: true, status: 'ready' })
    expect(await tread.execute({ kind: 'outbound_result', ticket_id: 'nope', task_id: T }, as('session-o'))).toEqual(RESULT_UNAVAILABLE)
    expect(await tread.execute({ kind: 'outbound' }, as('session-o'))).toMatchObject({ code: 'not-approver' })
  })
})

describe('#881 v2: the mailbox cut flag reaches the trigger', () => {
  it('a cut row carries truncated; an uncut one does not', () => {
    const row = { at: 1, from: 'dsh/aaaaaaaa', text: 'x', seq: 1, task_id: 'in-1', receipt_for: T }
    const cut = translate({ ...row, truncated: true, chars: 99999 }, 'e'), whole = translate(row, 'e')
    expect(cut.kind === 'trigger' && cut.trigger.meta['truncated']).toBe(true)
    expect(whole.kind === 'trigger' && 'truncated' in whole.trigger.meta).toBe(false)
  })
})

describe('#881 v2 B1: who may read which status', () => {
  it('a member reads only with a real binding to the open ticket; another member, or the same one once unbound, gets the refusal', async () => {
    const t = await seeded(); receive(t.host, receipt())
    const real = t.host.executor.bindingFor.bind(t.host.executor)
    const spy = vi.spyOn(t.host.executor, 'bindingFor').mockImplementation((m: string, id: string) => (m === 'session-m' && id === t.ticketId ? {} as never : m === 'session-m' ? real(m, id) : undefined))
    expect(t.host.outboundResult('session-m', t.ticketId, T)).toMatchObject({ ok: true, status: 'unavailable', reason: 'policy' })
    expect(t.host.outboundResult('session-o', t.ticketId, T)).toEqual(RESULT_UNAVAILABLE)
    spy.mockReturnValue(undefined)
    expect(t.host.outboundResult('session-m', t.ticketId, T)).toEqual(RESULT_UNAVAILABLE)
  })
  it('an observer sees the status alone, on open tickets only', async () => {
    const t = await seeded(); receive(t.host, receipt())
    vi.spyOn(t.host, 'isObserver').mockImplementation((s: string) => s === 'session-o')
    expect(t.host.outboundResult('session-o', t.ticketId, T)).toEqual({ ok: true, status: 'ready' })
  })
  it('an ended ticket: the router still reads it, a bound member and an observer get the refusal', async () => {
    const t = await seeded(); receive(t.host, receipt())
    vi.spyOn(t.host.executor, 'bindingFor').mockReturnValue({} as never)
    vi.spyOn(t.host, 'isObserver').mockImplementation((s: string) => s === 'session-o')
    const real = t.host.store.tickets.get(t.ticketId)!
    vi.spyOn(t.host.store.tickets, 'get').mockImplementation((id: string) => (id === t.ticketId ? { ...real, ended: { outcome: 'done' } } as never : undefined))
    expect(t.host.outboundResult('session-r', t.ticketId, T)).toMatchObject({ ok: true, status: 'unavailable', reason: 'policy' })
    expect(t.host.outboundResult('session-m', t.ticketId, T)).toEqual(RESULT_UNAVAILABLE)
    expect(t.host.outboundResult('session-o', t.ticketId, T)).toEqual(RESULT_UNAVAILABLE)
  })
  it('wrong ticket, wrong task, empty ids and strangers all get the one refusal with no hint', async () => {
    const t = await seeded(); receive(t.host, receipt())
    for (const [who, ticket, task] of [['session-r', 'nope', T], ['session-r', t.ticketId, 'direct-nope'], ['session-r', '', T], ['session-r', t.ticketId, ''], ['stranger', t.ticketId, T]] as const) {
      expect(t.host.outboundResult(who, ticket, task), `${who} ${ticket} ${task}`).toEqual(RESULT_UNAVAILABLE)
    }
  })
  it('an older attempt id reads only its own state, never the newest result', async () => {
    const t = await seeded(); receive(t.host, receipt())
    expect(t.host.outboundResult('session-r', t.ticketId, OLD)).toEqual({ ok: true, status: 'unavailable' })
  })
  it('a narrow recovery chain is not served in this slice', async () => {
    const t = await seeded({ narrowRecovery: { proposal: {}, phase: 'prepared', digest: 'x' } })
    expect(t.host.outboundResult('session-r', t.ticketId, T)).toEqual(RESULT_UNAVAILABLE)
  })
})
