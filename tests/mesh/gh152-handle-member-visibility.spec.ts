// @vitest-environment node
/**
 * gh#152: a canvas member named by one of this host's own `<zone>/<id8>`
 * handles is ROUTABLE (gh#131) — and must be VISIBLE: whoami's teams.canvas,
 * the scoped a2a_teams listing, the state face's canvasTeams and member chips,
 * and the team row's live count read it as the session it names. The two
 * stored shapes of one session (id + handle) collapse to one member on every
 * read face, while the store keeps both (gh#131: never rewritten).
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
const url = (p: number): string => `http://127.0.0.1:${String(p)}`
const state = async (n: MeshNode): Promise<Record<string, any>> => await globalThis.fetch(`${n.baseUrl}/__dsh_a2a/state`).then(async r => await r.json())

const IDS = { a: 'session-aaaaaaaa11112222', b: 'session-bbbbbbbb33334444' }

function ownSession(node: MeshNode, id: string): void {
  const agent = { id: SessionId(id), session: { events: [] as unknown[], title: node.name }, steer(): void {} } as unknown as Agent
  node.agents.agent = agent
  node.ctx.emit('agent/created', { agent })
}

async function pairAB(tag: string) {
  const [pa, pb] = [await reservePort(), await reservePort()]
  // teamScopeInfo on: P3-b's symptom is the SCOPED plane hiding the canvas.
  const a = await bootNode({ name: 'A', session: `mesh-152-${tag}-a`, team: 'dsh', sessionNodes: true, teamScopeInfo: true, port: pa, peers: [url(pb)] } as never)
  const b = await bootNode({ name: 'B', session: `mesh-152-${tag}-b`, team: 'dsh', sessionNodes: true, port: pb, peers: [url(pa)] } as never)
  ownSession(a, IDS.a)
  ownSession(b, IDS.b)
  await post(`${a.baseUrl}/__dsh_a2a/join`, { id: IDS.a })
  await post(`${b.baseUrl}/__dsh_a2a/join`, { id: IDS.b })
  return { a, b }
}

describe('gh#152 a handle-stored member is visible as the session it names', () => {
  it('whoami teams.canvas, the scoped teams listing, state canvasTeams, the member chip and the live count all see it', async () => {
    const { a, b } = await pairAB('fleet')
    try {
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'ops' })
      expect((await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: 'ops', id: 'dsh/aaaaaaaa' })).ok).toBe(true)

      // whoami: the session's canvas teams include the handle-stored one.
      const whoami = await a.ctx.tools.get('a2a_whoami')!.execute({}, runContext(a.agents.agent)) as { ok: boolean; teams: { canvas: string[] } }
      expect(whoami.ok, JSON.stringify(whoami)).toBe(true)
      expect(whoami.teams.canvas).toContain('ops')

      // Scoped a2a_teams: the canvas row shows, with the handle member live.
      const teams = await a.ctx.tools.get('a2a_teams')!.execute({}, runContext(a.agents.agent)) as { ok: boolean; teams: Array<{ team: string; description: string }> }
      const row = teams.teams.find(entry => entry.team === 'dsh/canvas/ops')
      expect(row, JSON.stringify(teams)).toBeDefined()
      expect(row!.description).toBe('canvas team — 1 member, 1 live')

      // State face: the session row carries canvasTeams; the member chip is
      // the local session (join/live facts), not an opaque remote ref.
      const s = await state(a)
      expect(s.sessions.find((row2: any) => row2.id === IDS.a)?.canvasTeams).toEqual(['ops'])
      const ops = s.canvas.teams.find((row2: any) => row2.name === 'ops')
      expect(ops.members).toHaveLength(1)
      expect(ops.members[0]).toMatchObject({ id: IDS.a, team: 'dsh/aaaaaaaa', joined: true, live: true })
      expect(ops.members[0].remote).toBeUndefined()
    } finally { await a.dispose(); await b.dispose() }
  }, 60_000)

  it('both stored shapes of one session read as ONE member everywhere; the store keeps both', async () => {
    const { a, b } = await pairAB('both')
    try {
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'both' })
      await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'both', id: IDS.a })
      // The store keeps both shapes (gh#131: never rewritten).
      const relayed=await post(`${b.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: a.baseUrl, op: 'add-member', name: 'both', id: 'dsh/aaaaaaaa' })
      expect(relayed.members[0]).toBe(IDS.a);expect(relayed.members).toHaveLength(2);expect(relayed.members[1]).toMatch(/^dsh\/aaaaaaaa@[0-9a-f]{8}$/)

      const teams = await a.ctx.tools.get('a2a_teams')!.execute({}, runContext(a.agents.agent)) as { ok: boolean; teams: Array<{ team: string; description: string }> }
      const row = teams.teams.find(entry => entry.team === 'dsh/canvas/both')
      expect(row, JSON.stringify(teams)).toBeDefined()
      expect(row!.description).toBe('canvas team — 1 member, 1 live')

      const s = await state(a)
      const both = s.canvas.teams.find((row2: any) => row2.name === 'both')
      expect(both.members).toHaveLength(1)
      expect(both.members[0]).toMatchObject({ id: IDS.a, live: true })
    } finally { await a.dispose(); await b.dispose() }
  }, 60_000)
})
