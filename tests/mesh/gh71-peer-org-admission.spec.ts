/**
 * Issue #43 (same-zone cross-host caller): a zone/id8 handle that resolves
 * to NO local session is a cross-host member (two nodes sharing one zone
 * name). Its link record on THIS host is the canvas remote member ref the
 * operator added — the foreign-zone branch already honors that basis; the
 * same-zone path must too, or a linked remote member is refused as
 * teamless (production repro: the WSL node dispatching after PR#42 skip).
 * gh#71 (总工席 dispatch): the warm card cache peer canvasOrg joins the
 * same basis (双向识别), the probe face persists the full card, and the
 * TOOL-face team-scoped gate credits shared canvas + warm-org bases.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
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

import { bootNode, reservePort, type MeshNode } from './harness.ts'

const post = async (url: string, body?: unknown): Promise<Record<string, any>> =>
  await globalThis.fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => await r.json() as Record<string, any>)

function swapAgent(node: MeshNode, id: string, name: string): void {
  const agent = {
    id: SessionId(id),
    session: { events: [] as unknown[], title: name },
    steer(payload: unknown): void {
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
      const events = (agent as unknown as { session: { events: unknown[] } }).session.events
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `ok from ${name}: ${text}` }] } } })
      node.ctx.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
    },
  } as unknown as Agent & { session: { events: unknown[] } }
  node.agents.agent = agent
  node.ctx.emit('agent/created', { agent: agent as unknown as Agent })
}


class FakeMultiAgents extends Service {
  readonly agents: Agent[] = []
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): Agent { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return [...this.agents] }
  get(id: Agent['id']): Agent | undefined { return this.agents.find(a => a.id === id) }
}

type Mounted = {
  ctx: Context
  agents: FakeMultiAgents
  port: number
  dispose: () => Promise<void>
}

async function mount(canvas: Array<{ name: string; members: string[] }>, joined: string[]): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const agents = new FakeMultiAgents(ctx)
  const home = mkdtempSync(join(tmpdir(), 'a2a-i43-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'canvas.json'), JSON.stringify({ teams: canvas }), 'utf8')
  writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: joined }), 'utf8')
  apply(ctx, {
    apiKey: '',
    session: 'i43-test-node',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'i43 node',
    teamScopeRouting: true,
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0,
    wakeBootStaggerMs: 3_000,
    stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000,
    cardCacheNegativeTtlMs: 30_000,
    remoteRowsTtlMs: 15_000,
    dshHome: home,
    cardTtlMs: 172_800_000,
  } satisfies Config)
  return {
    ctx,
    agents,
    port: (ctx as unknown as { webServer: WebServer }).webServer.port,
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  while (mounted.length > 0) await (mounted.pop() as () => Promise<void>)()
  vi.unstubAllGlobals()
})

const LOCAL_MEMBER = 'session-0123456789abcdef'
const REMOTE_CALLER = 'dsh/cccccccc' // same-zone handle, NOT a local session

describe('issue #43 same-zone cross-host admission', () => {
  it('a same-zone handle listed as a canvas remote member clears admission and delivers to the local member', async () => {
    const m = await mount([{ name: '品味组', members: [LOCAL_MEMBER, REMOTE_CALLER] }], [LOCAL_MEMBER])
    mounted.push(m.dispose)
    const member = {
      id: SessionId(LOCAL_MEMBER),
      session: { events: [] as unknown[] },
      steer: vi.fn(),
    } as unknown as Agent & { steer: ReturnType<typeof vi.fn> }
    m.agents.agents.push(member)
    m.ctx.emit('agent/created', { agent: member })
    const res = await fetch(`http://127.0.0.1:${String(m.port)}/a2a/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: 'dsh/01234567', message: '建联：同 zone 跨节点成员', caller_session: REMOTE_CALLER, wait: false }),
    }).then(async r => await r.json() as Record<string, any>)
    expect(res.error).toBeUndefined()
    expect(res.delivered).toBe(true)
    expect(member.steer).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('a same-zone handle with NO canvas remote ref on this host is still refused as teamless', async () => {
    const m = await mount([{ name: '品味组', members: [LOCAL_MEMBER, REMOTE_CALLER] }], [LOCAL_MEMBER])
    mounted.push(m.dispose)
    const res = await fetch(`http://127.0.0.1:${String(m.port)}/a2a/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: 'dsh/01234567', message: '未链接的同 zone 外来者', caller_session: 'dsh/dddddddd', wait: false }),
    }).then(async r => await r.json() as Record<string, any>)
    expect(res.error).toContain('declares no team membership')
  }, 30_000)

  it('the remote-ref basis is target-scoped: the caller still cannot reach a session OUTSIDE the shared canvas team (F5)', async () => {
    const other = 'session-9999888877776666'
    const m = await mount([{ name: '品味组', members: [LOCAL_MEMBER, REMOTE_CALLER] }], [LOCAL_MEMBER, other])
    mounted.push(m.dispose)
    const first = { id: SessionId(LOCAL_MEMBER), session: { events: [] as unknown[] }, steer: vi.fn() } as unknown as Agent & { steer: ReturnType<typeof vi.fn> }
    const second = { id: SessionId(other), session: { events: [] as unknown[] }, steer: vi.fn() } as unknown as Agent & { steer: ReturnType<typeof vi.fn> }
    m.agents.agents.push(first, second)
    m.ctx.emit('agent/created', { agent: first })
    m.ctx.emit('agent/created', { agent: second })
    const toMember = await fetch(`http://127.0.0.1:${String(m.port)}/a2a/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: 'dsh/01234567', message: '成员可达', caller_session: REMOTE_CALLER, wait: false }),
    }).then(async r => await r.json() as Record<string, any>)
    expect(toMember.delivered).toBe(true)
    const toOutsider = await fetch(`http://127.0.0.1:${String(m.port)}/a2a/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: 'dsh/99998888', message: '非成员不可达', caller_session: REMOTE_CALLER, wait: false }),
    }).then(async r => await r.json() as Record<string, any>)
    expect(String(toOutsider.error)).toContain('shares no team with target')
    expect(second.steer).not.toHaveBeenCalled()
  }, 30_000)

  it('a group member dispatches to the CANVAS GROUP NAME (whole-group); a stranger to the group name is refused', { timeout: 30_000 }, async () => {
    const m = await mount([{ name: '品味组', members: [LOCAL_MEMBER, REMOTE_CALLER] }], [LOCAL_MEMBER])
    mounted.push(m.dispose)
    const member = { id: SessionId(LOCAL_MEMBER), session: { events: [] as unknown[] }, steer: vi.fn() } as unknown as Agent & { steer: ReturnType<typeof vi.fn> }
    m.agents.agents.push(member)
    m.ctx.emit('agent/created', { agent: member })

    // 66abc2cf defect pin: the remote caller (a 品味组 member by THIS host's
    // canvas record) addresses the GROUP NAME — whole-group dispatch. The
    // tool-face gate must credit the group the same way the picker does
    // (members.includes(team) never matches a canvas group-name string;
    // canvasTeamOf(name) === team is the match).
    const toGroup = await fetch(`http://127.0.0.1:${String(m.port)}/a2a/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: 'dsh/canvas/品味组', message: '整组派发', caller_session: REMOTE_CALLER, wait: false }),
    }).then(async r => await r.json() as Record<string, any>)
    expect(toGroup.error).toBeUndefined()
    expect(toGroup.delivered).toBe(true)
    expect(member.steer).toHaveBeenCalledTimes(1)

    // Negative control: a handle in NO group cannot ride the group name.
    const stranger = await fetch(`http://127.0.0.1:${String(m.port)}/a2a/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: 'dsh/canvas/品味组', message: '非组员整组派发', caller_session: 'dsh/dddddddd', wait: false }),
    }).then(async r => await r.json() as Record<string, any>)
    expect(String(stranger.error)).toBeDefined()
    expect(member.steer).toHaveBeenCalledTimes(1)
  }, 30_000)
})

describe('gh#71 probe full-face persist (fix ①)', () => {
  it('a probe sweep persists the peer full card (canvasOrg readable from state) without any prior directory sweep', { timeout: 30_000 }, async () => {
    const portP = await reservePort()
    const portQ = await reservePort()
    const p = await bootNode({ name: 'P', session: 'mesh-gh71-p', team: 'dsh', sessionNodes: true, port: portP, peers: [`http://127.0.0.1:${String(portQ)}`], teamScopeInfo: false, cardCacheTtlMs: 10_000 })
    const q = await bootNode({ name: 'Q', session: 'mesh-gh71-q', team: 'dsh', sessionNodes: true, port: portQ, peers: [`http://127.0.0.1:${String(portP)}`] })
    try {
      swapAgent(p, 'session-eeee5555zzzz0000', 'P-探针席')
      swapAgent(q, 'session-dddd4444zzzz0000', 'Q-目标席')
      expect((await post(`${p.baseUrl}/__dsh_a2a/join`, { id: 'session-eeee5555zzzz0000' })).team).toBe('dsh/eeee5555')
      expect((await post(`${q.baseUrl}/__dsh_a2a/join`, { id: 'session-dddd4444zzzz0000' })).team).toBe('dsh/dddd4444')
      expect((await post(`${q.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '探针组' })).ok).toBe(true)
      expect((await post(`${q.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '探针组', id: 'dsh/dddd4444' })).ok).toBe(true)
      const probeTool = p.ctx.tools.get('a2a_probe')
      const agentP = (p as unknown as { agents: { agent: unknown } }).agents.agent
      const probe = await probeTool?.execute({}, { signal: new AbortController().signal, agent: agentP } as never) as Record<string, any>
      expect(probe?.ok).toBe(true)
      let sawOrg = false
      for (let i = 0; i < 10 && !sawOrg; i += 1) {
        const pState = await post(`${p.baseUrl}/__dsh_a2a/state`)
        const rows = (pState.peerOrg ?? []) as Array<{ url: string; org: Array<{ name: string }> }>
        const row = rows.find((r: { url: string }) => r.url === `http://127.0.0.1:${String(portQ)}`)
        sawOrg = row?.org.some(t => t.name === '探针组') === true
        if (!sawOrg) await new Promise(resolve => setTimeout(resolve, 300))
      }
      expect(sawOrg).toBe(true)
    } finally {
      await p.dispose()
      await q.dispose()
    }
  })
})