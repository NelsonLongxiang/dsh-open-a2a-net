/**
 * Mesh anomalies — the empirical anomaly-morphology layer. Every scenario
 * here reproduces a failure form CAPTURED ON A REAL FLEET (the 2026-10-17
 * campaign: four cross-machine endpoints, three distinct failure shapes,
 * plus the same-machine settlement oddities), then pins the contract the
 * campaign actually relied on: a hanging peer cannot hold the wire hostage
 * (the 15s HTTP budget aborts), one probe report tells three failure shapes
 * apart, a non-routable caller's fire-and-forget route is honest
 * bookkeeping (visible, never counted as debt), orphan receipts correlate
 * nothing, the content-echo settlement fallback (F5) is intentional and
 * marked, and the dead-letter → late-receipt revival lifecycle works end to
 * end. Layer contract: docs/testing-layers.md §故障矩阵.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { bootNode, craftCard, ghostNode, postJson, reservePort, runContext, type MeshNode } from './harness.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('the decentralized client opens no socket') })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The panel state route's task rows. */
async function stateTasks(node: MeshNode): Promise<{ taskId: string; status: string; receiptExpected?: boolean; settleable?: boolean }[]> {
  const state = await (await globalThis.fetch(`${node.baseUrl}/__dsh_a2a/state`)).json() as { tasks: { taskId: string; status: string; receiptExpected?: boolean; settleable?: boolean }[] }
  return state.tasks
}

interface LedgerView {
  ok: boolean
  tasks: { taskId: string; team: string; peer: string; status: string; deadAt?: number; reason?: string; direction?: string; receiptExpected?: boolean }[]
  archive: { taskId: string; summary?: string }[]
  archivedTotal: number
}

async function ledger(node: MeshNode): Promise<LedgerView> {
  return await node.ctx.tools.get('a2a_tasks')?.execute({}, runContext()) as LedgerView
}

/** A ghost that ACCEPTS the TCP connection and never answers: the
 * hung-process / wedged-proxy shape (captured 2026-10-17 as a cross-machine
 * AbortError on every direct fetch). */
async function hangingNode(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer(() => { /* accept, hold the socket open, never respond */ })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error)))),
  }
}

/** Boot the canonical receipt-owed pair: alpha (joined, routable label) → cargo. */
async function owedPair(): Promise<{ alpha: MeshNode; cargo: MeshNode }> {
  const portA = await reservePort()
  const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', sessionNodes: true, peers: [`http://127.0.0.1:${String(portA)}`] })
  const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha/1a2b3c4d', team: 'alpha', sessionNodes: true, port: portA, peers: [cargo.baseUrl] })
  const selfJoin = await postJson(alpha.baseUrl, '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })
  expect(selfJoin.status).toBe(200)
  return { alpha, cargo }
}

describe('mesh anomalies — hung peers and mixed-fleet diagnosis', () => {
  // The one deliberately slow test in the mesh layer: proving a wedged peer
  // cannot hold the socket open forever means waiting out the real 15s HTTP
  // budget (a2a-client HTTP_TIMEOUT_MS). 25s wall keeps CI safe under load.
  it('a peer that accepts the connection but never answers is cut by the HTTP budget and reported unreachable with the abort detail', async () => {
    // Probing a single target (the fleet stays clean) is exactly the ops
    // move when one endpoint is suspect: one verified-card fetch, one row.
    const hung = await hangingNode()
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-anom-a', team: 'alpha' })
    try {
      const result = await alpha.ctx.tools.get('a2a_probe')?.execute({ url: hung.baseUrl }, runContext()) as { ok: boolean; results: { url: string; reachable: boolean; ms: number; error?: string }[] }
      expect(result.ok).toBe(true)
      expect(result.results).toHaveLength(1)
      const row = result.results[0]
      expect(row.reachable).toBe(false)
      // The abort detail is the captured .85 AbortError form: the probe
      // names WHAT happened instead of a bare boolean, so an operator can
      // tell a wedged process from a dead one.
      expect(row.error).toMatch(/^unreachable:/)
      expect(row.error).toMatch(/abort|timeout|TimeoutError/i)
      expect(row.ms).toBeGreaterThanOrEqual(15_000)
      // Routing stays closed with no verified publishers: the hung node's
      // team never becomes a candidate. Both closed verdicts are valid —
      // the empty-fleet form names the team and the next operator move.
      const routed = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'some-team', message: 'any' }, runContext()) as { ok: boolean; error?: string }
      expect(routed.ok).toBe(false)
      expect(String(routed.error)).toMatch(/no route to "some-team"|team "some-team" is not published/)
    } finally {
      await alpha.dispose()
      await hung.close()
    }
  }, 25_000)

  it('one probe report tells three failure shapes apart: live, expired card, dead port', async () => {
    // The captured cross-machine morning: four endpoints, three distinct
    // shapes in ONE fleet. The probe's whole job is that a single report
    // names each shape precisely — never "some nodes are down".
    const { card } = craftCard({ name: 'skewed', session: 'ghost-anom', team: 'skewed', expiresAt: Date.now() - 1_000 })
    const expired = await ghostNode(card)
    const deadPort = await reservePort() // bound then released: nothing listens
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-anom-c', team: 'cargo' })
    const alpha = await bootNode({
      name: 'alpha', session: 'mesh-anom-b', team: 'alpha',
      peers: [cargo.baseUrl, expired.baseUrl, `http://127.0.0.1:${String(deadPort)}`],
    })
    try {
      const result = await alpha.ctx.tools.get('a2a_probe')?.execute({}, runContext()) as { ok: boolean; results: { url: string; reachable: boolean; team?: string; error?: string }[] }
      expect(result.results).toHaveLength(3)
      const byUrl = new Map(result.results.map(row => [row.url, row]))
      expect(byUrl.get(cargo.baseUrl)).toMatchObject({ reachable: true, team: 'cargo' })
      expect(byUrl.get(expired.baseUrl)?.reachable).toBe(false)
      expect(byUrl.get(expired.baseUrl)?.error).toContain('expired')
      const dead = byUrl.get(`http://127.0.0.1:${String(deadPort)}`)
      expect(dead?.reachable).toBe(false)
      // A dead port is an unreachable transport fact (ECONNREFUSED class),
      // not a card verdict — the two tiers must not blur.
      expect(dead?.error).toMatch(/^unreachable:/)
    } finally {
      await alpha.dispose()
      await cargo.dispose()
      await expired.close()
    }
  })
})

