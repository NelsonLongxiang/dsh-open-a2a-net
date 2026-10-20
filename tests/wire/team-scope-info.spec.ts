/**
 * S5 (teamScopeInfo, owner directive 2026-10-20): information-plane scoping.
 * The read-only fleet tools (a2a_teams / a2a_status / a2a_probe) disclose
 * remote facts only inside the host's joined-team scope — the union of
 * local roster declarations (`a2a/teams.json`). [this host] rows, local
 * traffic, and a2a_tasks (own ledger, unscoped by ruling) stay. The open
 * plane remains supported at teamScopeInfo: false.
 *
 * Unit configs are literals (apply takes them as-is); the schema default
 * is injected by the loader in production, so scoped behavior tests pass
 * teamScopeInfo: true explicitly — the default itself is pinned by the
 * source assertion in the first test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import { generateKeyPairSync } from 'node:crypto'
import { signCard } from '../../src/card.ts'
import { apply, type Config } from '../../src/index.ts'

/** Minimal agents face: one settable live root; no initiator fiber. */
class FakeAgentsService extends Service {
  agent: unknown
  constructor(ctx: Context) {
    super(ctx, 'agents')
  }
  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }
  roots(): unknown[] {
    return this.agent === undefined ? [] : [this.agent]
  }
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '', session: 'sess-1', team: 'home-zone', routeTimeoutMs: 60_000, flushTimeoutMs: 300_000,
    announce: false, agentName: 'test node', peers: [], delegates: [], sessionNodes: false,
    wakeJoinedOnBoot: false, stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000, cardTtlMs: 172_800_000,
    dshHome: '', ...overrides,
  } as Config
}

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-a2a-scope-'))
}

/** Seed `<home>/a2a/teams.json` before the mount — the store restores it. */
function declareTeams(home: string, session: string, teams: string[]): void {
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'teams.json'), JSON.stringify({ memberships: [{ session, teams }] }))
}

function runContext(): { signal: AbortSignal } {
  return { signal: new AbortController().signal } as { signal: AbortSignal }
}

interface TeamRow { team: string; local?: boolean; teams?: string[] }

