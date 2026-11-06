// @vitest-environment node
/**
 * #125 production data (2026-11-03, .156 on 0.6.33, observe): two owed rows were settled by a CONTENT
 * ECHO from an off-chain settler — a relay quoting the task id, and another task's receipt mentioning
 * it in passing. An echo is weak evidence: under observe it is now judged as enforce, so only an
 * on-chain settler's echo settles. Formal receipt headers keep observing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, postJson, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const A_ID = 'session-aaaaaaaa11112222'
const B_ID = 'session-bbbbbbbb33334444'
const state = async (n: MeshNode): Promise<Record<string, any>> => await globalThis.fetch(`${n.baseUrl}/__dsh_a2a/state`).then(async r => await r.json())
const until = async (f: () => Promise<boolean>, ms = 8000): Promise<void> => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return; await new Promise(r => setTimeout(r, 50)) } }
const rowOf = async (n: MeshNode, id: string): Promise<Record<string, any> | undefined> => { const s = await state(n); return [...s.tasks, ...(s.archived ?? [])].find((r: any) => r.taskId === id) }
const route = async (n: MeshNode, args: Record<string, unknown>): Promise<Record<string, any>> => await n.ctx.tools.get('a2a_route')!.execute(args, runContext(n.agents.agent)) as Record<string, any>
const delayed = (n: MeshNode, text = 'finished the work'): void => {
  const agent = n.agents.agent as any
  agent.steer = (p: unknown) => { n.steered.push(p); agent.session.events.push({ type: 'user/message', data: { content: typeof p === 'string' ? [{ type: 'text', text: p }] : (p as never).content } }); setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }); n.ctx.emit('agent/status', { agent, status: 'idle' }) }, 150) }
}

describe('#125 content echo is judged as enforce under observe', () => {
  it('an off-chain relay quoting the task id leaves the row owed; the target member mentioning it settles it', async () => {
    const pA = await reservePort(); const pB = await reservePort()
    const scoped = { sessionNodes: true, settlementAuth: 'observe', teamScopeRouting: true, teamScopeInfo: true }
    const A = await bootNode({ name: 'A', session: 'hostA', team: 'alpha', agentId: A_ID, port: pA, peers: [`http://127.0.0.1:${pB}`], home: tmpHome(), ...scoped } as never)
    const B = await bootNode({ name: 'B', session: 'hostB', team: 'cargo', agentId: B_ID, port: pB, peers: [`http://127.0.0.1:${pA}`], home: tmpHome(), ...scoped } as never)
    try {
      await postJson(A.baseUrl, '/__dsh_a2a/join', { id: A_ID })
      await postJson(B.baseUrl, '/__dsh_a2a/join', { id: B_ID })
      for (const [n, own, other] of [[A, A_ID, 'cargo/bbbbbbbb'], [B, B_ID, 'alpha/aaaaaaaa']] as const) {
        await postJson(n.baseUrl, '/__dsh_a2a/canvas', { action: 'create', name: 'ops' })
        await postJson(n.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: own })
        await postJson(n.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: other })
      }
      B.agents.agent!.followup=()=>{} // The echo judge, not an automatic final, must settle this task.
      const t = await route(A, { team: 'alpha/canvas/ops', message: 'canvas work', async: true })
      expect(t.ok, JSON.stringify(t)).toBe(true)
      const id = String(t.task_id)
      // 1. An off-chain relay (this host's own process face, not the target) quotes the task id.
      const relay = await globalThis.fetch(`${A.baseUrl}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: 'alpha/aaaaaaaa', caller_session: 'alpha', message: `[转达] task ${id} 已完成`, wait: false }) })
      expect(relay.status).toBe(200)
      await until(async () => (await state(A)).settlement.refusals.some((r: { taskId: string }) => r.taskId === id))
      expect((await rowOf(A, id))?.status).toBe('pending')
      const refusal = (await state(A)).settlement.refusals.find((r: { taskId: string }) => r.taskId === id)
      expect(refusal).toMatchObject({ reason: 'echo-off-chain', enforced: true })
      // 2. The member that got the task mentions it (no receipt header): an on-chain echo still settles.
      const note = await route(B, { team: 'alpha/aaaaaaaa', message: `进度：task ${id} 做完了`, async: true })
      expect(note.ok, JSON.stringify(note)).toBe(true)
      await until(async () => (await rowOf(A, id))?.status !== 'pending')
      expect((await rowOf(A, id))?.settledBy).toMatchObject({ caller: 'cargo/bbbbbbbb' })
    } finally { await A.dispose(); await B.dispose() }
  }, 90_000)
})
