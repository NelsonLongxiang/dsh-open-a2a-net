// @vitest-environment node
/**
 * Lifecycle-os report 2026-11-04: a2a_tasks failed every call on 0.6.32+ — its rows were the ledger
 * records spread whole, and those now carry internal facts (the #114 auth record, #139 peerKey /
 * peerHost) the tool's output schema (additionalProperties: false) does not admit. Tests had called
 * the tool definition directly, past the runtime's output validation. This drives the read tools
 * through the REAL tool runtime on two hosts with genuine cross-host ledger rows.
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

type Runtime = { execute: (input: unknown) => Promise<{ isError?: boolean; value?: unknown; error?: unknown }> }
const viaRuntime = async (n: MeshNode, name: string) => {
  const tools = n.ctx.get('tools') as unknown as Runtime
  return await tools.execute({ name, arguments: {}, agent: n.agents.agent, signal: new AbortController().signal, callId: `call-${name}-${String(Math.random()).slice(2, 8)}` } as never)
}

describe('read tools validate against their own output schema (real runtime, real cross-host rows)', () => {
  it('a2a_tasks / a2a_status / a2a_whoami / a2a_teams answer on both hosts after a cross-host canvas task', async () => {
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
      // No final from B: A keeps a pending outbound row (peerKey, peerHost, deliveredTo) and B a pending
      // inbound row with its #114 authorization record — exactly the shapes that broke the schema.
      const t = await route(A, { team: 'alpha/canvas/ops', message: 'canvas work', async: true })
      expect(t.ok, JSON.stringify(t)).toBe(true)
      const rowB = async () => ((await state(B)).tasks as Array<{ taskId: string }>).find(r => r.taskId === String(t.task_id))
      await until(async () => (await rowB()) !== undefined)
      expect(await rowOf(A, String(t.task_id))).toBeDefined()
      for (const n of [A, B]) {
        for (const name of ['a2a_tasks', 'a2a_status', 'a2a_whoami', 'a2a_teams']) {
          const out = await viaRuntime(n, name)
          expect(out.isError, `${n === A ? 'A' : 'B'} ${name}: ${JSON.stringify(out.error ?? out.value).slice(0, 400)}`).not.toBe(true)
        }
      }
      const tasks = (await viaRuntime(A, 'a2a_tasks')).value as { tasks: Array<Record<string, unknown>> }
      const mine = tasks.tasks.find(r => r.taskId === String(t.task_id))!
      expect(mine).toMatchObject({ team: 'alpha/canvas/ops', status: 'pending', deliveredTo: 'cargo/bbbbbbbb' })
      expect(mine).not.toHaveProperty('peerKey')
      expect(mine).not.toHaveProperty('auth')
    } finally { await A.dispose(); await B.dispose() }
  }, 90_000)
})
