/**
 * Remote session-log faces (0.6.15): the PEER face GET /a2a/log answers
 * admitted callers with this host's readable sessions / transcript tails
 * (same admission as /a2a/direct: caller_session required, zone/id8 judged
 * on shared teams), and the CONTROL proxy /__dsh_a2a/remote-session-log
 * reads a remote host's log face ON THIS HOST'S BEHALF — tracked peers
 * only, team handles resolved through the directory walk, honest
 * aggregation when every candidate fails.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
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

type Mounted = {
  ctx: Context
  port: number
  home: string
  dispose: () => Promise<void>
}

async function mount(extra: Partial<Config> = {}): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  new FakeMultiAgents(ctx)
  const home = mkdtempSync(join(tmpdir(), 'a2a-remote-log-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  apply(ctx, {
    apiKey: '',
    session: 'remote-log-test',
    team: 'dsh',
    teamScopeRouting: true,
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'remote log node',
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
    home,
    port: (ctx as unknown as { webServer: WebServer }).webServer.port,
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

const mounted: Array<() => Promise<void>> = []
afterEach(async () => {
  while (mounted.length > 0) await (mounted.pop() as () => Promise<void>)()
  vi.unstubAllGlobals()
})

/** Write a two-frame zstd log for `id` under a cwd bucket (same shape as
 *  the session-log specs: header frame + one frame per turn). */
function writeLog(home: string, id: string, turns: string[]): void {
  const bucket = join(home, 'sessions', '--D-workspace-bucket--', id)
  mkdirSync(bucket, { recursive: true })
  const header = JSON.stringify({ type: 'session', version: 1, id })
  const frames = [zstdCompressSync(header + '\n')]
  for (const turn of turns) {
    frames.push(zstdCompressSync(JSON.stringify({ type: 'user/message', time: 1, data: { content: [{ type: 'text', text: turn }] } }) + '\n'))
  }
  writeFileSync(join(bucket, 'session.jsonl.zstd'), Buffer.concat(frames))
}

function logUrl(port: number, params: Record<string, string>): string {
  return `http://127.0.0.1:${port}/a2a/log?${new URLSearchParams(params)}`
}

describe('peer log face /a2a/log (0.6.15)', () => {
  it('serves the transcript tail to an admitted zone caller', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const id = 'session-aaaa1111-0000-4000-8000-000000000000'
    writeLog(m.home, id, ['远端第一问', '远端第二问'])
    const res = await fetch(logUrl(m.port, { caller_session: 'dsh', id }))
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; messages: Array<{ text: string }> }
    expect(body.ok).toBe(true)
    expect(body.messages.map(message => message.text)).toEqual(['远端第一问', '远端第二问'])
  })

  it('lists readable sessions newest-first without an id', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const older = 'session-11111111-0000-4000-8000-000000000000'
    const newer = 'session-22222222-0000-4000-8000-000000000000'
    writeLog(m.home, older, ['旧'])
    writeLog(m.home, newer, ['新'])
    utimesSync(join(m.home, 'sessions', '--D-workspace-bucket--', older, 'session.jsonl.zstd'), new Date(1), new Date(1))
    const body = await (await fetch(logUrl(m.port, { caller_session: 'dsh' }))).json() as {
      ok: boolean
      sessions: Array<{ id: string; mtimeMs: number; sizeBytes: number }>
    }
    expect(body.ok).toBe(true)
    expect(body.sessions.map(row => row.id)).toEqual([newer, older])
  })

  it('rejects non-GET with 405', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const res = await fetch(logUrl(m.port, { caller_session: 'dsh' }), { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('refuses anonymous callers with the /a2a/direct refusal shape', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const body = await (await fetch(logUrl(m.port, {}))).json() as { ok: boolean; error: string; code: number }
    expect(body.ok).toBe(false)
    expect(body.code).toBe(-32000)
    expect(body.error).toContain('caller_session')
  })

  it('refuses same-zone handles that declare no shared team', async () => {
    // 'dsh/abcd1234' has this zone's shape but no joined session carries it:
    // self-declaration alone is not admission (shared-team rule).
    const m = await mount()
    mounted.push(m.dispose)
    const body = await (await fetch(logUrl(m.port, { caller_session: 'dsh/abcd1234', id: 'session-aaaa1111-0000-4000-8000-000000000000' }))).json() as { ok: boolean; code: number }
    expect(body.ok).toBe(false)
    expect(body.code).toBe(-32000)
  })

  it('keeps the transcript out of the answer for refused callers', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const id = 'session-bbbb2222-0000-4000-8000-000000000000'
    writeLog(m.home, id, ['机密对话'])
    const body = await (await fetch(logUrl(m.port, { caller_session: 'dsh/abcd1234', id }))).json() as { ok: boolean; messages?: unknown }
    expect(body.ok).toBe(false)
    expect(body.messages).toBeUndefined()
  })
})

