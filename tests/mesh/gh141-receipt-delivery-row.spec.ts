// @vitest-environment node
/**
 * gh#141: across hosts, a receipt never becomes a debt, and the receipt a
 * session (or its host's autosend) sends pays the inbound row the answered
 * delivery was born with. Before the fix both hosts kept rows nothing could
 * settle: the receiver's own inbound row, the receipt's outbound row on the
 * sender, and a fresh inbound row for the receipt on the original caller.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, postJson, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const A_ID = 'session-aaaaaaaa11112222'
const B_ID = 'session-bbbbbbbb33334444'
const state = async (n: MeshNode): Promise<Record<string, any>> => await globalThis.fetch(`${n.baseUrl}/__dsh_a2a/state`).then(async r => await r.json())
const until = async (f: () => Promise<boolean>, ms = 8000): Promise<void> => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return; await new Promise(r => setTimeout(r, 50)) } }
const archived = async (n: MeshNode, id: string): Promise<Record<string, any> | undefined> => ((await state(n)).archived ?? []).find((r: any) => r.taskId === id)
const route = async (n: MeshNode, args: Record<string, unknown>): Promise<Record<string, any>> =>
  await n.ctx.tools.get('a2a_route')!.execute(args, runContext(n.agents.agent)) as Record<string, any>
/** The target answers each steer with a final message (arms the autosend). */
const answering = (n: MeshNode): void => {
  const agent = n.agents.agent as any
  agent.steer = (p: unknown) => {
    agent.session.events.push({ type: 'user/message', data: { content: typeof p === 'string' ? [{ type: 'text', text: p }] : (p as any).content } })
    setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'did it' }] } } }); n.ctx.emit('agent/status', { agent, status: 'idle' }) }, 150)
  }
}
const silent = (n: MeshNode): void => { (n.agents.agent as any).steer = () => {} }
const owed = async (n: MeshNode): Promise<unknown[]> => (await state(n)).tasks.map((t: any) => [t.taskId, t.direction, t.brief])

async function pair(): Promise<{ A: MeshNode; B: MeshNode }> {
  const pA = await reservePort(); const pB = await reservePort()
  const base = { team: 'dsh', sessionNodes: true, settlementAuth: 'enforce' }
  const A = await bootNode({ ...base, name: 'A', session: 'hostA', agentId: A_ID, port: pA, peers: [`http://127.0.0.1:${pB}`], home: tmpHome() } as any)
  const B = await bootNode({ ...base, name: 'B', session: 'hostB', agentId: B_ID, port: pB, peers: [`http://127.0.0.1:${pA}`], home: tmpHome() } as any)
  expect((await postJson(A.baseUrl, '/__dsh_a2a/join', { id: A_ID })).status).toBe(200)
  expect((await postJson(B.baseUrl, '/__dsh_a2a/join', { id: B_ID })).status).toBe(200)
  return { A, B }
}

describe('gh#141 cross-host receipts leave no unpayable rows (settlementAuth enforce)', () => {
  it('manual and auto receipts to the session handle: both ledgers end empty, every row settled on-chain', async () => {
    const { A, B } = await pair()
    try {
      answering(B)
      const auto = await route(A, { team: 'dsh/bbbbbbbb', message: 'auto job', async: true })
      expect(auto.ok, JSON.stringify(auto)).toBe(true)
      await until(async () => (await archived(B, auto.task_id)) !== undefined)
      silent(B)
      const man = await route(A, { team: 'dsh/bbbbbbbb', message: 'manual job', async: true })
      expect(man.ok, JSON.stringify(man)).toBe(true)
      const r = await route(B, { team: 'dsh/aaaaaaaa', message: `[A2A receipt] task ${String(man.task_id)} done`, async: true })
      expect(r.ok, JSON.stringify(r)).toBe(true)
      await until(async () => (await archived(A, man.task_id)) !== undefined && (await archived(B, man.task_id)) !== undefined)

      expect(await owed(A)).toEqual([])
      expect(await owed(B)).toEqual([])
      // The receiver's inbound rows are paid by the receipts it sent, judged on the chain.
      expect(await archived(B, auto.task_id)).toMatchObject({ direction: 'inbound', endedBy: 'receipt', settledBy: { chain_role: 'host-face' } })
      expect(await archived(B, man.task_id)).toMatchObject({ direction: 'inbound', endedBy: 'receipt', summary: 'done', settledBy: { chain_role: 'target' } })
      // The caller's outbound rows settle as before.
      expect(await archived(A, man.task_id)).toMatchObject({ direction: 'outbound', endedBy: 'receipt' })
      // No receipt was booked as a debt on either side.
      expect(((await state(A)).archived ?? []).filter((x: any) => String(x.brief ?? '').startsWith('[A2A receipt]'))).toEqual([])
      expect(((await state(B)).archived ?? []).filter((x: any) => String(x.brief ?? '').startsWith('[A2A receipt]'))).toEqual([])
      expect((await state(A)).settlement.refusals).toEqual([])
      expect((await state(B)).settlement.refusals).toEqual([])
    } finally { await A.dispose(); await B.dispose() }
  }, 60_000)

  it('the wire answers a receipt delivery receipt:"none" and books no inbound row for it', async () => {
    const { A, B } = await pair()
    try {
      silent(A)
      const res = await postJson(A.baseUrl, '/a2a/direct', { team: 'dsh/aaaaaaaa', message: '[A2A receipt] task direct-0badf00d done', caller_session: 'hostA', wait: false, task_id: 'direct-r141wire' })
      const body = await res.json() as Record<string, unknown>
      expect(body).toMatchObject({ delivered: true, receipt: 'none' })
      expect(await owed(A)).toEqual([])
    } finally { await A.dispose(); await B.dispose() }
  }, 60_000)
})
