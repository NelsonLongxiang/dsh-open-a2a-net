// @vitest-environment node
/** #934: a card that is no longer waiting leaves the list, and deciding it says where it went. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AUTO_ACK_TEXT, ticketCardId, type DecisionSpec } from '../../src/superagent/host/decisions.ts'

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

describe('#934 a card no longer waiting', () => {
  it('leaves the list when its question is replaced, and deciding it names the ticket', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    m.h.report('session-m', { state: 'waiting', summary: '要定', question: '用哪个？', decision: spec('P3') }, ticket)
    const [card] = m.h.decisionCards()
    expect(card).toMatchObject({ source: 'ticket', ticketId: ticket })
    // A plain progress report keeps an open question open (it waits for its answer)…
    m.h.report('session-m', { state: 'progress', summary: '还在等' }, ticket)
    expect(m.h.decisionCards().map(c => c.id)).toContain(card!.id)
    // …a new question replaces it: the old card leaves the list in the same step.
    m.h.report('session-m', { state: 'waiting', summary: '改问', question: '换个问法？', decision: spec('P3') }, ticket)
    expect(m.h.decisionCards().map(c => c.id)).not.toContain(card!.id)
    expect(m.h.decisionCards().some(c => c.question === '换个问法？')).toBe(true)
    const out = m.h.decide(card!.id, 'choose', '甲')
    expect(out).toMatchObject({ ok: false, code: 'stale', now: { ticket: { id: ticket } } })
    // The ticket is still running: its live stage is reported, never 'ended'.
    const stage = (out.now as { ticket: { stage: unknown } }).ticket.stage
    expect(stage).not.toBe('ended')
    expect(stage).toEqual(m.h.ticket(ticket)!.stage)
    expect(String(out.error)).toContain(ticket)
    await m.h.stop()
  })
  it('a card already decided says when, by whom and what', async () => {
    const m = await team()
    const { id } = m.h.proposeDecision('router', 'session-r', '问', spec()) as { id: string }
    expect(m.h.decide(id, 'approve')).toMatchObject({ ok: true })
    const out = m.h.decide(id, 'choose', '乙')
    expect(out).toMatchObject({ ok: false, code: 'stale', now: { decided: { by: 'owner', at: m.h.decisions.get(id)!.decided!.at, text: '决定：甲' } } })
    expect(String(out.error)).toContain('决定：甲')
    await m.h.stop()
  })
  it('an id this host never held says so, with no made-up whereabouts', async () => {
    const m = await team()
    const out = m.h.decide('d-nowhere', 'approve')
    expect(out).toMatchObject({ ok: false, code: 'stale', error: expect.stringContaining('no record') })
    expect(out).not.toHaveProperty('now')
    await m.h.stop()
  })
  it('#938 review B1: a card the host closed on its timeout says the host decided it, not the owner', async () => {
    const m = await team()
    const { id } = m.h.proposeDecision('router', 'session-r', '凭据访问', spec()) as { id: string }
    // Closed by the host two days ago: past the day such cards stay listed.
    const at = new Date(Date.now() - 48 * 3_600_000).toISOString()
    expect(m.h.decisions.autoAcknowledge(id, at, 15)).toBe(true)
    const out = m.h.decide(id, 'approve')
    expect(out).toMatchObject({ ok: false, code: 'stale', now: { decided: { by: 'host', at, text: AUTO_ACK_TEXT } } })
    expect(String(out.error)).toContain('by the host')
    await m.h.stop()
  })
  it('#938 review B1 boundary: the owner deciding an auto-acked card again, in the same millisecond, stays the owner', async () => {
    const m = await team()
    const { id } = m.h.proposeDecision('router', 'session-r', '凭据访问', spec()) as { id: string }
    const at = new Date(Date.now() - 48 * 3_600_000).toISOString()
    expect(m.h.decisions.autoAcknowledge(id, at, 15)).toBe(true)
    // The owner's own decision replaces the host's, at the very same time; the autoAck audit record stays.
    m.h.decisions.decide(id, { at, text: '决定：乙\n说明：我看过了' })
    expect(m.h.decisions.get(id)!.autoAck).toBeDefined()
    const out = m.h.decide(id, 'approve')
    expect(out).toMatchObject({ ok: false, code: 'stale', now: { decided: { by: 'owner', at, text: '决定：乙' } } })
    expect(String(out.error)).not.toContain('by the host')
    await m.h.stop()
  })
  it('a ticket question whose ticket ended reports ended with its outcome', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    m.h.report('session-m', { state: 'waiting', summary: '要定', question: '用哪个？', decision: spec('P3') }, ticket)
    const [card] = m.h.decisionCards()
    const real = m.h.store.tickets.get(ticket)!
    m.h.report('session-m', { state: 'waiting', summary: '改问', question: '换个问法？', decision: spec('P3') }, ticket)
    const spy = vi.spyOn(m.h.store.tickets, 'get').mockImplementation(((id: string) => id === ticket ? { ...real, ended: { outcome: 'dropped' } } : undefined) as never)
    try {
      const out = m.h.decide(card!.id, 'choose', '甲')
      expect(out).toMatchObject({ ok: false, code: 'stale', now: { ticket: { id: ticket, stage: 'ended', outcome: 'dropped' } } })
      expect(String(out.error)).toContain('ended (dropped)')
    } finally { spy.mockRestore() }
    await m.h.stop()
  })
  it('a ticket question whose ticket is no longer on the host reports gone', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    m.h.report('session-m', { state: 'waiting', summary: '要定', question: '还要吗？', decision: spec('P3') }, ticket)
    const id = ticketCardId(ticket, '还要吗？')
    m.h.report('session-m', { state: 'waiting', summary: '改问', question: '换个问法？', decision: spec('P3') }, ticket)
    const spy = vi.spyOn(m.h.store.tickets, 'get').mockImplementation((() => undefined) as never)
    try {
      const out = m.h.decide(id, 'approve')
      expect(out).toMatchObject({ ok: false, code: 'stale', now: { ticket: { id: ticket, stage: 'gone' } } })
      expect(String(out.error)).toContain('no longer on this host')
    } finally { spy.mockRestore() }
    await m.h.stop()
  })
})
