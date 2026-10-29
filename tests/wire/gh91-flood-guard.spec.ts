// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootNode, type MeshNode } from '../mesh/harness.ts'
import { peerPayloadFingerprint } from '../../src/idempotency-store.ts'

const nodes: MeshNode[] = []
afterEach(async () => { for (const n of nodes.splice(0)) await n.dispose(); vi.unstubAllGlobals() })
async function boot(): Promise<MeshNode> {
  vi.stubGlobal('WebSocket', function () { throw new Error('no socket') })
  const n = await bootNode({ name: 'receiver', session: 'gh91-' + nodes.length, team: 'dsh', sessionNodes: true, teamScopeRouting: true, originClaimWindow: true })
  nodes.push(n)
  const join = await fetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: 'session-0123456789abcdef' }) }).then(r => r.json()) as { team: string }
  expect(join.team).toBe('dsh/01234567')
  return n
}
async function post(n: MeshNode, id: string, message = 'ordinary request', caller = 'dsh', wait = true) {
  const r = await fetch(n.baseUrl + '/a2a/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: 'dsh/01234567', caller_session: caller, task_id: id, message, wait }) })
  return { status: r.status, body: await r.json() as { code?: number; reason?: string; error?: string; task_id?: string; delivered?: boolean; reply?: string; result?: unknown } }
}
function part(transfer: string, file: string, i: number, n: number): string {
  return '[JPFILE-PART v1] ' + JSON.stringify({ v: 1, transfer_id: transfer, file_id: file, part_i: i, part_n: n, payload: 'data' })
}

describe('gh#91 authenticated direct flood brake', () => {
  it('admits 16 ordinary deliveries, rejects the 17th visibly BEFORE steer, and stores a failed query outcome', async () => {
    const n = await boot()
    for (let i = 0; i < 16; i++) expect((await post(n, 'rate-' + i)).body.code).toBeUndefined()
    const calls = n.steered.length
    const refused = await post(n, 'rate-17')
    expect(refused.body).toMatchObject({ code: -32008, reason: 'sender-rate-limited', task_id: 'rate-17' })
    expect(n.steered).toHaveLength(calls)
    const fingerprint = peerPayloadFingerprint({ caller: 'dsh', message: 'ordinary request', noWait: false, team: 'dsh/01234567' })
    const query = await fetch(n.baseUrl + '/a2a/query', { method: 'POST', body: JSON.stringify({ task_id: 'rate-17', fingerprint }) }).then(r => r.json())
    expect(query).toMatchObject({ found: true, status: 'failed' })
    const state = await fetch(n.baseUrl + '/__dsh_a2a/state').then(r => r.json()) as { activity: Array<{ peer: string; ok: boolean }> }
    expect(state.activity.some(x => x.peer === 'dsh' && !x.ok)).toBe(true)
  })
  it('a second host has its OWN budget even for the same caller', async () => {
    const a = await boot(); const b = await boot()
    for (let i = 0; i < 16; i++) await post(a, 'a-' + i)
    expect((await post(a, 'a-over')).body.code).toBe(-32008)
    expect((await post(b, 'b-first')).body.code).toBeUndefined()
    expect(b.steered).toHaveLength(1)
  })
  it('replays keep their existing 409 semantics and consume no fresh delivery quota', async () => {
    const n = await boot()
    await post(n, 'once')
    for (let i = 0; i < 18; i++) expect((await post(n, 'once')).status).toBe(409)
    for (let i = 0; i < 15; i++) expect((await post(n, 'fresh-' + i)).body.code).toBeUndefined()
    expect((await post(n, 'over')).body.reason).toBe('sender-rate-limited')
    expect(n.steered).toHaveLength(16)
  })
  it('17 declared parts and malformed part messages are rejected without steering', async () => {
    const n = await boot()
    expect((await post(n, 'declared-over', part('t', 'f', 1, 17))).body.reason).toBe('file-parts-exceeded')
    expect((await post(n, 'malformed', '[JPFILE-PART v1] broken')).body.reason).toBe('file-part-invalid')
    expect(n.steered).toHaveLength(0)
  })
  it('counts a transfer across files, rejects its 17th part, and does not reinject duplicate part coordinates', async () => {
    const n = await boot()
    await post(n, 'p0', part('transfer', 'first-file', 1, 1))
    expect((await post(n, 'duplicate-new-task', part('transfer', 'first-file', 1, 1))).body.reason).toBe('file-part-duplicate')
    for (let i = 1; i < 16; i++) expect((await post(n, 'p' + i, part('transfer', 'file-' + i, 1, 1))).body.code).toBeUndefined()
    expect((await post(n, 'p16', part('transfer', 'another-file', 1, 1))).body.reason).toBe('file-parts-exceeded')
    expect(n.steered).toHaveLength(16)
  })
  it('the async path shares the same pre-steer brake', async () => {
    const n = await boot()
    for (let i = 0; i < 16; i++) expect((await post(n, 'async-' + i, 'ordinary request', 'dsh', false)).body.delivered).toBe(true)
    const calls = n.steered.length
    expect((await post(n, 'async-over', 'ordinary request', 'dsh', false)).body).toMatchObject({ reason: 'sender-rate-limited', delivered: false })
    expect(n.steered).toHaveLength(calls)
  })
  it('does not spend quota on caller-admission failures', async () => {
    const n = await boot()
    for (let i = 0; i < 18; i++) expect((await post(n, 'bad-' + i, 'ordinary request', 'dsh/99998888')).body.code).toBe(-32000)
    expect((await post(n, 'good')).body.code).toBeUndefined()
    expect(n.steered).toHaveLength(1)
  })
})
