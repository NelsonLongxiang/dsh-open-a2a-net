/**
 * Issue #43 (same-zone cross-host caller): a zone/id8 handle that resolves
 * to NO local session is a cross-host member (two nodes sharing one zone
 * name). Its link record on THIS host is the canvas remote member ref the
 * operator added — the foreign-zone branch already honors that basis; the
 * same-zone path must too, or a linked remote member is refused as
 * teamless (production repro: the WSL node's dsh/b1d74c97 dispatching to
 * the taste group after PR#42's initiator skip correctly falls through to
 * the remote leg, and the target host refuses the delivery).
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

    // The inbound wire face with a same-zone caller that is NOT a local
    // session: no envelope (inside the originClaimWindow it walks on with a
    // counted warn), so the admission core is exactly what decides.
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
      body: JSON.stringify({ team: 'dsh/01234567', message: '未链接的同 zone 外来者', caller_session: 'dsh/dddddddd', wait: false }),
    }).then(async r => await r.json() as Record<string, any>)
    expect(res.error).toContain('declares no team membership')
    expect(member.steer).not.toHaveBeenCalled()
  }, 30_000)

  it('the remote-ref basis is target-scoped: the caller still cannot reach a session OUTSIDE the shared canvas team (F5)', async () => {
    // Two local sessions; the canvas team holds only the first. The remote
    // caller must reach the member but be refused for the non-member.
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
})
