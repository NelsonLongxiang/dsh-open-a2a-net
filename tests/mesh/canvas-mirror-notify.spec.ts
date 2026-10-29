// @vitest-environment node
/**
 * Owner ruling 2026-10-29 — canvas sync is single owner + mirror: a team lives
 * on the host that created it, peers mirror it from that host's full card and
 * edit it through the fleet relay. A canvas change pings the linked peers
 * (/a2a/canvas-changed) so their mirror refreshes now instead of when the card
 * cache lapses. B runs with a 10-minute card cache here, so every refresh the
 * test sees came from the ping or the relay, never from the TTL.
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

/** The org B's state face currently mirrors for one peer. */
async function mirrored(node: MeshNode, peer: string): Promise<Array<{ name: string; members: string[] }>> {
  const state = await post(`${node.baseUrl}/__dsh_a2a/state`)
  return (state.peerOrg as Array<{ url: string; org: Array<{ name: string; members: string[] }> }> | undefined)?.find(row => row.url === peer)?.org ?? []
}

async function sweep(node: MeshNode): Promise<void> {
  await node.ctx.tools.get('a2a_teams')?.execute({}, { signal: new AbortController().signal, agent: node.agents.agent } as never)
}

async function until(check: () => Promise<boolean>, ms = 4_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

/** A signed stand-in peer that records which paths it was POSTed. */
async function fakePeer(port: number, peers: string[]): Promise<{ server: Server; posts: string[]; envelope: () => Record<string, string>; cardReads: () => number }> {
  const { privateKey } = generateKeyPairSync('ed25519')
  const base = url(port)
  const card = signCard({ name: 'M', session: 'm-session', team: 'dsh', capabilities: {}, expiresAt: Date.now() + 3_600_000 } as never, privateKey)
  const posts: string[] = []
  let reads = 0
  const server = createServer((req, res) => {
    if (req.url === '/.well-known/agent-card.json') {
      reads += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ...card, peers }))
      return
    }
    req.resume()
    req.on('end', () => {
      posts.push(req.url ?? '')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
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
  return { server, posts, envelope, cardReads: () => reads }
}

describe('canvas single owner + mirror: change notification', () => {
  it('an owner-side change and a relayed edit both reach the mirror without waiting for the card TTL', async () => {
    const [pa, pb] = [await reservePort(), await reservePort()]
    const a = await bootNode({ name: 'A', session: 'mesh-mirror-a', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pb)] })
    const b = await bootNode({ name: 'B', session: 'mesh-mirror-b', team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa)], cardCacheTtlMs: 600_000 })
    const ids = { a: 'session-aaaaaaaa11112222', b: 'session-bbbbbbbb33334444' }
    ownSession(a, ids.a)
    ownSession(b, ids.b)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id: ids.a })
      await post(`${b.baseUrl}/__dsh_a2a/join`, { id: ids.b })
      // Warm both card caches once with a directory sweep (the a2a_teams tool):
      // bilateral seeds → each side holds the other's FULL card.
      await sweep(a)
      await sweep(b)
      expect(await until(async () => (await post(`${b.baseUrl}/__dsh_a2a/state`)).peerOrg?.some((row: { url: string }) => row.url === a.baseUrl) === true)).toBe(true)

      // 1. Owner-side create: B's mirror shows the new frame (ping, not TTL).
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '镜像队' })).ok).toBe(true)
      expect(await until(async () => (await mirrored(b, a.baseUrl)).some(e => e.name === '镜像队'))).toBe(true)

      // 2. Owner-side add-member: the member shows up in B's mirror.
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '镜像队', id: ids.a })).ok).toBe(true)
      expect(await until(async () => (await mirrored(b, a.baseUrl)).find(e => e.name === '镜像队')?.members.includes('dsh/aaaaaaaa') === true)).toBe(true)

      // 3. B edits A's team through the relay: B's mirror is current when the relay returns.
      const relayed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: '镜像队', id: ids.b })
      expect(relayed.ok).toBe(true)
      expect((await mirrored(b, a.baseUrl)).find(e => e.name === '镜像队')?.members).toContain('dsh/bbbbbbbb')

      // 4. Removal propagates the same way (no tombstones: the owner's store is the truth).
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'remove-member', name: '镜像队', id: 'dsh/bbbbbbbb' })).ok).toBe(true)
      expect(await until(async () => (await mirrored(b, a.baseUrl)).find(e => e.name === '镜像队')?.members.includes('dsh/bbbbbbbb') === false)).toBe(true)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  }, 60_000)

  it('a tracked peer that is NOT linked is never pinged; unsigned and untracked pings are refused', async () => {
    const [pa, pm, px] = [await reservePort(), await reservePort(), await reservePort()]
    // M is seeded by A, but M's card does not seed A back: tracked, not linked.
    const m = await fakePeer(pm, [])
    // X seeds nobody and nobody seeds X: a signed stranger.
    const x = await fakePeer(px, [])
    const a = await bootNode({ name: 'A', session: 'mesh-mirror-c', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pm)] })
    try {
      await post(`${a.baseUrl}/__dsh_a2a/state`)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '私有队' })).ok).toBe(true)
      await new Promise(r => setTimeout(r, 1_200))
      expect(m.posts).not.toContain('/a2a/canvas-changed')

      // No envelope at all: no caller URL, so not a tracked peer.
      expect((await post(`${a.baseUrl}/a2a/canvas-changed`, {})).ok).toBe(false)
      // M's URL with a bad signature: tracked, so the claim is checked — and fails.
      const forged = await post(`${a.baseUrl}/a2a/canvas-changed`, {}, { ...m.envelope(), 'X-A2A-Caller-Sig': Buffer.alloc(64).toString('base64') })
      expect(forged.ok).toBe(false)
      expect(String(forged.error)).toMatch(/untrusted-origin/)

      // A signed stranger is refused before A fetches anything from it.
      const before = x.cardReads()
      const stranger = await post(`${a.baseUrl}/a2a/canvas-changed`, {}, x.envelope())
      expect(stranger.ok).toBe(false)
      expect(String(stranger.error)).toMatch(/not a tracked peer/)
      expect(x.cardReads()).toBe(before)

      // A tracked peer's signed ping is taken (it only makes A re-read M's card).
      const tracked = await post(`${a.baseUrl}/a2a/canvas-changed`, {}, m.envelope())
      expect(tracked).toMatchObject({ ok: true, refreshed: 1, deferred: 0 })
      // …and a second one inside the gap is deferred to a trailing refresh, never dropped.
      expect(await post(`${a.baseUrl}/a2a/canvas-changed`, {}, m.envelope())).toMatchObject({ ok: true, refreshed: 0, deferred: 1 })
    } finally {
      await a.dispose()
      m.server.close()
      x.server.close()
    }
  }, 60_000)
})
