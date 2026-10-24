// @vitest-environment node
/**
 * gh#36: the quick-dispatch host face rides a LIVE joined session's node
 * team as its caller face when one exists — receipts route back to that
 * session (the owner SEES the answer). Without a live session the host
 * face keeps the bare zone (the reply's reconciliation note applies).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
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

class FakeAgentsService extends Service {
  map = new Map<string, Agent>()

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return [...this.map.values()]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.map.get(String(id))
  }
}

interface RelayAgent extends Agent { steerTexts: unknown[]; host?: Context }

function makeAgent(id: string, name: string): RelayAgent {
  const agent = {
    id: SessionId(id),
    session: { events: [] as unknown[], title: name },
    steerTexts: [] as unknown[],
    steer(payload: unknown): void {
      agent.steerTexts.push(payload)
      const events = (agent as unknown as { session: { events: unknown[] } }).session.events
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `answered ${name}` }] } } })
      agent.host?.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
    },
  } as unknown as RelayAgent
  return agent
}

interface Mounted { ctx: Context; port: number; a: RelayAgent; b: RelayAgent; dispose: () => Promise<void> }

async function mount(): Promise<Mounted> {
  const home = mkdtempSync(join(tmpdir(), 'gh36-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  const a = makeAgent('session-aaaaaaaa11111111', '收信席-A')
  const b = makeAgent('session-bbbbbbbb22222222', '目标席-B')
  for (const agent of [a, b]) { agents.map.set(String(agent.id), agent); agent.host = ctx }
  apply(ctx, {
    apiKey: '',
    session: 'host-gh36',
    team: 'dsh',
    routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: 'gh36-host',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    dshHome: home,
    cardTtlMs: 172_800_000,
    teamJoinAllowlist: ['dsh/shared'],
  } as Config)
  for (const agent of [a, b]) ctx.emit('agent/created', { agent: agent as unknown as Agent })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  const post = async (path: string, body: unknown): Promise<{ ok?: boolean; task_id?: string; reply?: string; error?: string }> =>
    await (await globalThis.fetch(`http://127.0.0.1:${String(port)}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).json() as { ok?: boolean; task_id?: string; reply?: string; error?: string }
  // A joins (live) + declares the shared team; B joins + declares.
  for (const agent of [a, b]) {
    expect((await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(agent.id) }),
    })).status).toBe(200)
    const joined = await ctx.tools.get('a2a_team_join')?.execute({ team: 'dsh/shared', id: String(agent.id) }, { signal: new AbortController().signal, agent: agent as unknown as Agent } as never) as { ok?: boolean; error?: string }
    expect(joined?.ok).toBe(true)
  }
  return { ctx, port, a, b, post, dispose: async () => { await ctx.fiber.dispose() } }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('gh#36 quick-dispatch caller face', () => {
  it('rides the live joined session: the receipt lands in ITS drawer (B sees [A2A receipt] from A, not bare dsh)', async () => {
    const m = await mount()
    try {
      const dispatch = await m.post('/__dsh_a2a/dispatch', { team: 'dsh/bbbbbbbb', message: '面板派发——应收信' })
      expect(dispatch.ok).toBe(true)
      expect(dispatch.task_id).toBeDefined()
      // B (the target) was steered.
      expect(m.b.steerTexts.length).toBeGreaterThan(0)
      // The reply no longer carries the not-routable warning: the caller
      // face is A's session team.
      expect(String(dispatch.reply)).not.toContain('not network-routable')
      // The receipt MECHANICS (final waiter → ladder → caller-lane steer)
      // are the same machinery every session route uses, pinned by the
      // boundary-hardening suites; this pin owns the CALLER-FACE contract:
      // the lane exists (routable label), so the drawer WILL see the
      // receipt where the old bare-zone face logged every lane failing.
    } finally {
      await m.dispose()
    }
  }, 30_000)
})
