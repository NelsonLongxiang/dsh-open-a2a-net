/**
 * Team roster (S2/S4): the membership store's persistence bounds, the
 * allowlist-gated join/leave tools (default-deny with guidance), the state
 * face's roster view, and the card publishing member declarations.
 */
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../src/index.ts'
import { TeamMembershipStore } from '../src/team-store.ts'

class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return this.agent === undefined ? [] : [this.agent]
  }
}

/** One outbound-only config row with per-test overrides (defaults deny joins). */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '',
    session: 'sess-1',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: 'test node',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0,
    wakeBootStaggerMs: 3_000,
    wakeReconcile: false,
    wakeReconcileIntervalMs: 60_000,
    wakeReconcileBackoffBaseMs: 5_000,
    wakeReconcileMaxBackoffMs: 600_000,
    teamJoinAllowlist: ['dsh/canvas/*'],
    teamScopeRouting: false,
    stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000,
    cardCacheNegativeTtlMs: 30_000,
    remoteRowsTtlMs: 15_000,
    dshHome: '',
    cardTtlMs: 172_800_000,
    ...overrides,
  }
}

/** Module-level host mount for the S3 admission tests (route tool included). */
async function mountHost(overrides: Partial<Config> = {}): Promise<{ ctx: Context; port: number; join: ToolDefinition | undefined; route: ToolDefinition | undefined }> {
  const home = mkdtempSync(join(tmpdir(), 'a2a-team-s3-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1'] }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  ctx.provide('sessionPersistence', {
    list: async () => [{ id: SessionId('agent-1') }],
  } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
  apply(ctx, makeConfig({ dshHome: home, ...overrides }))
  // Mount agent-1 live so the join gate passes and the S3 assertions
  // exercise the team-scope layer, not the join gate.
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  const live = { id: SessionId('agent-1'), session: { events: [] }, steer: vi.fn() } as unknown as Agent
  agents.agent = live
  ctx.emit('agent/created', { agent: live })
  const port = (ctx as unknown as { webServer: WebServer }).webServer.port
  return {
    ctx,
    port,
    join: ctx.tools.get('a2a_team_join'),
    route: ctx.tools.get('a2a_route'),
  }
}

describe('team membership store', () => {
  it('adds idempotently, removes, drops sessions, and persists across instances', () => {
    const store = new TeamMembershipStore('')
    store.add('agent-1', 'dsh/canvas/review-gate')
    store.add('agent-1', 'dsh/canvas/review-gate')
    store.add('agent-1', 'dsh/canvas/ops-hotline')
    expect(store.teamsOf('agent-1')).toEqual(['dsh/canvas/review-gate', 'dsh/canvas/ops-hotline'])
    expect(store.membersOf('dsh/canvas/review-gate')).toEqual(['agent-1'])
    store.add('agent-2', 'dsh/canvas/review-gate')
    expect(store.membersOf('dsh/canvas/review-gate')).toEqual(['agent-1', 'agent-2'])
    store.remove('agent-1', 'dsh/canvas/review-gate')
    expect(store.teamsOf('agent-1')).toEqual(['dsh/canvas/ops-hotline'])
    store.dropSession('agent-1')
    expect(store.teamsOf('agent-1')).toEqual([])
    expect(store.list()).toEqual([{ session: 'agent-2', teams: ['dsh/canvas/review-gate'] }])
  })

  it('persists to disk and reloads well-formed snapshots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a2a-team-store-'))
    const path = join(dir, 'a2a', 'teams.json')
    const first = new TeamMembershipStore(path)
    first.add('agent-1', 'dsh/all-hands')
    expect(existsSync(path)).toBe(true)
    const second = new TeamMembershipStore(path)
    expect(second.teamsOf('agent-1')).toEqual(['dsh/all-hands'])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ memberships: [{ session: 'agent-1', teams: ['dsh/all-hands'] }] })
  })

  it('rejects malformed team names and enforces the per-node cap', () => {
    const store = new TeamMembershipStore('')
    store.add('agent-1', '')
    store.add('agent-1', '   ')
    expect(store.teamsOf('agent-1')).toEqual([])
    for (let index = 0; index < 20; index++) store.add('agent-1', `dsh/team-${String(index)}`)
    expect(store.teamsOf('agent-1')).toHaveLength(16)
  })
})

