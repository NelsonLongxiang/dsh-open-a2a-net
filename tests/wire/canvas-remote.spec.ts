/**
 * Canvas team remote-member routing (0.6.6): a canvas team whose members are
 * zone-qualified remote handles (zone/id8) fails over from the local tiers to
 * the directory walk per remote member, dispatches to the publishing peer with
 * the MEMBER handle (not the canvas team name), keys the owed-task ledger to
 * the canvas team the caller named, and reports honest exhaustion when no
 * peer publishes the member handle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
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
  port: number
  dispose: () => Promise<void>
}

async function mount(canvas: Array<{ name: string; members: string[] }>): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  new FakeMultiAgents(ctx)
  const home = mkdtempSync(join(tmpdir(), 'a2a-canvas-remote-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'canvas.json'), JSON.stringify({ teams: canvas }), 'utf8')
  apply(ctx, {
    apiKey: '',
    session: 'canvas-remote-test',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'canvas remote node',
    peers: ['http://peer-x'],
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
    port: (ctx as unknown as { webServer: WebServer }).webServer.port,
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  while (mounted.length > 0) await (mounted.pop() as () => Promise<void>)()
  vi.unstubAllGlobals()
})

const noAgent = (): ToolRunContext => ({ signal: new AbortController().signal } as unknown as ToolRunContext)

const MEMBER_HANDLE = 'nel157/a1b2c3d4'

describe('canvas team remote-member routing', () => {
  it('dispatches to the publishing peer with the member handle; the ledger keys the canvas team', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { signCard } = await import('../../src/card.ts')
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = {
      ...signCard({ name: 'remote node', session: 'sess-r', team: 'nel157', capabilities: { route: true, async: true }, expiresAt: Date.now() + 60_000 }, privateKey),
      sessionTeams: [{ team: MEMBER_HANDLE, name: 'remote-agent', description: 'remote session team' }],
    }
    const posted: Array<{ url: string; body: Record<string, unknown> }> = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
      if (url === 'http://peer-x/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
      }
      if (url === 'http://peer-x/a2a/direct' && init?.method === 'POST') {
        posted.push({ url, body: JSON.parse(init.body ?? '{}') as Record<string, unknown> })
        const requestId = (posted[posted.length - 1]!.body.task_id ?? '') as string
        return Promise.resolve({
          ok: true, status: 200,
          text: async () => JSON.stringify({ routed: true, delivered: true, task_id: requestId, context_id: 'ctx-r1' }),
        } as unknown as Response)
      }
      return realFetch(url, init as never)
    })
    const m = await mount([{ name: 'ops', members: [MEMBER_HANDLE] }])
    mounted.push(m.dispose)

    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh/canvas/ops', message: 'remote round', async: true }, noAgent()) as { ok: boolean; team?: string; reply?: string; task_id?: string }

    // The peer request carried the MEMBER handle — the canvas team name never
    // leaves this host as a routing target.
    expect(posted.length).toBe(1)
    expect(posted[0]!.body.team).toBe(MEMBER_HANDLE)
    // The caller sees the canvas team it named, and the peer's reply.
    expect(result.ok).toBe(true)
    expect(result.team).toBe('dsh/canvas/ops')
    expect(result.reply).toContain('Delivered to ' + MEMBER_HANDLE + ' (async)')
    // The owed-task ledger keys the canvas team (not the member handle).
    const tasks = await m.ctx.tools.get('a2a_tasks')!.execute({}, noAgent()) as { tasks: Array<{ taskId: string; team: string; peer: string; status: string }> }
    const owed = tasks.tasks.find(task => task.taskId === result.task_id)
    expect(owed).toBeDefined()
    expect(owed!.team).toBe('dsh/canvas/ops')
    expect(owed!.peer).toBe('http://peer-x')
  })

  it('reports honest exhaustion when no peer publishes the member handle', async () => {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (url === 'http://peer-x/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: false, status: 404, text: async () => 'no card' } as unknown as Response)
      }
      return realFetch(url, init as never)
    })
    const m = await mount([{ name: 'ops', members: [MEMBER_HANDLE] }])
    mounted.push(m.dispose)

    const route = m.ctx.tools.get('a2a_route')
    const result = await route!.execute({ team: 'dsh/canvas/ops', message: 'nobody home' }, noAgent()) as { ok: boolean; error?: string }

    expect(result.ok).toBe(false)
    expect(result.error).toContain('dsh/canvas/ops')
    expect(result.error).toContain('no live or wakeable local member')
  })
})