describe('control proxy /__dsh_a2a/remote-session-log (0.6.15)', () => {
  it('reads a tracked peer through ?peer= and presents the host face label', async () => {
    const m = await mount({ peers: ['http://peer-x'] })
    mounted.push(m.dispose)
    const seen: string[] = []
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (String(url).startsWith('http://peer-x/a2a/log') && (init?.method ?? 'GET') === 'GET') {
        seen.push(url)
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, sessions: [{ id: 'session-77777777-peer', mtimeMs: 1, sizeBytes: 4096 }] }) } as unknown as Response)
      }
      return realFetch(url, init as never)
    })
    const body = await (await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/remote-session-log?peer=http%3A%2F%2Fpeer-x%2F`)).json() as {
      ok: boolean
      via: string
      sessions: Array<{ id: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.via).toBe('http://peer-x')
    // Trailing slash normalized; the caller label is the host's own zone team.
    expect(String(seen[0])).toContain('caller_session=dsh')
    expect(body.sessions[0]!.id).toBe('session-77777777-peer')
  })

  it('refuses untracked peers outright (the proxy never dials arbitrary urls)', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const body = await (await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/remote-session-log?peer=http%3A%2F%2Fevil`)).json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('unknown peer on this node')
  })

  it('resolves ?team= through the directory walk and reads the matching session (0.6.16)', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { signCard } = await import('../../src/card.ts')
    const { privateKey } = generateKeyPairSync('ed25519')
    const MEMBER_HANDLE = 'nel157/a1b2c3d4'
    const card = {
      ...signCard({ name: 'remote node', session: 'sess-r', team: 'nel157', capabilities: { route: true }, expiresAt: Date.now() + 60_000 }, privateKey),
      sessionTeams: [{ team: MEMBER_HANDLE, name: 'remote-agent', description: 'remote session team' }],
    }
    const m = await mount({ peers: ['http://peer-x'] })
    mounted.push(m.dispose)
    const realFetch = globalThis.fetch
    let tailAskedId = ''
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (String(url) === 'http://peer-x/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
      }
      if (String(url).startsWith('http://peer-x/a2a/log')) {
        const u = new URL(String(url))
        if (u.searchParams.get('id') === null) {
          // listing face — the suffix a1b2c3d4 must resolve to this session
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, count: 2, sessions: [
            { id: 'session-ffffffff-0000-0000-0000-000000000000', mtimeMs: 2, sizeBytes: 10 },
            { id: 'session-a1b2c3d4-1111-2222-3333-444455556666', mtimeMs: 1, sizeBytes: 20 },
          ] }) } as unknown as Response)
        }
        tailAskedId = u.searchParams.get('id') ?? ''
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, id: tailAskedId, count: 1, messages: [{ role: 'user', text: '对端最近的问题' }] }) } as unknown as Response)
      }
      return realFetch(url, init as never)
    })
    const body = await (await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/remote-session-log?team=${encodeURIComponent(MEMBER_HANDLE)}`)).json() as {
      ok: boolean
      via: string
      messages: Array<{ text: string }>
    }
    expect(body.ok).toBe(true)
    expect(body.via).toBe('http://peer-x')
    // the handle suffix resolved to the a1b2c3d4 session, not the newest ffffffff one
    expect(tailAskedId).toBe('session-a1b2c3d4-1111-2222-3333-444455556666')
    expect(body.messages[0]!.text).toBe('对端最近的问题')
  })

  it('falls back to the newest session for a bare zone team and fails honestly on no match (0.6.16)', async () => {
    const { generateKeyPairSync } = await import('node:crypto')
    const { signCard } = await import('../../src/card.ts')
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = {
      ...signCard({ name: 'zone host', session: 'sess-z', team: 'nel157', capabilities: { route: true }, expiresAt: Date.now() + 60_000 }, privateKey),
      sessionTeams: [{ team: 'nel157', name: 'zone roster', description: 'bare zone team' }, { team: 'nel157/aaaabbbb', name: 'ghost session', description: 'publishes a handle with no log' }],
    }
    const m = await mount({ peers: ['http://peer-x'] })
    mounted.push(m.dispose)
    const realFetch = globalThis.fetch
    let listingCalls = 0
    let tailAskedId = ''
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (String(url) === 'http://peer-x/.well-known/agent-card.json' && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(card) } as unknown as Response)
      }
      if (String(url).startsWith('http://peer-x/a2a/log')) {
        const u = new URL(String(url))
        if (u.searchParams.get('id') === null) {
          listingCalls += 1
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, count: 1, sessions: [
            { id: 'session-9999aaaa-bbbb', mtimeMs: 5, sizeBytes: 30 },
          ] }) } as unknown as Response)
        }
        tailAskedId = u.searchParams.get('id') ?? ''
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, id: tailAskedId, count: 0, messages: [] }) } as unknown as Response)
      }
      return realFetch(url, init as never)
    })
    // bare zone team → newest session
    let body = await (await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/remote-session-log?team=nel157`)).json() as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(tailAskedId).toBe('session-9999aaaa-bbbb')
    // handle whose suffix matches nothing in the listing → honest refusal
    body = await (await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/remote-session-log?team=nel157%2Faaaabbbb`)).json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('no readable session')
    expect(listingCalls).toBe(2)
  })

  it('aggregates candidate failures honestly', async () => {
    const m = await mount({ peers: ['http://peer-x'] })
    mounted.push(m.dispose)
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      if (String(url).startsWith('http://peer-x/a2a/log')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: false, error: 'no log artifact for this session' }) } as unknown as Response)
      }
      return realFetch(url, init as never)
    })
    const body = await (await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/remote-session-log?peer=http%3A%2F%2Fpeer-x&id=session-zzzz`)).json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('remote log unavailable')
    expect(body.error).toContain('no log artifact for this session')
  })

  it('demands team or peer', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const body = await (await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/remote-session-log`)).json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('team or peer is required')
  })
})
