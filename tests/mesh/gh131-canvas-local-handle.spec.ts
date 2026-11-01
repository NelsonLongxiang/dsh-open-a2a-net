// @vitest-environment node
/**
 * gh#131: a canvas member named by one of this host's own `<zone>/<id8>`
 * handles (a fleet edit stores members by handle, gh#41) is the session it
 * names for the local routing tiers — read at route time, never written
 * back (review of PR #151: a rewrite that depends on which peer cards are
 * cached deleted a peer's slot on an id8 collision). Several cases come
 * from that review's repros.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { generateKeyPairSync } from 'node:crypto'
import { signCard } from '../../src/card.ts'
import { bootNode, ghostNode, reservePort, runContext, steerText, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const post = async (url: string, body: unknown): Promise<Record<string, any>> =>
  await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => await r.json() as Record<string, any>)
const url = (p: number): string => `http://127.0.0.1:${String(p)}`

function ownSession(node: MeshNode, id: string): string[] {
  const steered: string[] = []
  const agent = { id: SessionId(id), session: { events: [] as unknown[], title: node.name }, steer(p: unknown): void { steered.push(typeof p === 'string' ? p : JSON.stringify(p)) } } as unknown as Agent
  node.agents.agent = agent
  node.ctx.emit('agent/created', { agent })
  return steered
}

async function pairAB(tag: string, ids: { a: string; b: string }) {
  const [pa, pb] = [await reservePort(), await reservePort()]
  const a = await bootNode({ name: 'A', session: `mesh-131-${tag}-a`, team: 'dsh', sessionNodes: true, port: pa, peers: [url(pb)] })
  const b = await bootNode({ name: 'B', session: `mesh-131-${tag}-b`, team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa)] })
  const steeredA = ownSession(a, ids.a)
  ownSession(b, ids.b)
  await post(`${a.baseUrl}/__dsh_a2a/join`, { id: ids.a })
  await post(`${b.baseUrl}/__dsh_a2a/join`, { id: ids.b })
  return { a, b, steeredA }
}

const IDS = { a: 'session-aaaaaaaa11112222', b: 'session-bbbbbbbb33334444' }

describe('gh#131 a local session named by handle is a local canvas member', () => {
  it('a peer fleet edit naming A\'s session by handle: stored as sent, a dispatch reaches it locally, remove by handle works', async () => {
    const { a, b, steeredA } = await pairAB('fleet', IDS)
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'ops' })).ok).toBe(true)
      const relayed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: 'ops', id: 'dsh/aaaaaaaa' })
      expect(relayed).toMatchObject({ ok: true, members: ['dsh/aaaaaaaa'] })
      const dispatched = await post(`${a.baseUrl}/__dsh_a2a/dispatch`, { team: 'dsh/canvas/ops', message: 'hello team' })
      expect(dispatched.ok, JSON.stringify(dispatched)).toBe(true)
      expect(steeredA.some(text => text.includes('hello team'))).toBe(true)
      const removed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'remove-member', name: 'ops', id: 'dsh/aaaaaaaa' })
      expect(removed).toMatchObject({ ok: true, members: [] })
    } finally { await a.dispose(); await b.dispose() }
  }, 60_000)

  it('review P2-1: a peer removes by handle a member the local control stored by id, and one it stored by handle', async () => {
    const { a, b } = await pairAB('remove', IDS)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'by-id' })
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'by-id', id: IDS.a })
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'by-handle' })
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'by-handle', id: 'dsh/aaaaaaaa' })
      for (const name of ['by-id', 'by-handle']) {
        const removed = await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'remove-member', name, id: 'dsh/aaaaaaaa' })
        expect(removed, name).toMatchObject({ ok: true, members: [] })
      }
    } finally { await a.dispose(); await b.dispose() }
  }, 60_000)

  it('a handle stored before its session joined reaches the session once it joins', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-131-later', team: 'dsh', sessionNodes: true, port: await reservePort() })
    const id = 'session-cccccccc55556666'
    const steered = ownSession(a, id)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'later' })
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'later', id: 'dsh/cccccccc' })).members).toEqual(['dsh/cccccccc'])
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id })
      const dispatched = await post(`${a.baseUrl}/__dsh_a2a/dispatch`, { team: 'dsh/canvas/later', message: 'joined now' })
      expect(dispatched.ok, JSON.stringify(dispatched)).toBe(true)
      expect(steered.some(text => text.includes('joined now'))).toBe(true)
    } finally { await a.dispose() }
  }, 60_000)

  it('review P2-2: an id8 both hosts use keeps the peer\'s slot: a restart and a join on a cold card cache never rewrite the store', async () => {
    const shared = 'session-0123456789abcdef'
    const [pa, pb] = [await reservePort(), await reservePort()]
    const a = await bootNode({ name: 'A', session: 'mesh-131-col-a', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pb)] })
    const b = await bootNode({ name: 'B', session: 'mesh-131-col-b', team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa)] })
    let a2: MeshNode | undefined
    try {
      for (const n of [a, b]) await post(`${n.baseUrl}/__dsh_a2a/join`, { id: shared })
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'g' })
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'g', id: shared })
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'g', id: 'dsh/01234567' })).members).toEqual([shared, 'dsh/01234567'])
      await a.dispose()
      a2 = await bootNode({ name: 'A', session: 'mesh-131-col-a', team: 'dsh', sessionNodes: true, port: await reservePort(), peers: [url(pb)], home: a.home })
      await post(`${a2.baseUrl}/__dsh_a2a/join`, { id: shared })
      // Cold cache, a join: the store is never rewritten.
      expect((await post(`${a2.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'g', id: shared })).members).toEqual([shared, 'dsh/01234567'])
      // The warm route to the peer's member is issue41-canvas-self-skip's own case.
    } finally { await a2?.dispose(); await b.dispose() }
  }, 90_000)

  it('review P3-1: a referral-learned host publishing our handle cannot veto the local reading', async () => {
    const id = 'session-abcdef0011223344'
    const { privateKey } = generateKeyPairSync('ed25519')
    const core = signCard({ name: 'ghost', session: 'mesh-131-ghost', team: 'dsh', capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, privateKey)
    const ghost = await ghostNode({ ...core, sessionTeams: [{ team: 'dsh/abcdef00', name: 'squat', description: 'squat' }] } as never)
    const [pa, pb] = [await reservePort(), await reservePort()]
    const b = await bootNode({ name: 'B', session: 'mesh-131-gb', team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa), ghost.baseUrl] })
    const a = await bootNode({ name: 'A', session: 'mesh-131-ga', team: 'dsh', sessionNodes: true, port: pa, peers: [url(pb)] })
    const steeredA = ownSession(a, id)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id })
      ownSession(b, 'session-bbbbbbbb00000000'); await post(`${b.baseUrl}/__dsh_a2a/join`, { id: 'session-bbbbbbbb00000000' })
      for (let i = 0; i < 10; i += 1) {
        const found = await a.ctx.tools.get('a2a_teams')?.execute({ query: 'abcdef00' }, runContext(a.agents.agent as never)) as Record<string, any>
        if (JSON.stringify(found).includes(ghost.baseUrl)) break
        await new Promise(r => setTimeout(r, 300))
      }
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'ops' })
      await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: 'ops', id: 'dsh/abcdef00' })
      const res = await post(`${a.baseUrl}/__dsh_a2a/dispatch`, { team: 'dsh/canvas/ops', message: 'ghost-proof hello' })
      expect(res.ok, JSON.stringify(res)).toBe(true)
      expect(steeredA.some(t => t.includes('ghost-proof hello'))).toBe(true)
    } finally { await a.dispose(); await b.dispose(); await ghost.close() }
  }, 90_000)

  it('#41 still holds: the initiator named by handle as the only member is skipped, never echoed', async () => {
    const { a, b, steeredA } = await pairAB('self', IDS)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'solo' })
      await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: 'solo', id: 'dsh/aaaaaaaa' })
      const res = await a.ctx.tools.get('a2a_route')?.execute({ team: 'dsh/canvas/solo', message: 'loop?' }, runContext(a.agents.agent as never)) as Record<string, any>
      expect(res.ok).toBe(false)
      expect(String(res.error)).toContain('would loop')
      expect(steeredA.some(t => t.includes('loop?'))).toBe(false)
    } finally { await a.dispose(); await b.dispose() }
  }, 60_000)
  it('review P2: leaving drops a handle-stored membership too — a rejoin is not routed through it', async () => {
    const { a, b, steeredA } = await pairAB('leave', IDS)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'ops' })
      await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: 'ops', id: 'dsh/aaaaaaaa' })
      await post(`${a.baseUrl}/__dsh_a2a/leave`, { id: IDS.a })
      await post(`${a.baseUrl}/__dsh_a2a/join`, { id: IDS.a })
      // The membership left with the session: listing it re-creates nothing, and a dispatch finds no member.
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'ops' })).ok).toBe(true)
      const res = await post(`${a.baseUrl}/__dsh_a2a/dispatch`, { team: 'dsh/canvas/ops', message: 'after rejoin' })
      expect(res.ok).toBe(false)
      expect(steeredA.some(t => t.includes('after rejoin'))).toBe(false)
    } finally { await a.dispose(); await b.dispose() }
  }, 60_000)

  it('review P3-a: removing a local session by id from a team holding both shapes removes both', async () => {
    const { a, b, steeredA } = await pairAB('mixed', IDS)
    try {
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'mix' })
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'mix', id: IDS.a })
      await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: 'mix', id: 'dsh/aaaaaaaa' })
      const removed = await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'remove-member', name: 'mix', id: IDS.a })
      expect(removed).toMatchObject({ ok: true, members: [] })
      const res = await post(`${a.baseUrl}/__dsh_a2a/dispatch`, { team: 'dsh/canvas/mix', message: 'after removal' })
      expect(res.ok).toBe(false)
      expect(steeredA.some(t => t.includes('after removal'))).toBe(false)
    } finally { await a.dispose(); await b.dispose() }
  }, 60_000)
})
