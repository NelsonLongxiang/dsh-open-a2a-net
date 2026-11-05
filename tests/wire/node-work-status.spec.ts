// @vitest-environment node
/**
 * Owner 2026-11-03: the state face tells the board whether each live local session is mid-turn or
 * idle (`status`), and how many receipt-owing tasks wait on it (`queued`, the gh#224 count).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootNode, type MeshNode } from '../mesh/harness.ts'

const nodes: MeshNode[] = []
afterEach(async () => { for (const n of nodes.splice(0)) await n.dispose(); vi.unstubAllGlobals() })
const state = async (n: MeshNode) => await fetch(n.baseUrl + '/__dsh_a2a/state').then(r => r.json()) as { sessions: Array<{ id: string; status?: string; queued?: number }> }

describe('state face: live session work status', () => {
  it('reports the agent status and the receipt-owing queue for each live session', async () => {
    vi.stubGlobal('WebSocket', function () { throw new Error('no socket') })
    const n = await bootNode({ name: 'h', session: 'work-status', team: 'dsh', sessionNodes: true, teamScopeRouting: true, originClaimWindow: true, targetQueueCap: 0, silent: true } as never)
    nodes.push(n)
    await fetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: 'session-0123456789abcdef' }) })
    const agent = n.agents.agent as unknown as { status: string }
    agent.status = 'idle'
    let row = (await state(n)).sessions.find(s => s.id === 'session-0123456789abcdef')!
    expect(row).toMatchObject({ status: 'idle', queued: 0 })
    for (const id of ['w-1', 'w-2']) {
      await fetch(n.baseUrl + '/a2a/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: 'dsh/01234567', caller_session: 'dsh', task_id: id, message: 'work', wait: false }) })
    }
    agent.status = 'running'
    row = (await state(n)).sessions.find(s => s.id === 'session-0123456789abcdef')!
    expect(row).toMatchObject({ status: 'running', queued: 2 })
  })
})
