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
async function team(cap = 1, members: readonly string[] = ['session-a', 'session-b']) {
  const { SuperagentHost, CREDENTIAL_STOP, CREDENTIAL_BLOCK } = await import('../../src/superagent/host/index.ts')
  const { routeItem, registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const clock = { now: Date.parse('2026-11-23T01:00:00.000Z') }
  const home = mkdtempSync(join(tmpdir(), 'sa-credact-'))
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', ...members], remote: [] } : undefined, home, logger: { info: () => {}, warn: () => {} },
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
  return { h, home, clock, ticket, holder, card, registered, accept, CREDENTIAL_STOP, CREDENTIAL_BLOCK }
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
    // Ticket 877ca64f: naming the excluded session is refused instead of answering ok:true.
    expect(m.h.assignTicket(again, m.holder)).toMatchObject({ ok: false, code: 'excluded' })
    await vi.waitFor(() => { expect(m.h.executor.list().some(b => b.ticketId === again)).toBe(true) })
    const ran = m.h.executor.list().find(b => b.ticketId === again)!
    expect(ran.member).not.toBe(m.holder)
    await m.h.stop()
  })

  it('ticket 269f287e: a second stop card does not stop work the refiled ticket already runs on another member, even when the router named the excluded session', async () => {
    const m = await team()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const first = m.card()!.id
    const out = m.h.decide(first, 'choose', m.CREDENTIAL_STOP) as { refiled: string[] }
    m.h.pass()
    // The router names the excluded session on accept: the named record keeps it, the work is bound to the other member.
    const accepted = routeItem(m.h, { trigger_id: out.refiled[0]!, kind: 'accept', title: '写文档（重派）', scope: 's', reason: 'r', member: m.holder } as never) as { ok: boolean; ticket_id: string; member_refused?: { code: string } }
    expect(accepted).toMatchObject({ ok: true, member_refused: { code: 'excluded' } })
    const again = accepted.ticket_id
    expect(m.h.executor.memberOfTicket(again)?.member).not.toBe(m.holder)
    await vi.waitFor(() => { expect(m.h.executor.list().some(b => b.ticketId === again)).toBe(true) })
    const ran = m.h.executor.list().find(b => b.ticketId === again)!
    expect(ran.member).not.toBe(m.holder)
    // The same session is audited again (after the card gap) and the owner stops its tickets: the one running on the other member stays.
    m.clock.now += 24 * 60 * 60 * 1000
    m.h.auditCall(m.holder, 'member', 'bash', CALL)
    const second = m.h.decisionCards().find(c => c.by === 'credential:' + m.holder && c.id !== first)!
    expect(second).toBeDefined()
    const stop = m.h.decide(second.id, 'choose', m.CREDENTIAL_STOP) as { stopped: string[] }
    expect(stop.stopped).not.toContain(again)
    expect(m.h.store.tickets.get(again)!.ended).toBeUndefined()
    expect(m.h.executor.list().find(b => b.ticketId === again)?.member).toBe(ran.member)
    await m.h.stop()
  })

  it('ticket 269f287e: the stop decides by the binding, even when the named record still names the excluded session', async () => {
    const m = await team()
    const first = m.card()!.id
    const out = m.h.decide(first, 'choose', m.CREDENTIAL_STOP) as { refiled: string[] }
    m.h.pass()
    const again = m.accept(out.refiled[0]!, '写文档（重派）')
    await vi.waitFor(() => { expect(m.h.executor.list().some(b => b.ticketId === again)).toBe(true) })
    const ran = m.h.executor.list().find(b => b.ticketId === again)!
    expect(ran.member).not.toBe(m.holder)
    // Any path that leaves the record on the excluded session (a split part, a named seat): the work is still the other member's.
    m.h.executor.setMember(again, m.holder)
    m.clock.now += 24 * 60 * 60 * 1000
    m.h.auditCall(m.holder, 'member', 'bash', CALL)
    const second = m.h.decisionCards().find(c => c.by === 'credential:' + m.holder && c.id !== first)!
    expect((m.h.decide(second.id, 'choose', m.CREDENTIAL_STOP) as { stopped: string[] }).stopped).not.toContain(again)
    expect(m.h.store.tickets.get(again)!.ended).toBeUndefined()
    await m.h.stop()
  })

  it('ticket 269f287e: a ticket named to the session and not bound yet is still stopped', async () => {
    const m = await team()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const asked = m.h.request('另一件事') as { triggerId: string }
    m.h.pass()
    // The holder is busy (cap 1), so this one waits, named to it, with no binding.
    const queued = (routeItem(m.h, { trigger_id: asked.triggerId, kind: 'accept', title: '另一件事', scope: 's', reason: 'r', member: m.holder } as never) as { ticket_id: string }).ticket_id
    expect(m.h.executor.memberOfTicket(queued)?.member).toBe(m.holder)
    expect(m.h.executor.list().some(b => b.ticketId === queued)).toBe(false)
    const stop = m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_STOP) as { stopped: string[] }
    expect(stop.stopped).toEqual(expect.arrayContaining([m.ticket, queued]))
    await m.h.stop()
  })

  it('ticket 269f287e: with no other member, the refiled ticket named to the excluded session waits instead of being dropped', async () => {
    const m = await team(1, ['session-a'])
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const out = m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_STOP) as { refiled: string[] }
    m.h.pass()
    const accepted = routeItem(m.h, { trigger_id: out.refiled[0]!, kind: 'accept', title: '写文档（重派）', scope: 's', reason: 'r', member: m.holder } as never) as { ok: boolean; ticket_id: string; member_refused?: { code: string } }
    expect(accepted).toMatchObject({ ok: true, member_refused: { code: 'excluded' } })
    m.h.pass()
    await vi.waitFor(() => { expect(m.h.queueOf(accepted.ticket_id)?.reason).toBe('all-excluded') })
    expect(m.h.store.tickets.get(accepted.ticket_id)!.ended).toBeUndefined()
    expect(m.h.executor.list().some(b => b.ticketId === accepted.ticket_id)).toBe(false)
    await m.h.stop()
  })

  it('ticket eabe1586: a split part named to the excluded session records no member and is reported, like accept', async () => {
    const m = await team()
    const { splitRequest } = await import('../../src/superagent/host/tools.ts')
    const out = m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_STOP) as { refiled: string[] }
    m.h.pass()
    const other = ['session-a', 'session-b'].find(s => s !== m.holder)!
    const split = splitRequest(m.h, { trigger_id: out.refiled[0]!, title: '写文档（两项）', scope: 's', reason: 'r', asked: '请交给别的成员重做',
      parts: [{ title: '一', scope: 's1', member: m.holder }, { title: '二', scope: 's2', member: other }] }) as { ok: boolean; parts: string[]; member_refused?: Array<{ part: number; code: string }> }
    expect(split).toMatchObject({ ok: true, member_refused: [{ part: 1, code: 'excluded' }] })
    expect(split.member_refused).toHaveLength(1)
    expect(m.h.executor.memberOfTicket(split.parts[0]!)?.member).not.toBe(m.holder)
    expect(m.h.executor.memberOfTicket(split.parts[1]!)?.member).toBe(other)
    await m.h.stop()
  })

  it.each([
    ['short id', (s: string) => s.replace(/^session-/, '')],
    ['upper case', (s: string) => s.toUpperCase()],
    ['padded name', (s: string) => `  ${s}  `],
  ] as const)('ticket eabe1586 (#865 review B2): accept naming the excluded session by its %s is refused the same way', async (_how, spell) => {
    const m = await team()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const out = m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_STOP) as { refiled: string[] }
    m.h.pass()
    const accepted = routeItem(m.h, { trigger_id: out.refiled[0]!, kind: 'accept', title: '写文档（重派）', scope: 's', reason: 'r', member: spell(m.holder) } as never) as { ok: boolean; ticket_id: string }
    expect(accepted).toMatchObject({ ok: true, member_refused: { code: 'excluded' } })
    expect(m.h.executor.memberOfTicket(accepted.ticket_id)?.member).not.toBe(m.holder)
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

  it('#825 re-review: split children of the refiled ticket never go to that session either, even when a part names it', async () => {
    const m = await team(4, ['session-a', 'session-b', 'session-c', 'session-d'])
    const out = m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_STOP) as { refiled: string[] }
    m.h.pass()
    const again = m.accept(out.refiled[0]!, '写文档（重派）')
    const split = m.h.splitParent(again, 'session-r', [{ title: '前半', scope: 'a' }, { title: '后半', scope: 'b', member: m.holder }], 'two parts') as { ok: boolean; children: string[] }
    expect(split).toMatchObject({ ok: true })
    await vi.waitFor(() => { for (const child of split.children) expect(m.h.executor.list().some(b => b.ticketId === child)).toBe(true) })
    for (const child of split.children) expect(m.h.executor.list().find(b => b.ticketId === child)!.member).not.toBe(m.holder)
    await m.h.stop()
  })

  it('#825 re-review: the exclusion is written privately and read back after a restart', async () => {
    const { statSync, readFileSync } = await import('node:fs')
    const m = await team()
    const out = m.h.decide(m.card()!.id, 'choose', m.CREDENTIAL_STOP) as { refiled: string[] }
    const { globSync } = await import('node:fs')
    const found = (globSync as unknown as (p: string, o: { cwd: string }) => string[])('**/credential-exclusions.json', { cwd: m.home })
    expect(found).toHaveLength(1)
    const path = join(m.home, found[0]!)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [out.refiled[0]!]: m.holder })
    // Windows cannot carry POSIX permission bits (tests/gates/submission-export-mode.mjs: 'Windows mode preservation is not verifiable'); the private-write check is the content and restart read-back below everywhere, the 0o600 bit only where it can hold.
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    await m.h.stop()
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const again = new SuperagentHost({ canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a', 'session-b'], remote: [] } : undefined, home: m.home, logger: { info: () => {}, warn: () => {} },
      deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: () => undefined } as never)
    expect((again as unknown as { credentialExclusions: Map<string, string> }).credentialExclusions.get(out.refiled[0]!)).toBe(m.holder)
    await again.stop()
  })
})
