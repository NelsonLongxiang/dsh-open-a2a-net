/**
 * Team roster (S2/S4): the membership store's persistence bounds, the
 * allowlist-gated join/leave tools (default-deny with guidance), the state
 * face's roster view, and the card publishing member declarations.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../../src/index.ts'
import { envelopeFor } from './envelope.ts'
import { TeamMembershipStore } from '../../src/team-store.ts'

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
    originClaimWindow: true, // #64: fixture posts unsigned deliveries (production default is closed)
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
    teamJoinAllowlist: ['dsh/review-gate'],
    // teamScopeRouting rides the schema default (phase-2: true) — the
    // helper must not pin the old default over it.
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
/** Rosters can no longer be joined (owner ruling 2026-11-18); one declared before is seeded on disk, as an old host has it. */
function seedRosters(home: string, rosters: Record<string, readonly string[]>): void {
  const store = new TeamMembershipStore(join(home, 'a2a', 'teams.json'))
  for (const [id, teams] of Object.entries(rosters)) for (const team of teams) store.add(id, team)
}

async function mountHost(overrides: Partial<Config> = {}, rosters: Record<string, readonly string[]> = {}): Promise<{ ctx: Context; port: number; route: ToolDefinition | undefined }> {
  const home = mkdtempSync(join(tmpdir(), 'a2a-team-s3-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1'] }))
  seedRosters(home, rosters)
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