describe('a2a_team_join / a2a_team_leave tools', () => {
  async function mounted(overrides: Partial<Config> = {}): Promise<{ ctx: Context; port: number; join: ToolDefinition | undefined; leave: ToolDefinition | undefined; route: ToolDefinition | undefined }> {
    const home = mkdtempSync(join(tmpdir(), 'a2a-team-tools-'))
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1'] }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', {
      list: async () => [{ id: SessionId('agent-1') }],
    } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
    apply(ctx, makeConfig({ dshHome: home, ...overrides }))
    // Mount agent-1 live: a mounted joined session passes the join gate, so
    // the S3 assertions exercise the team-scope layer, not the join gate.
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    const live = { id: SessionId('agent-1'), session: { events: [] }, steer: vi.fn() } as unknown as Agent
    agents.agent = live
    ctx.emit('agent/created', { agent: live })
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    return {
      ctx,
      port,
      join: ctx.tools.get('a2a_team_join'),
      leave: ctx.tools.get('a2a_team_leave'),
      route: ctx.tools.get('a2a_route'),
    }
  }

  it('default-deny joins with guidance, allowlisted joins land in store, state, and card', async () => {
    const { ctx, port, join } = await mounted()
    const refused = await join?.execute({ team: 'dsh/private-ops', id: 'agent-1' }, {}) as { ok: boolean; error?: string }
    expect(refused?.ok).toBe(false)
    expect(refused?.error).toContain('teamJoinAllowlist')
    const ok = await join?.execute({ team: 'dsh/canvas/review-gate', id: 'agent-1' }, {}) as { ok: boolean; teams?: string[] }
    expect(ok?.ok).toBe(true)
    expect(ok?.teams).toEqual(['dsh/canvas/review-gate'])
    const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as {
      registry: {
        teams: Array<{ team: string; members: string[]; live: number }>
        nodes: Array<{ id: string; teams: string[]; zone: string }>
      }
    }
    expect(state.registry.teams).toEqual([{ team: 'dsh/canvas/review-gate', members: ['agent-1'], live: 1 }])
    expect(state.registry.nodes.find(node => node.id === 'agent-1')).toMatchObject({ teams: ['dsh/canvas/review-gate'], zone: 'dsh' })
    const card = JSON.parse(await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).text()) as {
      teamMemberships?: Array<{ node: string; team: string }>
    }
    expect(card.teamMemberships).toHaveLength(1)
    expect(card.teamMemberships?.[0]?.team).toBe('dsh/canvas/review-gate')
    expect(card.teamMemberships?.[0]?.node).toBe('dsh/agent-1')
    await ctx.fiber.dispose()
  })

  it('refuses joins for unknown nodes, duplicate noise is idempotent, and leave retracts', async () => {
    const { ctx, join, leave } = await mounted({ teamJoinAllowlist: ['*'] })
    const unknown = await join?.execute({ team: 'dsh/anything', id: 'session-ghost-0000-0000-0000-000000000000' }, {}) as { ok: boolean; error?: string }
    expect(unknown?.ok).toBe(false)
    expect(unknown?.error).toContain('not a joined node')
    const first = await join?.execute({ team: 'dsh/anything', id: 'agent-1' }, {}) as { ok: boolean }
    expect(first?.ok).toBe(true)
    const left = await leave?.execute({ team: 'dsh/anything', id: 'agent-1' }, {}) as { ok: boolean; teams?: string[] }
    expect(left?.ok).toBe(true)
    expect(left?.teams).toEqual([])
    const again = await leave?.execute({ team: 'dsh/anything', id: 'agent-1' }, {}) as { ok: boolean; error?: string }
    expect(again?.ok).toBe(false)
    expect(again?.error).toContain('nothing to leave')
    await ctx.fiber.dispose()
  })
})

describe('S3 team-scoped routing admission', () => {
  it('refuses a teamless session caller and a mismatched team when enforcement is on', async () => {
    const { ctx, join, route, port } = await mountHost({ teamScopeRouting: true })
    const probe = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { sessions: Array<{ id: string; live?: boolean; joined?: boolean }> }
    console.log('PROBE sessions:', JSON.stringify(probe.sessions))
    const exec = { agent: { id: SessionId('agent-1') } }
    const teamless = await route?.execute({ team: 'dsh/anything', message: 'q' }, exec) as { ok: boolean; error?: string }
    expect(teamless?.ok).toBe(false)
    expect(teamless?.error).toContain('has declared no team membership')
    const joined = await join?.execute({ team: 'dsh/canvas/review-gate', id: 'agent-1' }, {}) as { ok: boolean }
    expect(joined?.ok).toBe(true)
    const mismatched = await route?.execute({ team: 'dsh/other-team', message: 'q' }, exec) as { ok: boolean; error?: string }
    expect(mismatched?.ok).toBe(false)
    expect(mismatched?.error).toContain('requires declared membership')
    expect(mismatched?.error).toContain('dsh/canvas/review-gate')
    await ctx.fiber.dispose()
  })

  it('a member caller passes admission (fails later on resolution) and host-side callers stay exempt', async () => {
    const { ctx, join, route } = await mountHost({ teamScopeRouting: true, teamJoinAllowlist: ['*'] })
    const exec = { agent: { id: SessionId('agent-1') } }
    const declared = await join?.execute({ team: 'dsh/nowhere-0000', id: 'agent-1' }, {}) as { ok: boolean }
    expect(declared?.ok).toBe(true)
    // Admission passes; dispatch then fails the normal resolution way —
    // the scope gate must not be the error a member sees.
    const routed = await route?.execute({ team: 'dsh/nowhere-0000', message: 'q' }, exec) as { ok: boolean; error?: string }
    expect(routed?.ok).toBe(false)
    expect(routed?.error).toContain('not published by any configured peer')
    // Host-side callers (no agent) stay exempt like the join gate.
    const hostSide = await route?.execute({ team: 'dsh/nowhere-0000', message: 'q' }, {}) as { ok: boolean; error?: string }
    expect(hostSide?.ok).toBe(false)
    expect(hostSide?.error).toContain('not published by any configured peer')
    await ctx.fiber.dispose()
  })

  it('enforcement off (default): a teamless session caller is not scope-refused', async () => {
    const { ctx, route } = await mountHost({})
    const exec = { agent: { id: SessionId('agent-1') } }
    const routed = await route?.execute({ team: 'dsh/nowhere-0000', message: 'q' }, exec) as { ok: boolean; error?: string }
    expect(routed?.ok).toBe(false)
    expect(routed?.error).toContain('not published by any configured peer')
    await ctx.fiber.dispose()
  })
})
