/**
 * gh#193: `isolated: true` sends nothing to any peer. A host that learned
 * peers into `a2a/peers.json` (and is seeded with more) polls its state
 * face, reads a remote log and relays a fleet canvas op — and no request
 * reaches a peer, the state face says `isolated: true`, and a learned peer
 * is not scored or evicted. The same host with the switch off does dial the peers
 * (the control, so the count above is not vacuous).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
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

const LEARNED = 'http://learned-peer.test:3080'
const SEEDED = 'http://seeded-peer.test:3080'
const PEERS_JSON = JSON.stringify({ peers: [{ url: LEARNED, score: 1, seed: false }] })

/** Every fetch that names a peer host; anything else (this host's own faces) passes through. */
function countPeerFetches(): string[] {
  const seen: string[] = []
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
    const text = String(url)
    if (new URL(text).hostname.endsWith('-peer.test')) {
      seen.push(text)
      return Promise.reject(new Error('peer unreachable in this test'))
    }
    return realFetch(url, init)
  })
  return seen
}

async function mount(extra: Partial<Config>): Promise<{ port: number; home: string; dispose: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  new FakeMultiAgents(ctx)
  const home = mkdtempSync(join(tmpdir(), 'a2a-isolated-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'peers.json'), PEERS_JSON)
  apply(ctx, {
    apiKey: '',
    session: 'isolated-test',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'isolated node',
    peers: [SEEDED],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0,
    wakeBootStaggerMs: 3_000,
    stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000,
    cardCacheNegativeTtlMs: 0,
    remoteRowsTtlMs: 0,
    dshHome: home,
    cardTtlMs: 172_800_000,
    ...extra,
  } satisfies Config)
  return { port: (ctx as unknown as { webServer: WebServer }).webServer.port, home, dispose: async () => { await ctx.fiber.dispose() } }
}

/** Poll the state face a few times, letting each throttled directory sweep run. */
async function pollState(port: number): Promise<{ isolated?: unknown }> {
  let body: { isolated?: unknown } = {}
  for (let i = 0; i < 3; i++) {
    body = await (await fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as { isolated?: unknown }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return body
}

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  while (mounted.length > 0) await (mounted.pop() as () => Promise<void>)()
  vi.unstubAllGlobals()
})

describe('gh#193 isolated: nothing leaves the host', () => {
  it('state polls, a remote log read and a fleet canvas op dial no peer; the state face says isolated; the learned peer is not scored or evicted', async () => {
    const seen = countPeerFetches()
    const m = await mount({ isolated: true })
    mounted.push(m.dispose)
    const state = await pollState(m.port)
    expect(state.isolated).toBe(true)
    const log = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/remote-session-log?peer=${encodeURIComponent(SEEDED)}`)).json() as { ok: boolean; error: string }
    expect(log.ok).toBe(false)
    expect(log.error).toContain('isolated')
    const op = await (await fetch(`http://127.0.0.1:${String(m.port)}/__dsh_a2a/fleet-canvas-op`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer: LEARNED, op: 'create', name: 'x' }),
    })).json() as { ok: boolean; error?: string }
    expect(op.ok).toBe(false)
    expect(op.error).toContain('isolated') // the learned peer is still tracked: the relay reached the door, not the "untracked" refusal
    expect(seen).toEqual([])
    // Disposal flushes the store's debounced write: a refused fetch must not
    // have scored (and so evicted) the learned peer.
    await m.dispose()
    mounted.length = 0
    const after = JSON.parse(readFileSync(join(m.home, 'a2a', 'peers.json'), 'utf8')) as { peers: Array<{ url: string; lastContactAt?: number }>; evictions?: unknown[] }
    expect(after.peers.map(p => p.url)).toContain(LEARNED)
    expect(after.peers.every(p => p.lastContactAt === undefined)).toBe(true)
    expect(after.evictions ?? []).toEqual([])
  })

  it('control: the same host with the switch off dials both the learned and the seeded peer, and says nothing about isolation', async () => {
    const seen = countPeerFetches()
    const m = await mount({})
    mounted.push(m.dispose)
    const state = await pollState(m.port)
    expect(state.isolated).toBeUndefined()
    expect(seen.some(url => url.startsWith(LEARNED))).toBe(true)
    expect(seen.some(url => url.startsWith(SEEDED))).toBe(true)
  })
})
