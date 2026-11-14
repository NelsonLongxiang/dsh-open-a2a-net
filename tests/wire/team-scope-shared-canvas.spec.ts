/**
 * S5 alignment (production feedback 2026-11-14): routing admits a target that shares a canvas with a joined local
 * session on the target's own host (outboundScope orgShared); the information plane now lists that session too, marked
 * [shared via <canvas>], and a refused probe names the missing side instead of a bare "no team".
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
import type { A2aPeerCard } from '../../src/types.ts'
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

/** Seed the explicit local network-join intent used by local handle resolution. */
function declareJoined(home: string, session: string): void {
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: [session] }))
}

/** Seed one local canvas name so collision handling can be pinned. */
function declareCanvas(home: string, name: string, members: string[]): void {
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'canvas.json'), JSON.stringify({ teams: [{ name, members }] }))
}

function runContext(): { signal: AbortSignal } {
  return { signal: new AbortController().signal } as { signal: AbortSignal }
}

interface TeamRow { team: string; local?: boolean; teams?: string[] }


describe('S5 alignment: a peer canvas shared with a joined local session', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
  afterEach(() => { vi.unstubAllGlobals() })

  const key = generateKeyPairSync('ed25519')
  function peerCard(members: string[]): A2aPeerCard {
    return {
      ...signCard({ name: 'peer-b', session: 'peer-host-b', team: 'zone-b', capabilities: { roster: true }, expiresAt: Date.now() + 3_600_000 }, key.privateKey),
      sessionTeams: [{ team: 'zone-b/ops', name: 'ops seat', description: '' }, { team: 'zone-b/other', name: 'other seat', description: '' }],
      canvasOrg: [{ name: 'prod', team: 'zone-b/canvas/prod', members }],
    }
  }
  function stubFleet(cards: Readonly<Record<string, A2aPeerCard>>): void {
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      const target = String(url)
      if (target.startsWith('http://127.0.0.1') || target.startsWith('http://localhost')) return realFetch(target, init)
      for (const [prefix, card] of Object.entries(cards)) if (target.startsWith(prefix)) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
      return Promise.reject(new Error('unreachable'))
    })
  }
  async function mount(home: string, peers: string[]): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers, teamScopeInfo: true, dshHome: home }))
    return ctx
  }
  type Row = TeamRow & { sharedVia?: string }

  it('lists the peer session its own host\'s canvas holds beside a joined local session, [shared via] that canvas', async () => {
    const home = tmpHome()
    declareJoined(home, 'agent-1')
    stubFleet({ 'http://peer-b': peerCard(['home-zone/agent-1', 'zone-b/ops']) })
    const ctx = await mount(home, ['http://peer-b'])
    const tool = ctx.tools.get('a2a_teams')!
    const listed = await tool.execute({}, runContext()) as { teams: Row[]; note?: string }
    const ops = listed.teams.find(row => row.team === 'zone-b/ops')
    expect(ops?.sharedVia).toBe('zone-b/canvas/prod')
    expect(listed.teams.some(row => row.team === 'zone-b/other')).toBe(false)
    const status = await ctx.tools.get('a2a_status')!.execute({}, runContext()) as { peers: { url: string }[] }
    expect(status.peers.map(peer => peer.url)).toEqual(['http://peer-b'])
    await ctx.fiber.dispose()
  })

  it('keeps the session out while the local side of that canvas is not joined', async () => {
    stubFleet({ 'http://peer-b': peerCard(['home-zone/agent-1', 'zone-b/ops']) })
    const ctx = await mount(tmpHome(), ['http://peer-b'])
    const listed = await ctx.tools.get('a2a_teams')!.execute({}, runContext()) as { teams: Row[] }
    expect(listed.teams.some(row => row.team === 'zone-b/ops')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('a refused probe names the missing side and the owner\'s fix', async () => {
    const home = tmpHome()
    declareJoined(home, 'agent-1')
    stubFleet({ 'http://peer-b': peerCard(['zone-b/ops']) })
    const ctx = await mount(home, ['http://peer-b'])
    const probed = await ctx.tools.get('a2a_probe')!.execute({ url: 'http://peer-b' }, runContext()) as { results: { error?: string }[] }
    const error = probed.results[0]?.error ?? ''
    expect(error).toContain('refused (not probed)')
    expect(error).toMatch(/Neither side declares the other|may not be read yet/)
    expect(error).toContain('workbench board')
    await ctx.fiber.dispose()
  })
})
