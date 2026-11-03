// @vitest-environment node
/**
 * Review of PR #142: legitimate cross-host receipts under ENFORCE.
 * (1) canvas task to a remote member, answered by the member host's auto-receipt;
 * (2) N2: the peer signs its claim with another spelling of its own address
 *     (reachable alias) — the card key should name it;
 * (3) N2 as reported (LAN URL unreachable from the dialer): the claim's card
 *     cannot be fetched, so no claimKey ever reaches the judge.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, postJson, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const A_ID = 'session-aaaaaaaa11112222'
const B_ID = 'session-bbbbbbbb33334444'
const state = async (n: MeshNode): Promise<Record<string, any>> => await globalThis.fetch(`${n.baseUrl}/__dsh_a2a/state`).then(async r => await r.json())
const until = async (f: () => Promise<boolean>, ms = 8000): Promise<void> => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return; await new Promise(r => setTimeout(r, 50)) } }
const rowOf = async (n: MeshNode, id: string): Promise<Record<string, any> | undefined> => { const s = await state(n); return [...s.tasks, ...(s.archived ?? [])].find((r: any) => r.taskId === id) }
const ledgerRow = (n: MeshNode, id: string): Record<string, any> | undefined => (JSON.parse(readFileSync(join(n.home, 'a2a', 'tasks.json'), 'utf8')).tasks as any[]).find(r => r.taskId === id)
const route = async (n: MeshNode, args: Record<string, unknown>): Promise<Record<string, any>> => await n.ctx.tools.get('a2a_route')!.execute(args, runContext(n.agents.agent)) as Record<string, any>
const delayed = (n: MeshNode, text = 'finished the work'): void => {
  const agent = n.agents.agent as any
  agent.steer = (p: unknown) => { n.steered.push(p); agent.session.events.push({ type: 'user/message', data: { content: typeof p === 'string' ? [{ type: 'text', text: p }] : (p as never).content } }); setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }); n.ctx.emit('agent/status', { agent, status: 'idle' }) }, 150) }
}

describe('r142 legitimate cross-host receipts under enforce', () => {
  it('canvas (scope off, two zones): a task to the remote member settles by the member host\'s auto-receipt', async () => {
    const pA = await reservePort(); const pB = await reservePort()
    const A = await bootNode({ name: 'A', session: 'hostA', team: 'alpha', agentId: A_ID, sessionNodes: true, settlementAuth: 'enforce', port: pA, peers: [`http://127.0.0.1:${pB}`], home: tmpHome() } as never)
    const B = await bootNode({ name: 'B', session: 'hostB', team: 'cargo', agentId: B_ID, sessionNodes: true, settlementAuth: 'enforce', port: pB, peers: [`http://127.0.0.1:${pA}`], home: tmpHome() } as never)
    try {
      expect((await postJson(A.baseUrl, '/__dsh_a2a/join', { id: A_ID })).status).toBe(200)
      expect((await postJson(B.baseUrl, '/__dsh_a2a/join', { id: B_ID })).status).toBe(200)
      await postJson(A.baseUrl, '/__dsh_a2a/canvas', { action: 'create', name: 'ops' })
      await postJson(A.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: A_ID })
      await postJson(A.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: 'cargo/bbbbbbbb' })
      delayed(B)
      const t = await route(A, { team: 'alpha/canvas/ops', message: 'canvas work', async: true })
      expect(t.ok, JSON.stringify(t)).toBe(true)
      expect(ledgerRow(A, String(t.task_id))).toMatchObject({ deliveredTo: 'cargo/bbbbbbbb', peerHost: 'hostB' })
      await until(async () => (await rowOf(A, String(t.task_id)))?.status !== 'pending' || (await state(A)).settlement.refusals.length > 0)
      const s = await state(A)
      expect(s.settlement.refusals, JSON.stringify(s.settlement.refusals)).toEqual([])
      // gh#217: the member that did the work answers for it (it used to be the host's process label).
      expect((await rowOf(A, String(t.task_id)))?.settledBy).toMatchObject({ caller: 'cargo/bbbbbbbb', chain_role: 'target-member' })
    } finally { await A.dispose(); await B.dispose() }
  }, 90_000)

})
