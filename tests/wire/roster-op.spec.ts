import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { apply, type Config } from '../../src/index.ts'

const A = 'session-aaaaaaaa11111111', B = 'session-bbbbbbbb22222222'
class FakeAgents extends Service {
  agents: Agent[] = []
  constructor(ctx: Context) { super(ctx, 'agents') }
  roots(): Agent[] { return this.agents }
  get(id: unknown): Agent | undefined { return this.agents.find(a => String(a.id) === String(id)) }
  requireInitiator(): never { throw new Error('no initiator') }
}
async function mounted(existingCanvas?: string) {
  const home = mkdtempSync(join(tmpdir(), 'a2a-roster-web-'))
  mkdirSync(join(home, 'a2a'))
  writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: [A, B] }))
  if (existingCanvas !== undefined) writeFileSync(join(home, 'a2a', 'canvas.json'), JSON.stringify({ teams: [{ name: existingCanvas, members: [] }] }))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgents)
  ctx.provide('sessionPersistence', { list: async () => [{ id: SessionId(A) }, { id: SessionId(B) }] } as unknown as import('@deepseek-ai/dsh-session-persistence').SessionPersistence)
  const config = { apiKey: 'test-key', session: 'host-test', team: 'dsh', routeTimeoutMs: 5_000, flushTimeoutMs: 5_000, announce: false, peers: [], delegates: [], sessionNodes: true, teamScopeRouting: true, wakeJoinedOnBoot: false, wakeReconcile: false, cardCacheTtlMs: 60_000, remoteRowsTtlMs: 15_000, cardTtlMs: 172_800_000, dshHome: home, agentName: 'test host', teamJoinAllowlist: [] } as Config
  apply(ctx, config)
  const agents = ctx.get('agents') as unknown as FakeAgents
  const a = { id: SessionId(A), session: { events: [] }, steer: vi.fn() } as unknown as Agent
  const b = { id: SessionId(B), session: { events: [] }, steer: vi.fn() } as unknown as Agent
  agents.agents = [a, b]
  ctx.emit('agent/created', { agent: a }); ctx.emit('agent/created', { agent: b })
  const base = 'http://127.0.0.1:' + String((ctx as unknown as { webServer: WebServer }).webServer.port)
  const post = async (body: unknown, key = 'test-key') => {
    const response = await fetch(base + '/__dsh_a2a/roster-op', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() as { ok: boolean; error?: string; team?: string; members?: string[] } }
  }
  const state = async () => await (await fetch(base + '/__dsh_a2a/state', { headers: { 'X-API-Key': 'test-key' } })).json() as { registry: { teams: Array<{ team: string; members: string[] }>; teamAudit: Array<{ id: string; actor?: string; ok: boolean }> } }
  return { ctx, home, a, b, base, post, state }
}

describe('#199 roster control HTTP and shared membership', () => {
  it('creates roster declarations and routes between two local members, then dissolves both declarations and name', async () => {
    const m = await mounted()
    try {
      expect((await m.post({ op: 'create', name: '生产服务组', ids: [A, B] }, '')).status).toBe(401)
      const created = await m.post({ op: 'create', name: '生产服务组', ids: [A, B] })
      expect(created).toMatchObject({ status: 200, body: { ok: true, team: 'dsh/生产服务组', members: [A, B] } })
      const st = await m.state()
      expect(st.registry.teams).toContainEqual(expect.objectContaining({ team: 'dsh/生产服务组', members: [A, B] }))
      expect(st.registry.teamAudit.some(row => row.id === 'human:owner' && row.actor === 'human:owner')).toBe(true)
      const who = await m.ctx.tools.get('a2a_whoami')?.execute({}, { agent: m.a }) as { teams: { roster: string[] } }
      expect(who.teams.roster).toContain('dsh/生产服务组')
      for (const action of ['create', 'add-member']) {
        const reply = await fetch(m.base + '/__dsh_a2a/canvas', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' }, body: JSON.stringify({ action, name: '生产服务组', id: A }) })
        expect((await reply.json() as { ok: boolean }).ok).toBe(false)
      }
      expect((await m.post({ op: 'remove-member', name: '生产服务组', id: B })).body).toMatchObject({ ok: true, members: [A] })
      expect((await m.post({ op: 'add-member', name: '生产服务组', id: B })).body).toMatchObject({ ok: true, members: [A, B] })
      const routed = await m.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/bbbbbbbb', message: 'ping', async: true }, { agent: m.a, signal: new AbortController().signal }) as { ok: boolean; error?: string }
      expect(routed.ok, routed.error).toBe(true)
      expect(m.b.steer).toHaveBeenCalled()
      expect((await m.post({ op: 'dissolve', name: '生产服务组' })).body.ok).toBe(true)
      expect((await m.state()).registry.teams).not.toContainEqual(expect.objectContaining({ team: 'dsh/生产服务组' }))
      const after = await m.ctx.tools.get('a2a_whoami')?.execute({}, { agent: m.a }) as { teams: { roster: string[] } }
      expect(after.teams.roster).not.toContain('dsh/生产服务组')
      expect(readFileSync(join(m.home, 'cordis.patch.yml'), 'utf8')).not.toContain('dsh/生产服务组')
    } finally { await m.ctx.fiber.dispose() }
  }, 25_000)

  it('refuses remote and unjoined members and canvas paths without mutating registry', async () => {
    const m = await mounted('roster:伪装')
    try {
      const canvas = await fetch(m.base + '/__dsh_a2a/canvas', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' }, body: JSON.stringify({ action: 'create', name: '已占用' }) })
      expect((await canvas.json() as { ok: boolean }).ok).toBe(true)
      const prefix = await fetch(m.base + '/__dsh_a2a/canvas', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' }, body: JSON.stringify({ action: 'create', name: 'roster:伪装' }) })
      expect((await prefix.json() as { ok: boolean }).ok).toBe(false)
      for (const body of [
        { op: 'create', name: '伪装', ids: [A, B] },
        { op: 'create', name: '已占用', ids: [A, B] },
        { op: 'create', name: '生产服务组', ids: [A, 'other/eeeeeeee'] },
        { op: 'create', name: '生产服务组', ids: [A, 'not-joined'] },
        { op: 'create', name: 'dsh/canvas/生产服务组', ids: [A, B] },
      ]) { const reply = await m.post(body); expect(reply.status).toBe(200); expect(reply.body.ok).toBe(false) }
      expect((await m.state()).registry.teams).toEqual([])
    } finally { await m.ctx.fiber.dispose() }
  })
})
