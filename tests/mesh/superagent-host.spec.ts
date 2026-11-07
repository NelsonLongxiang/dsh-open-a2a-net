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
const R_ID = 'session-a0000000aaaa1111', M_ID = 'session-b1111111bbbb2222', O_ID = 'session-c2222222cccc3333'
const execAs = (agent: Agent) => ({ signal: new AbortController().signal, agent }) as never
const until = async (f: () => boolean | Promise<boolean>, ms = 8000): Promise<void> => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return; await new Promise(r => setTimeout(r, 25)) } }

async function mount(home: string) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(ManyAgents)
  const agents = ctx.get('agents') as unknown as ManyAgents
  const [R, M, O] = [[R_ID, 'router'], [M_ID, 'member'], [O_ID, 'outsider']].map(([id, name]) => makeAgent(id!, name!))
  for (const a of [R!, M!, O!]) { agents.map.set(String(a.id), a); a.host = ctx }
  apply(ctx, { apiKey: '', session: 'host-sess', team: 'dsh', routeTimeoutMs: 5_000, flushTimeoutMs: 300_000, announce: true, agentName: 'sa-host', peers: [], delegates: [], sessionNodes: true, wakeJoinedOnBoot: false, dshHome: home, superagent: true } as unknown as Config)
  for (const a of [R!, M!, O!]) ctx.emit('agent/created', { agent: a as unknown as Agent })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  const post = async (path: string, body: unknown): Promise<Record<string, any>> => await (await globalThis.fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Record<string, any>
  const sa = async (body: unknown): Promise<Record<string, any>> => await post('/__dsh_a2a/superagent', body)
  const state = async (): Promise<Record<string, any>> => await (await globalThis.fetch(`http://127.0.0.1:${port}/__dsh_a2a/superagent`)).json() as Record<string, any>
  const tool = async (name: string, from: Agent, args: Record<string, unknown>): Promise<Record<string, any>> => await ctx.tools.get(name)!.execute(args, execAs(from)) as Record<string, any>
  for (const a of [R!, M!, O!]) await post('/__dsh_a2a/join', { id: String(a.id) })
  return { ctx, R: R!, M: M!, O: O!, post, sa, state, tool, dispose: async () => { await ctx.fiber.dispose() } }
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
})
