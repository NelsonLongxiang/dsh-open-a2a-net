// @vitest-environment node
/**
 * gh#39 (owner ruling): the a2a_teams listing ADVERTISES targets — an
 * exposed node id invites a session with no collaboration relationship to
 * route at it (the AGENTS seat saw dsh/e9a87677 listed and targeted it).
 * With teamScopeInfo on (default), [this host] session rows now follow the
 * CALLER's collaboration circle; the host's own GUI plane stays full.
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

class FakeAgentsService extends Service {
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

interface Mounted { ctx: Context; port: number; a: Agent; b: Agent; c: Agent; tools: <T>(name: string, args: unknown, agent?: Agent) => Promise<T>; dispose: () => Promise<void> }

async function mount(scopeInfo: boolean): Promise<Mounted> {
  const home = mkdtempSync(join(tmpdir(), 'gh39-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  const mk = (id: string, title: string): Agent => ({ id: SessionId(id), session: { title } }) as unknown as Agent
  const a = mk('session-aaaaaaaa11111111', '邀请方-A')
  const b = mk('session-bbbbbbbb22222222', '同队-B')
  const c = mk('session-cccccccc33333333', '陌生-C')
  for (const agent of [a, b, c]) { agents.map.set(String(agent.id), agent) }
  apply(ctx, {
    apiKey: '',
    session: 'host-gh39',
    team: 'dsh',
    routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: 'gh39-host',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    dshHome: home,
    cardTtlMs: 172_800_000,
    teamJoinAllowlist: ['*'],
    teamScopeInfo: scopeInfo,
  } as Config)
  for (const agent of [a, b, c]) ctx.emit('agent/created', { agent })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  const tools = async <T>(name: string, args: unknown, agent?: Agent): Promise<T> =>
    await ctx.tools.get(name)?.execute(args, { signal: new AbortController().signal, ...(agent !== undefined ? { agent } : {}) } as never) as T
  // Join + compose: A and B share canvas 'shared'; C is in none of A's circles.
  for (const agent of [a, b, c]) {
    await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(agent.id) }),
    })).json()
  }
  for (const id of [String(a.id), String(b.id)]) {
    await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/canvas`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', name: 'shared' }),
    })).json()
    await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/canvas`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add-member', name: 'shared', id }),
    })).json()
  }
  return { ctx, port, a, b, c, tools, dispose: async () => { await ctx.fiber.dispose() } }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('gh#39 teams listing follows the caller circle', () => {
  it('scoped: A sees the process team, own row, own canvas, and B (shared canvas) — C is withheld with a note', async () => {
    const m = await mount(true)
    try {
      const listed = await m.tools<{ ok: boolean; teams: Array<{ team: string; name?: string }>; note?: string }>('a2a_teams', {}, m.a)
      const names = listed.teams.map(t => t.team)
      expect(names).toContain('dsh') // process team
      expect(names).toContain('dsh/aaaaaaaa') // own row
      expect(names).toContain('dsh/canvas/shared') // own canvas
      expect(names).toContain('dsh/bbbbbbbb') // shared-canvas peer
      expect(names).not.toContain('dsh/cccccccc') // stranger withheld
      expect(listed.note).toContain('local')
      expect(listed.note).toContain('collaboration circle')
    } finally {
      await m.dispose()
    }
  }, 30_000)

  it('open plane (teamScopeInfo: false): A sees every local session row', async () => {
    const m = await mount(false)
    try {
      const listed = await m.tools<{ ok: boolean; teams: Array<{ team: string }>; note?: string }>('a2a_teams', {}, m.a)
      const names = listed.teams.map(t => t.team)
      expect(names).toContain('dsh/cccccccc') // the stranger is listed on the open plane
      expect(listed.note).toBeUndefined()
    } finally {
      await m.dispose()
    }
  }, 30_000)
})
