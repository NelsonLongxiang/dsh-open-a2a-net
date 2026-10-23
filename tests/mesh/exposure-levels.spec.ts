// @vitest-environment node
/**
 * #19 exposure levels — card-face wave (D2 excerpt knob, ruling final).
 * D2: the sessionTeams excerpt rides the owner-level exposureExcerpt knob
 * — full (verbatim, default) / masked (16-char shape) / off (omitted).
 * Titles and team handles stay in every tier. D5: v1 carries exactly
 * these tiers — no private residue (nothing below the linked default).
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
import { envelopeFor } from '../wire/envelope.ts'

class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return this.agent === undefined ? [] : [this.agent]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.agent !== undefined && this.agent.id === id ? this.agent : undefined
  }
}

interface SessionTeamRow { team?: string; name?: string; description?: string }

interface Mounted { port: number; home: string; dispose: () => Promise<void> }

async function mount(exposureExcerpt: 'full' | 'masked' | 'off'): Promise<Mounted> {
  const home = mkdtempSync(join(tmpdir(), 'a2a-19exp-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  const session = {
    id: SessionId('session-0123456789abcdef'),
    session: { events: [{ type: 'user/message', data: { content: [{ type: 'text', text: '这句话很长很长很长，用来验证摘录档位的截断行为是否正确' }] } }] as unknown[] },
    steer(): void { /* not routed in this spec */ },
  } as unknown as Agent
  agents.agent = session
  apply(ctx, {
    apiKey: '',
    session: 'host-sess',
    team: 'dsh',
    routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: 'e19-host',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    dshHome: home,
    cardTtlMs: 172_800_000,
    exposureExcerpt,
  } as Config)
  ctx.emit('agent/created', { agent: session })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(session.id) }),
  })).json()
  return { port, home, dispose: async () => { await ctx.fiber.dispose() } }
}

async function fullCard(m: Mounted): Promise<SessionTeamRow[]> {
  const body = await (await globalThis.fetch(`http://127.0.0.1:${String(m.port)}/.well-known/agent-card.json`, { headers: envelopeFor(m.home, m.port, 'dsh') })).json() as { sessionTeams?: SessionTeamRow[] }
  return body.sessionTeams ?? []
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('#19 D2: card-face excerpt exposure knob', () => {
  it('full (default): the verbatim excerpt rides the sessionTeams row', async () => {
    const m = await mount('full')
    try {
      const rows = await fullCard(m)
      const row = rows.find(r => r.team === 'dsh/01234567')
      expect(row).toBeDefined()
      expect(row?.name).toContain('01234567')
      expect(row?.description).toContain('这句话很长很长很长')
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('masked: the excerpt truncates to a 16-char shape; title and handle stay', async () => {
    const m = await mount('masked')
    try {
      const rows = await fullCard(m)
      const row = rows.find(r => r.team === 'dsh/01234567')
      expect(row).toBeDefined()
      expect(row?.name).toContain('01234567')
      expect(row?.description).toBeDefined()
      expect((row?.description ?? '').length).toBeLessThanOrEqual(17) // 16 + ellipsis
      expect(row?.description).not.toContain('截断行为是否正确')
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('off: the description field is omitted entirely; the listing itself stays', async () => {
    const m = await mount('off')
    try {
      const rows = await fullCard(m)
      const row = rows.find(r => r.team === 'dsh/01234567')
      expect(row).toBeDefined()
      expect(row?.name).toContain('01234567')
      expect(row?.description).toBeUndefined()
    } finally {
      await m.dispose()
    }
  }, 20_000)
})
