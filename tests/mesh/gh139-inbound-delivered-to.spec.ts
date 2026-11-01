// @vitest-environment node
/**
 * Review of PR #142: the wire face's trackInbound deliveredTo wiring has no
 * real-host test (mutating it to undefined leaves the PR suite green).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, postJson, reservePort, runContext, tmpHome } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

describe('r142 inbound deliveredTo', () => {
  it('a delivery to the bare process team records the session face that received it', async () => {
    const pA = await reservePort()
    const B = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', sessionNodes: true, settlementAuth: 'observe', home: tmpHome(), peers: [`http://127.0.0.1:${String(pA)}`] })
    const A = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', agentId: 'session-aaaaaaaa11112222', sessionNodes: true, settlementAuth: 'observe', port: pA, peers: [B.baseUrl] })
    try {
      await postJson(A.baseUrl, '/__dsh_a2a/join', { id: 'session-aaaaaaaa11112222' })
      ;(B.agents.agent as any).steer = (p: unknown) => { B.steered.push(p) }
      const t = await A.ctx.tools.get('a2a_route')!.execute({ team: 'cargo', message: 'work', async: true }, runContext(A.agents.agent)) as Record<string, any>
      expect(t.ok, JSON.stringify(t)).toBe(true)
      const rows = JSON.parse(readFileSync(join(B.home, 'a2a', 'tasks.json'), 'utf8')).tasks as Array<Record<string, any>>
      const inbound = rows.find(r => r.taskId === t.task_id)
      expect(inbound?.direction).toBe('inbound')
      expect(inbound?.deliveredTo, JSON.stringify(inbound)).toBe('cargo/01234567')
    } finally { await A.dispose(); await B.dispose() }
  }, 60_000)
})
