// @vitest-environment node
/**
 * gh#60 first step — the hop budget at /a2a/direct ingress
 * (docs/protocol/recursion-guard.md 4.2/6):
 *   (1) a zero-budget arrival is refused with the STRUCTURED
 *       budget-exhausted error (-32007) and nothing steers
 *   (2) a positive-budget guard passes to ordinary admission
 *   (3) an ABSENT header grants the default one-shot budget (old peers
 *       constrained, not broken) and behaves exactly like today
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
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

class FakeMultiAgents extends Service {
  readonly agents: Agent[] = []
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): Agent { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return [...this.agents] }
  get(id: Agent['id']): Agent | undefined { return this.agents.find(a => a.id === id) }
}

async function mount(): Promise<{ port: number; dispose: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const agents = new FakeMultiAgents(ctx)
  const home = mkdtempSync(join(tmpdir(), 'a2a-gh60-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['session-aaaabbbbccccdddd'] }), 'utf8')
  apply(ctx, {
    apiKey: '', session: 'gh60-test', team: 'dsh', routeTimeoutMs: 60_000, flushTimeoutMs: 300_000,
    announce: false, agentName: 'gh60 node', peers: [], delegates: [], sessionNodes: true,
    wakeJoinedOnBoot: false, wakePrewarmDelayMs: 0, wakePrewarmQuietMs: 0, wakeBootStaggerMs: 3_000,
    stateColdRowsTtlMs: 5_000, cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000,
    remoteRowsTtlMs: 15_000, dshHome: home, cardTtlMs: 172_800_000,
  } satisfies Config)
  const member = { id: SessionId('session-aaaabbbbccccdddd'), session: { events: [] as unknown[] }, steer: vi.fn() } as unknown as Agent & { steer: ReturnType<typeof vi.fn> }
  agents.agents.push(member)
  ctx.emit('agent/created', { agent: member })
  return {
    port: (ctx as unknown as { webServer: WebServer }).webServer.port,
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

const mounted: Array<() => Promise<void>> = []
afterEach(async () => { while (mounted.length > 0) await (mounted.pop() as () => Promise<void>)() })

const b64 = (obj: unknown): string => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')

describe('gh#60 hop budget at ingress', () => {
  it('(1) hopBudget=0 refuses with structured budget-exhausted; nothing steers', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const res = await fetch('http://127.0.0.1:' + String(m.port) + '/a2a/direct', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Guard': b64({ visitToken: 'ab', hopBudget: 0 }) },
      body: JSON.stringify({ team: 'dsh/aaaabbbb', message: 'should never steer', caller_session: 'dsh/cccc1111', wait: false }),
    }).then(async r => await r.json() as Record<string, unknown>)
    expect(res.code).toBe(-32007)
    expect(String(res.error)).toContain('budget-exhausted')
  }, 30_000)

  it('(2) a positive-budget guard rides through to ordinary admission', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const res = await fetch('http://127.0.0.1:' + String(m.port) + '/a2a/direct', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Guard': b64({ visitToken: 'ab', hopBudget: 3 }) },
      body: JSON.stringify({ team: 'dsh/aaaabbbb', message: 'guard ok, admission decides', caller_session: 'dsh/cccc1111', wait: false }),
    }).then(async r => await r.json() as Record<string, unknown>)
    expect(res.code).not.toBe(-32007)
  }, 30_000)

  it('(3) an absent header grants the default budget — behavior unchanged from today', async () => {
    const m = await mount()
    mounted.push(m.dispose)
    const res = await fetch('http://127.0.0.1:' + String(m.port) + '/a2a/direct', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team: 'dsh/aaaabbbb', message: 'no guard header', caller_session: 'dsh/cccc1111', wait: false }),
    }).then(async r => await r.json() as Record<string, unknown>)
    expect(res.code).not.toBe(-32007)
  }, 30_000)
})
