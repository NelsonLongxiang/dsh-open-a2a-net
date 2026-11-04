// @vitest-environment node
/**
 * #291 regression: harness 0.2.2-rc removed AgentRegistry.roots() in favor
 * of list(); on such hosts every roots() call in the sessionNodes tracking
 * threw TypeError. The agent/created listener threw during session resume,
 * the host rolled the resumed Agent back, api-session/removed dropped the
 * row from the session list, and a refresh brought it back (2026-11-05
 * incident). Pinned here: on a list()-only registry the boot loop and the
 * agent/created listener keep working via list()+delegation depth, never
 * throw, and never mount a subagent-tree child as a joinable session.
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

/** The 0.2.2-rc registry face: list() only — no roots(). */
class ListOnlyAgentsService extends Service {
  agentsMap = new Map<string, Agent>()

  constructor (ctx: Context) {
    super(ctx, 'agents')
  }

  list (): Agent[] {
    return [...this.agentsMap.values()]
  }

  get (id: Agent['id']): Agent | undefined {
    return this.agentsMap.get(String(id))
  }
}

interface TestAgent extends Agent {
  steerCalls: unknown[]
  host?: Context
}

function makeAgent (id: string, title: string, depth?: { runtime?: number, header?: number }): TestAgent {
  const agent = {
    id: SessionId(id),
    session: { events: [] as unknown[], title, ...(depth?.header === undefined ? {} : { header: { delegationDepth: depth.header } }) },
    ...(depth?.runtime === undefined ? {} : { options: { subagentDepth: depth.runtime } }),
    steerCalls: [] as unknown[],
    steer (_payload: unknown): void {},
  } as unknown as TestAgent
  return agent
}

function makeConfig (home: string): Config {
  return {
    apiKey: '',
    session: 'host-sess',
    team: 'dsh',
    routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: 'gh291-host',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    dshHome: home,
  } as Config
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket () { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

async function stateSessions (port: number): Promise<Array<{ id: string, live: boolean }>> {
  const res = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)
  expect(res.status).toBe(200)
  const body = await res.json() as { sessions?: Array<{ id: string, live: boolean }> }
  return body.sessions ?? []
}

describe('#291: session tracking survives a registry without roots()', () => {
  it('boot loop and agent/created track top-level agents via list()+depth; children never mount; nothing throws', async () => {
    const home = mkdtempSync(join(tmpdir(), 'a2a-gh291-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(ListOnlyAgentsService)
    const agents = ctx.get('agents') as unknown as ListOnlyAgentsService
    const top = makeAgent('session-top00000000000001', '顶层会话')
    const resumedChild = makeAgent('session-chld0000000000002', '续唤的子代理', { header: 2 })
    agents.agentsMap.set(String(top.id), top)
    agents.agentsMap.set(String(resumedChild.id), resumedChild)
    // The boot loop ran inside apply() over the list()-only registry — the
    // pre-fix code threw TypeError right here (agents.roots is not a function).
    expect(() => apply(ctx, makeConfig(home))).not.toThrow()
    top.host = ctx
    resumedChild.host = ctx
    const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
    try {
      // Boot-loop pin: the persisted-depth child is not a joinable session.
      let sessions = await stateSessions(port)
      expect(sessions.map(row => row.id)).toEqual([String(top.id)])
      expect(sessions[0]?.live).toBe(true)

      // The incident path itself: a resumed top-level session announces
      // through agent/created on a registry without roots(). Pre-fix, this
      // throw vetoed publication and the session list dropped the row.
      const resumed = makeAgent('session-resu0000000000003', '恢复的历史会话')
      agents.agentsMap.set(String(resumed.id), resumed)
      resumed.host = ctx
      expect(() => ctx.emit('agent/created', { agent: resumed as unknown as Agent })).not.toThrow()

      // A runtime-depth child announcing is tracked nowhere (no throw, no row).
      const child = makeAgent('session-kid00000000000004', '新子代理', { runtime: 1 })
      agents.agentsMap.set(String(child.id), child)
      child.host = ctx
      expect(() => ctx.emit('agent/created', { agent: child as unknown as Agent })).not.toThrow()

      sessions = await stateSessions(port)
      expect(sessions.map(row => row.id).sort()).toEqual([String(resumed.id), String(top.id)].sort())
    } finally {
      await ctx.fiber.dispose()
    }
  }, 20_000)
})
