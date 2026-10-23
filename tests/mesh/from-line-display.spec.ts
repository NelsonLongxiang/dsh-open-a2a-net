// @vitest-environment node
/**
 * From-line display names (owner ruling, claim 8ea4150f94): a bare routing
 * handle carries zero semantics for the reader. Four forms pinned —
 * same-host (local title product), cross-host (warm card cache
 * sessionTeams name), cold cache (bare, never a stall), unknown
 * (bare, no false names).
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
import { bootNode, reservePort, runContext, steerText, type MeshNode } from './harness.ts'

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

interface RelayAgent extends Agent {
  steerTexts: unknown[]
  host?: Context
}

function makeAgent(id: string, title: string): RelayAgent {
  const agent = {
    id: SessionId(id),
    session: { events: [] as unknown[], title },
    steerTexts: [] as string[],
    steer(payload: unknown): void {
      agent.steerTexts.push(payload)
      const text = payloadText(payload)
      const events = (agent as unknown as { session: { events: unknown[] } }).session.events
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `answered ${title}: ${text.slice(0, 30)}` }] } } })
      agent.host?.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
    },
  } as unknown as RelayAgent
  return agent
}

interface Mounted { ctx: Context; port: number; a: RelayAgent; b: RelayAgent; dispose: () => Promise<void> }

async function mountTwoSessions(): Promise<Mounted> {
  const home = mkdtempSync(join(tmpdir(), 'a2a-fromline-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  const a = makeAgent('session-aaaaaaaa11111111', '标题A')
  const b = makeAgent('session-bbbbbbbb22222222', '标题B')
  agents.map.set(String(a.id), a)
  agents.map.set(String(b.id), b)
  a.host = ctx
  b.host = ctx
  apply(ctx, {
    apiKey: '',
    session: 'host-sess',
    team: 'dsh',
    routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000,
    announce: true,
    agentName: 'from-host',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    dshHome: home,
    cardTtlMs: 172_800_000,
    teamJoinAllowlist: ['dsh/shared'],
  } as Config)
  ctx.emit('agent/created', { agent: a as unknown as Agent })
  ctx.emit('agent/created', { agent: b as unknown as Agent })
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  for (const agent of [a, b]) {
    const res = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/join`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(agent.id) }),
    })
    expect(res.status).toBe(200)
    // W1 shared-team admission: both declare one shared team so the local
    // route between them clears the joined-face gate.
    const joined = await ctx.tools.get('a2a_team_join')?.execute({ team: 'dsh/shared', id: String(agent.id) }, execAs(agent))
    expect((joined as { ok?: boolean } | undefined)?.ok).toBe(true)
  }
  return { ctx, port, a, b, dispose: async () => { await ctx.fiber.dispose() } }
}

const execAs = (agent: Agent) => ({ signal: new AbortController().signal, agent }) as never

/** The steerRelay payload shape: {id, role, content:[{type:'text',text}]}. */
function payloadText(payload: unknown): string {
  const blocks = (payload as { content?: Array<{ text?: string }> }).content
  if (Array.isArray(blocks)) return blocks.map(block => String(block.text ?? '')).join(' ')
  return JSON.stringify(payload)
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('from-line display names (claim 8ea4150f94)', () => {
  it('SAME-HOST: a zone/id8 handle resolves to the local session-title product', async () => {
    const m = await mountTwoSessions()
    try {
      const routed = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/bbbbbbbb', message: '同机借道' }, execAs(m.a)) as { ok: boolean }
      expect(m.b.steerTexts.length).toBeGreaterThan(0)
      const envelopes = m.b.steerTexts.map(entry => payloadText(entry))
      // nodeMetadataOf().name = the title when a title service answers, else the
      // stable seat label — this mount has no title service, so the label
      // product 'host-sess-aaaaaaaa' IS the resolved display name.
      expect(envelopes.some(text => text.includes('from "dsh/aaaaaaaa"（host-sess-aaaaaaaa）'))).toBe(true)
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('CROSS-HOST: a remote zone/id8 handle resolves through the warm card cache sessionTeams name', async () => {
    const alphaPort = await reservePort()
    const cargoPort = await reservePort()
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', sessionNodes: true, port: alphaPort, peers: [`http://127.0.0.1:${String(cargoPort)}`] })
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', sessionNodes: true, port: cargoPort, peers: [`http://127.0.0.1:${String(alphaPort)}`] })
    try {
      // Both sessions join, so each publishes a session team with its
      // harness label as the row name (nodeMetadataOf title fallback).
      for (const node of [alpha, cargo]) {
        const res = await globalThis.fetch(`http://127.0.0.1:${String(node.port)}/__dsh_a2a/join`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'session-0123456789abcdef' }),
        })
        expect(res.status).toBe(200)
      }
      const first = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo/01234567', message: '跨机第一声（冷缓存可裸）' }, runContext(alpha.agents.agent)) as { ok: boolean }
      expect(first?.ok).toBe(true)
      // Warm CARGO's card cache with alpha's card (the directory sweep): the
      // next delivery's from line can resolve the sessionTeams name.
      await cargo.ctx.tools.get('a2a_teams')?.execute({}, runContext())
      const routed = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo/01234567', message: '跨机名字' }, runContext(alpha.agents.agent)) as { ok: boolean }
      expect(routed?.ok).toBe(true)
      expect(cargo.steered.length).toBeGreaterThan(0)
      const envelope = payloadText(cargo.steered[cargo.steered.length - 1])
      // The from handle is alpha's joined session team; the display name is
      // alpha's own row name (its label product) served through its card.
      expect(envelope).toMatch(/from "alpha\/01234567"（[^）]+）/)
    } finally {
      await cargo.dispose()
      await alpha.dispose()
    }
  }, 30_000)

  it('COLD CACHE / UNKNOWN: no resolution keeps the from line bare — never a stall, never a false name', async () => {
    const target = await bootNode({ name: 'coldt', session: 'mesh-coldt', team: 'cold-zone', sessionNodes: true, teamScopeRouting: false })
    try {
      // An envelope-less legacy delivery with a foreign caller label: no
      // local match, no warm card for its zone → the from line stays bare.
      const reply = await (await globalThis.fetch(`http://127.0.0.1:${String(target.port)}/a2a/direct`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'cold-zone', message: 'cold probe', caller_session: 'weird-caller-xyz' }),
      })).json() as { routed?: boolean }
      expect(reply.routed).toBe(true)
      expect(target.steered.length).toBeGreaterThan(0)
      const envelope = payloadText(target.steered[target.steered.length - 1])
      expect(envelope).toContain('from "weird-caller-xyz" (routed to')
      expect(envelope).not.toMatch(/（[^）]+）/m)
    } finally {
      await target.dispose()
    }
  }, 20_000)
})
