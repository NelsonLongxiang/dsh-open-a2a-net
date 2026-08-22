/**
 * Shared TTL card-cache tests: within one serve window a peer's card is
 * fetched (and scored) at most once across consumers; the negative window
 * keeps dead peers from being re-punished every poll; expiry re-fetches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import { generateKeyPairSync } from 'node:crypto'
import { signCard } from '../src/card.ts'
import { apply, type Config } from '../src/index.ts'

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

const cardBody = (key: NodeJS.KeyPairKeyObjectReturnType, url: string) => {
  const { privateKey } = key as { privateKey: NodeJS.KeyPairKeyObjectReturnType }
  void url
  return signCard({ name: 'peer-a', session: 'peer-host', team: 'dsh', capabilities: {}, expiresAt: Date.now() + 3_600_000 }, privateKey)
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
