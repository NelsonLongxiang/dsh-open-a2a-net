// @vitest-environment node
/**
 * Single owner + mirror: a linked peer dissolves a team it does not own.
 * The team lives on the host that created it; the peer's 解散 goes through
 * its relay (/__dsh_a2a/fleet-canvas-op, op 'remove') to the owner's
 * /a2a/canvas-op, and the owner's change ping clears every linked mirror.
 * Before this, the relay had no team-removal op and the workbench sent the
 * dissolve to the peer's OWN store — the owner never heard of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { signCard } from '../../src/card.ts'
import { bootNode, reservePort, type MeshNode } from './harness.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

const url = (p: number): string => `http://127.0.0.1:${String(p)}`
const post = async (target: string, body?: unknown, headers: Record<string, string> = {}): Promise<Record<string, any>> =>
  await globalThis.fetch(target, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => await r.json() as Record<string, any>)

function ownSession(node: MeshNode, id: string): void {
  const agent = { id: SessionId(id), session: { events: [] as unknown[], title: node.name }, steer(): void {} } as unknown as Agent
  node.agents.agent = agent
  node.ctx.emit('agent/created', { agent })
}
const sweep = async (node: MeshNode): Promise<void> => {
  await node.ctx.tools.get('a2a_teams')?.execute({}, { signal: new AbortController().signal, agent: node.agents.agent } as never)
}
const ownTeams = async (node: MeshNode): Promise<string[]> =>
  ((await post(`${node.baseUrl}/__dsh_a2a/state`)).canvas?.teams as Array<{ name: string }> | undefined ?? []).map(t => t.name)
const mirrored = async (node: MeshNode, peer: string): Promise<string[]> =>
  ((await post(`${node.baseUrl}/__dsh_a2a/state`)).peerOrg as Array<{ url: string; org: Array<{ name: string }> }> | undefined)?.find(r => r.url === peer)?.org.map(t => t.name) ?? []
async function until(check: () => Promise<boolean>, ms = 4_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

/** A signed peer whose card does not seed A back: tracked by A, NOT linked.
 *  It keeps the envelope A stamps on its card reads (every outbound request
 *  carries one). */
async function unlinkedPeer(port: number): Promise<{ server: Server; envelope: () => Record<string, string>; seen: () => Record<string, string> | undefined }> {
  const { privateKey } = generateKeyPairSync('ed25519')
  const base = url(port)
  const card = signCard({ name: 'M', session: 'm-session', team: 'dsh', capabilities: {}, expiresAt: Date.now() + 3_600_000 } as never, privateKey)
  let seen: Record<string, string> | undefined
  const server = createServer((req, res) => {
    if (req.url === '/.well-known/agent-card.json' && req.headers['x-a2a-caller-sig'] !== undefined) {
      seen = Object.fromEntries(['x-a2a-caller', 'x-a2a-caller-url', 'x-a2a-caller-ts', 'x-a2a-caller-sig'].map(h => [h, String(req.headers[h])]))
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(req.url === '/.well-known/agent-card.json' ? JSON.stringify({ ...card, peers: [] }) : '{"ok":true}')
  })
  await new Promise<void>(r => server.listen(port, '127.0.0.1', () => r()))
  const envelope = (): Record<string, string> => {
    const ts = Date.now()
    return {
      'X-A2A-Caller': 'dsh',
      'X-A2A-Caller-Url': base,
      'X-A2A-Caller-Ts': String(ts),
      'X-A2A-Caller-Sig': sign(undefined, Buffer.from(JSON.stringify(['dsh', base, ts]), 'utf8'), privateKey).toString('base64'),
    }
  }
  return { server, envelope, seen: () => seen }
}

describe('fleet dissolve: a linked peer dissolves a team it does not own', () => {
  it('B dissolves A\'s team through its relay; A\'s store and B\'s mirror both drop it; a repeat is a no-op success', async () => {
    const [pa, pb] = [await reservePort(), await reservePort()]
    const a = await bootNode({ name: 'A', session: 'mesh-dissolve-a', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pb)] })
    const b = await bootNode({ name: 'B', session: 'mesh-dissolve-b', team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa)], cardCacheTtlMs: 600_000 })
    const ids = { a: 'session-aaaaaaaa11112222', b: 'session-bbbbbbbb33334444' }
    ownSession(a, ids.a)
    ownSession(b, ids.b)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id: ids.a })
      await post(`${b.baseUrl}/__dsh_a2a/join`, { id: ids.b })
      await sweep(a)
      await sweep(b)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '共建队' })).ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '共建队', id: ids.a })).ok).toBe(true)
      expect(await until(async () => (await mirrored(b, a.baseUrl)).includes('共建队'))).toBe(true)

      // B's own store has no such team: the local control cannot dissolve it.
      expect(await ownTeams(b)).not.toContain('共建队')

      const dissolved = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'remove', name: '共建队' })
      expect(dissolved).toMatchObject({ ok: true, removed: true })
      expect(await ownTeams(a)).not.toContain('共建队')
      // B runs a 10-minute card cache: the mirror clears from the relay's
      // refresh / A's change ping, not from the TTL.
      expect(await until(async () => !(await mirrored(b, a.baseUrl)).includes('共建队'))).toBe(true)

      // Two peers dissolving at once: the second finds it gone — still ok, and says so.
      expect(await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'remove', name: '共建队' })).toMatchObject({ ok: true, removed: false })
      // A team name is required.
      const nameless = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'remove' })
      expect(nameless.ok).toBe(false)
      expect(String(nameless.error)).toMatch(/name are required/)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  }, 60_000)

  it('an unsigned or unlinked caller cannot dissolve, not even by replaying A\'s own envelope; the team stays', async () => {
    const [pa, pm] = [await reservePort(), await reservePort()]
    const m = await unlinkedPeer(pm)
    const a = await bootNode({ name: 'A', session: 'mesh-dissolve-c', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pm)] })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '私有队' })).ok).toBe(true)
      const bare = await post(`${a.baseUrl}/a2a/canvas-op`, { op: 'remove', name: '私有队' })
      expect(bare.ok).toBe(false)
      expect(String(bare.error)).toContain('untrusted-origin')
      const unlinked = await post(`${a.baseUrl}/a2a/canvas-op`, { op: 'remove', name: '私有队' }, m.envelope())
      expect(unlinked.ok).toBe(false)
      expect(String(unlinked.error)).toMatch(/not linked/)
      // A reads M's card (any tracked peer, linked or not) and stamps its
      // envelope on that read. The claim binds no target, so M can replay it
      // at A — where it names A itself.
      ownSession(a, 'session-cccccccc55556666')
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-cccccccc55556666' })
      for (let i = 0; i < 20 && m.seen() === undefined; i += 1) { await sweep(a); await new Promise(r => setTimeout(r, 100)) }
      expect(m.seen()?.['x-a2a-caller-url']).toBe(a.baseUrl)
      const replayed = await post(`${a.baseUrl}/a2a/canvas-op`, { op: 'remove', name: '私有队' }, m.seen()!)
      expect(replayed.ok).toBe(false)
      expect(String(replayed.error)).toMatch(/replayed self envelope/)
      expect(await ownTeams(a)).toContain('私有队')
    } finally {
      await a.dispose()
      m.server.close()
    }
  }, 60_000)
})
