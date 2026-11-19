/**
 * #713 stage A2: a host whose retained task-delivery correspondence window is full refuses a new delivery before anything
 * is enqueued, and says so with a typed reason through the wire's async and sync responses (sync goes through the
 * receiving host's routeIntoAgentFor) and the caller's client decode. Nothing reaches the target session; no task is born for the refused route.
 */
import { it, expect } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootNode, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'
import { TaskLedger } from '../../src/task-ledger.ts'
import { TASK_DELIVERY_CAP as CAP, type TaskDelivery } from '../../src/task-delivery.ts'

const post = (n: MeshNode, path: string, body: unknown) => fetch(n.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
const state = (n: MeshNode) => fetch(n.baseUrl + '/__dsh_a2a/state').then(r => r.json()) as Promise<any>

/** A home whose ledger already holds a full window of fresh cancelled correspondence (same snapshot shape the ledger writes). */
function fullHome(): string {
  const home = tmpHome(), dir = join(home, 'a2a'), file = join(dir, 'tasks.json')
  mkdirSync(dir, { recursive: true })
  const row = (i: number): TaskDelivery => ({ version: 1, taskId: 'seed-' + String(i), sessionId: 'session-ffffffff00001111', messageId: 'seed-message-' + String(i), fingerprint: 'b'.repeat(64), createdAt: Date.now(), state: 'cancelled' })
  new TaskLedger(file, { warn: () => {} }).reserveDelivery(row(0))
  const snap = JSON.parse(readFileSync(file, 'utf8')) as { taskDeliveries: TaskDelivery[] }
  snap.taskDeliveries = Array.from({ length: CAP }, (_, i) => row(i))
  writeFileSync(file, JSON.stringify(snap))
  return home
}

async function pair(fullB: boolean) {
  const pa = await reservePort(), pb = await reservePort(), au = 'http://127.0.0.1:' + String(pa), bu = 'http://127.0.0.1:' + String(pb)
  const opts = (name: string, team: string, port: number, peers: string[]) => ({ name, session: name, team, port, peers, sessionNodes: true, teamScopeRouting: false, silent: true, asyncNudgeDelayMs: 86_400_000 })
  const a = await bootNode(opts('capA', 'alpha', pa, [bu]))
  const b = await bootNode({ ...opts('capB', 'beta', pb, [au]), ...(fullB ? { home: fullHome() } : {}) })
  for (const n of [a, b]) await post(n, '/__dsh_a2a/join', { id: String(n.agents.agent!.id) })
  const delivered: unknown[] = []
  b.agents.agent!.followup = (m: unknown) => { delivered.push(m) }
  return { a, b, delivered, dispose: async () => { await a.dispose(); await b.dispose() } }
}

/**
 * The route tries this host's local tier first (a miss here), then the full peer: two failures, so the result carries the
 * capacity count and the peer's text, not one typed refusal for the whole route (one host's window is not the network's).
 * The count exists only when the client decoded the peer's typed refusal.
 */
const refused = (result: any) => {
  expect(result.ok).toBe(false)
  expect(result.acceptance).toBeUndefined()
  expect(result.capacityRefusals).toBe(1)
  expect(result.refusal).toBeUndefined()
  expect(result.error).toContain('nothing was sent')
  expect(result.error).toContain('host-wide')
  expect(result.error).not.toMatch(/seed-|session-f/)
}

for (const async of [true, false]) it(`a remote route to a host with a full window is refused typed, nothing sent (async=${String(async)})`, async () => {
  const m = await pair(true)
  try {
    const before = (await state(m.b)).deliveryCapacity
    expect(before).toMatchObject({ status: 'observed', retained: CAP, saturated: true })
    const result = await m.a.ctx.tools.get('a2a_route')!.execute({ team: 'beta/01234567', message: 'work for a full host', async }, runContext(m.a.agents.agent)) as any
    refused(result)
    expect(m.delivered).toEqual([])
    expect((await state(m.b)).deliveryCapacity).toMatchObject({ stored: CAP, retained: CAP })
    // The caller keeps no owed row for a route that was never sent.
    expect((await state(m.a)).tasks.filter((t: any) => t.team === 'beta/01234567')).toEqual([])
  } finally { await m.dispose() }
}, 60_000)

it('control: the same route to a host with room is delivered and carries no refusal', async () => {
  const m = await pair(false)
  try {
    const result = await m.a.ctx.tools.get('a2a_route')!.execute({ team: 'beta/01234567', message: 'work', async: true }, runContext(m.a.agents.agent)) as any
    expect(result).toMatchObject({ ok: true, task_status: 'TASK_STATE_DELIVERED' })
    expect(result.refusal).toBeUndefined()
    expect(m.delivered).toHaveLength(1)
  } finally { await m.dispose() }
}, 60_000)

it('a receipt for an id that was never owed, sent to a full host, is refused typed and inserted nowhere', async () => {
  const m = await pair(true)
  try {
    const before = await state(m.b)
    const result = await m.a.ctx.tools.get('a2a_route')!.execute({ team: 'beta/01234567', message: '[A2A receipt] task t-not-owed done', async: true }, runContext(m.a.agents.agent)) as any
    refused(result)
    expect(m.delivered).toEqual([])
    const after = await state(m.b)
    expect(after.tasks).toEqual(before.tasks)
    expect(after.archived).toEqual(before.archived)
  } finally { await m.dispose() }
}, 60_000)
