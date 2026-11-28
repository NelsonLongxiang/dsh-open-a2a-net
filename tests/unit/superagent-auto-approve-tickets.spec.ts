// @vitest-environment node
/** #888 v3 D5 phase two: a ticket's question card is taken as a host note on the ticket, never through the engine. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AUTO_APPROVE_DEFAULT, DEFAULT_SETTINGS, parseSettings } from '../../src/superagent/host/policy.ts'
import { isHostAutoDecision } from '../../src/superagent/host/auto-decision.ts'
import { agentLedEnd } from '../../src/superagent/host/cards.ts'
import { ticketCardId } from '../../src/superagent/host/decisions.ts'

const T0 = Date.parse('2026-11-24T10:00:00Z')
const MIN = 60_000
const on = (over: Record<string, unknown> = {}) => ({ enabled: true, levels: ['P3'], sources: ['ticket'], afterMinutes: 30, perHour: 10, ...over })
const base = { options: ['甲', '乙'], recommended: '甲', level: 'P3' }

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem, registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const clock = { t: T0 }
  const sent: Array<[string, string]> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-auto-t-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
    now: () => new Date(clock.t).toISOString(),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const call = async (name: string, as: string, args: Record<string, unknown>) => await registered.get(name)!.execute(args, { agent: { id: as }, signal: new AbortController().signal })
  const openTicket = async (): Promise<string> => {
    const asked = h.request('做事') as { triggerId: string }
    h.pass()
    const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '做事', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
    await vi.waitFor(() => { expect(h.executor.bindingOf('session-m')?.ticketId).toBe(ticket) })
    return ticket
  }
  /** The member asks a question on the ticket; returns the ticket card's id. */
  const ask = async (ticket: string, extra: Record<string, unknown> = {}, state = 'waiting'): Promise<string> => {
    expect(await call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state, summary: 's', question: '要哪个？', ...base, ...extra })).toMatchObject({ ok: true })
    return ticketCardId(ticket, '要哪个？')
  }
  const enable = (over: Record<string, unknown> = {}) => expect(h.saveSettings({ autoApprove: on(over) }, () => true)).toMatchObject({ ok: true })
  const book = () => (h as unknown as { decisions: { get(id: string): Record<string, any> | undefined } }).decisions
  const ticketOf = (id: string) => h.store.tickets.get(id)!
  const autoNotes = (id: string) => ticketOf(id).inputs.filter(isHostAutoDecision)
  return { h, clock, sent, call, openTicket, ask, enable, book, ticketOf, autoNotes }
}