describe('roster self-join is retired (owner ruling 2026-11-18)', () => {
  it('no join or leave tool is registered; the board cannot create or grow a roster, only shrink one', async () => {
    const { ctx, port } = await mountHost({ teamJoinAllowlist: ['dsh/review-gate'] }, { 'agent-1': ['dsh/review-gate'] })
    expect(ctx.tools.get('a2a_team_join')).toBeUndefined()
    expect(ctx.tools.get('a2a_team_leave')).toBeUndefined()
    const op = async (body: Record<string, unknown>) => await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/roster-op`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as { ok: boolean; error?: string; members?: string[] }
    expect(await op({ op: 'create', name: 'fresh', ids: ['agent-1', 'agent-2'] })).toMatchObject({ ok: false, error: expect.stringContaining('retired') })
    expect(await op({ op: 'add-member', name: 'review-gate', id: 'agent-1' })).toMatchObject({ ok: false, error: expect.stringContaining('retired') })
    expect(await op({ op: 'remove-member', name: 'review-gate', id: 'agent-1' })).toMatchObject({ ok: true, members: [] })
    await ctx.fiber.dispose()
  })
})

describe('S3 team-scoped routing admission', () => {
  it('refuses a teamless session caller and a mismatched team when enforcement is on', async () => {
    const { ctx, route } = await mountHost({ teamScopeRouting: true })
    const exec = { agent: { id: SessionId('agent-1') } }
    const teamless = await route?.execute({ team: 'dsh/anything', message: 'q' }, exec) as { ok: boolean; error?: string }
    expect(teamless?.ok).toBe(false)
    expect(teamless?.error).toContain('has declared no team membership')
    await ctx.fiber.dispose()
    // A roster declared before the retirement still scopes the routing for one version.
    const seeded = await mountHost({ teamScopeRouting: true }, { 'agent-1': ['dsh/review-gate'] })
    const mismatched = await seeded.route?.execute({ team: 'dsh/other-team', message: 'q' }, exec) as { ok: boolean; error?: string }
    expect(mismatched?.ok).toBe(false)
    expect(mismatched?.error).toContain('requires declared membership')
    expect(mismatched?.error).toContain('dsh/review-gate')
    await seeded.ctx.fiber.dispose()
  })

  it('a member caller passes admission (fails later on resolution) and host-side callers stay exempt', async () => {
    const { ctx, route } = await mountHost({ teamScopeRouting: true, teamJoinAllowlist: ['dsh/nowhere-0000'] }, { 'agent-1': ['dsh/nowhere-0000'] })
    const exec = { agent: { id: SessionId('agent-1') } }
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

describe('roster capability flag (phase-2 flip prerequisite)', () => {
  it('the card advertises roster:true and directory/registry rows mark pre-roster peers legacy', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { signCard } = await import('../../src/card.ts')
    const { privateKey } = generateKeyPairSync('ed25519')
    // A pre-roster peer: capabilities without the roster flag.
    const legacyCard = {
      ...signCard({ name: 'old node', session: 'sess-o', team: 'peer', capabilities: { route: true, async: true }, expiresAt: Date.now() + 60_000 }, privateKey),
      sessionTeams: [{ team: 'peer/eeee0000', name: 'old-session', description: 'd' }],
    }
    // A current peer: roster flag present.
    const newCard = {
      ...signCard({ name: 'new node', session: 'sess-n', team: 'peer2', capabilities: { route: true, async: true, roster: true }, expiresAt: Date.now() + 60_000 }, privateKey),
      sessionTeams: [{ team: 'peer2/ffff0000', name: 'new-session', description: 'd' }],
    }
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (url === 'http://peer-old/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(legacyCard) } as unknown as Response)
      }
      if (url === 'http://peer-new/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(newCard) } as unknown as Response)
      }
      return realFetch(url, init as never)
    })
    const home = mkdtempSync(join(tmpdir(), 'a2a-cap-flag-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    apply(ctx, makeConfig({ peers: ['http://peer-old', 'http://peer-new'], dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    await vi.waitFor(async () => {
      const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as {
        remote: Array<{ team: string; legacy?: boolean }>
        registry: { nodes: Array<{ id: string; legacy?: boolean; remote?: boolean }> }
      }
      expect(state.remote.find(row => row.team === 'peer2/ffff0000')?.legacy).toBeUndefined()
      expect(state.remote.find(row => row.team === 'peer/eeee0000')?.legacy).toBe(true)
      expect(state.registry.nodes.find(node => node.id === 'peer2/ffff0000')?.legacy).toBeUndefined()
      expect(state.registry.nodes.find(node => node.id === 'peer/eeee0000')?.legacy).toBe(true)
    }, { timeout: 5_000 })
    // Our own served card carries the roster capability.
    const served = JSON.parse(await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).text()) as { capabilities?: { roster?: unknown } }
    expect(served.capabilities?.roster).toBe(true)
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
  })
})

describe('roster reader half (peer card teamMemberships)', () => {
  it('a2a_teams rows and the state remote/registry faces carry the peer roster declarations', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { signCard } = await import('../../src/card.ts')
    const { privateKey } = generateKeyPairSync('ed25519')
    // The unsigned serve-fresh members ride the signed core, exactly as the
    // card route assembles them at read time.
    const card = {
      ...signCard({ name: 'peer node', session: 'sess-p', team: 'peer', capabilities: {}, expiresAt: Date.now() + 60_000 }, privateKey),
      sessionTeams: [{ team: 'peer/aa11bb22', name: 'remote-1', description: 'a remote session' }],
      teamMemberships: [{ node: 'peer/aa11bb22', team: 'dsh/canvas/review-gate' }],
    }
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (url === 'http://peer-x/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
      }
      // Everything else (the state route polls inside waitFor) goes through.
      return realFetch(url, init as never)
    })
    const home = mkdtempSync(join(tmpdir(), 'a2a-team-reader-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    apply(ctx, makeConfig({ peers: ['http://peer-x'], dshHome: home }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port

    // Directory listing: the session-team row carries its declared roster.
    const listed = await ctx.tools.get('a2a_teams')?.execute({}, { agent: undefined } as never) as {
      ok: boolean; teams: Array<{ team: string; local?: boolean; teams?: readonly string[] }>
    }
    expect(listed.ok).toBe(true)
    const remoteRow = listed.teams.find(row => row.team === 'peer/aa11bb22')
    expect(remoteRow?.teams).toEqual(['dsh/canvas/review-gate'])
    // The peer's own process team row has no roster declaration.
    expect(listed.teams.find(row => row.team === 'peer')?.teams).toBeUndefined()

    // State faces: remote rows and registry nodes carry the same roster
    // (the refresh is a background sweep — poll until the window fills).
    await vi.waitFor(async () => {
      const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as {
        remote: Array<{ team: string; teams?: readonly string[] }>
        registry: { nodes: Array<{ id: string; teams?: readonly string[]; remote?: boolean }> }
      }
      expect(state.remote.find(row => row.team === 'peer/aa11bb22')?.teams).toEqual(['dsh/canvas/review-gate'])
      expect(state.registry.nodes.find(node => node.id === 'peer/aa11bb22' && node.remote === true)?.teams).toEqual(['dsh/canvas/review-gate'])
    }, { timeout: 5_000 })
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
  })
})

describe('S3 phase-3 enforcement (default-on + inbound shared-team admission)', () => {
  const mount = async (overrides: Partial<Config> = {}): Promise<{ ctx: Context; port: number }> => {
    const home = mkdtempSync(join(tmpdir(), 'a2a-s3-p3-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    const live = { id: SessionId('agent-1'), session: { events: [] }, steer: vi.fn() } as unknown as Agent
    agents.agent = live
    ctx.emit('agent/created', { agent: live })
    apply(ctx, makeConfig({ dshHome: home, ...overrides }))
    return { ctx, port: (ctx as unknown as { webServer: WebServer }).webServer.port }
  }
  const direct = async (port: number, team: string, caller: string): Promise<{ error?: string; routed?: boolean }> =>
    await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
      method: 'POST',
      body: JSON.stringify({ team, message: 'probe', caller_session: caller, wait: false }),
    })).json() as { error?: string; routed?: boolean }
  const joinNet = async (port: number): Promise<void> => {
    await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, { method: 'POST', body: JSON.stringify({ id: 'agent-1' }) })
  }
  const declareTeams = (home: string, session: string, teams: string[]): void => {
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'teams.json'), JSON.stringify({ memberships: [{ session, teams }] }))
  }

  // The schema default (teamScopeRouting: true) is injected by the loader
  // in production; unit tests pass it explicitly to simulate the
  // loader-resolved runtime config — see the three behavior tests below.

  const sessionId = 'session-abcdef12-0000-0000-0000-000000000000'
  const callerTeam = 'dsh/abcdef12'

  it('local unteamed caller is refused on the spot; declaring a shared team passes', async () => {
    // Round 1: no declarations on disk — the caller is teamless.
    const home = mkdtempSync(join(tmpdir(), 'a2a-s3-p3-local-'))
    const { ctx, port } = await mount({ teamScopeRouting: true, dshHome: home })
    await joinNet(port)
    const refused = await direct(port, callerTeam, callerTeam)
    // The caller is the joined node itself, but it declares nothing — a
    // teamless node has no network even against its own host.
    expect(refused.error).toContain('declares no team membership')
    await ctx.fiber.dispose()
    // Round 2: the caller declares this node's own network handle ('dsh',
    // the process team — a genuinely shared team), and the gate passes.
    const home2 = mkdtempSync(join(tmpdir(), 'a2a-s3-p3-local2-'))
    declareTeams(home2, sessionId, ['dsh'])
    const mounted = await mount({ teamScopeRouting: true, dshHome: home2 })
    await joinNet(mounted.port)
    const allowed = await direct(mounted.port, callerTeam, callerTeam)
    // The gate's verdict is what this test proves: the teamless refusal
    // must be gone once a shared team is declared. Whatever comes after
    // (dispatch-layer text) is out of scope here.
    expect(allowed.error ?? '').not.toContain('declares no team membership')
    expect(allowed.error ?? '').not.toContain('none is routable on this node')
    await mounted.ctx.fiber.dispose()
  })

  it('a local caller whose declared teams are foreign is refused with the shared-team text', async () => {
    const home = mkdtempSync(join(tmpdir(), 'a2a-s3-p3-foreign-'))
    // Declare only a foreign team BEFORE the mount: the caller IS teamed,
    // but none of its teams is routable here.
    declareTeams(home, sessionId, ['dsh/other-fleet'])
    const { ctx, port } = await mount({ teamScopeRouting: true, dshHome: home })
    await joinNet(port)
    // caller = the joined node itself; target = the process team, which
    // the foreign declaration does not unlock.
    const refused = await direct(port, 'dsh', callerTeam)
    expect(refused.error).toContain('none is routable on this node')
    await ctx.fiber.dispose()
  })

  it('a teamed local caller reaches its own shared team (permission half)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'a2a-s3-p3-allow-'))
    const { ctx, port } = await mount({ teamScopeRouting: true, dshHome: home })
    await joinNet(port)
    // gh#7 N3: admission reads THIS host's roster. The caller handle
    // dsh/agent-1 is a local joined node's pseudo-handle (id8 passes short
    // ids through) — declare the process team (always routable) for it so
    // the same-zone roster branch admits, then the dispatch layer answers
    // the honest self-route refusal.
    declareTeams(home, 'agent-1', ['dsh'])
    const allowed = await direct(port, 'dsh', 'dsh/agent-1')
    expect(allowed.error ?? '').not.toContain('declares no team membership')
    expect(allowed.error ?? '').not.toContain('none is routable on this node')
    expect(allowed.error ?? '').not.toContain('no operator-established link')
    expect(allowed.error ?? '').toContain('Self-route refused')
    await ctx.fiber.dispose()
  })

  it('gh#7 N3/V5: a remote caller is refused on first contact and after the sweep — its own card never admits it', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { signCard } = await import('../../src/card.ts')
    const { privateKey } = generateKeyPairSync('ed25519')
    // The remote node's card declares its session into the TARGET's own
    // team — the self-serve-admission shape (V5b). Under N3 the card is the
    // caller's claim about itself: no basis. Only an operator-added canvas
    // remote member ref admits a foreign-zone handle.
    const remoteCard = {
      ...signCard({ name: 'remote', session: 'sess-r', team: 'remote-zone', capabilities: { route: true, async: true, roster: true }, expiresAt: Date.now() + 60_000 }, privateKey),
      sessionTeams: [{ team: 'remote-zone/1234abcd', name: 'remote-session', description: 'd' }],
      teamMemberships: [{ node: 'remote-zone/1234abcd', team: 'dsh' }],
    }
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (url === 'http://peer-remote/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(remoteCard) } as unknown as Response)
      }
      return realFetch(url, init as never)
    })
    const home = mkdtempSync(join(tmpdir(), 'a2a-s3-p3-remote-'))
    const { ctx, port } = await mount({ teamScopeRouting: true, dshHome: home, peers: ['http://peer-remote'] })
    await joinNet(port)
    // First contact: no operator link exists — refused immediately. The
    // old fail-open window (learn-and-admit-once) is gone with N3.
    const first = await direct(port, callerTeam, 'remote-zone/1234abcd')
    expect(first.error ?? '').toContain('no operator-established link')
    // The sweep still learns the card (the directory row appears)…
    await vi.waitFor(async () => {
      const state = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { remote: Array<{ team: string }> }
      expect(state.remote.find(row => row.team === 'remote-zone/1234abcd')).toBeDefined()
    }, { timeout: 5_000 })
    // …but the learned card's team claims still do not admit the caller.
    const second = await direct(port, callerTeam, 'remote-zone/1234abcd')
    expect(second.error ?? '').toContain('no operator-established link')
    await ctx.fiber.dispose()
    vi.unstubAllGlobals()
  })
})

describe('a2a_teams output schema covers roster fields (!85 regression pin)', () => {
  it('the teams-row schema source declares legacy and teams so strict validation never rejects roster rows', async () => {
    // Behavioral proof already lives in the reader-half test (an execute
    // carrying legacy/teams rows passes strict validation). This pin reads
    // the schema source so a future field addition cannot silently skip
    // the output-schema declaration again (the 0.5.45 all-break defect).
    const { readFileSync } = await import('node:fs')
    // gh#77 B3-R moved the a2a_teams registration to src/tools/info.ts — the
    // pin follows the schema's new home (path-only change, same assertions).
    const source = readFileSync(join(process.cwd(), 'src', 'tools', 'info.ts'), 'utf8')
    const schemaStart = source.indexOf("name: 'a2a_teams'")
    const schemaSection = source.slice(schemaStart, source.indexOf('      presentCall:', schemaStart))
    expect(schemaSection).toContain('via:')
    expect(schemaSection).toContain('legacy:')
    expect(schemaSection).toContain('teams:')
  })
})

describe('discovery invisibility for unjoined sessions (owner ruling B)', () => {
  it('the served card advertises only joined session nodes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'a2a-invis-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    apply(ctx, makeConfig({ teamScopeRouting: true, dshHome: home, announce: true }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const card = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`, { headers: envelopeFor(home, port, 'dsh') })).json() as { sessionTeams?: Array<{ team: string }> }
    // No session in this bare harness joined the network: the card must not
    // advertise any session team (unjoined = invisible to peer discovery).
    expect((card.sessionTeams ?? []).length).toBe(0)
    await ctx.fiber.dispose()
  })
})

