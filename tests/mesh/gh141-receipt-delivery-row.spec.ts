// @vitest-environment node
/**
 * gh#141: across hosts, a receipt never becomes a debt, and the receipt a
 * session (or its host's autosend) sends pays the inbound row the answered
 * delivery was born with. Before the fix both hosts kept rows nothing could
 * settle: the receiver's own inbound row, the receipt's outbound row on the
 * sender, and a fresh inbound row for the receipt on the original caller.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { bootNode, postJson, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'
import { peerPayloadFingerprint } from '../../src/idempotency-store.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const A_ID = 'session-aaaaaaaa11112222'
const B_ID = 'session-bbbbbbbb33334444'
const state = async (n: MeshNode): Promise<Record<string, any>> => await globalThis.fetch(`${n.baseUrl}/__dsh_a2a/state`).then(async r => await r.json())
const archived = async (n: MeshNode, id: string): Promise<Record<string, any> | undefined> => ((await state(n)).archived ?? []).find((r: any) => r.taskId === id)
const route = async (n: MeshNode, args: Record<string, unknown>, agent: Agent = n.agents.agent!): Promise<Record<string, any>> =>
  await n.ctx.tools.get('a2a_route')!.execute(args, runContext(agent)) as Record<string, any>
const owedRow = async (n: MeshNode, id: string): Promise<Record<string, any> | undefined> => ((await state(n)).tasks ?? []).find((r: any) => r.taskId === id)
const C_ID = 'session-cccccccc55556666'

/** A second live, joined session on node n (the harness ships one). From the review of PR #149. */
async function addSession(n: MeshNode, id: string): Promise<Agent> {
  const second = { id: SessionId(id), session: { events: [] as unknown[] }, steer: () => {}, followup(message:unknown){this.steer(message)} } as unknown as Agent
  const svc = n.agents as any
  const first = svc.agent
  svc.roots = () => [first, second].filter(Boolean)
  svc.get = (want: unknown) => [first, second].find(a => a !== undefined && a.id === want)
  n.ctx.emit('agent/created', { agent: second })
  expect((await postJson(n.baseUrl, '/__dsh_a2a/join', { id })).status).toBe(200)
  return second
}
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

async function pair(modeA: 'off' | 'observe' | 'enforce' = 'enforce', modeB = modeA, extra: Record<string, unknown> = {}): Promise<{ A: MeshNode; B: MeshNode }> {
  const pA = await reservePort(); const pB = await reservePort()
  // Settlement-chain tests isolate debt/receipt roles; their hand-built pair has no operator team link.
  const base = { team: 'dsh', sessionNodes: true, teamScopeRouting: false, teamScopeInfo: false, ...extra }
  const A = await bootNode({ ...base, settlementAuth: modeA, name: 'A', session: 'hostA', agentId: A_ID, port: pA, peers: [`http://127.0.0.1:${pB}`], home: tmpHome() } as any)
  const B = await bootNode({ ...base, settlementAuth: modeB, name: 'B', session: 'hostB', agentId: B_ID, port: pB, peers: [`http://127.0.0.1:${pA}`], home: tmpHome() } as any)
  expect((await postJson(A.baseUrl, '/__dsh_a2a/join', { id: A_ID })).status).toBe(200)
  expect((await postJson(B.baseUrl, '/__dsh_a2a/join', { id: B_ID })).status).toBe(200)
  return { A, B }
}

