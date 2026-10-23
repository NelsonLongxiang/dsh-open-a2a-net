// @vitest-environment node
/**
 * gh#26 / F5: same-host admission needs a TARGET-level intersection — a
 * canvas-group member must not reach ANOTHER group's session teams. Four
 * acceptance pins (attribute-owner ruling):
 *   ① cross-group refused, refusal text names the target-level gap;
 *   ② same-group passes;
 *   ③ the PROCESS face (config.team) keeps the host-level exemption;
 *   ④ the refusal text is accurate (declared vs target links).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
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

class TwoRootAgentsService extends Service {
  map = new Map<string, Agent>()

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return [...this.map.values()]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.map.get(String(id))
  }
}

interface RelayAgent extends Agent { steerCalls: unknown[]; host?: Context }

function makeAgent(id: string, name: string): RelayAgent {
  const agent = {
    id: SessionId(id),
    session: { events: [] as unknown[], title: name },
    steerCalls: [] as unknown[],
    steer(payload: unknown): void {
      agent.steerCalls.push(payload)
      const message = typeof payload === 'object' && payload !== null && 'content' in (payload as Record<string, unknown>)
        ? ((payload as { content: Array<{ text?: string }> }).content ?? []).map(block => String(block.text ?? '')).join(' ')
        : String(payload)
      const events = (agent as unknown as { session: { events: unknown[] } }).session.events
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `answered ${name}: ${message.slice(0, 30)}` }] } } })
      agent.host?.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
    },
  } as unknown as RelayAgent
  return agent
}

interface Mounted { ctx: Context; port: number; a: RelayAgent; b: RelayAgent; c: RelayAgent; dispose: () => Promise<void> }

async function mount(): Promise<Mounted> {
  const home = mkdtempSync(join(tmpdir(), 'a2a-f5-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(TwoRootAgentsService)
  const agents = ctx.get('agents') as unknown as TwoRootAgentsService
  // a: 本项目组 (canvas group-1). b: ygl 组 (canvas group-2). c: same group as a.
  const a = makeAgent('session-aaaaaaaa11111111', '本项目-A')
  const b = makeAgent('session-bbbbbbbb22222222', 'ygl-B')
  const c = makeAgent('session-cccccccc33333333', '本项目-C')
  for (const agent of [a, b, c]) { agents.map.set(String(agent.id), agent); agent.host = ctx }
  apply(ctx, {
    apiKey: '',
    session: 'host-f5',
    team: 'dsh',
    routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: 'f5-host',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    dshHome: home,
    cardTtlMs: 172_800_000,
    // allowlist must permit the canvas groups' join gestures; canvas
    // membership itself is add-member direct.
    teamJoinAllowlist: ['*'],
  } as Config)
  for (const agent of [a, b, c]) ctx.emit('agent/created', { agent: agent as unknown as Agent })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  const post = async (path: string, body: unknown): Promise<number> => {
    const res = await globalThis.fetch(`http://127.0.0.1:${String(port)}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return res.status
  }
  for (const agent of [a, b, c]) {
    expect(await post('/__dsh_a2a/join', { id: String(agent.id) })).toBe(200)
  }
  // Two canvas groups: 本项目组 (a, c) / ygl (b).
  expect(await post('/__dsh_a2a/canvas', { action: 'add-member', name: '本项目组', id: String(a.id) })).toBe(200)
  expect(await post('/__dsh_a2a/canvas', { action: 'add-member', name: '本项目组', id: String(c.id) })).toBe(200)
  expect(await post('/__dsh_a2a/canvas', { action: 'add-member', name: 'ygl', id: String(b.id) })).toBe(200)
  return { ctx, port, a, b, c, dispose: async () => { await ctx.fiber.dispose() } }
}

const execAs = (agent: Agent) => ({ signal: new AbortController().signal, agent }) as never

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('gh#26 F5: target-level same-host admission', () => {
  it('① cross-group refused with the target-level reason; ② same-group passes; ③ process face keeps the host-level exemption', async () => {
    const m = await mount()
    try {
      // ① 本项目组 member → ygl session team: REFUSED, reason names the
      // target-level gap (declared vs target links).
      const cross = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/bbbbbbbb', message: '跨组' }, execAs(m.a)) as { ok: boolean; error?: string }
      expect(cross?.ok).toBe(false)
      expect(String(cross?.error)).toContain('shares no team with target')
      expect(String(cross?.error)).toContain('target links')
      expect(m.b.steerCalls).toHaveLength(0)
      // ② same-group (本项目-C): passes.
      const same = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/cccccccc', message: '组内' }, execAs(m.a)) as { ok: boolean }
      expect(same?.ok).toBe(true)
      expect(m.c.steerCalls.length).toBeGreaterThan(0)
      // ③ process face: the owner face keeps the host-level exception —
      // any shared team clears it, and a group member can address it.
      const proc = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh', message: '进程队面' }, execAs(m.a)) as { ok: boolean; error?: string }
      expect(String(proc?.error ?? '')).not.toContain('shares no team with target')
    } finally {
      await m.dispose()
    }
  }, 30_000)

  it('④ refusal text is accurate: declared [本项目组], target links [ygl]', async () => {
    const m = await mount()
    try {
      const cross = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/bbbbbbbb', message: '文案' }, execAs(m.a)) as { ok: boolean; error?: string }
      expect(String(cross?.error)).toContain('shares no team with target "dsh/bbbbbbbb"')
      expect(String(cross?.error)).toContain('dsh/canvas/本项目组')
      expect(String(cross?.error)).toContain('dsh/canvas/ygl')
    } finally {
      await m.dispose()
    }
  }, 30_000)
})
