import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply } from '../src/index.ts'

class FakeAgentsService extends Service {
  agent: Agent | undefined
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): Agent { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return this.agent === undefined ? [] : [this.agent] }
  get(id: Agent['id']): Agent | undefined { return this.agent !== undefined && this.agent.id === id ? this.agent : undefined }
}

async function harness(joinedIds: string[] = [], withAgents: boolean = false): Promise<{ ctx: Context; agents: FakeAgentsService }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  const agents = withAgents ? await ctx.plugin(FakeAgentsService) : new FakeAgentsService(ctx)
  const home = mkdtempSync(join(tmpdir(), 'a2a-gate-'))
  if (joinedIds.length > 0) {
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: joinedIds }), 'utf8')
  }
  apply(ctx, { dshHome: home, session: 'gate-test', peers: [], delegates: [] })
  ;(ctx as any).__gateHome = home
  return { ctx, agents }
}

function execWith(agent: { id: string } | undefined): ToolRunContext {
  return { signal: new AbortController().signal, agent } as unknown as ToolRunContext
}

// v0.5.24 (join-gate): an unjoined session is refused on every a2a tool with
// the plain-language ban and the join pointer; a joined session passes; an
// agent-less host call (taskboard marquee / service face) passes untouched.
// User adjudication: joining is a user gesture only.
describe('a2a join gate (unjoined sessions may not use a2a tools)', () => {
  it.each(['a2a_teams', 'a2a_route', 'a2a_probe', 'a2a_status', 'a2a_tasks'])('%s refuses an unjoined session with the ban and the join pointer', async (name) => {
    const { ctx } = await harness()
    const tool = ctx.tools.get(name)
    expect(tool).toBeDefined()
    await expect(tool!.execute(name === 'a2a_route' ? { team: 'dsh', message: 'x' } : {}, execWith({ id: 'session-unjoined000000000000000' })))
      .rejects.toThrow('你被禁止使用 a2a 网络')
    await expect(tool!.execute(name === 'a2a_route' ? { team: 'dsh', message: 'x' } : {}, execWith({ id: 'session-unjoined000000000000000' })))
      .rejects.toThrow(/sidebar/)
  })


  it('an agent-less host call (marquee / service face) passes the gate untouched', async () => {
    const { ctx } = await harness()
    const teams = ctx.tools.get('a2a_teams')
    const result = await teams!.execute({}, execWith(undefined)) as { ok: boolean; error?: string }
    expect(result.ok).toBe(true)
    expect(result.error).toBeUndefined()
  })
})
