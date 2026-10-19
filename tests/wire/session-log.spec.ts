/**
 * Session transcript route (0.6.11): GET /__dsh_a2a/session-log serves the
 * tail of a LOCAL node's own conversation log for the workbench inspector —
 * inline reading, no navigation (owner ruling 2026-10-20). These specs pin
 * the control-plane contract: the trust window, the artifact-existence gate
 * (host-scoped reading — network visibility is not the reading gate, 0.6.12),
 * the no-id listing face, generation-artifact discovery, multi-frame zstd
 * decode, the limit cap, and honest errors for absent artifacts.
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
  agents: FakeMultiAgents
  port: number
  home: string
  dispose: () => Promise<void>
}

async function mount(extra: Partial<Config> = {}, joined: string[] = []): Promise<Mounted> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const agents = new FakeMultiAgents(ctx)
  const home = mkdtempSync(join(tmpdir(), 'a2a-session-log-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  // joined.json must exist BEFORE apply: the store restores once at boot.
  if (joined.length > 0) writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: joined }), 'utf8')
  apply(ctx, {
    apiKey: '',
    session: 'session-log-test',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'session log node',
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

/** Write a two-frame zstd generation log for `id` under a cwd bucket. */
function writeLog(home: string, id: string, turns: string[], generation?: number): void {
  const bucket = join(home, 'sessions', '--D-workspace-bucket--', id)
  mkdirSync(bucket, { recursive: true })
  const stem = generation === undefined ? 'session' : `session.v${generation}`
  const header = JSON.stringify({ type: 'session', version: generation ?? 1, id })
  const frames = [zstdCompressSync(header + '\n')]
  for (const turn of turns) {
    frames.push(zstdCompressSync(JSON.stringify({ type: 'user/message', time: 1, data: { content: [{ type: 'text', text: turn }] } }) + '\n'))
  }
  writeFileSync(join(bucket, `${stem}.jsonl.zstd`), Buffer.concat(frames))
}

async function get(port: number, id: string, limit?: number, headers: Record<string, string> = {}): Promise<Response> {
  const query = new URLSearchParams({ id })
  if (limit !== undefined) query.set('limit', String(limit))
  return fetch(`http://127.0.0.1:${port}/__dsh_a2a/session-log?${query}`, { headers })
}

describe('session-log route (0.6.11)', () => {
  it('serves the tail of a joined session\u2019s log across frames and generations', async () => {
    const id = 'session-aaaa1111-0000-4000-8000-000000000000'
    const m = await mount({}, [id])
    mounted.push(m.dispose)
    writeLog(m.home, id, ['第一问', '第二问', '第三问'])
    const res = await get(m.port, id)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; messages: Array<{ role: string; text: string }> }
    expect(body.ok).toBe(true)
    expect(body.messages.map(message => message.text)).toEqual(['第一问', '第二问', '第三问'])
  })

  it('prefers the newest generation artifact', async () => {
    const id = 'session-bbbb2222-0000-4000-8000-000000000000'
    const m = await mount({}, [id])
    mounted.push(m.dispose)
    writeLog(m.home, id, ['旧世代内容'], 2)
    writeLog(m.home, id, ['新世代内容'], 3)
    const body = await (await get(m.port, id)).json() as { ok: boolean; messages: Array<{ text: string }> }
    expect(body.messages.map(message => message.text)).toEqual(['新世代内容'])
  })

  it('caps the limit', async () => {
    const id = 'session-cccc3333-0000-4000-8000-000000000000'
    const m = await mount({}, [id])
    mounted.push(m.dispose)
    writeLog(m.home, id, ['1', '2', '3'])
    const body = await (await get(m.port, id, 2)).json() as { messages: Array<{ text: string }> }
    expect(body.messages.map(message => message.text)).toEqual(['2', '3'])
  })

  it('serves logs for sessions the network faces never see (0.6.12 reading is host-scoped)', async () => {
    // Archived or never-joined sessions hold real conversation logs; the
    // workbench reading face admits them while network visibility stays
    // governed by its own rules (the 3081 'no chat records reachable'
    // defect: cold rows filtered, transcript entry point gone).
    const id = 'session-ffff6666-0000-4000-8000-000000000000'
    const m = await mount()
    mounted.push(m.dispose)
    writeLog(m.home, id, ['离档会话的对话'])
    const body = await (await get(m.port, id)).json() as { ok: boolean; messages: Array<{ text: string }> }
    expect(body.ok).toBe(true)
    expect(body.messages.map(message => message.text)).toEqual(['离档会话的对话'])
  })

  it('lists readable sessions newest-first without an id (0.6.12)', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const older = 'session-11111111-0000-4000-8000-000000000000'
    const newer = 'session-22222222-0000-4000-8000-000000000000'
    writeLog(m.home, older, ['旧'])
    writeLog(m.home, newer, ['新'])
    // Force distinct mtimes: same-tick writes can tie, and the sort must not
    // depend on scan order.
    utimesSync(join(m.home, 'sessions', '--D-workspace-bucket--', older, 'session.jsonl.zstd'), new Date(1), new Date(1))
    const body = await (await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/session-log`)).json() as {
      ok: boolean
      count: number
      sessions: Array<{ id: string; mtimeMs: number; sizeBytes: number }>
    }
    expect(body.ok).toBe(true)
    expect(body.sessions.map(row => row.id)).toEqual([newer, older])
    expect(body.sessions[0]!.sizeBytes).toBeGreaterThan(0)
  })

  it('rejects path-shaped ids even for known prefixes', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const body = await (await get(m.port, '../a2a/joined.json')).json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
  })

  it('answers honestly when the session has no log artifact', async () => {
    const id = 'session-dddd4444-0000-4000-8000-000000000000'
    const m = await mount({}, [id])
    mounted.push(m.dispose)
    const body = await (await get(m.port, id)).json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('no log artifact')
  })

  it('honors the apiKey window', async () => {
    const id = 'session-eeee5555-0000-4000-8000-000000000000'
    const m = await mount({ apiKey: 'secret-key' }, [id])
    mounted.push(m.dispose)
    writeLog(m.home, id, ['钥匙测试'])
    const denied = await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/session-log?id=${id}`)
    expect(denied.status).toBe(401)
    const allowed = await fetch(`http://127.0.0.1:${m.port}/__dsh_a2a/session-log?id=${id}`, { headers: { 'x-api-key': 'secret-key' } })
    expect(allowed.status).toBe(200)
  })
})
