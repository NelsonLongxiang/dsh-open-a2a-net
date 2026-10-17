/**
 * Mesh baseline — the closed loop the product promises, proven between REAL
 * nodes over real HTTP: mutual discovery with persisted peers, gossip
 * propagation through a middle node, the sync route round trip, async
 * receipt settlement (replay included), and cross-node session-team
 * visibility. These are the green-path anchors the fault suite deviates
 * from; layer contract in docs/testing-layers.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootNode, postJson, reservePort, runContext, steerText, type MeshNode } from './harness.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('the decentralized client opens no socket') })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The panel state route's task rows: owed receipts with routing facts. */
async function stateTasks(node: MeshNode): Promise<{ taskId: string; team: string; peer: string; status: string }[]> {
  const state = await (await globalThis.fetch(`${node.baseUrl}/__dsh_a2a/state`)).json() as { tasks: { taskId: string; team: string; peer: string; status: string }[] }
  return state.tasks
}

/** Boot the canonical two-node mutual mesh: alpha <-> cargo on a reserved port. */
async function mutualPair(): Promise<{ alpha: MeshNode; cargo: MeshNode }> {
  const portA = await reservePort()
  // sessionNodes: true mounts the panel state face (/__dsh_a2a/state) the
  // receipt assertions poll; the join surface stays unused (unjoined
  // sessions are invisible on the network by design).
  const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', sessionNodes: true, peers: [`http://127.0.0.1:${String(portA)}`] })
  // alpha's session label is deliberately ROUTABLE (<zone>/<id8>): the
  // receipt contract branches on caller routability, and the closed loop
  // under test is the one where the peer CAN send the receipt back.
  const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha/1a2b3c4d', team: 'alpha', sessionNodes: true, port: portA, peers: [cargo.baseUrl] })
  return { alpha, cargo }
}

describe('mesh baseline — real cross-machine closed loops', () => {
  it('two real nodes discover each other mutually and close a sync route round trip', async () => {
    const { alpha, cargo } = await mutualPair()
    try {
      const listed = await alpha.ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { ok: boolean; teams: { team: string; local?: boolean; origin?: string; via?: string }[] }
      expect(listed.ok).toBe(true)
      const cargoRow = listed.teams.find(row => row.team === 'cargo')
      // The remote row carries the publisher session as origin and the
      // serving peer URL as via — the traceability facts of a fleet row.
      expect(cargoRow?.local).toBeFalsy()
      // Origin carries the publisher session plus its LAN IP when known.
      expect(cargoRow?.origin).toContain('mesh-cargo')
      expect(cargoRow?.via).toBe(cargo.baseUrl)

      const result = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'ping mesh' }, runContext()) as { ok: boolean; reply?: string }
      expect(result.ok).toBe(true)
      expect(result.reply).toContain('ok from cargo:')
      // The delivery steered cargo's agent exactly once — cross-node wire, no local echo.
      expect(cargo.steered).toHaveLength(1)
      expect(steerText(cargo.steered[0])).toContain('ping mesh')
    } finally {
      await alpha.dispose()
      await cargo.dispose()
    }
  })

  it('gossip: a third node is learned through a middle peer and routable', async () => {
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo' })
    const relay = await bootNode({ name: 'relay', session: 'mesh-relay', team: 'relay', peers: [cargo.baseUrl] })
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', peers: [relay.baseUrl] })
    try {
      // The search pass chases one referral hop: relay's card offers cargo.
      const found = await alpha.ctx.tools.get('a2a_teams')?.execute({ query: 'cargo' }, runContext()) as { ok: boolean; teams: { team: string; via?: string }[] }
      expect(found.ok).toBe(true)
      expect(found.teams.some(row => row.team === 'cargo' && row.via === cargo.baseUrl)).toBe(true)

      const result = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'via gossip' }, runContext()) as { ok: boolean; reply?: string }
      expect(result.ok).toBe(true)
      expect(result.reply).toContain('ok from cargo:')
      expect(cargo.steered).toHaveLength(1)
    } finally {
      await alpha.dispose()
      await relay.dispose()
      await cargo.dispose()
    }
  })

  it('an async cross-node task owes its receipt, and a replayed receipt settles the ledger exactly once', async () => {
    const { alpha, cargo } = await mutualPair()
    try {
      // alpha's session joins the network from its own host (the user
      // gesture the join gate demands); its routes then carry the joined
      // session's routable callback address.
      const selfJoin = await postJson(alpha.baseUrl, '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })
      expect(selfJoin.status).toBe(200)
      const delivered = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'long task', async: true }, runContext(alpha.agents.agent)) as { ok: boolean; task_id: string }
      expect(delivered.ok).toBe(true)
      // The owed receipt rides the panel state with the peer candidate recorded.
      const owed = await stateTasks(alpha)
      expect(owed).toEqual([{ taskId: delivered.task_id, team: 'cargo', peer: cargo.baseUrl, status: 'pending', startedAt: expect.any(Number), direction: 'outbound', receiptExpected: true, settleable: true }])

      // The peer's receipt arrives over the real wire; a network replay of
      // the very same receipt body must not double-settle or resurrect debt.
      const receipt = { team: 'alpha', message: `[A2A receipt] task ${String(delivered.task_id)} cargo green`, caller_session: 'mesh-cargo' }
      await postJson(alpha.baseUrl, '/a2a/direct', receipt)
      await postJson(alpha.baseUrl, '/a2a/direct', receipt)
      const settled = await alpha.ctx.tools.get('a2a_tasks')?.execute({}, runContext()) as { ok: boolean; archive: { taskId: string; summary: string }[]; archivedTotal: number }
      expect((await stateTasks(alpha)).some(row => row.taskId === delivered.task_id)).toBe(false)
      expect(settled.archive.filter(row => row.taskId === delivered.task_id)).toHaveLength(1)
      expect(settled.archivedTotal).toBeGreaterThanOrEqual(1)
    } finally {
      await alpha.dispose()
      await cargo.dispose()
    }
  })

  it('a joined session node on a remote host is listed with its facts and routable cross-node', async () => {
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', sessionNodes: true })
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', peers: [cargo.baseUrl] })
    try {
      // cargo's agent went live at boot (harness) and now joins the network
      // from its own host.
      const joined = await postJson(cargo.baseUrl, '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })
      expect(joined.status).toBe(200)

      const listed = await alpha.ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { ok: boolean; teams: { team: string; session?: string; origin?: string; via?: string }[] }
      const sessionRow = listed.teams.find(row => row.team === 'cargo/01234567')
      // Cross-machine session nodes: visible from another host through the
      // publisher's card, carrying the publisher session as origin.
      expect(sessionRow?.session).toBe('mesh-cargo')
      expect(sessionRow?.origin).toContain('mesh-cargo')
      expect(sessionRow?.via).toBe(cargo.baseUrl)

      const result = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo/01234567', message: 'hello session node' }, runContext()) as { ok: boolean; reply?: string }
      expect(result.ok).toBe(true)
      expect(result.reply).toContain('ok from cargo:')
      expect(cargo.steered).toHaveLength(1)
    } finally {
      await alpha.dispose()
      await cargo.dispose()
    }
  })
})
