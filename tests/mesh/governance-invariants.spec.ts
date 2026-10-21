// @vitest-environment node
/**
 * gh#7 governance invariants — the INVERTED repro (closure artifact for
 * V1-V4). The review seat's original spec pinned the violating shapes;
 * this one pins the FIXED shapes: every violation path must now refuse.
 * V5's cross-host self-serve vector is pinned in team-roster.spec (the
 * N3 rewrite); V5's policy question (allowlist patterns) is an owner
 * ruling, not code.
 */
import { describe, expect, it, vi } from 'vitest'
import { request } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, networkInterfaces } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { apply, type Config } from '../../src/index.ts'
import { bootNode, runContext } from './harness.ts'

const lanIp = (): string => {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  throw new Error('no non-loopback IPv4 interface')
}

function raw(host: string, port: number, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = request({ host, port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      let text = ''
      res.on('data', (c) => { text += String(c) })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject)
    req.end(data)
  })
}

describe('V1 inverted (N1): headers are not authentication — non-loopback needs apiKey', () => {
  it('LAN caller with Sec-Fetch-Site/Origin/spoofed same-origin is refused on every write route; loopback still works', async () => {
    const ip = lanIp()
    const node = await bootNode({ name: 'host', session: 'mesh-host', team: 'host', host: '0.0.0.0', sessionNodes: true })
    try {
      const id = 'session-0123456789abcdef'
      expect((await raw(ip, node.port, '/__dsh_a2a/join', { id })).status).toBe(403)
      expect((await raw(ip, node.port, '/__dsh_a2a/join', { id }, { 'Sec-Fetch-Site': 'none' })).status).toBe(403)
      expect((await raw(ip, node.port, '/__dsh_a2a/join', { id }, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(403)
      expect((await raw(ip, node.port, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id }, { Origin: `http://${ip}:${String(node.port)}` })).status).toBe(403)
      expect((await raw(ip, node.port, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: 'evil/deadbeef' }, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(403)
      // The operator surface (loopback) is untouched.
      expect((await raw('127.0.0.1', node.port, '/__dsh_a2a/join', { id })).status).toBe(200)
    } finally {
      await node.dispose()
    }
  })
})

describe('V2 inverted (S1): apiKey guards the delivery face too', () => {
  it('with apiKey set, /a2a/direct demands X-API-Key; the key unlocks delivery', async () => {
    const node = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', apiKey: 'secret-123', teamScopeRouting: false, sessionNodes: true })
    try {
      const refused = await raw('127.0.0.1', node.port, '/a2a/direct', { team: 'cargo', message: 'no key', caller_session: 'cargo' })
      expect(refused.status).toBe(401)
      expect(refused.text).toContain('X-API-Key required')
      expect(node.steered.length).toBe(0)
      const allowed = await raw('127.0.0.1', node.port, '/a2a/direct', { team: 'cargo', message: 'with key', caller_session: 'cargo' }, { 'X-API-Key': 'secret-123' })
      expect(allowed.status).toBe(200)
      expect(node.steered.length).toBe(1)
    } finally {
      await node.dispose()
    }
  })
})

describe('V3 inverted (N3): admission reads this host\'s records, never the caller\'s spelling', () => {
  it('free-form and unlinked foreign-zone callers are refused; nothing is steered', async () => {
    const node = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', teamScopeRouting: true, sessionNodes: true })
    try {
      const freeForm = await raw('127.0.0.1', node.port, '/a2a/direct', { team: 'cargo', message: 'free-form', caller_session: 'anyone-at-all' })
      expect(freeForm.status).toBe(200)
      expect(freeForm.text).toContain('matches no node fact on this host')
      const foreign = await raw('127.0.0.1', node.port, '/a2a/direct', { team: 'cargo', message: 'first contact', caller_session: 'evil/deadbeef' })
      expect(foreign.status).toBe(200)
      expect(foreign.text).toContain('no operator-established link')
      expect(node.steered.length).toBe(0)
      // The host face keeps working: the bare zone team is a host fact.
      const own = await raw('127.0.0.1', node.port, '/a2a/direct', { team: 'cargo', message: 'own face', caller_session: 'cargo' })
      expect(node.steered.length).toBe(1)
      expect(own.text).toContain('routed')
    } finally {
      await node.dispose()
    }
  })
})

class FakeAgentsService extends Service {
  agent: Agent | undefined
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): Agent { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return this.agent === undefined ? [] : [this.agent] }
}

describe('V4 inverted (N2): a model tool declares membership for its own node only', () => {
  it('agent-1 cannot enroll agent-2; self-declaration still works; the card stays clean', async () => {
    const home = mkdtempSync(join(tmpdir(), 'a2a-gov-v4-'))
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1', 'agent-2'] }))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FakeAgentsService)
    ctx.provide('sessionPersistence', { list: async () => [{ id: SessionId('agent-1') }, { id: SessionId('agent-2') }] } as never)
    apply(ctx, {
      apiKey: '', session: 'sess-1', team: 'dsh', routeTimeoutMs: 60_000, flushTimeoutMs: 300_000, announce: true, agentName: 'n',
      peers: [], delegates: [], sessionNodes: true, wakeJoinedOnBoot: false, wakePrewarmDelayMs: 0, wakePrewarmQuietMs: 0,
      wakeBootStaggerMs: 3_000, teamJoinAllowlist: ['dsh/review-gate'], stateColdRowsTtlMs: 5_000,
      cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000, remoteRowsTtlMs: 15_000, dshHome: home, cardTtlMs: 172_800_000,
    } as Config)
    const agents = ctx.get('agents') as unknown as FakeAgentsService
    const live = { id: SessionId('agent-1'), session: { events: [] }, steer: vi.fn() } as unknown as Agent
    agents.agent = live
    ctx.emit('agent/created', { agent: live })
    const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
    try {
      const joinTool = ctx.tools.get('a2a_team_join')
      const other = await joinTool?.execute({ team: 'dsh/review-gate', id: 'agent-2' }, runContext(live)) as { ok: boolean; error?: string }
      expect(other.ok).toBe(false)
      expect(other.error).toContain('[NOT_SELF]')
      const self = await joinTool?.execute({ team: 'dsh/review-gate', id: 'agent-1' }, runContext(live)) as { ok: boolean }
      expect(self.ok).toBe(true)
      const card = JSON.parse(await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json`)).text()) as { teamMemberships?: Array<{ node: string; team: string }> }
      expect(card.teamMemberships).toEqual([{ node: 'dsh/agent-1', team: 'dsh/review-gate' }])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
