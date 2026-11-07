// @vitest-environment node
/**
 * superagent design v4, PR-B on one host: superagent's engine runs in the a2a host. The owner's request enters through
 * the workbench Source, the gate admits it, the router (a fixed session) receives the candidate card in its own session
 * and decides with superagent_route; the ticket waits for the executor (PR-C). The router takes no A2A work and sends
 * none; no other session can use the router's tools. State survives a restart.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../../src/index.ts'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cliEnv } from './harness.ts'

class ManyAgents extends Service {
  map = new Map<string, Agent>()
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): never { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return [...this.map.values()] }
  get(id: Agent['id']): Agent | undefined { return this.map.get(String(id)) }
}
interface TestAgent extends Agent { steered: string[]; host?: Context }
function makeAgent(id: string, name: string): TestAgent {
  const agent = {
    id: SessionId(id), session: { id: SessionId(id), events: [] as unknown[], title: name }, steered: [] as string[],
    followup(message: unknown): void { queueMicrotask(() => { agent.host?.emit('agent/inbox/claimed', { agent, message, turn: 1 }); agent.steer(message) }) },
    steer(payload: unknown): void {
      const text = typeof payload === 'object' && payload !== null && 'content' in (payload as Record<string, unknown>)
        ? ((payload as { content: Array<{ text?: string }> }).content.map(b => b.text ?? '').join(''))
        : String(payload)
      agent.steered.push(text)
      const events = (agent as unknown as { session: { events: unknown[] } }).session.events
      events.push({ type: 'user/message', data: { content: [{ type: 'text', text }] } })
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `noted by ${name}` }] } } })
      agent.host?.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
    },
  } as unknown as TestAgent
  return agent
}
const R_ID = 'session-a0000000aaaa1111', M_ID = 'session-b1111111bbbb2222', O_ID = 'session-c2222222cccc3333', X_ID = 'session-d3333333dddd4444'
const execAs = (agent: Agent) => ({ signal: new AbortController().signal, agent }) as never
const until = async (f: () => boolean | Promise<boolean>, ms = 8000): Promise<void> => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return; await new Promise(r => setTimeout(r, 25)) } }

async function mount(home: string, extra: Partial<Config> = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(ManyAgents)
  const agents = ctx.get('agents') as unknown as ManyAgents
  const [R, M, O, X] = [[R_ID, 'router'], [M_ID, 'member'], [O_ID, 'outsider'], [X_ID, 'member-x']].map(([id, name]) => makeAgent(id!, name!))
  for (const a of [R!, M!, O!, X!]) { agents.map.set(String(a.id), a); a.host = ctx }
  apply(ctx, { apiKey: '', session: 'host-sess', team: 'dsh', routeTimeoutMs: 5_000, flushTimeoutMs: 300_000, announce: true, agentName: 'sa-host', peers: [], delegates: [], sessionNodes: true, wakeJoinedOnBoot: false, dshHome: home, superagent: true, ...extra } as unknown as Config)
  for (const a of [R!, M!, O!, X!]) ctx.emit('agent/created', { agent: a as unknown as Agent })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  const post = async (path: string, body: unknown): Promise<Record<string, any>> => await (await globalThis.fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Record<string, any>
  const sa = async (body: unknown): Promise<Record<string, any>> => await post('/__dsh_a2a/superagent', body)
  const state = async (): Promise<Record<string, any>> => await (await globalThis.fetch(`http://127.0.0.1:${port}/__dsh_a2a/superagent`)).json() as Record<string, any>
  const tool = async (name: string, from: Agent, args: Record<string, unknown>): Promise<Record<string, any>> => await ctx.tools.get(name)!.execute(args, execAs(from)) as Record<string, any>
  for (const a of [R!, M!, O!, X!]) await post('/__dsh_a2a/join', { id: String(a.id) })
  return { ctx, port, agents, R: R!, M: M!, O: O!, X: X!, post, sa, state, tool, dispose: async () => { await ctx.fiber.dispose() } }
}
const triggerIn = (card: string): string => /^trigger (\S+) /m.exec(card)![1]!

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

describe('superagent engine in the a2a host', () => {
  it('workbench request → gate → router candidate → accept → ticket; follow-up fans out; isolation holds; state survives restart', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-host-mesh-'))
    let m = await mount(home)
    try {
      // Owner control: only a joined local session can be the router.
      expect(await m.sa({ action: 'settings', settings: { router: 'session-ffffffff00000000' } })).toMatchObject({ ok: false })
      expect(await m.sa({ action: 'settings', settings: { router: R_ID } })).toMatchObject({ ok: true, settings: { router: R_ID } })

      // 1) The owner's request reaches the router as a candidate card, in its own session (no A2A involved).
      const asked = await m.sa({ action: 'request', text: '给 nexus 的节点列表加一个搜索框' })
      expect(asked).toMatchObject({ ok: true, result: 'stored' })
      await until(() => m.R.steered.some(t => t.includes('[superagent candidate]')))
      const card = m.R.steered.find(t => t.includes('[superagent candidate]'))!
      expect(card).toContain('给 nexus 的节点列表加一个搜索框')
      expect(card).toContain('strength explicit')
      const trigger = triggerIn(card)
      expect(trigger).toBe(asked.triggerId)
      expect(m.M.steered).toEqual([])

      // 2) Only the router may decide: another session's call is refused and changes nothing.
      expect(await m.tool('superagent_route', m.M, { items: [{ trigger_id: trigger, kind: 'accept', title: 'x', scope: 'y', reason: 'z' }] })).toMatchObject({ ok: false, code: 'not-router' })
      expect(await m.tool('superagent_read', m.O, { kind: 'tickets' })).toMatchObject({ ok: false, code: 'not-router' })

      // 3) The router accepts: one ticket, waiting for the executor; the acknowledgement lands on the workbench Thread.
      const routed = await m.tool('superagent_route', m.R, { items: [{ trigger_id: trigger, kind: 'accept', title: '节点列表搜索框', scope: '只改 nexus 节点列表', reason: '属主明确提出', acknowledgement: '收到，会在节点列表加搜索框。' }] })
      expect(routed.ok, JSON.stringify(routed)).toBe(true)
      const ticketId = routed.results[0].ticket_id as string
      let s = await m.state()
      const ticket = s.tickets.find((t: any) => t.id === ticketId)
      expect(ticket).toMatchObject({ title: '节点列表搜索框', mandate: { strength: 'explicit', basis: { via: 'addressed', sender: 'owner' } }, stage: { stage: 'working', action: 'queued' } })
      const thread = s.threads.find((t: any) => t.ref.id === asked.thread)
      expect(thread.replies.map((r: any) => [r.message.kind, r.message.text, r.status])).toEqual([['acknowledgement', '收到，会在节点列表加搜索框。', 'sent']])
      // Accept is idempotent by trigger id (upstream): deciding again yields no second ticket.
      const again = await m.tool('superagent_route', m.R, { items: [{ trigger_id: trigger, kind: 'accept', title: 'again', scope: 'y', reason: 'z' }] })
      expect(again.results[0].ticket_id ?? ticketId).toBe(ticketId)
      expect((await m.state()).tickets).toHaveLength(1)

      // 4) The owner's follow-up on that Thread goes to the ticket (Subscription fan-out), not to a new Eval.
      const before = m.R.steered.length
      const follow = await m.sa({ action: 'request', text: '搜索要支持拼音', thread: asked.thread })
      expect(follow).toMatchObject({ ok: true, result: 'stored' })
      s = await m.state()
      expect(s.tickets[0].inputs.some((i: any) => i.kind === 'trigger' && i.triggerId === follow.triggerId)).toBe(true)
      await new Promise(r => setTimeout(r, 100))
      expect(m.R.steered.length).toBe(before)

      // 5) A second request: the router ignores it, with a reason; no ticket.
      const chat = await m.sa({ action: 'request', text: '今天天气怎么样' })
      await until(() => m.R.steered.some(t => t.includes(chat.triggerId)))
      expect(await m.tool('superagent_route', m.R, { items: [{ trigger_id: chat.triggerId, kind: 'ignore', reason: '闲聊，不是工作请求' }] })).toMatchObject({ ok: true, results: [{ decision: 'ignore' }] })
      expect((await m.state()).tickets).toHaveLength(1)

      // 6) The router takes no A2A work and sends none — by handle, by session id, or through a canvas it sits in.
      for (const id of [R_ID, O_ID]) await m.post('/__dsh_a2a/canvas', { action: 'add-member', name: 'mixed', id })
      for (const team of ['dsh/a0000000', 'dsh/canvas/mixed']) {
        const out = await m.tool('a2a_route', m.O, { team, message: '直接找总工派活', async: true })
        expect(out.ok, `${team}: ${JSON.stringify(out)}`).toBe(false)
        expect(String(out.error)).toContain('superagent-router-inbound')
      }
      const outbound = await m.tool('a2a_route', m.R, { team: 'dsh/c2222222', message: '总工私下派活', async: true })
      expect(outbound.ok).toBe(false)
      expect(String(outbound.error)).toContain('superagent-router-outbound')
      expect(m.O.steered.some(t => t.includes('总工私下派活'))).toBe(false)
      expect(m.R.steered.some(t => t.includes('直接找总工派活'))).toBe(false)

      // 7) A Source that is off records the Trigger as filtered and asks nobody.
      expect(await m.sa({ action: 'settings', settings: { sources: { workbench: false } } })).toMatchObject({ ok: true })
      expect(await m.sa({ action: 'request', text: '关掉之后的请求' })).toMatchObject({ ok: true, result: 'filtered' })
      expect(await m.sa({ action: 'settings', settings: { sources: { workbench: true } } })).toMatchObject({ ok: true })
    } finally { await m.dispose() }

    // 8) Restart: tickets, decisions and replies come back from the a2a home.
    m = await mount(home)
    try {
      const s = await m.state()
      expect(s.settings.router).toBe(R_ID)
      expect(s.tickets).toHaveLength(1)
      expect(s.tickets[0]).toMatchObject({ title: '节点列表搜索框' })
      expect(s.threads.flatMap((t: any) => t.decisions.map((d: any) => d.kind)).sort()).toEqual(['accept', 'ignore'])
      // Inverse of the isolation: once the owner clears the router, the same session is ordinary again.
      expect(await m.sa({ action: 'settings', settings: { router: null } })).toMatchObject({ ok: true })
      const out = await m.tool('a2a_route', m.R, { team: 'dsh/canvas/mixed', message: 'ordinary again', async: true })
      expect(String(out.error ?? '')).not.toContain('superagent-router')
    } finally { await m.dispose() }
  }, 60_000)

  it('PR-B2a: the owner\'s terminal is the workbench Source — a2a-net superagent request / state ride the owner credential', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-host-cli-'))
    const m = await mount(home)
    try {
      expect(await m.sa({ action: 'settings', settings: { router: R_ID } })).toMatchObject({ ok: true })
      // Async spawn: the host answers in this very process, so a synchronous child would deadlock it.
      const cli = (...args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>(resolve => {
        const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args, '--home', `http://127.0.0.1:${m.port}`], { env: cliEnv(mkdtempSync(join(tmpdir(), 'sa-cli-home-'))) })
        let stdout = '', stderr = ''
        child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
        child.on('close', status => resolve({ status, stdout, stderr }))
      })
      const asked = await cli('superagent', 'request', '终端里提的需求', '--json')
      expect(asked.status, asked.stderr).toBe(0)
      const out = JSON.parse(asked.stdout) as { ok: boolean; result: string; triggerId: string; thread: string }
      expect(out).toMatchObject({ ok: true, result: 'stored' })
      // A person addressing the team: the router gets an explicit candidate, exactly as from the workbench.
      await until(() => m.R.steered.some(t => t.includes(out.triggerId) && t.includes('strength explicit')))
      const routed = await m.tool('superagent_route', m.R, { items: [{ trigger_id: out.triggerId, kind: 'accept', title: '终端需求', scope: 's', reason: '属主', acknowledgement: '收到' }] })
      expect(routed.ok).toBe(true)
      const state = await cli('superagent', 'state')
      expect(state.status, state.stderr).toBe(0)
      expect(state.stdout).toContain(`router ${R_ID}`)
      expect(state.stdout).toContain('终端需求')
      expect(state.stdout).toContain('acknowledgement: 收到')
      expect((await cli('superagent', 'request')).status).not.toBe(0)
    } finally { await m.dispose() }
  }, 30_000)

  it('PR-B2b: the A2A Source — a CLI identity\'s request to the team address is an agent\'s Trigger, takes no queue slot, and reaches the router only through the bot list', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-a2a-src-'))
    // Routing scope on, as shipped: a CLI deposited on this host is then admitted as `cli-deposit`, an operator link.
    const m = await mount(home, { teamScopeRouting: true })
    const run = (cliHome: string, ...args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>(resolve => {
      const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args, '--home', `http://127.0.0.1:${m.port}`], { env: cliEnv(cliHome) })
      let stdout = '', stderr = ''
      child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
      child.on('close', status => resolve({ status, stdout, stderr }))
    })
    try {
      const rules = [{ name: 'deps', text: 'Bump a pinned dependency when an agent reports it.' }]
      expect(await m.sa({ action: 'settings', settings: { router: R_ID, sources: { a2a: true }, acceptMode: 'observe', rules } })).toMatchObject({ ok: true })
      // The host creates and deposits the team identity itself (reply mode publishes it as owing receipts).
      let address = ''
      await until(async () => { const s = await m.state(); address = s.a2a.address ?? ''; return address !== '' && s.a2a.health['a2a-deposit']?.state === 'ready' }, 20_000)
      expect(address).toMatch(/^superagent-team\/[0-9a-f]{16}$/)

      // Two requester identities on this host: one the owner lists as a bot, one not.
      const listed = mkdtempSync(join(tmpdir(), 'sa-req-a-')), stranger = mkdtempSync(join(tmpdir(), 'sa-req-b-'))
      for (const [dir, name] of [[listed, 'reporter'], [stranger, 'stranger']] as const) {
        expect((await run(dir, 'init', name)).status).toBe(0)
        expect((await run(dir, 'publish')).status).toBe(0)
      }
      const handleOf = (dir: string): string => (JSON.parse(readFileSync(join(dir, 'cli.json'), 'utf8')) as { handle: string }).handle
      expect(await m.sa({ action: 'settings', settings: { bots: { a2a: [handleOf(listed)] } } })).toMatchObject({ ok: true })

      // Four requests from the listed agent: the team address owes receipts, yet none is refused for a full queue (cap 3).
      for (const n of [1, 2, 3, 4]) {
        const sent = await run(listed, 'route', address, `依赖 lib-${String(n)} 有新版本`, '--json')
        expect(sent.status, sent.stderr).toBe(0)
        expect(JSON.parse(sent.stdout)).toMatchObject({ delivered: true })
      }
      const strangerSent = await run(stranger, 'route', address, '陌生 agent 的请求', '--json')
      expect(strangerSent.status, strangerSent.stderr).toBe(0)

      // a2a-watch reads the mailbox: the listed agent's requests reach the router as inferred candidates with the rules.
      await until(() => m.R.steered.filter(t => t.includes('[superagent candidate]') && t.includes(handleOf(listed))).length >= 1, 40_000)
      const card = m.R.steered.find(t => t.includes(handleOf(listed)))!
      expect(card).toContain('strength inferred')
      expect(card).toContain('rule deps:')
      expect(m.R.steered.some(t => t.includes(handleOf(stranger)))).toBe(false)
      // Observe: the router's accept on the matched rule is recorded as would-accept; no ticket.
      const trigger = /^trigger (\S+) /m.exec(card)![1]!
      const routed = await m.tool('superagent_route', m.R, { items: [{ trigger_id: trigger, kind: 'accept', title: 'bump', scope: 'one dep', reason: 'matches deps', rules: ['deps'] }] })
      expect(routed.results[0]).toMatchObject({ ok: true, decision: 'ignore', reason: [{ code: 'observed' }] })
      expect((await m.state()).tickets).toHaveLength(0)
      // The stranger's request was recorded and refused at the gate (an audited ignore), never a candidate.
      const s = await m.state()
      const strangerThread = s.threads.find((t: any) => t.triggers.some((x: any) => x.actor.id === handleOf(stranger)))
      expect(strangerThread, JSON.stringify(s.threads.map((t: any) => t.key))).toBeDefined()
      expect(strangerThread.decisions.map((d: any) => [d.kind, d.reason[0]?.code])).toEqual([['ignore', 'botNotListed']])
    } finally { await m.dispose() }
  }, 90_000)

  it('PR-C1: the A2A executor runs tickets on the fixed members — one slot each, queue, report, relay, follow-ups — and never opens a session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-exec-'))
    const m = await mount(home)
    try {
      expect(await m.sa({ action: 'settings', settings: { router: R_ID, members: [R_ID] } })).toMatchObject({ ok: false })
      expect(await m.sa({ action: 'settings', settings: { router: R_ID, members: [M_ID, 'session-ffffffff00000000'] } })).toMatchObject({ ok: false })
      expect(await m.sa({ action: 'settings', settings: { router: R_ID, members: [M_ID, X_ID] } })).toMatchObject({ ok: true })
      const sessionsBefore = m.agents.roots().length

      // Three requests, three tickets, two members: two run, one waits.
      const asks: Array<{ triggerId: string; thread: string }> = []
      for (const text of ['需求一：加搜索框', '需求二：修复排序', '需求三：补文档']) asks.push(await m.sa({ action: 'request', text }) as never)
      await until(() => asks.every(a => m.R.steered.some(t => t.includes(a.triggerId))))
      const tickets: string[] = []
      for (const [i, a] of asks.entries()) {
        const routed = await m.tool('superagent_route', m.R, { items: [{ trigger_id: a.triggerId, kind: 'accept', title: `工单${String(i + 1)}`, scope: '小改动', reason: '属主', acknowledgement: '收到' }] })
        tickets.push(routed.results[0].ticket_id)
      }
      const cards = (agent: { steered: string[] }) => agent.steered.filter(t => t.includes('[superagent assignment]'))
      await until(() => cards(m.M).length === 1 && cards(m.X).length === 1)
      let s = await m.state()
      expect(s.executor.bindings).toHaveLength(2)
      const queued = s.tickets.find((t: any) => !s.executor.bindings.some((b: any) => b.ticketId === t.id))
      expect(queued.stage).toEqual({ stage: 'working', action: 'queued' })
      expect(cards(m.M)[0]).toContain('需求一：加搜索框')
      expect(cards(m.M)[0]).toContain('a2a_ticket_report')

      // The owner's follow-up on X's ticket goes straight to X (Subscription fan-out → executor Input).
      const xTicket = s.executor.bindings.find((b: any) => b.member === X_ID).ticketId
      const xAsk = asks[tickets.indexOf(xTicket)]!
      await m.sa({ action: 'request', text: '补充：要带单元测试', thread: xAsk.thread })
      await until(() => m.X.steered.some(t => t.includes('[superagent input]') && t.includes('补充：要带单元测试')))

      // Only an assigned member may report; M reports ready → its ticket completes → the router hears it → M takes the waiting one.
      expect(await m.tool('a2a_ticket_report', m.O, { state: 'ready', summary: 'x' })).toMatchObject({ ok: false, code: 'not-member' })
      const mTicket = s.executor.bindings.find((b: any) => b.member === M_ID).ticketId
      const report = await m.tool('a2a_ticket_report', m.M, { state: 'ready', summary: '已提交 PR https://example.invalid/pr/1' })
      expect(report, JSON.stringify(report)).toMatchObject({ ok: true, ticketId: mTicket })
      await until(() => m.R.steered.some(t => t.includes('[superagent report]') && t.includes(mTicket)))
      await until(() => cards(m.M).length === 2)
      expect(cards(m.M)[1]).toContain(queued.id)
      s = await m.state()
      expect(s.tickets.find((t: any) => t.id === mTicket).ended).toMatchObject({ outcome: 'completed' })
      expect(s.executor.bindings.map((b: any) => b.ticketId).sort()).toEqual([queued.id, xTicket].sort())

      // The router hands the result to the person, on the thread the request came from.
      const mAsk = asks[tickets.indexOf(mTicket)]!
      expect(await m.tool('superagent_reply', m.R, { purpose: 'result', ticket_id: mTicket, text: '搜索框已完成：https://example.invalid/pr/1' })).toMatchObject({ ok: true })
      s = await m.state()
      expect(s.threads.find((t: any) => t.ref.id === mAsk.thread).replies.map((r: any) => r.message.text)).toContain('搜索框已完成：https://example.invalid/pr/1')

      // Members neither take nor send A2A work.
      const inbound = await m.tool('a2a_route', m.O, { team: 'dsh/b1111111', message: '私下找成员派活', async: true })
      expect(String(inbound.error)).toContain('superagent-member-inbound')
      const outbound = await m.tool('a2a_route', m.M, { team: 'dsh/c2222222', message: '成员私下派活', async: true })
      expect(String(outbound.error)).toContain('superagent-member-outbound')
      // PR-F: each refused route is counted once, by its rule, with who and what.
      const refusals = (await m.state()).refusals
      expect(refusals.counts).toMatchObject({ 'superagent-member-inbound': 1, 'superagent-member-outbound': 1 })
      expect(refusals.recent.slice(-2)).toMatchObject([{ rule: 'superagent-member-inbound', target: 'dsh/b1111111' }, { rule: 'superagent-member-outbound', caller: M_ID }])

      // No session was opened for any ticket.
      expect(m.agents.roots().length).toBe(sessionsBefore)
    } finally { await m.dispose() }
  }, 60_000)

  it('PR-D: the router and the members call only their role\'s tools — through the real tool pipeline, any preset, a subagent too', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-host-mesh-'))
    const m = await mount(home)
    try {
      // The pipeline call a model's tool call takes (guards apply), unlike calling a tool's body directly.
      let call = 0
      const run = async (name: string, from: Agent, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> => {
        const result = await m.ctx.tools.execute({ callId: `c${String(++call)}` as never, name, arguments: args, agent: from, signal: new AbortController().signal })
        return { isError: result.isError, text: JSON.stringify(result.isError ? result.error : result.value) }
      }
      const refusedByRole = async (name: string, from: Agent, args: Record<string, unknown> = {}): Promise<boolean> => {
        const r = await run(name, from, args)
        return r.isError && r.text.includes('[superagent-role-tools]')
      }
      // Each role session's own tool scope, observed: what it may see is restricted, and lifted when the role goes.
      const scopes = new Map<string, { allow: string[] | undefined; lifted: number }>()
      for (const a of [m.R, m.M, m.O]) {
        const seen = { allow: undefined as string[] | undefined, lifted: 0 }
        scopes.set(String(a.id), seen)
        ;(a as unknown as { ctx: unknown }).ctx = { [Symbol('dsh.scope')]: a, tools: {
          get: (name: string) => m.ctx.tools.get(name),
          restrict: (filter: { allow: string[] }) => { seen.allow = [...filter.allow]; return () => { seen.allow = undefined; seen.lifted++ } },
        } }
      }

      // No role yet: nothing is refused for a role, nothing restricted.
      expect(await refusedByRole('a2a_teams', m.R)).toBe(false)
      expect(await m.sa({ action: 'settings', settings: { router: R_ID, members: [M_ID] } })).toMatchObject({ ok: true })

      // The router: superagent_* only. Its visible tools are exactly those.
      expect(scopes.get(R_ID)!.allow).toEqual(['superagent_route', 'superagent_read', 'superagent_reply', 'superagent_status'])
      const statusRun = await run('superagent_read', m.R, { kind: 'tickets' }); expect(statusRun.isError, statusRun.text).toBe(false)
      for (const name of ['a2a_route', 'a2a_report', 'a2a_teams', 'a2a_ticket_report', 'a2a_file_send']) expect(await refusedByRole(name, m.R, { team: 'dsh/c2222222', message: 'x' }), name).toBe(true)

      // A member: work tools + a2a_ticket_report + a2a_file_fetch (of this host's tools, the last two). No A2A route, no report
      // outside its ticket, no router tool.
      expect(scopes.get(M_ID)!.allow).toEqual(['a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_file_fetch'])
      expect(await refusedByRole('a2a_ticket_report', m.M, { state: 'progress', summary: 'x' })).toBe(false)
      expect(await refusedByRole('a2a_file_fetch', m.M, {})).toBe(false)
      for (const name of ['a2a_route', 'a2a_report', 'a2a_teams', 'a2a_tasks', 'a2a_file_send', 'superagent_route']) expect(await refusedByRole(name, m.M, { team: 'dsh/c2222222', message: 'x' }), name).toBe(true)

      // A subagent of a member acts in the member's role (it could not be opened by the member, but one opened before is held).
      const S = makeAgent('session-e4444444eeee5555', 'member-subagent')
      ;(S as unknown as { session: { header: { parentSession: string } } }).session.header = { parentSession: M_ID }
      m.agents.map.set(String(S.id), S); S.host = m.ctx
      expect(await refusedByRole('a2a_route', S, { team: 'dsh/c2222222', message: 'x' })).toBe(true)

      // An outsider is untouched.
      expect(await refusedByRole('a2a_teams', m.O)).toBe(false)
      expect(scopes.get(O_ID)!.allow).toBeUndefined()

      // The owner swaps the roles: restrictions follow the settings at once, the old ones are lifted.
      expect(await m.sa({ action: 'settings', settings: { router: O_ID, members: [] } })).toMatchObject({ ok: true })
      expect(scopes.get(R_ID)).toMatchObject({ allow: undefined, lifted: 1 })
      expect(scopes.get(M_ID)).toMatchObject({ allow: undefined, lifted: 1 })
      expect(scopes.get(O_ID)!.allow).toEqual(['superagent_route', 'superagent_read', 'superagent_reply', 'superagent_status'])
      expect(await refusedByRole('a2a_teams', m.R)).toBe(false)
      expect(await refusedByRole('a2a_teams', m.O)).toBe(true)
      expect(await refusedByRole('a2a_route', S, { team: 'dsh/c2222222', message: 'x' })).toBe(false)
      // PR-F: every refused call counted once (router 5, member 6, the member's subagent 1, the new router 1).
      expect((await m.state()).refusals.counts['superagent-role-tools']).toBe(13)
    } finally { await m.dispose() }
  }, 30_000)

  it('PR-F: a member takes up a person\'s message by its trigger id; what it read before reporting stays with the ticket, an unread one goes to the router at the end', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-takeup-'))
    const m = await mount(home)
    try {
      expect(await m.sa({ action: 'settings', settings: { router: R_ID, members: [M_ID] } })).toMatchObject({ ok: true })
      const ask = await m.sa({ action: 'request', text: '需求：加一个导出按钮' })
      await until(() => m.R.steered.some(t => t.includes(ask.triggerId)))
      const routed = await m.tool('superagent_route', m.R, { items: [{ trigger_id: ask.triggerId, kind: 'accept', title: '导出按钮', scope: '小改动', reason: '属主', acknowledgement: '收到' }] })
      const ticketId = routed.results[0].ticket_id as string
      await until(() => m.M.steered.some(t => t.includes('[superagent assignment]')))
      const card = m.M.steered.find(t => t.includes('[superagent assignment]'))!
      // The card names the request's trigger and how to take up later messages.
      expect(card).toContain(`request: trigger ${ask.triggerId}`)
      expect(card).toContain('a2a_ticket_ack')

      // From here the member stays in one turn (no idle): what it reads counts only by its session's inbox claims.
      const M = m.M as unknown as { steer: (p: unknown) => void; followup: (p: unknown) => void; steered: string[] }
      const text = (p: unknown) => typeof p === 'object' && p !== null && 'content' in (p as object) ? (p as { content: Array<{ text?: string }> }).content.map(b => b.text ?? '').join('') : String(p)
      let claim = true
      M.followup = (message: unknown) => { queueMicrotask(() => { if (claim) m.ctx.emit('agent/inbox/claimed', { agent: m.M as never, message, turn: 1 } as never); M.steered.push(text(message)) }) }
      const said = async (body: string) => { const r = await m.sa({ action: 'request', text: body, thread: ask.thread }); await until(() => M.steered.some(t => t.includes(body))); return r.triggerId as string }

      // Three follow-ups the member reads: one it acknowledges, one it hands back, one it just reads.
      const acked = await said('补充：导出 CSV 就行')
      const handed = await said('另外：顺便把登录页也改一下')
      const read = await said('文件名用日期')
      const input = M.steered.find(t => t.includes('补充：导出 CSV 就行'))!
      expect(input).toContain(`trigger ${acked}`)
      expect(input).toContain('(a person)')
      await until(async () => (await m.state()).tickets[0].inputs.filter((i: any) => [acked, handed, read].includes(i.triggerId) && typeof i.readAt === 'string').length === 3)
      let s = await m.state()
      expect(s.tickets[0].inputs.filter((i: any) => [acked, handed, read].includes(i.triggerId)).every((i: any) => typeof i.readAt === 'string')).toBe(true)

      expect(await m.tool('a2a_ticket_ack', m.M, { trigger_id: acked, text: '好的，只做 CSV。' })).toMatchObject({ ok: true, ticketId })
      s = await m.state()
      expect(s.threads.find((t: any) => t.ref.id === ask.thread).replies.map((r: any) => r.message.text)).toContain('好的，只做 CSV。')
      expect(await m.tool('a2a_ticket_handback', m.M, { trigger_id: handed, reason: '登录页不在本工单范围' })).toMatchObject({ ok: true, queued: true })
      await until(() => m.R.steered.some(t => t.includes('[superagent candidate]') && t.includes(handed)))
      // The router decides the handed-back message (one Eval per thread at a time).
      expect((await m.tool('superagent_route', m.R, { items: [{ trigger_id: handed, kind: 'ignore', reason: '另提需求再说' }] })).ok).toBe(true)
      expect(await m.tool('a2a_ticket_ack', m.O, { trigger_id: acked, text: 'x' })).toMatchObject({ ok: false, code: 'not-member' })

      // One more message arrives that the session never claims before the member reports ready in the same turn.
      claim = false
      const unread = await said('还有：按钮要蓝色')
      expect(await m.tool('a2a_ticket_report', m.M, { state: 'ready', summary: '完成：分支 ticket/x 提交 abc1234' })).toMatchObject({ ok: true })
      await until(() => m.R.steered.some(t => t.includes('[superagent candidate]') && t.includes(unread)))
      s = await m.state()
      expect(s.tickets.find((t: any) => t.id === ticketId).ended).toMatchObject({ outcome: 'completed' })
      const candidates = m.R.steered.filter(t => t.includes('[superagent candidate]'))
      expect(candidates.some(t => t.includes(acked))).toBe(false)
      expect(candidates.some(t => t.includes(read))).toBe(false)
      expect(candidates.some(t => t.includes(unread))).toBe(true)
    } finally { await m.dispose() }
  }, 30_000)
})
