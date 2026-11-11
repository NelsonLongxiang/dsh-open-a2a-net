// @vitest-environment node
/**
 * docs/design/superagent-named-dispatch.md: a dispatch that names a seat goes to that seat (the router only judges accept);
 * a seat that cannot take it holds the ticket and asks the requester 「等」 or 「换人」; rework the market returns is taken
 * in at once as a new ticket. Only from a signed caller whose card declares the capability.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDispatch } from '../../src/superagent/host/named-dispatch.ts'
import { key } from '../../src/superagent/source-types.ts'

const bot = 'market/0123456789abcdef'

async function team(options: { declares?: readonly string[]; profiled?: boolean } = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const declared = new Set(options.declares ?? ['directedSeats', 'reworkReturns'])
  const loaded = new Set(['session-r', 'session-a', 'session-b'])
  const members = ['session-r', 'session-a', 'session-b']
  const calls: string[][] = []
  const told: string[] = []
  const host = new SuperagentHost({ canvasTeam: (name: string) => name === 'team' ? { local: members, remote: [] } : undefined,
    home: mkdtempSync(join(tmpdir(), 'sa-named-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: (id: string, text: string) => { if (id === 'session-r') told.push(text); return true }, interval: () => () => {},
    homeUrl: () => 'http://127.0.0.1:1', sessionName: (id: string) => id, sessionLoaded: (id: string) => loaded.has(id),
    callerDeclares: (caller: string, capability: string) => caller === bot && declared.has(capability),
    runCli: async (args: string[]) => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' } } as never)
  expect(host.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Do what the market dispatches.' }],
    ...(options.profiled === true ? { profiles: { 'session-a': { role: '写作' }, 'session-b': { role: '审校' } } } : {}) }, () => true)).toMatchObject({ ok: true })
  const settle = async () => { for (let i = 0; i < 20; i++) { host.pass(); await new Promise(r => setTimeout(r, 5)) } }
  const receive = (task: string, text: string, opts: { context?: string; proof?: string } = {}) => {
    const context = opts.context ?? `ctx-${task}`
    const id = key('a2a', bot, task)
    host.engine.receive({ id, source: 'a2a', threads: [{ source: 'a2a', id: context }], actor: { source: 'a2a', id: bot }, human: false, addressed: 'direct', at: new Date().toISOString(), text,
      channel: { source: 'a2a', thread: `a2a:${context}`, address: { caller: bot, task, context } }, meta: { proof: opts.proof ?? 'origin-claim', admission: 'cli-deposit', taskId: task } } as never)
    host.pass()
    return id
  }
  const accept = (triggerId: string, member?: string) => routeItem(host, { trigger_id: triggerId, kind: 'accept', title: '问候语', scope: '写一句问候语', reason: '市场派工', rules: ['deps'], ...(member !== undefined ? { member } : {}) } as never)
  const holder = (ticketId: string) => host.executor.list().find(b => b.ticketId === ticketId)?.member
  return { host, calls, told, settle, receive, accept, holder, loaded, members }
}

const named = (seat: string, text = '写一句问候语。') => `[A2A dispatch] ${JSON.stringify({ for: seat })}\n${text}`

describe('the dispatch line', () => {
  it('is the first line, one JSON object with for and/or rework; anything else is plain text', () => {
    expect(parseDispatch('[A2A dispatch] {"for":"seat-1a2b3c4d"}\n写一句问候语。')).toEqual({ line: { for: 'seat-1a2b3c4d' }, body: '写一句问候语。' })
    expect(parseDispatch('[A2A dispatch] {"rework":{"of":"direct-000000000001"},"for":"dsh/aaaaaaaa"}\n改成蓝色')).toEqual({ line: { for: 'dsh/aaaaaaaa', rework: { of: 'direct-000000000001' } }, body: '改成蓝色' })
    expect(parseDispatch('写一句问候语。\n[A2A dispatch] {"for":"x"}')).toBeUndefined()
    expect(parseDispatch('[A2A dispatch] not json')).toBeUndefined()
    expect(parseDispatch('[A2A dispatch] {"for":""}')).toBeUndefined()
    expect(parseDispatch('[A2A dispatch] ["for"]')).toBeUndefined()
  })
})

describe('a dispatch that names a seat', () => {
  it('goes to the named seat whatever member the router names, and the router need not name one on a profiled team', async () => {
    const t = await team({ profiled: true })
    const id = t.receive('direct-000000000001', named('session-b'))
    const out = t.accept(id, 'session-a')
    expect(out).toMatchObject({ ok: true, decision: 'accept' })
    await t.settle()
    expect(t.holder(out.ticket_id as string)).toBe('session-b')
    const id2 = t.receive('direct-000000000002', named('session-a'))
    expect(t.accept(id2)).toMatchObject({ ok: true })
    await t.host.stop()
  })

  it('the router still judges: a named request can be ignored', async () => {
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const t = await team()
    const id = t.receive('direct-000000000003', named('session-b'))
    expect(routeItem(t.host, { trigger_id: id, kind: 'ignore', reason: '不是本团队的事' } as never)).toMatchObject({ ok: true, decision: 'ignore' })
    expect(t.host.store.tickets.list()).toHaveLength(0)
    await t.host.stop()
  })

  it('waits for a busy named seat instead of going to a free member (ruling b)', async () => {
    const t = await team()
    const first = t.accept(t.receive('direct-000000000004', named('session-a')))
    await t.settle()
    expect(t.holder(first.ticket_id as string)).toBe('session-a')
    const second = t.accept(t.receive('direct-000000000005', named('session-a')))
    await t.settle()
    expect(t.holder(second.ticket_id as string)).toBeUndefined()
    expect(t.host.executor.queueAhead(second.ticket_id as string)).toBeGreaterThanOrEqual(0)
    expect(t.host.report('session-a', { state: 'ready', summary: '你好' }, first.ticket_id as string)).toMatchObject({ ok: true })
    await t.settle()
    expect(t.holder(second.ticket_id as string)).toBe('session-a')
    await t.host.stop()
  })

  it('is plain text from a caller that does not declare directedSeats, or that is not signed', async () => {
    for (const setup of [{ declares: [] as string[], proof: 'origin-claim' }, { declares: ['directedSeats'], proof: 'cli-identity' }]) {
      const t = await team({ declares: setup.declares })
      const out = t.accept(t.receive('direct-000000000006', named('session-b'), { proof: setup.proof }), 'session-a')
      await t.settle()
      expect(t.holder(out.ticket_id as string)).toBe('session-a')
      await t.host.stop()
    }
  })

  it('a seat id names the member; the roster carries it, and moving the seat keeps the id', async () => {
    const t = await team()
    t.host.pass()
    const seatA = t.host.named.seatIdOf('session-a')!
    expect(seatA).toMatch(/^seat-[0-9a-f]{8}$/)
    const out = t.accept(t.receive('direct-000000000007', named(seatA)))
    await t.settle()
    expect(t.holder(out.ticket_id as string)).toBe('session-a')
    expect(t.host.named.moveSeat(seatA, 'session-b')).toEqual({ ok: true, seatId: seatA })
    expect(t.host.named.seatIdOf('session-b')).toBe(seatA)
    const { rosterSeats } = await import('../../src/superagent/host/roster.ts')
    const seats = rosterSeats({ team: () => ({ canvas: 'team', router: 'session-r', members: ['session-a', 'session-b'], observers: [] }), handleOf: id => `dsh/${id.slice(-8)}`, nameOf: () => undefined, online: () => true, loadOf: () => ({ active: 0, queued: 0 }), seatIdOf: id => t.host.named.seatIdOf(id) })
    expect(seats.find(s => s.seatId === seatA)?.seat).toBe('dsh/ession-b')
    await t.host.stop()
  })
})

describe('a named seat that cannot take the ticket', () => {
  const attention = (calls: string[][], task: string) => calls.filter(a => a[0] === 'receipt' && a[1] === task && a.includes('--attention'))

  it('holds it and asks the requester 等 or 换人; 换人 gives it to another member', async () => {
    const t = await team()
    const task = 'direct-000000000010'
    const out = t.accept(t.receive(task, named('dsh/nosuchseat')))
    const ticketId = out.ticket_id as string
    await t.settle()
    expect(t.holder(ticketId)).toBeUndefined()
    const asked = attention(t.calls, task)
    expect(asked).toHaveLength(1)
    expect(asked[0]![asked[0]!.indexOf('--options') + 1]).toBe('等|换人')
    expect(asked[0]!.at(-1)).toContain('不在这个团队')
    // The requester answers in the same conversation.
    t.receive('direct-000000000011', '换人', { context: `ctx-${task}` })
    await t.settle()
    expect(['session-a', 'session-b']).toContain(t.holder(ticketId))
    expect(t.host.store.tickets.get(ticketId)?.attention).toBeUndefined()
    await t.host.stop()
  })

  it('等 keeps it held; when the seat can work again it goes there, not elsewhere', async () => {
    const t = await team()
    t.loaded.delete('session-b')
    const task = 'direct-000000000012'
    const ticketId = t.accept(t.receive(task, named('session-b'))).ticket_id as string
    await t.settle()
    expect(attention(t.calls, task)[0]!.at(-1)).toContain('现在不在线')
    t.receive('direct-000000000013', '等', { context: `ctx-${task}` })
    await t.settle()
    expect(t.holder(ticketId)).toBeUndefined()
    expect(t.host.store.tickets.get(ticketId)?.attention).toBeUndefined()
    t.loaded.add('session-b')
    await t.settle()
    expect(t.holder(ticketId)).toBe('session-b')
    await t.host.stop()
  })

  it('换人 on a profiled team asks the router to choose; its choice ends the hold', async () => {
    const t = await team({ profiled: true })
    const task = 'direct-000000000014'
    const ticketId = t.accept(t.receive(task, named('dsh/nosuchseat'))).ticket_id as string
    await t.settle()
    t.receive('direct-000000000015', '换人', { context: `ctx-${task}` })
    await t.settle()
    expect(t.told.some(x => x.includes(ticketId) && x.includes('superagent_assign'))).toBe(true)
    expect(t.holder(ticketId)).toBeUndefined()
    expect(t.host.assignTicket(ticketId, 'session-a')).toMatchObject({ ok: true })
    await t.settle()
    expect(t.holder(ticketId)).toBe('session-a')
    await t.host.stop()
  })

  it('a split of a named ticket gives its parts to the named seat unless a part names another (ruling c)', async () => {
    const { splitRequest } = await import('../../src/superagent/host/tools.ts')
    const t = await team()
    const id = t.receive('direct-000000000016', named('session-b', '请分成两项：甲 列出问候语；乙 挑一种。'))
    const out = splitRequest(t.host, { trigger_id: id, title: '问候语（两项）', scope: 's', reason: '需求要求分成两项', rules: ['deps'], asked: '请分成两项', parts: [{ title: '甲', scope: '列出问候语' }, { title: '乙', scope: '挑一种', member: 'session-a' }] })
    expect(out).toMatchObject({ ok: true })
    const [first, second] = out.parts as string[]
    expect(t.host.executor.memberOfTicket(first!)?.member).toBe('session-b')
    expect(t.host.executor.memberOfTicket(second!)?.member).toBe('session-a')
    await t.host.stop()
  })
})

describe('rework the market returns', () => {
  it('is taken in at once as a new ticket on the member that did the returned one', async () => {
    const t = await team()
    const original = t.accept(t.receive('direct-000000000020', '写一句问候语。'), 'session-b')
    await t.settle()
    expect(t.host.report(t.holder(original.ticket_id as string)!, { state: 'ready', summary: '晴空万里' }, original.ticket_id as string)).toMatchObject({ ok: true })
    await t.settle()
    t.receive('direct-000000000021', '[A2A dispatch] {"rework":{"of":"direct-000000000020"}}\n[打回重做] 改成蓝色主题。')
    await t.settle()
    const rework = t.host.store.tickets.list().find(x => x.id !== original.ticket_id)!
    expect(rework.title).toBe('打回重做：问候语')
    expect(rework.mandate.scope).toBe('[打回重做] 改成蓝色主题。')
    expect(t.holder(rework.id) ?? t.host.executor.memberOfTicket(rework.id)?.member).toBe(t.host.executor.lastMemberOf(original.ticket_id as string))
    await t.host.stop()
  })

  it('goes to the router as before from a caller that does not declare reworkReturns', async () => {
    const t = await team({ declares: ['directedSeats'] })
    t.receive('direct-000000000022', '[A2A dispatch] {"rework":{"of":"direct-000000000020"}}\n[打回重做] 改成蓝色。')
    await t.settle()
    expect(t.host.store.tickets.list()).toHaveLength(0)
    await t.host.stop()
  })
})

describe('at boot', () => {
  it('a pass while the canvas cannot be read yet does not throw, and the seats sync on a later pass (#617 class)', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    let booting = true
    const host = new SuperagentHost({ canvasTeam: (name: string) => { if (booting) throw new ReferenceError("Cannot access 'cardCache' before initialization"); return name === 'team' ? { local: ['session-r', 'session-a'], remote: [] } : undefined },
      home: mkdtempSync(join(tmpdir(), 'sa-named-boot-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      homeUrl: () => 'http://127.0.0.1:1', sessionName: (id: string) => id, sessionLoaded: () => true, runCli: async () => '{}' } as never)
    booting = false
    expect(host.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true } }, () => true)).toMatchObject({ ok: true })
    booting = true
    expect(() => host.named.tick()).not.toThrow()
    expect(() => host.pass()).not.toThrow()
    booting = false
    host.pass()
    expect(host.named.seatIdOf('session-a')).toMatch(/^seat-/)
    await host.stop()
  })
})
