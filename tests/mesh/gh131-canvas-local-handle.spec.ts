// @vitest-environment node
/**
 * gh#131: a canvas member named by one of this host's own `<zone>/<id8>`
 * handles is stored as the session id it names — from a peer's fleet edit,
 * from the local control, and (for a session that joins later) once it joins
 * — so the local routing tiers reach it instead of dialling the directory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootNode, reservePort, runContext, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const post = async (url: string, body: unknown): Promise<Record<string, any>> =>
  await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => await r.json() as Record<string, any>)

function ownSession(node: MeshNode, id: string): string[] {
  const steered: string[] = []
  const agent = { id: SessionId(id), session: { events: [] as unknown[], title: node.name }, steer(p: unknown): void { steered.push(typeof p === 'string' ? p : JSON.stringify(p)) } } as unknown as Agent
  node.agents.agent = agent
  node.ctx.emit('agent/created', { agent })
  return steered
}

describe('gh#131 a local session named by handle is a local canvas member', () => {
  it('a peer fleet edit naming A\'s own session by handle stores A\'s session id, and a dispatch to the team reaches it locally', async () => {
    const [pa, pb] = [await reservePort(), await reservePort()]
    const url = (p: number): string => `http://127.0.0.1:${String(p)}`
    const a = await bootNode({ name: 'A', session: 'mesh-131-a', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pb)] })
    const b = await bootNode({ name: 'B', session: 'mesh-131-b', team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa)] })
    const ids = { a: 'session-aaaaaaaa11112222', b: 'session-bbbbbbbb33334444' }
    const steeredA = ownSession(a, ids.a)
    ownSession(b, ids.b)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id: ids.a })
      await post(`${b.baseUrl}/__dsh_a2a/join`, { id: ids.b })
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'ops' })).ok).toBe(true)
      const relayed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: 'ops', id: 'dsh/aaaaaaaa' })
      expect(relayed.ok, JSON.stringify(relayed)).toBe(true)
      expect(relayed.members).toEqual([ids.a])
      const dispatched = await post(`${a.baseUrl}/__dsh_a2a/dispatch`, { team: 'dsh/canvas/ops', message: 'hello team' })
      expect(dispatched.ok, JSON.stringify(dispatched)).toBe(true)
      expect(steeredA.some(text => text.includes('hello team'))).toBe(true)
      // Removing by the same handle removes the stored session id.
      const removed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'remove-member', name: 'ops', id: 'dsh/aaaaaaaa' })
      expect(removed.ok, JSON.stringify(removed)).toBe(true)
      expect(removed.members ?? []).toEqual([])
    } finally {
      await a.dispose()
      await b.dispose()
    }
  }, 60_000)

  it('a handle stored before its session joined is rewritten when it joins', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-131-c', team: 'dsh', sessionNodes: true, port: await reservePort() })
    const id = 'session-cccccccc55556666'
    ownSession(a, id)
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'later' })).ok).toBe(true)
      const added = await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'later', id: 'dsh/cccccccc' })
      expect(added.members).toEqual(['dsh/cccccccc'])
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id })
      const listed = await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'later', id })
      expect(listed.members).toEqual([id])
    } finally { await a.dispose() }
  }, 60_000)
  it("an id8 both hosts use stays a remote ref when the peer's card publishes it (collision guard)", async () => {
    const [pa, pb] = [await reservePort(), await reservePort()]
    const url = (p: number): string => `http://127.0.0.1:${String(p)}`
    const a = await bootNode({ name: 'A', session: 'mesh-131-d', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pb)] })
    const b = await bootNode({ name: 'B', session: 'mesh-131-e', team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa)] })
    const shared = 'session-0123456789abcdef'
    ownSession(a, shared)
    ownSession(b, shared)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id: shared })
      await post(`${b.baseUrl}/__dsh_a2a/join`, { id: shared })
      // Warm A's card cache with B's card, which publishes dsh/01234567 too.
      for (let i = 0; i < 20; i += 1) {
        const teams = await a.ctx.tools.get('a2a_teams')!.execute({}, runContext(a.agents.agent)) as Record<string, any>
        if (JSON.stringify(teams).includes(b.baseUrl) || JSON.stringify(teams).includes('mesh-131-e')) break
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'both' })).ok).toBe(true)
      const relayed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: 'both', id: 'dsh/01234567' })
      expect(relayed.ok, JSON.stringify(relayed)).toBe(true)
      expect(relayed.members).toEqual(['dsh/01234567'])
    } finally {
      await a.dispose()
      await b.dispose()
    }
  }, 60_000)
})