describe('mesh anomalies — receipt-ledger honesty under odd settlement shapes', () => {
  it('a fire-and-forget route from a non-routable caller is visible bookkeeping, never owed debt, yet still settles on a formal receipt', async () => {
    // The captured black-hole form: a caller whose label cannot receive a
    // receipt (bare process team) used to birth invisible debt. Fix ② keeps
    // the row VISIBLE with receiptExpected:false — supervision must not
    // chase it — and an honest receipt still closes it.
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-anom-d', team: 'cargo', sessionNodes: true })
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-anom-e', team: 'alpha', sessionNodes: true, peers: [cargo.baseUrl] })
    try {
      // No join and no live agent in the tool context: the caller label is
      // the bare process label — exactly the non-routable shape.
      const delivered = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'fire and forget', async: true }, runContext()) as { ok: boolean; task_id: string; reply?: string }
      expect(delivered.ok).toBe(true)
      const rows = await stateTasks(alpha)
      expect(rows).toEqual([{ taskId: delivered.task_id, team: 'cargo', peer: cargo.baseUrl, status: 'pending', startedAt: expect.any(Number), direction: 'outbound', receiptExpected: false, settleable: false, brief: 'fire and forget' }])
      // The tasks ledger agrees: visible, not debt.
      const book = await ledger(alpha)
      expect(book.tasks.find(row => row.taskId === delivered.task_id)).toMatchObject({ status: 'pending', receiptExpected: false, direction: 'outbound' })
      // A formal receipt for a receiptless row still settles it (honesty
      // beats bookkeeping): the late envelope closes the visible row.
      await postJson(alpha.baseUrl, '/a2a/direct', { team: 'alpha', message: `[A2A receipt] task ${String(delivered.task_id)} cargo done`, caller_session: 'mesh-anom-d' })
      const settled = await ledger(alpha)
      expect(settled.tasks.some(row => row.taskId === delivered.task_id)).toBe(false)
      expect(settled.archive.filter(row => row.taskId === delivered.task_id)).toHaveLength(1)
    } finally {
      await alpha.dispose()
      await cargo.dispose()
    }
  })

  it('an orphan receipt for a task this node never dispatched correlates nothing and corrupts nothing', async () => {
    // The captured cross-fleet noise form: receipts arriving for tasks born
    // on other nodes (or already forgotten). The ledger must shrug.
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-anom-f', team: 'cargo', sessionNodes: true })
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-anom-g', team: 'alpha', sessionNodes: true, peers: [cargo.baseUrl] })
    try {
      const before = await ledger(alpha)
      const response = await postJson(alpha.baseUrl, '/a2a/direct', { team: 'alpha', message: '[A2A receipt] task 11111111-2222-3333-4444-555555555555 ghost outcome', caller_session: 'mesh-anom-f' })
      expect(response.status).toBeLessThan(500)
      const after = await ledger(alpha)
      expect(after.tasks).toEqual(before.tasks)
      expect(after.archive.filter(row => row.taskId === '11111111-2222-3333-4444-555555555555')).toHaveLength(0)
      expect(after.archivedTotal).toBe(before.archivedTotal)
    } finally {
      await alpha.dispose()
      await cargo.dispose()
    }
  })

  it('a reply that merely echoes a pending task id settles the debt as a marked content echo (F5 fallback)', async () => {
    // The captured "settled by content echo" form: the target demonstrably
    // answered (its reply names the task id) but the formal receipt envelope
    // never rode the reply. F5 is the INTENTIONAL fallback — this pins it as
    // contract so it cannot silently regress into ghost debt.
    const { alpha, cargo } = await owedPair()
    try {
      const delivered = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'echo me', async: true }, runContext(alpha.agents.agent)) as { ok: boolean; task_id: string }
      expect(delivered.ok).toBe(true)
      const owed = await stateTasks(alpha)
      expect(owed.some(row => row.taskId === delivered.task_id && row.receiptExpected === true)).toBe(true)

      // A plain inbound message (no [A2A receipt] header) that names the
      // pending task id: the echo settles, with the audit marker.
      await postJson(alpha.baseUrl, '/a2a/direct', { team: 'alpha', message: `worked on task ${String(delivered.task_id)} and the result follows`, caller_session: 'mesh-anom-f' })
      const settled = await ledger(alpha)
      expect(settled.tasks.some(row => row.taskId === delivered.task_id)).toBe(false)
      const archived = settled.archive.find(row => row.taskId === delivered.task_id)
      expect(archived?.summary).toBe('(settled by content echo)')
    } finally {
      await alpha.dispose()
      await cargo.dispose()
    }
  })

  it('an unsettled debt dead-letters past the stale TTL (reason unconsumed) and a late receipt revives it into the archive', async () => {
    // The captured "回执不回流" form: the target went silent for good. The
    // debt must AGE OUT of the owed view with a reason a supervisor can act
    // on — and a late receipt from a revived target must still settle it.
    const portA = await reservePort()
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-anom-h', team: 'cargo', sessionNodes: true, peers: [`http://127.0.0.1:${String(portA)}`] })
    const alpha = await bootNode({
      name: 'alpha', session: 'mesh-anom-i/1a2b3c4d', team: 'alpha', sessionNodes: true, port: portA, peers: [cargo.baseUrl],
      // Sub-second dead-letter window: the injected seam exists exactly for
      // this lifecycle, which a 24h default would hide from every test.
      taskStaleTtlMs: 300,
    })
    try {
      const selfJoin = await postJson(alpha.baseUrl, '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })
      expect(selfJoin.status).toBe(200)
      const delivered = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'long silence', async: true }, runContext(alpha.agents.agent)) as { ok: boolean; task_id: string }
      expect(delivered.ok).toBe(true)

      // Past the window the row is DEAD with the actionable reason: the
      // settlement chain failed, not fire-and-forget bookkeeping.
      await vi.waitFor(async () => {
        const book = await ledger(alpha)
        expect(book.tasks.find(row => row.taskId === delivered.task_id)).toMatchObject({ status: 'dead', reason: 'unconsumed' })
      }, { timeout: 4_000 })
      const dead = await ledger(alpha)
      expect(dead.tasks.find(row => row.taskId === delivered.task_id)?.deadAt).toEqual(expect.any(Number))

      // The target revives and finally answers: the late receipt settles
      // the dead row into the archive — debt closed, history kept.
      await postJson(alpha.baseUrl, '/a2a/direct', { team: 'alpha', message: `[A2A receipt] task ${String(delivered.task_id)} cargo late but done`, caller_session: 'mesh-anom-h' })
      const revived = await ledger(alpha)
      expect(revived.tasks.some(row => row.taskId === delivered.task_id)).toBe(false)
      expect(revived.archive.filter(row => row.taskId === delivered.task_id)).toHaveLength(1)
    } finally {
      await alpha.dispose()
      await cargo.dispose()
    }
  })
})