describe('S5 information-plane scoping (teamScopeInfo)', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The fleet used by the behavior tests: peer-a publishes two session
  // teams (cargo, dock) with a roster declaration hanging cargo off the
  // dock team; peer-b's hub node declared membership in the joined dock
  // team; peer-c is a legacy pre-roster zone. With the local node joined
  // to 'zone-a/dock': dock survives directly (row.team), cargo and hub
  // survive via their roster declarations (row.teams), and everything
  // else (process rows, the legacy zone) is out of scope.
  const key = generateKeyPairSync('ed25519')
  const wireCards = {
    'http://peer-a': {
      ...signCard({ name: 'peer-a', session: 'peer-host-a', team: 'zone-a', capabilities: { roster: true }, expiresAt: Date.now() + 3_600_000 }, key.privateKey),
      sessionTeams: [
        { team: 'zone-a/cargo', name: 'cargo seat', description: 'cargo work' },
        { team: 'zone-a/dock', name: 'dock seat', description: 'dock work' },
      ],
      teamMemberships: [{ node: 'zone-a/cargo', team: 'zone-a/dock' }],
    },
    'http://peer-b': {
      ...signCard({ name: 'peer-b', session: 'peer-host-b', team: 'zone-b', capabilities: { roster: true }, expiresAt: Date.now() + 3_600_000 }, key.privateKey),
      sessionTeams: [{ team: 'zone-b/hub', name: 'hub seat', description: 'hub work' }],
      teamMemberships: [{ node: 'zone-b/hub', team: 'zone-a/dock' }],
    },
    'http://peer-c': signCard({ name: 'peer-c', session: 'peer-host-c', team: 'zone-c', capabilities: {}, expiresAt: Date.now() + 3_600_000 }, key.privateKey),
  }

  function stubFleet(): void {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      const target = String(url)
      // Loopback (the mounted WebServer) passes through to the real stack.
      if (target.startsWith('http://127.0.0.1') || target.startsWith('http://localhost')) return realFetch(target, init)
      if ((init?.method ?? 'GET') !== 'GET') return Promise.reject(new Error('unexpected method'))
      for (const [prefix, card] of Object.entries(wireCards)) {
        if (target.startsWith(prefix)) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
      }
      return Promise.reject(new Error('unreachable'))
    })
  }

  async function mount(overrides: Partial<Config> = {}): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: ['http://peer-a', 'http://peer-b', 'http://peer-c'], ...overrides }))
    return ctx
  }

  it('pins the schema default: teamScopeInfo ships default(true)', () => {
    const source = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8')
    expect(source).toContain('teamScopeInfo: s.boolean().default(true)')
  })

  it('a2a_teams scoped: only rows serving a joined team; [this host] rows and the note stay', async () => {
    stubFleet()
    const home = tmpHome()
    declareTeams(home, 'agent-1', ['zone-a/dock'])
    const ctx = await mount({ teamScopeInfo: true, dshHome: home })
    const listed = await ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { ok: boolean; teams: TeamRow[]; note?: string }
    const remote = listed.teams.filter(row => row.local !== true)
    expect(remote.map(row => row.team).sort()).toEqual(['zone-a/cargo', 'zone-a/dock', 'zone-b/hub'])
    expect(listed.teams.some(row => row.local === true)).toBe(true)
    expect(listed.note).toContain('teamScopeInfo on')
    await ctx.fiber.dispose()
  })

  it('a2a_teams scoped with no joined teams keeps host-internal rows only, and says so', async () => {
    stubFleet()
    const ctx = await mount({ teamScopeInfo: true, dshHome: tmpHome() })
    const listed = await ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { teams: TeamRow[]; note?: string }
    expect(listed.teams.every(row => row.local === true)).toBe(true)
    expect(listed.teams.some(row => row.team === 'home-zone')).toBe(true)
    expect(listed.note).toContain('0 joined teams')
    await ctx.fiber.dispose()
  })

  it('a2a_teams open plane (teamScopeInfo: false) still lists the whole fleet', async () => {
    stubFleet()
    const home = tmpHome()
    declareTeams(home, 'agent-1', ['zone-a/dock'])
    const ctx = await mount({ teamScopeInfo: false, dshHome: home })
    const listed = await ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { teams: TeamRow[]; note?: string }
    expect(listed.teams.map(row => row.team).sort()).toEqual(['home-zone', 'zone-a', 'zone-a/cargo', 'zone-a/dock', 'zone-b', 'zone-b/hub', 'zone-c'])
    expect(listed.note).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('a2a_status scoped narrows peers to cards serving a joined team; the open plane keeps the fleet', async () => {
    stubFleet()
    const home = tmpHome()
    declareTeams(home, 'agent-1', ['zone-a/dock'])
    const scoped = await mount({ teamScopeInfo: true, dshHome: home })
    const scopedStatus = await scoped.tools.get('a2a_status')?.execute({}, runContext()) as { peers: { url: string }[]; idempotency: unknown }
    expect(scopedStatus.peers.map(peer => peer.url).sort()).toEqual(['http://peer-a', 'http://peer-b'])
    expect(scopedStatus.idempotency).toBeDefined()
    await scoped.fiber.dispose()
    const open = await mount({ teamScopeInfo: false, dshHome: tmpHome() })
    const openStatus = await open.tools.get('a2a_status')?.execute({}, runContext()) as { peers: { url: string }[] }
    expect(openStatus.peers.map(peer => peer.url).sort()).toEqual(['http://peer-a', 'http://peer-b', 'http://peer-c'])
    await open.fiber.dispose()
  })

  it('a2a_probe scoped sweeps serving peers only; the open plane probes the fleet', async () => {
    stubFleet()
    const home = tmpHome()
    declareTeams(home, 'agent-1', ['zone-a/dock'])
    const scoped = await mount({ teamScopeInfo: true, dshHome: home })
    const swept = await scoped.tools.get('a2a_probe')?.execute({}, runContext()) as { results: { url: string; reachable: boolean }[] }
    expect(swept.results.map(row => row.url).sort()).toEqual(['http://peer-a', 'http://peer-b'])
    expect(swept.results.every(row => row.reachable)).toBe(true)
    await scoped.fiber.dispose()
    const open = await mount({ teamScopeInfo: false, dshHome: tmpHome() })
    const fleet = await open.tools.get('a2a_probe')?.execute({}, runContext()) as { results: { url: string }[] }
    expect(fleet.results.map(row => row.url).sort()).toEqual(['http://peer-a', 'http://peer-b', 'http://peer-c'])
    await open.fiber.dispose()
  })

  it('a2a_probe scoped refuses a single URL that cannot prove service; a serving URL is probed', async () => {
    stubFleet()
    const home = tmpHome()
    declareTeams(home, 'agent-1', ['zone-a/dock'])
    const ctx = await mount({ teamScopeInfo: true, dshHome: home })
    const refused = await ctx.tools.get('a2a_probe')?.execute({ url: 'http://peer-c' }, runContext()) as { results: { url: string; reachable: boolean; error?: string }[] }
    expect(refused.results).toHaveLength(1)
    expect(refused.results[0]?.reachable).toBe(false)
    expect(refused.results[0]?.error).toContain('refused (not probed)')
    const allowed = await ctx.tools.get('a2a_probe')?.execute({ url: 'http://peer-a' }, runContext()) as { results: { url: string; reachable: boolean; team?: string }[] }
    expect(allowed.results[0]?.reachable).toBe(true)
    expect(allowed.results[0]?.team).toBe('zone-a')
    await ctx.fiber.dispose()
  })

  it('a2a_probe scoped: a was-serving-but-down URL gets the normal down report, not a refusal', async () => {
    // Round 1: peer-a up — its card lands in the cache and proves service.
    stubFleet()
    const home = tmpHome()
    declareTeams(home, 'agent-1', ['zone-a/dock'])
    const ctx = await mount({ teamScopeInfo: true, dshHome: home })
    const warm = await ctx.tools.get('a2a_probe')?.execute({ url: 'http://peer-a' }, runContext()) as { results: { reachable: boolean }[] }
    expect(warm.results[0]?.reachable).toBe(true)
    // Round 2: peer-a down (card TTL still warm — negative fetch fails) —
    // the stale card keeps the probe legitimate and the report names the
    // down state instead of a policy refusal.
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (String(url).startsWith('http://peer-a') && (init?.method ?? 'GET') === 'GET') return Promise.reject(new Error('connection reset by peer'))
      if ((init?.method ?? 'GET') !== 'GET') return Promise.reject(new Error('unexpected method'))
      return Promise.reject(new Error('unreachable'))
    })
    const probed = await ctx.tools.get('a2a_probe')?.execute({ url: 'http://peer-a' }, runContext()) as { results: { reachable: boolean; error?: string }[] }
    expect(probed.results[0]?.reachable).toBe(false)
    expect(probed.results[0]?.error).toContain('unreachable')
    expect(probed.results[0]?.error ?? '').not.toContain('refused')
    await ctx.fiber.dispose()
  })

  /**
   * R4 (review 66abc2cf on 5ff78ed): activity / inFlight narrowing
   * assertions — and the M2 regression pin: a zero-roster host must still
   * see traffic addressed to its own process-team face (pre-fix, the
   * `joined.size > 0` gate self-blinded exactly those rows).
   */
  describe('activity and inFlight narrowing (R4)', () => {
    interface StatusShape {
      peers: { url: string }[]
      inFlight: { team: string; peer: string }[]
      activity: { dir: string; team: string; peer: string; ok: boolean }[]
    }

    /** Mount with the HTTP face plus one live session node, so inbound
     * /a2a/direct traffic steers and lands in the activity ring. */
    async function mountHttp(teamScopeInfo: boolean, home: string): Promise<{ ctx: Context; port: number }> {
      mkdirSync(join(home, 'a2a'), { recursive: true })
      writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1'] }))
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(TimerService)
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      await ctx.plugin(FakeAgentsService)
      ctx.provide('sessionPersistence', { list: async () => [{ id: SessionId('agent-1') }] } as never)
      apply(ctx, makeConfig({ announce: true, peers: ['http://peer-a'], dshHome: home, teamScopeInfo }))
      const agents = ctx.get('agents') as unknown as FakeAgentsService
      const live = { id: SessionId('agent-1'), session: { events: [] }, steer: vi.fn() }
      agents.agent = live
      ctx.emit('agent/created', { agent: live })
      const port = (ctx as unknown as { webServer: WebServer }).webServer.port
      return { ctx, port }
    }

    it('zero-roster host keeps its own-face inbound activity while foreign outbound is withheld (M2 pin)', async () => {
      stubFleet()
      const { ctx, port } = await mountHttp(true, tmpHome())
      // Inbound delivery to this host's own process team (fails delivery —
      // no initiator — but the attempt is host-internal traffic). Delivery
      // is async past the 202, so poll until the row lands.
      await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        body: JSON.stringify({ team: 'home-zone', message: 'probe', caller_session: 'zone-x/deadbeef12', wait: false }),
      })
      // Outbound attempt to a foreign team — remote dial fails (stub rejects
      // POST) but the activity row is out of scope on a zero-roster host.
      await ctx.tools.get('a2a_route')?.execute({ team: 'zone-a/dock', message: 'probe-out', async: true }, runContext()).catch(() => undefined)
      let status = await ctx.tools.get('a2a_status')?.execute({}, runContext()) as StatusShape
      const deadline = Date.now() + 3_000
      while (!status.activity.some(entry => entry.dir === 'in' && entry.team === 'home-zone') && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50))
        status = await ctx.tools.get('a2a_status')?.execute({}, runContext()) as StatusShape
      }
      expect(status.activity.some(entry => entry.dir === 'in' && entry.team === 'home-zone')).toBe(true)
      expect(status.activity.some(entry => entry.team === 'zone-a/dock')).toBe(false)
      await ctx.fiber.dispose()
    })

    it('in-flight rows narrow to scope: a hung foreign dial shows on the open plane only', async () => {
      let dialed = false
      const realFetch = globalThis.fetch
      vi.stubGlobal('fetch', (url: string, init?: { method?: string; signal?: AbortSignal }) => {
        const target = String(url)
        if (target.startsWith('http://127.0.0.1') || target.startsWith('http://localhost')) return realFetch(target, init)
        if ((init?.method ?? 'GET') === 'GET') {
          const card = wireCards['http://peer-a']
          if (target.startsWith('http://peer-a')) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
          return Promise.reject(new Error('unreachable'))
        }
        // The dial hangs until the test aborts it.
        dialed = true
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
        })
      })
      const scoped = await mountHttp(true, tmpHome())
      const scopedCtl = new AbortController()
      const scopedRoute = scoped.ctx.tools.get('a2a_route')?.execute({ team: 'zone-a/dock', message: 'probe', async: true }, { signal: scopedCtl.signal } as { signal: AbortSignal }) as Promise<unknown>
      const deadline = Date.now() + 3_000
      while (!dialed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
      expect(dialed).toBe(true)
      const scopedStatus = await scoped.ctx.tools.get('a2a_status')?.execute({}, runContext()) as StatusShape
      expect(scopedStatus.inFlight.some(entry => entry.team === 'zone-a/dock')).toBe(false)
      scopedCtl.abort()
      await scopedRoute.catch(() => undefined)
      await scoped.ctx.fiber.dispose()

      dialed = false
      const open = await mountHttp(false, tmpHome())
      const openCtl = new AbortController()
      const openRoute = open.ctx.tools.get('a2a_route')?.execute({ team: 'zone-a/dock', message: 'probe', async: true }, { signal: openCtl.signal } as { signal: AbortSignal }) as Promise<unknown>
      const deadline2 = Date.now() + 3_000
      while (!dialed && Date.now() < deadline2) await new Promise(resolve => setTimeout(resolve, 25))
      expect(dialed).toBe(true)
      const openStatus = await open.ctx.tools.get('a2a_status')?.execute({}, runContext()) as StatusShape
      expect(openStatus.inFlight.some(entry => entry.team === 'zone-a/dock' && entry.peer === 'http://peer-a')).toBe(true)
      openCtl.abort()
      await openRoute.catch(() => undefined)
      await open.ctx.fiber.dispose()
    })
  })

  describe('scope follow-up G2/G4 (review artifact 688c0354d3 v2)', () => {
    it('G2: scoped a2a_status keeps the host-synthetic log-face rows (real-driven)', async () => {
    const home = tmpHome()
    // This one test needs the real HTTP face: mount WITH a WebServer so the
    // /a2a/log route exists and records the host-synthetic activity rows.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    apply(ctx, makeConfig({ teamScopeInfo: true, dshHome: home }))
    const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
    stubFleet()
    // Drive the /a2a/log face twice: an admitted caller (activity row
    // dir=in team='log' peer=caller) and an anonymous pass (gate off in
    // this harness) — both are host-synthetic face telemetry.
    await fetch(`http://127.0.0.1:${String(port)}/a2a/log?caller_session=home-zone`)
    await fetch(`http://127.0.0.1:${String(port)}/a2a/log`)
    const status = await ctx.tools.get('a2a_status')!.execute({}, runContext()) as { activity: Array<{ dir: string; team: string; peer: string; ok: boolean }> }
    const logRows = status.activity.filter(entry => entry.team === 'log')
    expect(logRows.length).toBe(2)
    expect(logRows.some(entry => entry.peer === 'home-zone' && entry.ok)).toBe(true)
    // The control: nothing about the pass-through widens real fleet rows —
    // with zero roster and zero canvas the peers list stays empty.
    expect((status.peers as unknown[]).length).toBe(0)
    await ctx.fiber.dispose()
  })

  it('G4: canvas membership widens the scope — the canvas remote teammate becomes visible', async () => {
    const home = tmpHome()
    mkdirSync(join(home, 'a2a'), { recursive: true })
    // Local member agent-1 (no roster declaration at all) + the remote
    // handle peer-b publishes (zone-b/hub). Canvas is the ONLY join intent.
    writeFileSync(join(home, 'a2a', 'canvas.json'), JSON.stringify({ teams: [{ name: 'ops', members: ['agent-1', 'zone-b/hub'] }] }))
    const ctx = await mount({ teamScopeInfo: true, dshHome: home })
    stubFleet()
    // a2a_teams: peer-b's hub row serves a scope member handle — visible;
    // peer-a and the legacy peer-c stay withheld.
    const listed = await ctx.tools.get('a2a_teams')!.execute({}, runContext()) as { teams: TeamRow[]; note: string }
    expect(listed.teams.some(row => row.team === 'zone-b/hub')).toBe(true)
    expect(listed.teams.some(row => row.team === 'zone-a/cargo')).toBe(false)
    expect(listed.teams.some(row => row.team === 'zone-c')).toBe(false)
    // a2a_status: the same card serves the scope, so the peer is visible.
    const status = await ctx.tools.get('a2a_status')!.execute({}, runContext()) as { peers: Array<{ url: string }> }
    expect(status.peers.map(peer => peer.url)).toEqual(['http://peer-b'])
    await ctx.fiber.dispose()
  })
  })
})
