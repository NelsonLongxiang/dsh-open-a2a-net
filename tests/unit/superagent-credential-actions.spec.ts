// @vitest-environment node
/**
 * Ticket 4351d67f (owner ruling 2026-11-23): on a credential-access audit card, the owner's own choice acts.
 * 「停掉这个会话的工单」 stops the session's open tickets and files them back to the router; 「在团队设置里禁用这个工具」
 * blocks the tool for the team. The timeout only writes 「知道了」, and no agent can decide these cards.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CALL = { command: 'cat ~/.dsh/a2a/cli.json' }
async function team(cap = 1) {
  const { SuperagentHost, CREDENTIAL_STOP, CREDENTIAL_BLOCK } = await import('../../src/superagent/host/index.ts')
  const { routeItem, registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const clock = { now: Date.parse('2026-11-23T01:00:00.000Z') }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a', 'session-b'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-credact-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: () => undefined,
    now: () => new Date(clock.now).toISOString(),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', maxConcurrent: cap, approvers: ['session-a', 'session-b'] }, () => true)).toMatchObject({ ok: true })
  h.start()
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const asked = h.request('写文档') as { triggerId: string }
  h.pass()
  const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '写文档', scope: '只写文档', reason: 'r' } as never) as { ticket_id: string }).ticket_id
  await vi.waitFor(() => { expect(h.executor.memberOfTicket(ticket)).toBeDefined() })
  const holder = h.executor.memberOfTicket(ticket)!.member
  h.auditCall(holder, 'member', 'bash', CALL)
  const card = () => h.decisionCards().find(c => c.by === 'credential:' + holder)
  const accept = (triggerId: string, title: string) => (routeItem(h, { trigger_id: triggerId, kind: 'accept', title, scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
  return { h, clock, ticket, holder, card, registered, accept, CREDENTIAL_STOP, CREDENTIAL_BLOCK }
}

describe('credential-access card: the owner\'s own choice acts (4351d67f)', () => {
  it('「停掉这个会话的工单」 stops the session\'s open ticket and files it back to the router', async () => {
    const m = await team()
    const out = m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_STOP)
    expect(out).toMatchObject({ ok: true, action: 'stop-tickets', session: m.holder, stopped: [m.ticket] })
    expect((out as { refiled: string[] }).refiled).toHaveLength(1)
    expect(m.h.store.tickets.get(m.ticket)!.ended).toMatchObject({ outcome: 'stopped' })
    const refiled = m.h.store.triggers.get((out as { refiled: string[] }).refiled[0]!)
    expect(JSON.stringify(refiled)).toContain('写文档')
    expect(JSON.stringify(refiled)).toContain('> 只写文档')
    expect(JSON.stringify(refiled)).toContain('不是属主的新指示')
    await m.h.stop()
  })

  it('「在团队设置里禁用这个工具」 adds the tool to blockedTools, once', async () => {
    const m = await team()
    expect(m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_BLOCK)).toMatchObject({ ok: true, action: 'block-tool', tool: 'bash', blocked: true })
    expect(m.h.settings.blockedTools).toEqual(['bash'])
    expect(m.h.store.tickets.get(m.ticket)!.ended).toBeUndefined()
    m.clock.now += 10 * 60_000
    m.h.auditCall(m.holder, 'member', 'bash', CALL)
    const second = m.h.decisionCards().filter(c => c.by === 'credential:' + m.holder && c.decided === undefined).at(-1)!
    expect(m.h.decide(second.id, 'choose', m.CREDENTIAL_BLOCK)).toMatchObject({ blocked: true, already: true })
    expect(m.h.settings.blockedTools).toEqual(['bash'])
    await m.h.stop()
  })

  it('「知道了」 and the timeout do nothing; the owner\'s later choice on the auto-closed card still acts', async () => {
    const m = await team()
    const id = m.card()!.id
    m.clock.now += 15 * 60_000
    expect(m.h.ackCredentialCards()).toBe(1)
    expect(m.h.store.tickets.get(m.ticket)!.ended).toBeUndefined()
    expect(m.h.settings.blockedTools).toBeUndefined()
    expect(m.h.decide(id, 'choose', m.CREDENTIAL_STOP)).toMatchObject({ ok: true, stopped: [m.ticket] })
    expect(m.h.store.tickets.get(m.ticket)!.ended).toBeDefined()
    await m.h.stop()
  })

  it('an agent cannot decide the card, even an approver; nothing changes', async () => {
    const m = await team()
    const other = ['session-a', 'session-b'].find(s => s !== m.holder)!
    const out = await m.registered.get('a2a_decision_decide')!.execute({ card_id: m.card()!.id, option: m.CREDENTIAL_STOP, reason: 'stop it' }, { agent: { id: other }, signal: new AbortController().signal })
    expect(out).toMatchObject({ ok: false })
    expect(m.h.store.tickets.get(m.ticket)!.ended).toBeUndefined()
    expect(m.card()!.decided).toBeUndefined()
    const knew = m.h.decide(m.card()!.id, 'choose', '知道了')
    expect(knew).toEqual({ ok: true })
    expect(m.h.store.tickets.get(m.ticket)!.ended).toBeUndefined()
    await m.h.stop()
  })

  it('#825 review: the refiled ticket never goes back to that session, even when it is named', async () => {
    const m = await team()
    const out = m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_STOP) as { refiled: string[] }
    m.h.pass()
    const again = m.accept(out.refiled[0]!, '写文档（重派）')
    expect(m.h.assignTicket(again, m.holder)).toMatchObject({ ok: true })
    await vi.waitFor(() => { expect(m.h.executor.list().some(b => b.ticketId === again)).toBe(true) })
    const ran = m.h.executor.list().find(b => b.ticketId === again)!
    expect(ran.member).not.toBe(m.holder)
    await m.h.stop()
  })

  it('#825 review W6: only the session on the card loses its tickets', async () => {
    const m = await team(2)
    const asked = m.h.request('另一件事') as { triggerId: string }
    m.h.pass()
    const other = m.accept(asked.triggerId, '另一件事')
    await vi.waitFor(() => { expect(m.h.executor.memberOfTicket(other)).toBeDefined() })
    expect(m.h.executor.memberOfTicket(other)!.member).not.toBe(m.holder)
    expect(m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_STOP)).toMatchObject({ stopped: [m.ticket] })
    expect(m.h.store.tickets.get(other)!.ended).toBeUndefined()
    await m.h.stop()
  })

  it('#825 review: a blocked work tool is really refused to members; team tools and the router are untouched', async () => {
    const { roleToolRefusal, blockableTool } = await import('../../src/superagent/host/role-tools.ts')
    expect(roleToolRefusal('member', 'bash', undefined, [], ['bash'])).toContain('blocked')
    expect(roleToolRefusal('observer', 'bash', undefined, [], ['bash'])).toContain('blocked')
    expect(roleToolRefusal('member', 'a2a_ticket_report', undefined, [], ['a2a_ticket_report'])).toBeUndefined()
    expect(roleToolRefusal('member', 'bash', undefined, [], [])).toBeUndefined()
    expect(blockableTool('member', 'run_code')).toBe(false)
    const m = await team()
    m.clock.now += 10 * 60_000
    m.h.auditCall(m.holder, 'member', 'a2a_ticket_report', CALL)
    const teamToolCard = m.h.decisionCards().filter(c => c.by === 'credential:' + m.holder && c.decided === undefined).at(-1)!
    expect(m.h.decide(teamToolCard.id, 'choose', m.CREDENTIAL_BLOCK)).toMatchObject({ action: 'block-tool', tool: 'a2a_ticket_report', blocked: false })
    expect(m.h.settings.blockedTools).toBeUndefined()
    await m.h.stop()
  })
})