describe('a2a_whoami + structured join refusals (K3 feedback, 0.6.14)', () => {
  async function mountedWhoami(overrides: Partial<Config> = {}, rosters: Record<string, readonly string[]> = {}): Promise<{ ctx: Context; whoami: ToolDefinition | undefined }> {
    const home = mkdtempSync(join(tmpdir(), 'a2a-whoami-'))
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1'] }))
    seedRosters(home, rosters)
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
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    const live = { id: SessionId('agent-1'), session: { events: [] }, steer: vi.fn() } as unknown as Agent
    agents.agent = live
    ctx.emit('agent/created', { agent: live })
    return { ctx, whoami: ctx.tools.get('a2a_whoami') }
  }

  it('answers an UNJOINED session without any gate: joined=false, no handle, allowlist visible, initiator-face note', async () => {
    const { ctx, whoami } = await mountedWhoami()
    const answer = await whoami?.execute({}, { agent: { id: SessionId('agent-outside-0000-0000') } }) as {
      ok: boolean; face: string; node: { id: string; team?: string; joined: boolean; live: boolean }
      allowlist: { patterns: string[]; effect: string }; note: string
    }
    expect(answer?.ok).toBe(true)
    expect(answer?.face).toBe('session')
    expect(answer?.node.joined).toBe(false)
    expect(answer?.node.live).toBe(false)
    expect(answer?.node.team).toBeUndefined()
    expect(answer?.allowlist.patterns).toEqual(['dsh/review-gate'])
    expect(answer?.allowlist.effect).toBe('curated')
    expect(answer?.note).toContain('outbound routing still works')
    await ctx.fiber.dispose()
  })

  it('answers a joined node with handle and the roster teams declared before the retirement', async () => {
    const { ctx, whoami } = await mountedWhoami({}, { 'agent-1': ['dsh/review-gate'] })
    const answer = await whoami?.execute({}, { agent: { id: SessionId('agent-1') } }) as {
      node: { team?: string; joined: boolean; live: boolean }
      teams: { roster: string[]; canvas: string[] }
      lastRefusals: Array<{ team: string; reason: string }>
    }
    expect(answer?.node.joined).toBe(true)
    expect(answer?.node.live).toBe(true)
    // id8 passes short labels through ('agent-1') and hashes UUID-shaped ids —
    // the guarantee under test is the zone-qualified handle shape, not the tail.
    expect(answer?.node.team).toMatch(/^dsh\//)
    expect(answer?.teams.roster).toEqual(['dsh/review-gate'])
    expect(answer?.teams.canvas).toEqual([])
    await ctx.fiber.dispose()
  })

  it('host face answers with the bare node team (the 能发即能收 invariant)', async () => {
    const { ctx, whoami } = await mountedWhoami()
    const answer = await whoami?.execute({}, {}) as { ok: boolean; face: string; node: { team: string } }
    expect(answer?.face).toBe('host')
    expect(answer?.node.team).toBe('dsh')
    await ctx.fiber.dispose()
  })
})
