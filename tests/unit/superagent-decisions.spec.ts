// @vitest-environment node
/** docs/design/superagent-decision-cards.md: what a card is, who raises one, and what deciding does. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OPEN_CARDS_MAX, oneClick, parseDecision, type DecisionSpec } from '../../src/superagent/host/decisions.ts'
import { ownerOrNoLogin } from '../../src/superagent/host/owner-proof.ts'

const spec = (level: DecisionSpec['level'] = 'P2'): DecisionSpec => ({ level, options: ['甲', '乙'], recommended: '甲' })

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-cards-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const openTicket = async (): Promise<string> => {
    const asked = h.request('做事') as { triggerId: string }
    h.pass()
    const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '做事', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
    await vi.waitFor(() => { expect(h.executor.bindingOf('session-m')?.ticketId).toBe(ticket) })
    return ticket
  }
  const candidates = () => sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent candidate]')).map(([, t]) => t)
  return { h, sent, openTicket, candidates }
}

describe('what a card is', () => {
  it('needs options and a recommendation among them', () => {
    expect(parseDecision({ options: ['甲', '乙'], recommended: '乙', level: 'P3' })).toEqual({ level: 'P3', options: ['甲', '乙'], recommended: '乙' })
    expect(parseDecision({ options: ['甲'], recommended: '甲' })).toContain('options')
    expect(parseDecision({ options: ['甲', '甲'], recommended: '甲' })).toContain('differ')
    expect(parseDecision({ options: ['甲', '乙'], recommended: '丙' })).toContain('recommended')
    expect(parseDecision({ options: ['甲', '乙'], recommended: '甲', level: 'P9' })).toContain('level')
  })
  it('counts as P1 with no level, and only P2 and P3 are one click', () => {
    expect(parseDecision({ options: ['甲', '乙'], recommended: '甲' })).toMatchObject({ level: 'P1' })
    expect((['P0', 'P1', 'P2', 'P3'] as const).map(oneClick)).toEqual([false, false, true, true])
  })
})

describe('a card the router or an observer raises', () => {
  it('waits for the owner, and once decided reaches the router as the owner\'s request', async () => {
    const m = await team()
    const raised = m.h.proposeDecision('router', 'session-r', '要不要升级依赖？', spec(), '有安全修复') as { id: string }
    expect(m.h.decisionCards()).toEqual([expect.objectContaining({ id: raised.id, source: 'router', reason: '有安全修复', recommended: '甲' })])
    expect(m.h.decide(raised.id, 'approve')).toMatchObject({ ok: true, trigger_id: expect.any(String) })
    expect(m.h.decisionCards()).toHaveLength(0)
    m.h.pass()
    await vi.waitFor(() => { expect(m.candidates().some(t => t.includes('[决策卡] 要不要升级依赖？') && t.includes('决定：甲') && t.includes('strength explicit'))).toBe(true) })
    await m.h.stop()
  })
  it('cannot be decided twice', async () => {
    const m = await team()
    const { id } = m.h.proposeDecision('observer', 'session-m', '问', spec()) as { id: string }
    expect(m.h.decide(id, 'approve')).toMatchObject({ ok: true })
    expect(m.h.decide(id, 'approve')).toMatchObject({ ok: false, code: 'stale' })
    await m.h.stop()
  })
  it('P0 and P1 refuse one click; an option chosen goes through', async () => {
    const m = await team()
    for (const level of ['P0', 'P1'] as const) {
      const { id } = m.h.proposeDecision('router', 'session-r', `问 ${level}`, spec(level)) as { id: string }
      expect(m.h.decide(id, 'approve')).toMatchObject({ ok: false, code: 'needs-choice' })
      expect(m.h.decide(id, 'choose', '乙', '想清楚了')).toMatchObject({ ok: true })
    }
    await m.h.stop()
  })
  it('refuses an option that is not on the card, and needs a choice or words', async () => {
    const m = await team()
    const { id } = m.h.proposeDecision('router', 'session-r', '问', spec()) as { id: string }
    expect(m.h.decide(id, 'choose', '丙')).toMatchObject({ ok: false, code: 'choice' })
    expect(m.h.decide(id, 'choose')).toMatchObject({ ok: false, code: 'choice' })
    expect(m.h.decide(id, 'choose', undefined, '都不要，改成丁')).toMatchObject({ ok: true })
    await m.h.stop()
  })
  it('returns the same card for a repeat, and holds at the cap', async () => {
    const m = await team()
    const first = m.h.proposeDecision('router', 'session-r', '问 0', spec()) as { id: string }
    expect(m.h.proposeDecision('router', 'session-r', '问 0', spec())).toMatchObject({ ok: true, reused: true, id: first.id })
    for (let i = 1; i < OPEN_CARDS_MAX; i++) m.h.proposeDecision('router', 'session-r', `问 ${String(i)}`, spec())
    expect(m.h.proposeDecision('router', 'session-r', '再来', spec())).toMatchObject({ ok: false, code: 'too-many-open' })
    await m.h.stop()
  })
})

describe('a member\'s question', () => {
  it('is a card on its ticket, and the decision goes back to that ticket, with no second ticket', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    m.h.report('session-m', { state: 'waiting', summary: '要定', question: '用哪个？', decision: spec('P3') }, ticket)
    const [card] = m.h.decisionCards()
    expect(card).toMatchObject({ source: 'ticket', ticketId: ticket, level: 'P3', title: '做事' })
    const before = m.h.store.tickets.list().length
    expect(m.h.decide(card!.id, 'approve')).toMatchObject({ ok: true, ticket_id: ticket })
    expect(m.h.store.tickets.list()).toHaveLength(before)
    expect(m.h.store.tickets.get(ticket)!.inputs.some(i => i.kind === 'trigger')).toBe(true)
    expect(m.h.decisionCards()).toHaveLength(0)
    await m.h.stop()
  })
  it('without a card still shows, as P1 with nothing to approve', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    m.h.report('session-m', { state: 'waiting', summary: '要定', question: '老问题？' }, ticket)
    const [card] = m.h.decisionCards()
    expect(card).toMatchObject({ level: 'P1', options: [] })
    expect(m.h.decide(card!.id, 'approve')).toMatchObject({ ok: false, code: 'needs-choice' })
    expect(m.h.decide(card!.id, 'choose', undefined, '用甲')).toMatchObject({ ok: true })
    await m.h.stop()
  })
})

describe('who may decide', () => {
  const statuses = (none: number, withCookie: number) => async (_url: string, init: RequestInit) => ({ status: (init.headers as Record<string, string>).cookie !== undefined ? withCookie : none })
  it('a login when the host has one', async () => {
    expect(await ownerOrNoLogin('http://h', undefined, statuses(401, 200))).toBe(false)
    expect(await ownerOrNoLogin('http://h', 'dsh-auth=bad', statuses(401, 401))).toBe(false)
    expect(await ownerOrNoLogin('http://h', 'dsh-auth=ok', statuses(401, 200))).toBe(true)
  })
  it('the control route on a host with no login', async () => {
    expect(await ownerOrNoLogin('http://h', undefined, statuses(404, 404))).toBe(true)
  })
  it('nobody before the host knows its own address', async () => {
    expect(await ownerOrNoLogin(undefined, 'x', statuses(401, 200))).toBe(false)
  })
})
