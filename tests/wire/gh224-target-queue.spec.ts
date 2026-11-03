// @vitest-environment node
/**
 * gh#224 on a real host: three receipt-owing deliveries queue for one session, the fourth is
 * refused (-32009) before anything is steered and leaves a failed outcome; a receipt still gets
 * through; once one task is settled, a new delivery is accepted again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootNode, type MeshNode } from '../mesh/harness.ts'

const nodes: MeshNode[] = []
afterEach(async () => { for (const n of nodes.splice(0)) await n.dispose(); vi.unstubAllGlobals() })
async function boot(extra: Record<string, unknown> = {}): Promise<MeshNode> {
  vi.stubGlobal('WebSocket', function () { throw new Error('no socket') })
  const n = await bootNode({ name: 'receiver', session: 'gh224-' + nodes.length, team: 'dsh', sessionNodes: true, teamScopeRouting: true, originClaimWindow: true, ...extra } as never)
  nodes.push(n)
  await fetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: 'session-0123456789abcdef' }) })
  return n
}
async function post(n: MeshNode, id: string, message = 'ordinary request') {
  const r = await fetch(n.baseUrl + '/a2a/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: 'dsh/01234567', caller_session: 'dsh', task_id: id, message, wait: false }) })
  return await r.json() as { code?: number; reason?: string; delivered?: boolean; error?: string }
}

describe('gh#224 per-target queue cap (real host)', () => {
  it('queues three, refuses the fourth before steer, lets a receipt through, and reopens after a settlement', async () => {
    const n = await boot()
    for (let i = 0; i < 3; i++) expect((await post(n, `q-${String(i)}`)).delivered).toBe(true)
    const steered = n.steered.length
    const refused = await post(n, 'q-3')
    expect(refused).toMatchObject({ code: -32009, reason: 'target-queue-full', delivered: false })
    expect(refused.error).toContain('already has 3 task(s)')
    expect(n.steered).toHaveLength(steered)
    const state = await fetch(n.baseUrl + '/__dsh_a2a/state').then(r => r.json()) as { tasks: Array<{ taskId: string }> }
    expect(state.tasks.some(t => t.taskId === 'q-3')).toBe(false)
    // A receipt is terminal: never refused by the cap.
    expect((await post(n, 'q-receipt', '[A2A receipt] task direct-elsewhere completed (done)')).code).not.toBe(-32009)
    // Settle one queued task; the next delivery is accepted.
    await fetch(n.baseUrl + '/__dsh_a2a/tasks/abandon', { method: 'POST', body: JSON.stringify({ task_id: 'q-0' }) })
    expect((await post(n, 'q-4')).delivered).toBe(true)
  })

  it('targetQueueCap 0 turns the cap off', async () => {
    const n = await boot({ targetQueueCap: 0 })
    for (let i = 0; i < 5; i++) expect((await post(n, `off-${String(i)}`)).delivered).toBe(true)
  })
})
