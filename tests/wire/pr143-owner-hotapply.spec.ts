// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join as joinPath } from 'node:path'
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
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): never { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return [...this.map.values()] }
  get(id: Agent['id']): Agent | undefined { return this.map.get(String(id)) }
}

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

async function mounted(): Promise<{ ctx: Context; agent: Agent }> {
  const home = mkdtempSync(joinPath(tmpdir(), 'pr143-owner-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const agent = { id: SessionId('session-0123456789abcdef'), session: { events: [] }, steer(): void {} } as unknown as Agent
  ;(ctx.get('agents') as unknown as FakeAgentsService).map.set(String(agent.id), agent)
  apply(ctx, {
    apiKey: '', session: 'host-pr143', team: 'dsh', routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000, announce: false, agentName: 'pr143-host', peers: [],
    delegates: [], sessionNodes: true, wakeJoinedOnBoot: false, dshHome: home,
    cardTtlMs: 172_800_000, teamJoinAllowlist: ['dsh/initial'],
  } as Config)
  ctx.emit('agent/created', { agent })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(agent.id) }),
  })).text()
  const write = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/owner-settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamJoinAllowlist: ['dsh/initial', 'dsh/review-gate'], teamScopeInfo: true }),
  })).json() as { ok: boolean }
  expect(write.ok).toBe(true)
  return { ctx, agent }
}

describe('PR143 review: owner-settings hot apply', () => {
  it('whoami reads the updated allowlist without a restart', async () => {
    const { ctx, agent } = await mounted()
    try {
      const answer = await ctx.tools.get('a2a_whoami')?.execute({}, { signal: new AbortController().signal, agent }) as {
        ok: boolean; allowlist: { patterns: string[] }
      }
      expect(answer?.ok).toBe(true)
      expect(answer?.allowlist.patterns).toEqual(['dsh/initial', 'dsh/review-gate'])
    } finally { await ctx.fiber.dispose() }
  }, 30_000)

  it('a2a_teams applies the scoped listing without a restart', async () => {
    const { ctx, agent } = await mounted()
    try {
      const answer = await ctx.tools.get('a2a_teams')?.execute({}, { signal: new AbortController().signal, agent }) as {
        ok: boolean; note?: string
      }
      expect(answer?.ok).toBe(true)
      expect(answer?.note ?? '').toContain('teamScopeInfo on')
    } finally { await ctx.fiber.dispose() }
  }, 30_000)
})