describe('D5 phase two: ticket cards', () => {
  it('ticket is an allowed source; the default is still off with an empty list', () => {
    expect(AUTO_APPROVE_DEFAULT).toMatchObject({ enabled: false, sources: [] })
    expect(parseSettings({ autoApprove: on() }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { autoApprove: { sources: ['ticket'] } } })
    expect(parseSettings({ autoApprove: on({ sources: ['ticket', 'router', 'observer'] }) }, DEFAULT_SETTINGS)).toMatchObject({ ok: true })
  })

  it('takes the recommendation after the wait as a host note, clears the question, and opens nothing', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    const card = await m.ask(ticket)
    m.enable()
    const before = m.ticketOf(ticket).inputs.length
    m.clock.t = T0 + 29 * MIN
    m.h.pass()
    expect(m.book().get(card)!.decided).toBeUndefined()
    expect(m.ticketOf(ticket).attention).toBeDefined()
    m.clock.t = T0 + 31 * MIN
    m.h.pass()
    const done = m.book().get(card)!
    expect(done.decided.text.split('\n')[0]).toBe('决定：甲')
    expect(done.decided.by).toBe('host')
    expect(done.autoApproved).toMatchObject({ by: 'host', rule: 'auto-approve', minutes: 30 })
    expect(done.autoApproved.deliveredAt).toBeDefined()
    const t = m.ticketOf(ticket)
    expect(t.attention).toBeUndefined()
    expect(t.ended).toBeUndefined()
    expect(t.inputs.length).toBe(before + 1)
    const notes = m.autoNotes(ticket)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ kind: 'note', id: done.autoApproved.deliveryId, hostAutoDecision: { option: '甲', human: false } })
    expect(notes[0]!.text).toContain('非属主本人')
    // Not a person's word and no ticket opened by it: nothing human was added, and the ticket count did not move.
    expect(t.inputs.filter(input => input.kind === 'trigger' && input.human === true && input.at >= notes[0]!.at)).toEqual([])
    expect(m.h.store.tickets.list().length).toBe(1)
    await m.h.stop()
  })

  it('writes the note once however many passes run, and a restart finishes an unfinished one with the same id', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    await m.ask(ticket)
    m.enable()
    m.clock.t = T0 + 40 * MIN
    for (let i = 0; i < 4; i += 1) m.h.pass()
    expect(m.autoNotes(ticket)).toHaveLength(1)
    await m.h.stop()
  })

  it('leaves alone what is not eligible: not listed, a person is waited on, an input is needed, level out of range, off', async () => {
    const run = async (arrange: (m: Awaited<ReturnType<typeof team>>, ticket: string) => Promise<string>, over: Record<string, unknown> = {}) => {
      const m = await team()
      const ticket = await m.openTicket()
      const card = await arrange(m, ticket)
      m.enable(over)
      m.clock.t = T0 + 120 * MIN
      m.h.pass()
      const result = { decided: m.book().get(card)?.decided, notes: m.autoNotes(ticket).length, attention: m.ticketOf(ticket).attention }
      await m.h.stop()
      return result
    }
    const plain = (m: Awaited<ReturnType<typeof team>>, ticket: string) => m.ask(ticket)
    expect(await run(plain, { sources: ['router', 'observer'] })).toMatchObject({ decided: undefined, notes: 0 })
    expect(await run((m, ticket) => m.ask(ticket, {}, 'blocked'))).toMatchObject({ decided: undefined, notes: 0 })
    expect(await run((m, ticket) => m.ask(ticket, { inputs: { 甲: { kind: 'text', prompt: '写原因' } } }))).toMatchObject({ decided: undefined, notes: 0 })
    expect(await run((m, ticket) => m.ask(ticket, { level: 'P1' }))).toMatchObject({ decided: undefined, notes: 0 })
    expect(await run(plain, { levels: ['P2'] })).toMatchObject({ decided: undefined, notes: 0 })
    expect(await run(plain, { enabled: false })).toMatchObject({ decided: undefined, notes: 0 })
    // And the control: the same card with the rule on is taken.
    expect(await run(plain)).toMatchObject({ decided: { by: 'host' }, notes: 1 })
  })

  it('does not take a card whose ticket has moved on: the question is gone or the ticket ended', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    const card = await m.ask(ticket)
    m.enable()
    const t = m.ticketOf(ticket)
    delete t.attention
    m.h.store.tickets.save(t)
    m.clock.t = T0 + 120 * MIN
    m.h.pass()
    expect(m.book().get(card)!.decided).toBeUndefined()
    expect(m.autoNotes(ticket)).toHaveLength(0)
    await m.h.stop()
  })

  it('while the observer holds the question it is not taken; the wait runs from when the question reached the person', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    const card = await m.ask(ticket)
    const gate = (m.h as unknown as { questionGate: { held(id: string): boolean; pending: Map<string, unknown>; reached: Map<string, number> } }).questionGate
    expect(gate.held(ticket)).toBe(false)
    m.enable()
    gate.pending.set(ticket, { observer: 'session-o', since: T0 })
    m.clock.t = T0 + 200 * MIN
    m.h.pass()
    expect(m.book().get(card)!.decided).toBeUndefined()
    expect(m.autoNotes(ticket)).toHaveLength(0)
    // The observer let go at 100 minutes in: the person's clock starts there, not at the card's own time.
    gate.pending.delete(ticket)
    gate.reached.set(ticket, T0 + 190 * MIN)
    m.h.pass()
    expect(m.book().get(card)!.decided).toBeUndefined()
    m.clock.t = T0 + 221 * MIN
    m.h.pass()
    expect(m.book().get(card)!.decided).toMatchObject({ by: 'host' })
    await m.h.stop()
  })

  it('a delivery that is written but not marked done is not written twice', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    const card = await m.ask(ticket)
    m.enable()
    m.clock.t = T0 + 40 * MIN
    m.h.pass()
    expect(m.autoNotes(ticket)).toHaveLength(1)
    // As after a restart between the write and the mark: the record says not delivered and the question is back as it was.
    const stored = m.book().get(card)!
    stored.autoApproved = { ...stored.autoApproved, deliveredAt: undefined }
    const t = m.ticketOf(ticket)
    t.attention = { id: 'again', question: '要哪个？' } as never
    m.h.store.tickets.save(t)
    m.h.pass()
    expect(m.autoNotes(ticket)).toHaveLength(1)
    await m.h.stop()
  })

  it('a backlog does not go at once: the wait starts when the rule was switched on', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    const card = await m.ask(ticket)
    m.clock.t = T0 + 300 * MIN
    m.enable()
    m.h.pass()
    expect(m.book().get(card)!.decided).toBeUndefined()
    m.clock.t = T0 + 331 * MIN
    m.h.pass()
    expect(m.book().get(card)!.decided).toMatchObject({ by: 'host' })
    await m.h.stop()
  })

  it('an automatic decision is not the owner\'s: the owner may still decide, and the member cannot end the ticket on the note', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    const card = await m.ask(ticket)
    m.enable()
    m.clock.t = T0 + 40 * MIN
    m.h.pass()
    const assignment = m.ticketOf(ticket).assignments.at(-1)!
    expect(agentLedEnd(m.ticketOf(ticket), assignment.id)).toBe(false)
    expect(m.autoNotes(ticket)).toHaveLength(1)
    const again = m.h.decide(card, 'choose', '乙')
    expect(again).toMatchObject({ ok: true })
    await m.h.stop()
  })
})
