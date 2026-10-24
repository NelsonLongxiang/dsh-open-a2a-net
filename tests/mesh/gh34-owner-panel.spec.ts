// @vitest-environment node
/**
 * gh#34 end-to-end: the owner-settings control face writes the HOME patch
 * layer (the authoritative surface), hot-applies the two call-time keys,
 * and reports restart for announce.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
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

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('gh#34 owner-settings face (end-to-end)', () => {
  it('GET reads, POST writes the patch layer + hot-applies allowlist/teamScopeInfo, announce flags restart', async () => {
    const home = mkdtempSync(joinPath(tmpdir(), 'gh34-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    const agent = {
      id: SessionId('session-0123456789abcdef'),
      session: { events: [] as unknown[] },
      steer(): void { /* the join gate does not steer */ },
    } as unknown as Agent
    ;(ctx.get('agents') as unknown as FakeAgentsService).map.set(String(agent.id), agent)
    apply(ctx, {
      apiKey: '',
      session: 'host-gh34',
      team: 'dsh',
      routeTimeoutMs: 5_000,
      flushTimeoutMs: 300_000,
      announce: true,
      agentName: 'gh34-host',
      peers: [],
      delegates: [],
      sessionNodes: true,
      wakeJoinedOnBoot: false,
      dshHome: home,
      cardTtlMs: 172_800_000,
      teamJoinAllowlist: ['dsh/initial'],
    } as Config)
    ctx.emit('agent/created', { agent })
    const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
    await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(agent.id) }),
    })).json()
    try {
      // GET: initial values (the literal config carries no teamScopeInfo —
      // undefined reads as the OPEN plane, same truthiness as the schema
      // default's read site).
      const before = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/owner-settings`)).json() as { ok: boolean; teamJoinAllowlist: string[]; teamScopeInfo: boolean; announce: boolean }
      expect(before.ok).toBe(true)
      expect(before.teamJoinAllowlist).toEqual(['dsh/initial'])
      expect(before.teamScopeInfo).toBe(false)
      expect(before.announce).toBe(true)
      // POST: allowlist + teamScopeInfo (hot), announce flip (restart).
      const write = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/owner-settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamJoinAllowlist: ['dsh/initial', 'dsh/review-gate'], teamScopeInfo: true, announce: false }),
      })).json() as { ok: boolean; restartNeeded: boolean }
      expect(write.ok).toBe(true)
      expect(write.restartNeeded).toBe(true)
      // The patch layer carries the three keys.
      const patch = readFileSync(joinPath(home, 'cordis.patch.yml'), 'utf8')
      expect(patch).toContain("- id: a2a")
      expect(patch).toContain("teamJoinAllowlist: ['dsh/initial', 'dsh/review-gate']")
      expect(patch).toContain('teamScopeInfo: true')
      expect(patch).toContain('announce: false')
      // GET reflects the hot-applied values without a restart.
      const after = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/owner-settings`)).json() as { teamJoinAllowlist: string[]; teamScopeInfo: boolean; announce: boolean; announceRestartPending: boolean }
      expect(after.teamJoinAllowlist).toEqual(['dsh/initial', 'dsh/review-gate'])
      expect(after.teamScopeInfo).toBe(true)
      expect(after.announce).toBe(true) // boot value until restart
      expect(after.announceRestartPending).toBe(true)
      // HOT-APPLY ①: the join gate admits the newly allowlisted team.
      const join = await ctx.tools.get('a2a_team_join')?.execute({ team: 'dsh/review-gate', id: String(agent.id) }, { signal: new AbortController().signal, agent } as never) as { ok: boolean; error?: string }
      expect(join?.ok).toBe(true)
      // HOT-APPLY ②: the GET now reports scoping ON (the call-time read
      // flipped without a restart).
      const afterScoped = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/owner-settings`)).json() as { teamScopeInfo: boolean }
      expect(afterScoped.teamScopeInfo).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 30_000)
})
