// @vitest-environment node
/**
 * Node identity N2+N3 (docs/design/node-identity.md §3, §5, §9). The frozen
 * criteria, each with its counter-example:
 *   ① binding mounts at once: the bound session's very next assembly has
 *     both node sections (mutable 10150, core 10180, before 10200), another
 *     session's has neither, and an unjoined session cannot bind;
 *   ② a corrupt nodes.json (or bindings file) never stops a session from
 *     opening — agent/created publishes, the session just has no node;
 *   ③ `{{x}}` written into a layer assembles and stays literal;
 *   ④ a layer written mid-session leaves this session's head unchanged; the
 *     next mount (resume / compact re-publish) picks the new version.
 * Sessions here are fakes with REAL registration scopes (dsh-scope
 * createScope), so the scoped sections and variables behave as on a host.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../../src/index.ts'
import { NODE_PROMPT } from '../../src/node-bind.ts'

const KEY = 'node-bind-key'

class FakeAgentsService extends Service {
  map = new Map<string, Agent>()
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): never { throw new Error('no initiator in this fiber') }
  roots(): Agent[] { return [...this.map.values()] }
  get(id: Agent['id']): Agent | undefined { return this.map.get(String(id)) }
}

interface ScopedAgent { id: Agent['id']; ctx: Context; key: object; session: { events: unknown[]; title: string }; dispose: () => Promise<void> }

function makeAgent(host: Context, id: string): ScopedAgent {
  const key = {}
  const scope = createScope(host, key)
  return { id: SessionId(id), ctx: scope.ctx, key, session: { events: [], title: id }, dispose: async () => { await scope.dispose() } }
}

interface Mounted {
  ctx: Context
  agents: FakeAgentsService
  home: string
  post: (path: string, body: unknown, key?: string) => Promise<Response>
  get: (path: string) => Promise<Response>
  prompt: (agent: ScopedAgent) => Promise<string>
  publish: (agent: ScopedAgent) => void
  dispose: () => Promise<void>
}

async function mount(seed?: (home: string) => void, existing: (host: Context) => ScopedAgent[] = () => []): Promise<Mounted & { boot: ScopedAgent[] }> {
  const home = mkdtempSync(join(tmpdir(), 'a2a-nodebind-'))
  seed?.(home)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const agents = ctx.get('agents') as unknown as FakeAgentsService
  const boot = existing(ctx)
  for (const agent of boot) agents.map.set(String(agent.id), agent as unknown as Agent)
  apply(ctx, {
    apiKey: KEY, session: 'host-nodebind', team: 'dsh', routeTimeoutMs: 5_000, flushTimeoutMs: 300_000,
    announce: false, agentName: 'nodebind-host', peers: [], delegates: [], sessionNodes: true,
    wakeJoinedOnBoot: false, dshHome: home, cardTtlMs: 172_800_000, teamJoinAllowlist: ['*'],
  } as Config)
  const port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  const base = `http://127.0.0.1:${String(port)}`
  return {
    ctx, agents, home, boot,
    post: async (path, body, key = KEY) => await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, body: JSON.stringify(body) }),
    get: async path => await fetch(base + path, { headers: { 'X-API-Key': KEY } }),
    prompt: async (agent) => {
      const sp = ctx.get('systemPrompt') as unknown as { assemble: (c: { scope: object }) => Promise<Parameters<typeof renderPrompt>[0]> }
      return renderPrompt(await sp.assemble({ scope: agent.key }))
    },
    publish: (agent) => {
      agents.map.set(String(agent.id), agent as unknown as Agent)
      ctx.emit('agent/created', { agent: agent as unknown as Agent })
    },
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

const A = 'session-aaaaaaaa11111111'
const B = 'session-bbbbbbbb22222222'

async function nodeWithLayers(m: Mounted, name: string, mutable: Record<string, string>): Promise<void> {
  expect((await m.post('/__dsh_a2a/nodes', { action: 'create', name, label: '总工', role: ['chief'] })).status).toBe(200)
  expect((await m.post('/__dsh_a2a/nodes', { action: 'write-core', name, text: '你是总工，只做路由与裁定。', reason: '首版', expected_sha256: '' })).status).toBe(200)
  expect((await m.post('/__dsh_a2a/nodes', { action: 'write-mutable', name, sections: mutable, reason: '首版', expected_sha256: '' })).status).toBe(200)
}

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

describe('node binding mounts the node layers on the session scope (N2+N3)', () => {
  it('① bind mounts at once, in order, only on the bound session; an unjoined session cannot bind', async () => {
    const m = await mount()
    try {
      const a = makeAgent(m.ctx, A)
      const b = makeAgent(m.ctx, B)
      m.publish(a); m.publish(b)
      await nodeWithLayers(m, 'chief', { 当前状态: '#156 在验收' })
      // Counter-example: not joined yet → refused, nothing mounted.
      const early = await m.post('/__dsh_a2a/nodes', { action: 'bind', name: 'chief', session: A })
      expect(early.status).toBe(409)
      expect(await m.prompt(a)).not.toContain('节点契约')
      expect((await m.post('/__dsh_a2a/join', { id: A })).status).toBe(200)
      // Identity write: loopback without the key is not enough.
      expect((await m.post('/__dsh_a2a/nodes', { action: 'bind', name: 'chief', session: A }, 'wrong')).status).toBe(401)
      const bound = await m.post('/__dsh_a2a/nodes', { action: 'bind', name: 'chief', session: A })
      expect(bound.status).toBe(200)
      expect(((await bound.json()) as { value: { mounted: boolean } }).value.mounted).toBe(true)
      const text = await m.prompt(a)
      const mut = text.indexOf('## 节点自记（a2a:node:mutable）')
      const core = text.indexOf('## 节点契约（a2a:node:core）')
      expect(mut).toBeGreaterThan(-1)
      expect(core).toBeGreaterThan(mut)
      expect(text).toContain('#156 在验收')
      expect(text).toContain('你是总工，只做路由与裁定。')
      expect(text).toContain('本段优先于上方的「节点自记」。')
      expect(NODE_PROMPT.mutable.order).toBeLessThan(NODE_PROMPT.core.order)
      expect(NODE_PROMPT.core.order).toBeLessThan(10200)
      // The other session carries nothing.
      expect(await m.prompt(b)).not.toContain('节点契约')
      // One node per session.
      expect((await m.post('/__dsh_a2a/nodes', { action: 'create', name: 'other' })).status).toBe(200)
      expect((await m.post('/__dsh_a2a/nodes', { action: 'bind', name: 'other', session: A })).status).toBe(409)
      // The view reports the binding and what it froze.
      const view = await (await m.get('/__dsh_a2a/nodes')).json() as { bindings: Array<{ session: string; node: string; mounted: { core_version: number; mutable_version: number } | null }> }
      expect(view.bindings).toEqual([expect.objectContaining({ session: A, node: 'chief', mounted: { node: 'chief', core_version: 1, mutable_version: 1 } })])
      // Unbind removes the sections.
      expect((await m.post('/__dsh_a2a/nodes', { action: 'unbind', session: A })).status).toBe(200)
      expect(await m.prompt(a)).not.toContain('节点契约')
      expect((await m.post('/__dsh_a2a/nodes', { action: 'unbind', session: A })).status).toBe(404)
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('③ `{{x}}` in a layer assembles and stays literal', async () => {
    const m = await mount()
    try {
      const a = makeAgent(m.ctx, A)
      m.publish(a)
      await nodeWithLayers(m, 'chief', { 已知陷阱: '模板里的 {{x}} 和 {{ 不要展开' })
      expect((await m.post('/__dsh_a2a/join', { id: A })).status).toBe(200)
      expect((await m.post('/__dsh_a2a/nodes', { action: 'bind', name: 'chief', session: A })).status).toBe(200)
      expect(await m.prompt(a)).toContain('模板里的 {{x}} 和 {{ 不要展开')
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('④ a mid-session write leaves the head unchanged; the next mount takes the new version', async () => {
    const m = await mount()
    try {
      const a = makeAgent(m.ctx, A)
      m.publish(a)
      await nodeWithLayers(m, 'chief', { 当前重点: '旧重点' })
      expect((await m.post('/__dsh_a2a/join', { id: A })).status).toBe(200)
      expect((await m.post('/__dsh_a2a/nodes', { action: 'bind', name: 'chief', session: A })).status).toBe(200)
      const before = await m.prompt(a)
      const one = await (await m.get('/__dsh_a2a/nodes?name=chief')).json() as { current: { mutable: { sha256: string } } }
      expect((await m.post('/__dsh_a2a/nodes', { action: 'write-mutable', name: 'chief', sections: { 当前重点: '新重点' }, reason: '更新', expected_sha256: one.current.mutable.sha256 })).status).toBe(200)
      // Counter-example to a live provider: the same session's head is byte-identical.
      expect(await m.prompt(a)).toBe(before)
      // The session re-publishes (compact / resume): a fresh scope mounts v2.
      const next = makeAgent(m.ctx, A)
      await a.dispose()
      m.ctx.emit('agent/disposed', { agent: a as unknown as Agent })
      m.publish(next)
      const after = await m.prompt(next)
      expect(after).toContain('新重点')
      expect(after).not.toContain('旧重点')
    } finally {
      await m.dispose()
    }
  }, 20_000)
})

describe('a bad roster or table never stops a session from opening (N2+N3 ②)', () => {
  it('② corrupt nodes.json: agent/created publishes, the bound session opens without node sections', async () => {
    const m = await mount((home) => {
      mkdirSync(join(home, 'a2a'), { recursive: true })
      writeFileSync(join(home, 'a2a', 'nodes.json'), '{ not json')
      writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: [A] }))
      writeFileSync(join(home, 'a2a', 'node-bindings.json'), JSON.stringify({ bindings: [{ session: A, node: 'chief', by: 'human:owner', at: 'x' }] }))
    })
    try {
      const a = makeAgent(m.ctx, A)
      expect(() => { m.publish(a) }).not.toThrow()
      expect(await m.prompt(a)).not.toContain('节点契约')
      const view = await (await m.get('/__dsh_a2a/nodes')).json() as { read_only: string; bindings: Array<{ mounted: unknown }> }
      expect(view.read_only).not.toBe('')
      expect(view.bindings[0]?.mounted).toBeNull()
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('② corrupt node-bindings.json is kept in place, read-only; sessions open; bind is refused 503', async () => {
    const m = await mount((home) => {
      mkdirSync(join(home, 'a2a'), { recursive: true })
      writeFileSync(join(home, 'a2a', 'node-bindings.json'), '[1,2')
    })
    try {
      const a = makeAgent(m.ctx, A)
      expect(() => { m.publish(a) }).not.toThrow()
      expect((await m.post('/__dsh_a2a/join', { id: A })).status).toBe(200)
      expect((await m.post('/__dsh_a2a/nodes', { action: 'create', name: 'chief' })).status).toBe(200)
      expect((await m.post('/__dsh_a2a/nodes', { action: 'bind', name: 'chief', session: A })).status).toBe(503)
      expect(readFileSync(join(m.home, 'a2a', 'node-bindings.json'), 'utf8')).toBe('[1,2')
    } finally {
      await m.dispose()
    }
  }, 20_000)

  it('a tampered version file mounts without that layer (sha check), and the view shows it as null', async () => {
    const m = await mount()
    try {
      const a = makeAgent(m.ctx, A)
      m.publish(a)
      await nodeWithLayers(m, 'chief', { 当前状态: '原文' })
      const file = join(m.home, 'a2a', 'nodes', 'chief', 'mutable-v1.json')
      const v = JSON.parse(readFileSync(file, 'utf8')) as { sections: Record<string, string> }
      v.sections['当前状态'] = '被改过的指令'
      writeFileSync(file, JSON.stringify(v))
      expect((await m.post('/__dsh_a2a/join', { id: A })).status).toBe(200)
      expect((await m.post('/__dsh_a2a/nodes', { action: 'bind', name: 'chief', session: A })).status).toBe(200)
      const text = await m.prompt(a)
      expect(text).toContain('节点契约')
      expect(text).not.toContain('被改过的指令')
      const one = await (await m.get('/__dsh_a2a/nodes?name=chief')).json() as { current: { mutable: unknown; core: unknown } }
      expect(one.current.mutable).toBeNull()
      expect(one.current.core).not.toBeNull()
    } finally {
      await m.dispose()
    }
  }, 20_000)
})

describe('bindings survive a restart and remount on load (N2+N3 补注册)', () => {
  it('a live session at plugin load gets its bound node without a new agent/created', async () => {
    const first = await mount()
    let home = ''
    try {
      const a = makeAgent(first.ctx, A)
      first.publish(a)
      await nodeWithLayers(first, 'chief', { 当前状态: '重启前写的' })
      expect((await first.post('/__dsh_a2a/join', { id: A })).status).toBe(200)
      expect((await first.post('/__dsh_a2a/nodes', { action: 'bind', name: 'chief', session: A })).status).toBe(200)
      home = first.home
    } finally {
      await first.dispose()
    }
    const copyHome = (target: string): void => {
      mkdirSync(join(target, 'a2a'), { recursive: true })
      for (const f of ['nodes.json', 'joined.json', 'node-bindings.json']) writeFileSync(join(target, 'a2a', f), readFileSync(join(home, 'a2a', f)))
      mkdirSync(join(target, 'a2a', 'nodes', 'chief'), { recursive: true })
      for (const f of ['core-v1.json', 'mutable-v1.json']) writeFileSync(join(target, 'a2a', 'nodes', 'chief', f), readFileSync(join(home, 'a2a', 'nodes', 'chief', f)))
    }
    const second = await mount(copyHome, host => [makeAgent(host, A)])
    try {
      const [a] = second.boot
      expect(await second.prompt(a as ScopedAgent)).toContain('重启前写的')
    } finally {
      await second.dispose()
    }
  }, 30_000)
})
