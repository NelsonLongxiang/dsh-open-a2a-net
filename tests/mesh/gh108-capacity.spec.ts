// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { bootNode, type MeshNode } from './harness.ts'
import { CANVAS_MEMBER_CAP } from '../../src/canvas-store.ts'
import { createCanvasWire, type CanvasWireResult } from '../../nexus-stage/src/canvas-wire.ts'
let node: MeshNode | undefined
afterEach(async () => { await node?.dispose(); node = undefined; vi.unstubAllGlobals() })

it('gh108 real HTTP: a full host team refuses a new member visibly; duplicate/removal no-ops retain idempotence', async () => {
  vi.stubGlobal('WebSocket', function () { throw new Error('no socket') })
  node = await bootNode({ name: 'capacity-test', session: 'gh108-capacity', team: 'dsh', sessionNodes: true })
  const send = async (body: unknown): Promise<CanvasWireResult> => {
    const r = await fetch(node!.baseUrl + '/__dsh_a2a/canvas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json() as CanvasWireResult['body'] }
  }
  expect((await send({ action: 'create', name: 'Capacity' })).body.ok).toBe(true)
  const ids = Array.from({ length: CANVAS_MEMBER_CAP }, (_, i) => 'peer/' + i.toString(16).padStart(8, '0'))
  for (const id of ids) expect((await send({ action: 'add-member', name: 'Capacity', id })).body.ok).toBe(true)
  const refused = await send({ action: 'add-member', name: 'Capacity', id: 'peer/eeeeffff' })
  expect(refused.status).toBe(200); expect(refused.body.ok).toBe(false); expect(refused.body.error).toBeUndefined()
  expect(refused.body.members).toHaveLength(CANVAS_MEMBER_CAP)
  const notices: string[] = []
  const wire = createCanvasWire({ send, onNotice: (_kind, text) => notices.push(text) })
  expect(await wire.addMembers('Capacity', ['peer/eeeeffff'])).toBe(false)
  expect(notices).toHaveLength(1)
  // Local absence is not creation provenance: idempotent create on a full
  // existing team must never trigger removal of that team on failed add.
  expect(await wire.createTeam('Capacity', ['peer/eeeeffff'], true)).toBe(false)
  const preserved = await fetch(node.baseUrl + '/__dsh_a2a/state').then(r => r.json()) as { canvas: { teams: Array<{ name: string; members: unknown[] }> } }
  expect(preserved.canvas.teams.find(t => t.name === 'Capacity')?.members).toHaveLength(CANVAS_MEMBER_CAP)
  expect(await wire.addMembers('Capacity', [ids[0]!])).toBe(true)
  expect(await wire.removeMembers('Capacity', ['peer/eeeeffff'])).toBe(true)
  expect(await wire.removeTeam('Capacity')).toBe(true)
  expect(await wire.removeTeam('Capacity')).toBe(true)
  expect(notices).toHaveLength(2)
  const state = await fetch(node.baseUrl + '/__dsh_a2a/state').then(r => r.json()) as { canvas: { teams: Array<{ name: string }> } }
  expect(state.canvas.teams.some(t => t.name === 'Capacity')).toBe(false)
}, 30_000)
