// @vitest-environment node
/** #851 review, non-blocking 3: every place that shows a member's name cleans it the way the health problems do; only the display changes. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { key } from '../../src/superagent/source-types.ts'
import { tmpdir } from 'node:os'

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
async function team(names: Record<string, string>) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', ...Object.keys(names)], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-names-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => names[id] ?? id,
    sessionLoaded: () => true, bootSettled: () => true, now: () => '2026-11-23T00:00:00.000Z',
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  return h
}
const RAW_A = 'dev\u0007\u202e\nlead', LONG = 'y'.repeat(400), INVISIBLE = '\u200b\u202e'

describe('member names are shown cleaned everywhere, matched as before', () => {
  it('the member list shows cleaned names: controls dropped, line breaks a space, long names cut, nothing left falls back to the id', async () => {
    const h = await team({ 'session-a': RAW_A, 'session-b': LONG, 'session-c': INVISIBLE })
    const line = h.memberListLine()
    expect(line).toBe("The team's members: dev lead; " + 'y'.repeat(119) + "…; session-c.")
    expect(line).not.toMatch(CONTROL)
    await h.stop()
  })

  it('a member is found by the name as shown, by its raw name and by its id; a name cleaned to nothing only by its id', async () => {
    const h = await team({ 'session-a': RAW_A, 'session-b': LONG, 'session-c': INVISIBLE })
    expect(h.resolveMember('dev lead')).toBe('session-a')
    expect(h.resolveMember('DEV LEAD')).toBe('session-a')
    expect(h.resolveMember(RAW_A)).toBe('session-a')
    expect(h.resolveMember('y'.repeat(119) + '…')).toBe('session-b')
    expect(h.resolveMember(LONG)).toBe('session-b')
    expect(h.resolveMember('session-c')).toBe('session-c')
    expect(h.resolveMember('')).toBeUndefined()
    await h.stop()
  })

  it('two names that read the same once cleaned: neither is picked by that name, the list shows their ids, each is still found by id', async () => {
    const h = await team({ 'session-a': 'dev\u202e', 'session-b': 'dev', 'session-c': 'other' })
    expect(h.memberListLine()).toBe("The team's members: dev (session-a); dev (session-b); other.")
    expect(h.resolveMember('dev')).toBeUndefined()
    expect(h.resolveMember('session-a')).toBe('session-a')
    expect(h.resolveMember('session-b')).toBe('session-b')
    expect(h.resolveMember('other')).toBe('session-c')
    await h.stop()
  })

  it('the router names a member by the name it was shown; an unknown name gets the cleaned list back', async () => {
    const h = await team({ 'session-a': RAW_A, 'session-b': 'plain' })
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const ask = (): string => { const a = h.request('做事') as { triggerId: string }; h.pass(); return a.triggerId }
    const missing = routeItem(h, { trigger_id: ask(), kind: 'accept', title: '做事', scope: 's', reason: 'r', member: 'nobody' } as never) as { ok: boolean; error: string }
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain("The team's members: dev lead; plain.")
    expect(missing.error).not.toMatch(CONTROL)
    const taken = routeItem(h, { trigger_id: ask(), kind: 'accept', title: '做事', scope: 's', reason: 'r', member: 'dev lead' } as never) as Record<string, unknown>
    expect(taken).toMatchObject({ ok: true, decision: 'accept' })
    // The ticket went to the member the router named by its shown name.
    expect((h as unknown as { executor: { memberOfTicket(id: string): { member: string } | undefined } }).executor.memberOfTicket(taken.ticket_id as string)?.member).toBe('session-a')
    await h.stop()
  })
})

// #861 review: every exit that shows a member's name, driven once with a name full of controls; one loop checks them all.
const SHOWN = 'dev lead', OPS = 'ops lead'
const RAW_ID = 'dev\u0007\u202e\nlead (aaaaaaaa)', RAW_OPS = 'ops\u202e\u200b\nlead (oooooooo)'
const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v !== null && typeof v === 'object' ? Object.values(v).flatMap(strings) : []
const host = (over: Record<string, unknown>, names: Record<string, string>, members: string[]) => import('../../src/superagent/host/index.ts').then(({ SuperagentHost }) => new SuperagentHost({
  canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', ...members], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-exits-')), logger: { info: () => {}, warn: () => {} },
  deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => names[id] ?? id, presetOf: () => undefined,
  sessionLoaded: () => true, bootSettled: () => true, now: () => '2026-11-23T01:00:00.000Z', ...over,
} as never))

describe('every exit that shows a member\'s name shows it cleaned (#861 review)', () => {
  it('seat, roster, queue, assignment, tool, credential, stop, outbound, approver, dispatch card, named seat, builder', async () => {
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const { CREDENTIAL_STOP } = await import('../../src/superagent/host/index.ts')
    const { OUTBOUND_APPROVE } = await import('../../src/superagent/host/outbound.ts')
    const { orgInventory } = await import('../../src/superagent/host/builder-tools.ts')
    const exits: Array<[string, string | undefined, string]> = []
    const accept = (h: { request(t: string): unknown; pass(): void }, title: string, member?: string) => {
      const a = h.request(title) as { triggerId: string }; h.pass()
      return (routeItem(h as never, { trigger_id: a.triggerId, kind: 'accept', title, scope: 's', reason: 'r', ...(member !== undefined ? { member } : {}) } as never) as { ticket_id: string }).ticket_id
    }

    // 1. One working member: its seat, the roster, a queued ticket, an assignment, a tool card, a credential card and its stop.
    const h = await host({}, { 'session-a': RAW_ID, 'session-b': RAW_OPS }, ['session-a', 'session-b'])
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', maxConcurrent: 1 }, () => true)).toMatchObject({ ok: true })
    h.start()
    const first = accept(h, '写文档', 'session-a')
    await vi.waitFor(() => { expect(h.executor.memberOfTicket(first)?.member).toBe('session-a') })
    exits.push(['seatOf', h.seatOf(first)?.name, SHOWN])
    exits.push(['roster nameOf', (h as unknown as { roster: { d: { nameOf(id: string): string | undefined } } }).roster.d.nameOf('session-a'), SHOWN])
    const second = accept(h, '再写一篇', 'session-a')
    exits.push(['queueOf member', h.queueOf(second)?.member, SHOWN])
    exits.push(['assignTicket member', (h.assignTicket(second, 'session-a') as { member?: string }).member, SHOWN])
    // A running ticket moved to another member after its member reported it cannot go on: the other return of assignTicket.
    await vi.waitFor(() => { expect(h.executor.list().find(b => b.ticketId === first)?.member).toBe('session-a') })
    expect(h.report('session-a', { state: 'blocked', summary: '接不下去了' }, first)).toMatchObject({ ok: true })
    expect(h.store.tickets.get(first)!.assignments.at(-1)?.state).not.toBe('pending')
    exits.push(['reassign running', (h.assignTicket(first, 'session-b') as { member?: string }).member, OPS])
    h.requestTool('session-a', 'member', 'gitbash')
    exits.push(['tool card', h.decisionCards().find(c => c.source === 'tool')?.question, SHOWN])
    h.auditCall('session-a', 'member', 'bash', { command: 'cat ~/.dsh/a2a/cli.json' })
    const card = h.decisionCards().find(c => c.by === 'credential:session-a')!
    exits.push(['credential card', card.question, SHOWN])
    const stop = h.decide(card.id, 'choose', CREDENTIAL_STOP) as { stopped: string[]; refiled: string[] }
    exits.push(['stop note', strings(h.store.tickets.get(stop.stopped[0]!)?.ended).find(s => s.includes('凭据访问审计卡')), SHOWN])
    exits.push(['refiled request', h.store.triggers.get(stop.refiled[0]!)?.text, SHOWN])
    h.pass()
    const again = (routeItem(h, { trigger_id: stop.refiled[0]!, kind: 'accept', title: '重做', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
    exits.push(['excluded error', (h.assignTicket(again, 'session-a') as { error?: string }).error, SHOWN])
    await h.stop()

    // 2. A member's outbound request and the approver's note.
    const o = await host({ presetOf: (id: string) => id === 'session-o' ? 'superagent-observer' : undefined, handleOf: (id: string) => `dsh/${id}`, homeUrl: () => 'http://127.0.0.1:1',
      runCli: async (args: string[], env: NodeJS.ProcessEnv) => {
        if (args[0] === 'init') { mkdirSync(env.A2A_CLI_HOME!, { recursive: true }); writeFileSync(join(env.A2A_CLI_HOME!, 'cli.json'), JSON.stringify({ handle: 'superagent-team/0123456789abcdef' })); return '{}' }
        if (args[0] === 'admission') return JSON.stringify({ admitted: true, rule: 'cli-deposit' })
        return args[0] === 'route' ? JSON.stringify({ delivered: true, task_id: args[args.indexOf('--task') + 1] }) : '{}'
      } }, { 'session-m': RAW_ID, 'session-o': RAW_OPS }, ['session-m', 'session-o'])
    expect(o.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, approvers: ['session-o'] }, () => true)).toMatchObject({ ok: true })
    o.start()
    const job = accept(o, '数据', 'session-m')
    await vi.waitFor(() => { expect(o.executor.list().find(b => b.ticketId === job)?.member).toBe('session-m') })
    const raised = await o.requestOutbound('session-m', { ticket_id: job, address: 'dsh/canvas/other', text: '请给我们接口数据', why: '工单要用' }) as { card_id: string }
    exits.push(['outbound card', o.decisionCards().find(c => c.id === raised.card_id)?.question, SHOWN])
    expect(o.approverDecide('session-o', raised.card_id, OUTBOUND_APPROVE, '对方是合作团队')).toMatchObject({ ok: true })
    exits.push(['approver note', strings((o as unknown as { decisions: { get(id: string): unknown } }).decisions.get(raised.card_id)).find(s => s.includes('审批人')), OPS])
    await o.stop()

    // 3. The router's dispatch card on a profiled team, and a request that names a seat by its shown name.
    const bot = 'market/0123456789abcdef', told: string[] = []
    const n = await host({ deliverToSession: (id: string, text: string) => { if (id === 'session-r') told.push(text); return true }, homeUrl: () => 'http://127.0.0.1:1',
      callerDeclares: (caller: string, capability: string) => caller === bot && ['directedSeats', 'reworkReturns'].includes(capability),
      runCli: async (args: string[]) => args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' }, { 'session-a': RAW_ID, 'session-b': 'other (bbbbbbbb)' }, ['session-a', 'session-b'])
    expect(n.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Do what the market dispatches.' }],
      profiles: { 'session-a': { role: '写作' }, 'session-b': { role: '审校' } } }, () => true)).toMatchObject({ ok: true })
    const task = 'direct-000000000001', context = 'ctx-' + task
    n.engine.receive({ id: key('a2a', bot, task), source: 'a2a', threads: [{ source: 'a2a', id: context }], actor: { source: 'a2a', id: bot }, human: false, addressed: 'direct', at: new Date().toISOString(),
      text: `[A2A direct] (task ${task}) 已验证来源 http://127.0.0.1:9890 from "${bot}" (routed to dsh/canvas/team) sent:\n\n[A2A dispatch] ${JSON.stringify({ for: SHOWN + ' (aaaaaaaa)' })}\n写一句问候语。`,
      channel: { source: 'a2a', thread: `a2a:${context}`, address: { caller: bot, task, context } }, meta: { proof: 'origin-claim', admission: 'cli-deposit', taskId: task } } as never)
    for (let i = 0; i < 5; i++) { n.pass(); await new Promise(r => setTimeout(r, 5)) }
    const lines = told.flatMap(t => t.split('\n'))
    exits.push(['dispatch card member line', lines.find(l => l.startsWith('- ') && l.includes('写作')), SHOWN])
    exits.push(['named seat label', lines.find(l => l.includes('names a seat')), SHOWN])
    await n.stop()

    // 4. The team builder's inventory.
    const inv = orgInventory({ teams: [], sessions: ['session-a'], nameOf: () => RAW_ID, presetOf: () => undefined, staffing: [] })
    exits.push(['builder inventory', strings(inv).find(s => s.includes('lead')), SHOWN])
    // #861 re-review (B2, B4, B5): a team with a router and members, so the router's and each member's name are cleaned
    // too, and a name cleaned to nothing falls back to the session id.
    const raw: Record<string, string> = { 'session-r': RAW_A, 'session-m': RAW_A, 'session-z': INVISIBLE }
    const team = { ref: 'dsh/canvas/team', revisions: {}, seatOf: () => undefined, children: [],
      settings: { canvas: 'team', router: 'session-r', members: ['session-m', 'session-z'], observers: [], profiles: {}, rules: [], dispatch: '', repos: {}, acceptMode: 'auto' } }
    const placedInv = orgInventory({ teams: [team as never], sessions: [], nameOf: id => raw[id] ?? id, presetOf: () => undefined, staffing: [] }) as { teams: Array<{ router: { session: string; name: string }; members: Array<{ session: string; name: string }> }> }
    expect(placedInv.teams[0]!.router).toMatchObject({ session: 'session-r', name: 'dev lead' })
    expect(placedInv.teams[0]!.members.map(m => [m.session, m.name])).toEqual([['session-m', 'dev lead'], ['session-z', 'session-z']])

    for (const [exit, text, expected] of exits) {
      expect(text, exit).toBeDefined()
      // The raw names' own characters; some exits quote multi-line text of their own, so a line break alone is no finding.
      expect(text, exit).not.toMatch(/[\u0007\u202e\u200b]|dev\nlead|ops\nlead/)
      expect(text, exit).toContain(expected)
    }
    expect(exits).toHaveLength(15)
  })
})
