// @vitest-environment node
/**
 * Owner report (2026-10-29): a team created on one DSH instance often could
 * not be joined from the other. The workbench drops a local session card into
 * the peer's (remote) frame through /__dsh_a2a/fleet-canvas-op with the card's
 * RAW session id, which the peer's canvas-op face refuses (it accepts its own
 * sessions or a zone/id8 handle). The relay now sends the handle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootNode, reservePort, type MeshNode } from './harness.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

const post = async (url: string, body?: unknown): Promise<Record<string, any>> =>
  await globalThis.fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => await r.json() as Record<string, any>)

/** Give a node its own live session (the harness default id is shared by every node). */
function ownSession(node: MeshNode, id: string): void {
  const agent = { id: SessionId(id), session: { events: [] as unknown[], title: node.name }, steer(): void {} } as unknown as Agent
  node.agents.agent = agent
  node.ctx.emit('agent/created', { agent })
}

describe('cross-instance join through the fleet relay', () => {
  it('B relays its own RAW session id into a team A created; A stores B\'s handle', async () => {
    const [pa, pb] = [await reservePort(), await reservePort()]
    const url = (p: number) => `http://127.0.0.1:${String(p)}`
    const a = await bootNode({ name: 'A', session: 'mesh-xjoin-a', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pb)] })
    const b = await bootNode({ name: 'B', session: 'mesh-xjoin-b', team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa)] })
    const ids = { a: 'session-aaaaaaaa11112222', b: 'session-bbbbbbbb33334444' }
    ownSession(a, ids.a)
    ownSession(b, ids.b)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id: ids.a })
      await post(`${b.baseUrl}/__dsh_a2a/join`, { id: ids.b })
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '跨机队' })).ok).toBe(true)
      const relayed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: '跨机队', id: ids.b })
      expect(relayed.ok).toBe(true)
      expect(relayed.members).toContain('dsh/bbbbbbbb')
      // Removing through the relay with the raw id works the same way.
      const removed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'remove-member', name: '跨机队', id: ids.b })
      expect(removed.ok).toBe(true)
      expect(removed.members ?? []).not.toContain('dsh/bbbbbbbb')
    } finally {
      await a.dispose()
      await b.dispose()
    }
  }, 60_000)

  it('PR#96 P2-1: a hanging owner CARD face never gates the relay reply — the op answer returns as soon as it lands', async () => {
    const [pa, pb] = [await reservePort(), await reservePort()]
    const url = (p: number) => `http://127.0.0.1:${String(p)}`
    const a = await bootNode({ name: 'A2', session: 'mesh-xjoin-a2', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pb)] })
    const b = await bootNode({ name: 'B2', session: 'mesh-xjoin-b2', team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa)] })
    const ids = { a: 'session-aaaaaaaa55556666', b: 'session-bbbbbbbb77778888' }
    ownSession(a, ids.a)
    ownSession(b, ids.b)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id: ids.a })
      await post(`${b.baseUrl}/__dsh_a2a/join`, { id: ids.b })
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '挂起队' })).ok).toBe(true)
      // Warm the link and B's card cache for A with one landed relay op first.
      expect((await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: '挂起队', id: ids.b })).ok).toBe(true)
      // Now hang ONLY A's card face: every other route (the op face, the ping
      // face, the test's own post()) still goes through the real network.
      const real = globalThis.fetch
      vi.stubGlobal('fetch', ((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === `${a.baseUrl}/.well-known/agent-card.json` && (init?.method ?? 'GET') === 'GET') {
          return new Promise<Response>(() => { /* never settles: the card face hangs */ })
        }
        return real(input, init)
      }) as typeof fetch)
      const t0 = Date.now()
      const relayed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'remove-member', name: '挂起队', id: ids.b })
      // With the old `await refreshPeerCard` this reply waited on the hung
      // card face (two serial 15s fetch budgets); the pin fails on timeout.
      expect(relayed.ok).toBe(true)
      expect(relayed.members ?? []).not.toContain('dsh/bbbbbbbb')
      expect(Date.now() - t0).toBeLessThan(3_000)
    } finally {
      vi.unstubAllGlobals()
      await a.dispose()
      await b.dispose()
    }
  }, 15_000)
})
