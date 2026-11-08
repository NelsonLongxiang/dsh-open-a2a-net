// @vitest-environment node
/**
 * gh#217: with teamScopeRouting ON (the shipped default) a cross-host auto-receipt must reach the
 * caller host. It used to carry this host's process label as caller_session, which the caller's N3
 * gate refuses as a free-form label, so the caller's row never settled. The receipt now names the
 * session that did the work — the handle the caller's operator linked. The mesh harness leaves
 * routing scope off by default, which is why every older cross-host receipt test missed this.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, postJson, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const A_ID = 'session-aaaaaaaa11112222'
const B_ID = 'session-bbbbbbbb33334444'
const state = async (n: MeshNode): Promise<Record<string, any>> => await globalThis.fetch(`${n.baseUrl}/__dsh_a2a/state`).then(async r => await r.json())
const until = async (f: () => Promise<boolean>, ms = 8000): Promise<void> => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return; await new Promise(r => setTimeout(r, 50)) } throw new Error(`until: condition not met within ${String(ms)} ms`) }
const rowOf = async (n: MeshNode, id: string): Promise<Record<string, any> | undefined> => { const s = await state(n); return [...s.tasks, ...(s.archived ?? [])].find((r: any) => r.taskId === id) }
const route = async (n: MeshNode, args: Record<string, unknown>): Promise<Record<string, any>> => await n.ctx.tools.get('a2a_route')!.execute(args, runContext(n.agents.agent)) as Record<string, any>
const delayed = (n: MeshNode, text = 'finished the work'): void => {
  const agent = n.agents.agent as any
  agent.steer = (p: unknown) => { n.steered.push(p); agent.session.events.push({ type: 'user/message', data: { content: typeof p === 'string' ? [{ type: 'text', text: p }] : (p as never).content } }); setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }); n.ctx.emit('agent/status', { agent, status: 'idle' }) }, 150) }
}

describe('gh#217 cross-host auto-receipt with routing scope on', () => {
  for (const sameZone of [false, true]) {
    it(`${sameZone ? 'one zone' : 'two zones'}: the member host's auto-receipt settles the caller's row, nothing refused`, async () => {
      const pA = await reservePort(); const pB = await reservePort()
      const zA = 'alpha'; const zB = sameZone ? 'alpha' : 'cargo'
      const scoped = { sessionNodes: true, settlementAuth: 'enforce', teamScopeRouting: true, teamScopeInfo: true }
      const A = await bootNode({ name: 'A', session: 'hostA', team: zA, agentId: A_ID, port: pA, peers: [`http://127.0.0.1:${pB}`], home: tmpHome(), ...scoped } as never)
      const B = await bootNode({ name: 'B', session: 'hostB', team: zB, agentId: B_ID, port: pB, peers: [`http://127.0.0.1:${pA}`], home: tmpHome(), ...scoped } as never)
      try {
        expect((await postJson(A.baseUrl, '/__dsh_a2a/join', { id: A_ID })).status).toBe(200)
        expect((await postJson(B.baseUrl, '/__dsh_a2a/join', { id: B_ID })).status).toBe(200)
        // The operator links both ways: A's canvas holds B's member, B's canvas holds A's member.
        for (const [n, own, other] of [[A, A_ID, `${zB}/bbbbbbbb`], [B, B_ID, `${zA}/aaaaaaaa`]] as const) {
          await postJson(n.baseUrl, '/__dsh_a2a/canvas', { action: 'create', name: 'ops' })
          await postJson(n.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: own })
          await postJson(n.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: other })
        }
        delayed(B)
        const t = await route(A, { team: `${zA}/canvas/ops`, message: 'canvas work', async: true })
        expect(t.ok, JSON.stringify(t)).toBe(true)
        await until(async () => (await rowOf(A, String(t.task_id)))?.status !== 'pending', 10_000)
        const row = await rowOf(A, String(t.task_id))
        expect(row?.status, JSON.stringify(row)).not.toBe('pending')
        expect(row?.outcome).toBe('completed')
        expect(row?.settledBy).toMatchObject({ caller: `${zB}/bbbbbbbb` })
        expect(row?.settledBy?.chain_role).not.toBe('off-chain')
        expect((await state(A)).settlement.refusals).toEqual([])
        // No refused inbound on A: the receipt was admitted, not bounced.
        expect(((await state(A)).activity as Array<{ dir: string; ok: boolean }>).filter(a => a.dir === 'in' && !a.ok)).toEqual([])
      } finally { await A.dispose(); await B.dispose() }
    }, 90_000)
  }
})
