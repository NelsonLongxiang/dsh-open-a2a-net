/**
 * Quick dispatch (0.6.9, L3): POST /__dsh_a2a/dispatch is the workbench's
 * host-face ingress — a human sends one message to a routing team without
 * opening a session. It rides the same trunk as a2a_route with no agent:
 * the agent-less audit gate applies, the caller label is the bare node team,
 * and delivery semantics (local tiers → canvas remote seam → directory walk)
 * are identical by construction. These specs pin the control-plane shape:
 * local delivery, remote-member failover, the trust window, the message cap,
 * the per-client rate limit, and the gateAgentLessCalls refuse mode.
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

async function mount(canvas: Array<{ name: string; members: string[] }>, extra: Partial<Config> = {}, joined: string[] = []): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const agents = new FakeMultiAgents(ctx)
  const home = mkdtempSync(join(tmpdir(), 'a2a-quick-dispatch-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  if (canvas.length > 0) writeFileSync(join(home, 'a2a', 'canvas.json'), JSON.stringify({ teams: canvas }), 'utf8')
  if (joined.length > 0) writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: joined }), 'utf8')
  apply(ctx, {
    apiKey: '',
    session: 'quick-dispatch-test',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'quick dispatch node',
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
    ...extra,
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

function makeAgent(id: string): Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } } {
  return {
    id: SessionId(id),
    session: { events: [] },
    steer: vi.fn(() => {
      ;(undefined as unknown)
    }),
  } as unknown as Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } }
}

function goLive(m: Mounted, agent: Agent & { session: { events: unknown[] } }): void {
  m.agents.agents.push(agent)
  m.ctx.emit('agent/created', { agent })
}

const postJson = (port: number, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`http://127.0.0.1:${String(port)}${path}`, { method: 'POST', body: JSON.stringify(body), headers })

describe('quick dispatch control route (0.6.9)', () => {
  it('delivers to the live local member and books the ledger row keyed to the canvas team', async () => {
    const m = await mount([{ name: 'ops', members: [] }], {}, ['session-aaaabbbbccccdddd'])
    mounted.push(m.dispose)
    // A live session joined onto the canvas team through its session node id.
    const member = makeAgent('session-aaaabbbbccccdddd')
    goLive(m, member)
    // The canvas team gains the live member through the control route (the
    // same human gesture the workbench uses).
    const add = await postJson(m.port, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: 'session-aaaabbbbccccdddd' })
    expect((await add.json() as { ok?: boolean }).ok).toBe(true)

    const res = await postJson(m.port, '/__dsh_a2a/dispatch', { team: 'dsh/canvas/ops', message: 'quick hello' })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; team?: string; task_id?: string; task_status?: string; reply?: string }
    expect(body.ok).toBe(true)
    expect(body.team).toBe('dsh/canvas/ops')
    expect(body.task_id).toMatch(/^direct-/)
    // Async local delivery: the steer fired, the shape is the delivered one.
    expect(body.task_status).toBe('TASK_STATE_DELIVERED')
    expect(member.steer).toHaveBeenCalled()
    // The ledger row is keyed to the canvas team and visible to a2a_tasks.
    const tasks = await m.ctx.tools.get('a2a_tasks')!.execute({}, { signal: new AbortController().signal } as never) as { tasks: Array<{ taskId: string; team: string; sender?: unknown }> }
    const owed = tasks.tasks.find(task => task.taskId === body.task_id)
    expect(owed).toBeDefined()
    expect(owed!.team).toBe('dsh/canvas/ops')
    // #121: quick dispatch is the host's own gesture — bucketed under the
    // host process label; the live session team it borrows on the wire rides
    // apart as `face`, so the dispatch never lands in that session's seat.
    expect(owed!.sender).toEqual({ kind: 'host', id: 'quick-dispatch-test', face: 'dsh/aaaabbbb' })
  })

  it('fails over to a remote canvas member with the member handle on the wire', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { signCard } = await import('../../src/card.ts')
    const MEMBER_HANDLE = 'nel157/a1b2c3d4'
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = {
      ...signCard({ name: 'remote node', session: 'sess-r', team: 'nel157', capabilities: { route: true, async: true }, expiresAt: Date.now() + 60_000 }, privateKey),
      sessionTeams: [{ team: MEMBER_HANDLE, name: 'remote-agent', description: 'remote session team' }],
    }
    const posted: Array<Record<string, unknown>> = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
      if (url === 'http://peer-x/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
      }
      if (url === 'http://peer-x/a2a/direct' && init?.method === 'POST') {
        posted.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>)
        const requestId = posted[posted.length - 1]!.task_id as string
        return Promise.resolve({
          ok: true, status: 200,
          text: async () => JSON.stringify({ routed: true, delivered: true, task_id: requestId, context_id: 'ctx-r1' }),
        } as unknown as Response)
      }
      return realFetch(url, init as never)
    })
    const m = await mount([{ name: 'ops', members: [MEMBER_HANDLE] }], { peers: ['http://peer-x'] })
    mounted.push(m.dispose)

    const res = await postJson(m.port, '/__dsh_a2a/dispatch', { team: 'dsh/canvas/ops', message: 'remote quick' })
    const body = await res.json() as { ok: boolean; team?: string; task_id?: string }
    expect(body.ok).toBe(true)
    expect(body.team).toBe('dsh/canvas/ops')
    // The peer request carried the MEMBER handle and the host's bare team as
    // the caller (能发即能收): receipts can route back.
    expect(posted.length).toBe(1)
    expect(posted[0]!.team).toBe(MEMBER_HANDLE)
    expect(posted[0]!.caller_session).toBe('dsh')
  })

  it('takes the standard control-plane guard: wrong key 401, right key through', async () => {
    const m = await mount([], { apiKey: 'secret-123' })
    mounted.push(m.dispose)
    const refused = await postJson(m.port, '/__dsh_a2a/dispatch', { team: 'dsh', message: 'no key' })
    expect(refused.status).toBe(401)
    const wrong = await postJson(m.port, '/__dsh_a2a/dispatch', { team: 'dsh', message: 'bad key' }, { 'x-api-key': 'nope' })
    expect(wrong.status).toBe(401)
    // Right key passes the gate (the trunk then answers honestly — unknown
    // team, ok:false — but that is routing, not authorization).
    const allowed = await postJson(m.port, '/__dsh_a2a/dispatch', { team: 'dsh/no-such-team', message: 'with key' }, { 'x-api-key': 'secret-123' })
    expect(allowed.status).toBe(200)
    const body = await allowed.json() as { ok?: boolean }
    expect(body.ok).toBe(false)
  })

  it('enforces the message cap, required fields, and the per-client rate window', async () => {
    const m = await mount([])
    mounted.push(m.dispose)
    const missing = await postJson(m.port, '/__dsh_a2a/dispatch', { team: '', message: '' })
    expect(((await missing.json()) as { error?: string }).error).toContain('required')
    const over = await postJson(m.port, '/__dsh_a2a/dispatch', { team: 'dsh', message: 'x'.repeat(4001) })
    expect(((await over.json()) as { error?: string }).error).toContain('4000-char cap')
    // Rate window: two full-shape posts back to back from the same client —
    // the first reaches the routing trunk (unknown team, honest failure), the
    // second is refused by the window before the trunk.
    const first = await postJson(m.port, '/__dsh_a2a/dispatch', { team: 'dsh/no-such-team', message: 'first' })
    expect(((await first.json()) as { ok?: boolean }).ok).toBe(false)
    const second = await postJson(m.port, '/__dsh_a2a/dispatch', { team: 'dsh/no-such-team', message: 'second' })
    const body = await second.json() as { ok?: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('rate limited')
  })

  it('honors gateAgentLessCalls=refuse — the host face is a routing principal the owner can switch off', async () => {
    const m = await mount([{ name: 'ops', members: [] }], { gateAgentLessCalls: 'refuse' })
    mounted.push(m.dispose)
    const res = await postJson(m.port, '/__dsh_a2a/dispatch', { team: 'dsh/canvas/ops', message: 'refused' })
    const body = await res.json() as { ok?: boolean; error?: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('gateAgentLessCalls=refuse')
  })
})