describe('gh#141 cross-host receipts leave no unpayable rows (settlementAuth enforce)', () => {
  // Scope-off: Settlement assertions have no operator team memberships.
  it('manual and auto receipts to the session handle: both ledgers end empty, every row settled on-chain', async () => {
    const { A, B } = await pair()
    try {
      answering(B)
      const auto = await route(A, { team: 'dsh/bbbbbbbb', message: 'auto job', async: true })
      expect(auto.ok, JSON.stringify(auto)).toBe(true)
      await vi.waitFor(async () => { expect((await archived(B, auto.task_id)) !== undefined).toBe(true) }, { timeout: 8000 })
      silent(B)
      const man = await route(A, { team: 'dsh/bbbbbbbb', message: 'manual job', async: true })
      expect(man.ok, JSON.stringify(man)).toBe(true)
      const r = await route(B, { team: 'dsh/aaaaaaaa', message: `[A2A receipt] task ${String(man.task_id)} done`, async: true })
      expect(r.ok, JSON.stringify(r)).toBe(true)
      await vi.waitFor(async () => { expect((await archived(A, man.task_id)) !== undefined && (await archived(B, man.task_id)) !== undefined).toBe(true) }, { timeout: 8000 })

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

  // Scope-off: Settlement assertions have no operator team memberships.
  it('the wire answers a receipt delivery receipt:"none" and books no inbound row for it', async () => {
    const { A, B } = await pair()
    try {
      const steered: string[] = []
      ;(A.agents.agent as any).steer = (p: unknown) => { steered.push(typeof p === 'string' ? p : JSON.stringify(p)) }
      const res = await postJson(A.baseUrl, '/a2a/direct', { team: 'dsh/aaaaaaaa', message: '[A2A receipt] task direct-0badf00d done', caller_session: 'hostA', wait: false, task_id: 'direct-r141wire' })
      const body = await res.json() as Record<string, unknown>
      expect(body).toMatchObject({ delivered: true, receipt: 'none' })
      expect(await owed(A)).toEqual([])
      // P3-2 (review of PR #149): a receipt's steer asks for no receipt back.
      const receipts = steered.filter(t => t.includes('direct-0badf00d'))
      expect(receipts.length).toBe(1)
      expect(receipts[0]).not.toContain('route your outcome back')
    } finally { await A.dispose(); await B.dispose() }
  }, 60_000)
})

describe('gh#141 review of PR #149: only the debtor pays, and only what the creditor accepts', () => {
  for (const mode of ['off', 'observe', 'enforce'] as const) {
    // Scope-off: Settlement assertions have no operator team memberships.
    it(`P2-1 settlementAuth ${mode}: another session on B cannot pay B's row`, async () => {
      const { A, B } = await pair(mode)
      try {
        silent(B)
        const C = await addSession(B, C_ID)
        const job = await route(A, { team: 'dsh/bbbbbbbb', message: 'job for B only', async: true })
        expect(job.ok, JSON.stringify(job)).toBe(true)
        // Session C never received this task; it routes B's receipt to A.
        const forged = await route(B, { team: 'dsh/aaaaaaaa', message: `[A2A receipt] task ${String(job.task_id)} forged by C`, async: true }, C)
        expect(forged.ok, JSON.stringify(forged)).toBe(true)
        await new Promise(r => setTimeout(r, 300))
        expect(await owedRow(B, job.task_id)).toMatchObject({ direction: 'inbound', team: 'dsh/bbbbbbbb' })
        expect(await archived(B, job.task_id)).toBeUndefined()
        const offChain = [expect.objectContaining({ taskId: job.task_id, reason: 'settler-off-chain', enforced: true, settler: expect.objectContaining({ caller: 'dsh/cccccccc' }) })]
        // Under enforce A refuses the forged receipt itself and says so on the wire, so B never judges it;
        // otherwise A takes it as before and B refuses to count it as paid.
        if (mode === 'enforce') {
          expect((await state(A)).settlement.refusals).toEqual(offChain)
          expect((await state(B)).settlement.refusals).toEqual([])
        } else {
          expect((await state(B)).settlement.refusals).toEqual(offChain)
        }
      } finally { await A.dispose(); await B.dispose() }
    }, 60_000)
  }

  // Scope-off: Settlement assertions have no operator team memberships.
  it('P2-2: a receipt the creditor refuses (A enforce) leaves B\'s row owed even when B observes', async () => {
    const { A, B } = await pair('enforce', 'observe')
    try {
      silent(B)
      const C = await addSession(B, C_ID)
      const job = await route(A, { team: 'dsh/bbbbbbbb', message: 'job', async: true })
      expect(job.ok, JSON.stringify(job)).toBe(true)
      await route(B, { team: 'dsh/aaaaaaaa', message: `[A2A receipt] task ${String(job.task_id)} forged`, async: true }, C)
      await new Promise(r => setTimeout(r, 300))
      expect(await owedRow(A, job.task_id)).toMatchObject({ direction: 'outbound', status: 'pending' })
      expect(await owedRow(B, job.task_id)).toMatchObject({ direction: 'inbound', status: 'pending' })
    } finally { await A.dispose(); await B.dispose() }
  }, 60_000)

  // Scope-off: Settlement assertions have no operator team memberships.
  it('P3-3: the paid row records the receipt line as its claimed key\'s outcome (/a2a/query answers it)', async () => {
    const { A, B } = await pair()
    try {
      silent(B)
      const man = await route(A, { team: 'dsh/bbbbbbbb', message: 'manual job', async: true })
      expect(man.ok, JSON.stringify(man)).toBe(true)
      await route(B, { team: 'dsh/aaaaaaaa', message: `[A2A receipt] task ${String(man.task_id)} done`, async: true })
      await vi.waitFor(async () => { expect((await archived(B, man.task_id)) !== undefined).toBe(true) }, { timeout: 8000 })
      const fingerprint = peerPayloadFingerprint({ caller: 'dsh/aaaaaaaa', message: 'manual job', noWait: true, team: 'dsh/bbbbbbbb' })
      const answer = await (await postJson(B.baseUrl, '/a2a/query', { task_id: man.task_id, fingerprint })).json() as Record<string, unknown>
      expect(answer).toMatchObject({ found: true, status: 'completed', reply: 'done' })
    } finally { await A.dispose(); await B.dispose() }
  }, 60_000)

  // Scope-off: Settlement assertions have no operator team memberships.
  it('P3-4: a receipt to a team other than the row\'s receipt target pays nothing', async () => {
    const { A, B } = await pair('observe')
    try {
      silent(B)
      await addSession(A, 'session-dddddddd77778888')
      const job = await route(A, { team: 'dsh/bbbbbbbb', message: 'job', async: true })
      expect(job.ok, JSON.stringify(job)).toBe(true)
      const r = await route(B, { team: 'dsh/dddddddd', message: `[A2A receipt] task ${String(job.task_id)} wrong creditor`, async: true })
      expect(r.ok, JSON.stringify(r)).toBe(true)
      await new Promise(res => setTimeout(res, 300))
      expect(await owedRow(B, job.task_id)).toMatchObject({ direction: 'inbound', status: 'pending' })
      expect(await archived(B, job.task_id)).toBeUndefined()
    } finally { await A.dispose(); await B.dispose() }
  }, 60_000)

  // Scope-off: Settlement assertions have no operator team memberships.
  it('P3-4: a same-host receipt books no outbound row on the sender', async () => {
    const { A, B } = await pair('observe', 'observe', { teamJoinAllowlist: ['dsh/shared'] })
    try {
      silent(B)
      const C = await addSession(B, C_ID)
      for (const who of [B.agents.agent!, C]) await B.ctx.tools.get('a2a_team_join')!.execute({ team: 'dsh/shared', id: String(who.id) }, runContext(who))
      const r = await route(B, { team: 'dsh/bbbbbbbb', message: '[A2A receipt] task direct-feedf00d done', async: true }, C)
      expect(r.ok, JSON.stringify(r)).toBe(true)
      expect((await state(B)).tasks).toEqual([])
      expect(((await state(B)).archived ?? []).filter((x: any) => String(x.brief ?? '').startsWith('[A2A receipt]'))).toEqual([])
    } finally { await A.dispose(); await B.dispose() }
  }, 60_000)
})
