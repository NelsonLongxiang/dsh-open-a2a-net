/**
 * Shared TTL card-cache tests: within one serve window a peer's card is
 * fetched (and scored) at most once across consumers; the negative window
 * keeps dead peers from being re-punished every poll; expiry re-fetches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { generateKeyPairSync } from 'node:crypto'
import { signCard } from '../../src/card.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { apply, type Config } from '../../src/index.ts'

/** The state face mounts with the multi-agent service (gh#106 reads it). */
class FakeMultiAgents extends Service {
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): Agent { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return [] }
  get(): Agent | undefined { return undefined }
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '', session: 'sess-1', team: 'dsh', routeTimeoutMs: 60_000, flushTimeoutMs: 300_000,
    announce: false, agentName: 'test node', peers: [], delegates: [], sessionNodes: false,
    wakeJoinedOnBoot: false, wakeBootStaggerMs: 3_000, stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000, cardTtlMs: 172_800_000,
    dshHome: '', ...overrides,
  } as Config
}

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-a2a-cc-'))
}

function runContext(): { signal: AbortSignal } {
  return { signal: new AbortController().signal } as { signal: AbortSignal }
}

const cardBody = (key: NodeJS.KeyPairKeyObjectReturnType, url: string, expiresAt = Date.now() + 3_600_000) => {
  const { privateKey } = key as { privateKey: NodeJS.KeyPairKeyObjectReturnType }
  void url
  return signCard({ name: 'peer-a', session: 'peer-host', team: 'dsh', capabilities: {}, expiresAt }, privateKey)
}

describe('shared TTL card cache', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves one network fetch per URL within the window, across separate tool calls', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = cardBody({ privateKey }, 'http://peer-a')
    let calls = 0
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (String(url).startsWith('http://peer-a') && (init?.method ?? 'GET') === 'GET') {
        calls += 1
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
      }
      return Promise.reject(new Error('unreachable'))
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: ['http://peer-a'], dshHome: tmpHome() }))
    const teams = ctx.tools.get('a2a_teams')
    const first = await teams?.execute({}, runContext()) as { teams: { team: string }[] }
    expect(first.teams.some(t => t.session === 'peer-host' || t.team === 'dsh')).toBe(true)
    const callsAfterFirst = calls
    expect(callsAfterFirst).toBeGreaterThan(0)
    // A second call inside the window reuses the cached card: no new fetches.
    await teams?.execute({}, runContext())
    expect(calls).toBe(callsAfterFirst)
    await ctx.fiber.dispose()
  })

  it('PR#96 P2-2: a refetch failure keeps the OLD card for callers joining the single flight (the mirror never blanks)', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = cardBody({ privateKey }, 'http://peer-a')
    let calls = 0
    let serving = true
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (String(url).startsWith('http://peer-a') && (init?.method ?? 'GET') === 'GET') {
        calls += 1
        if (serving) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
        return Promise.reject(new Error('peer-a went down'))
      }
      return Promise.reject(new Error('unreachable'))
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    // Tiny positive TTL so the good entry is genuinely expired when we refetch.
    apply(ctx, makeConfig({ peers: ['http://peer-a'], dshHome: tmpHome(), cardCacheTtlMs: 40 }))
    const teams = ctx.tools.get('a2a_teams')
    const prime = await teams?.execute({}, runContext()) as { teams: { team: string }[] }
    expect(prime.teams.some(t => t.session === 'peer-host')).toBe(true)
    const callsWhenGood = calls
    serving = false
    await new Promise(resolve => setTimeout(resolve, 60))
    // Two concurrent calls join the SAME single flight over the expired entry;
    // the fetch fails — both must still surface the OLD card, not undefined.
    const [first, second] = await Promise.all([
      teams?.execute({}, runContext()) as Promise<{ teams: { team: string }[] }>,
      teams?.execute({}, runContext()) as Promise<{ teams: { team: string }[] }>,
    ])
    expect(first.teams.some(t => t.session === 'peer-host')).toBe(true)
    expect(second.teams.some(t => t.session === 'peer-host')).toBe(true)
    // Single-flight: the two joined calls shared ONE new fetch attempt.
    expect(calls).toBe(callsWhenGood + 1)
    await ctx.fiber.dispose()
  })

  it('PR#96 P2-2 r2: after the peer dies, SERIAL polls refetch once per negative window while the old card keeps serving', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = cardBody({ privateKey }, 'http://peer-a')
    let calls = 0
    let serving = true
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (String(url).startsWith('http://peer-a') && (init?.method ?? 'GET') === 'GET') {
        calls += 1
        if (serving) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
        return Promise.reject(new Error('peer-a went down'))
      }
      return Promise.reject(new Error('unreachable'))
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: ['http://peer-a'], dshHome: tmpHome(), cardCacheTtlMs: 40 }))
    const teams = ctx.tools.get('a2a_teams')
    await teams?.execute({}, runContext())
    const callsWhenGood = calls
    serving = false
    await new Promise(resolve => setTimeout(resolve, 60))
    for (let i = 0; i < 5; i += 1) {
      const poll = await teams?.execute({}, runContext()) as { teams: { team: string }[] }
      expect(poll.teams.some(t => t.session === 'peer-host')).toBe(true)
    }
    expect(calls).toBe(callsWhenGood + 1)
    await ctx.fiber.dispose()
  })

  it('PR#96 P2-2 r2: past the card\'s own expiresAt the old card stops answering — the dead peer leaves the directory', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = cardBody({ privateKey }, 'http://peer-a', Date.now() + 120)
    let calls = 0
    let serving = true
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (String(url).startsWith('http://peer-a') && (init?.method ?? 'GET') === 'GET') {
        calls += 1
        if (serving) return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
        return Promise.reject(new Error('peer-a went down'))
      }
      return Promise.reject(new Error('unreachable'))
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: ['http://peer-a'], dshHome: tmpHome(), cardCacheTtlMs: 40 }))
    const teams = ctx.tools.get('a2a_teams')
    await teams?.execute({}, runContext())
    const callsWhenGood = calls
    serving = false
    // Past the card's own expiry AND the cache TTL: the kept card is refused.
    await new Promise(resolve => setTimeout(resolve, 220))
    const gone = await teams?.execute({}, runContext()) as { teams: { team: string }[] }
    expect(gone.teams.some(t => t.session === 'peer-host')).toBe(false)
    expect(calls).toBe(callsWhenGood + 1)
    // The negative window now holds: no refetch per poll.
    const callsAtExit = calls
    await teams?.execute({}, runContext())
    expect(calls).toBe(callsAtExit)
    await ctx.fiber.dispose()
  })

  it('gh#106: while the old card is kept through a miss, the directory row, the state remote row and peerOrg say unreachable; a peer that answers again clears it', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = cardBody({ privateKey }, 'http://peer-a')
    let serving = true
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
      if (String(url).startsWith('http://peer-a')) {
        if (serving && (init?.method ?? 'GET') === 'GET') return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
        return Promise.reject(new Error('peer-a went down'))
      }
      return realFetch(url, init)
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    new FakeMultiAgents(ctx)
    apply(ctx, makeConfig({ peers: ['http://peer-a'], dshHome: tmpHome(), sessionNodes: true, cardCacheTtlMs: 40, cardCacheNegativeTtlMs: 40, remoteRowsTtlMs: 0 }))
    const port = (ctx as unknown as { webServer: WebServer }).webServer.port
    const teams = ctx.tools.get('a2a_teams')
    type Row = { session: string; unreachable?: boolean }
    const peerRows = async (): Promise<Row[]> => ((await teams?.execute({}, runContext())) as { teams: Row[] }).teams.filter(t => t.session === 'peer-host')
    /** Two state reads: the first starts the throttled sweep, the second serves its rows. */
    const state = async (): Promise<{ remote: Array<{ unreachable?: boolean }>; peerOrg: Array<{ url: string; unreachable?: boolean }>; registry: { nodes: Array<{ remote?: boolean; unreachable?: boolean }> } }> => {
      await realFetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)
      await new Promise(resolve => setTimeout(resolve, 20))
      return await (await realFetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as never
    }
    const up = await peerRows()
    expect(up.length).toBeGreaterThan(0)
    expect(up.every(row => row.unreachable === undefined)).toBe(true)
    const upState = await state()
    expect(upState.remote.length).toBeGreaterThan(0)
    expect(upState.remote.every(row => row.unreachable === undefined)).toBe(true)
    expect(upState.peerOrg.find(row => row.url === 'http://peer-a')?.unreachable).toBeUndefined()
    expect(upState.registry.nodes.every(row => row.unreachable === undefined)).toBe(true)
    serving = false
    await new Promise(resolve => setTimeout(resolve, 60))
    const down = await peerRows()
    expect(down.length).toBeGreaterThan(0) // still listed: the kept card serves until its own expiresAt
    expect(down.every(row => row.unreachable === true)).toBe(true)
    const downState = await state()
    expect(downState.remote.length).toBeGreaterThan(0)
    expect(downState.remote.every(row => row.unreachable === true)).toBe(true)
    expect(downState.peerOrg.find(row => row.url === 'http://peer-a')?.unreachable).toBe(true)
    const remoteNodes = downState.registry.nodes.filter(row => row.remote === true)
    expect(remoteNodes.length).toBeGreaterThan(0)
    expect(remoteNodes.every(row => row.unreachable === true)).toBe(true)
    serving = true
    await new Promise(resolve => setTimeout(resolve, 60))
    const back = await peerRows()
    expect(back.every(row => row.unreachable === undefined)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('caches negative results so dead peers are not re-punished per poll', async () => {
    let calls = 0
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).startsWith('http://dead-peer')) {
        calls += 1
        return Promise.reject(new Error('down'))
      }
      return Promise.reject(new Error('unreachable'))
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    apply(ctx, makeConfig({ peers: ['http://dead-peer'], dshHome: tmpHome() }))
    const teams = ctx.tools.get('a2a_teams')
    await teams?.execute({}, runContext())
    const afterFirst = calls
    expect(afterFirst).toBeGreaterThan(0)
    await teams?.execute({}, runContext())
    // The negative window suppresses the retry.
    expect(calls).toBe(afterFirst)
    await ctx.fiber.dispose()
  })
})
