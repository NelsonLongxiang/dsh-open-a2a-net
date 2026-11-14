// @vitest-environment node
/**
 * superagent design v5, v5-B2: a requester on another host. Team host A binds its canvas team `team` and advertises it
 * on its card as its superagent team. A session of requester host C — one that declares a team on C (S3) and that A's
 * owner linked by hand (a canvas remote reference on A) — routes to A's canvas address with A's fingerprint. A takes it
 * into the team's mailbox; the team acknowledges and, when the owner stops the ticket, sends the ending receipt, both
 * from A's process face on the canvas's behalf: C's own ledger settles its owed row as host-face.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, MockGuiConnection, mockGuiLogin, postJson, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const R_ID = 'session-aaaaaaaa00001111', C_ID = 'session-cccccccc00003333'
const url = (p: number): string => `http://127.0.0.1:${String(p)}`
const login = mockGuiLogin()
const post = async (n: MeshNode, path: string, body: unknown): Promise<Record<string, any>> => await (await globalThis.fetch(`${n.baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...login }, body: JSON.stringify(body) })).json() as Record<string, any>
const get = async (n: MeshNode, path: string): Promise<Record<string, any>> => await (await globalThis.fetch(`${n.baseUrl}${path}`)).json() as Record<string, any>
const tool = async (n: MeshNode, name: string, args: Record<string, unknown>): Promise<Record<string, any>> => await n.ctx.tools.get(name)!.execute(args, runContext(n.agents.agent)) as Record<string, any>
const texts = (n: MeshNode): string[] => n.steered.map(p => typeof p === 'string' ? p : JSON.stringify(p))

describe('superagent v5-B2: a requester on another host', () => {
  it('routes to the team host\'s canvas address and is answered on the canvas\'s behalf — host-face settlement on its own host', async () => {
    const [pA, pC] = await Promise.all([reservePort(), reservePort()])
    const A = await bootNode({ name: 'A', session: 'hostA', team: 'alpha', agentId: R_ID, port: pA, peers: [url(pC)], home: tmpHome(), sessionNodes: true, superagent: true } as never)
    const C = await bootNode({ name: 'C', session: 'hostC', team: 'charlie', agentId: C_ID, port: pC, peers: [url(pA)], home: tmpHome(), silent: true, sessionNodes: true, superagent: true } as never)
    try {
      await A.ctx.plugin(MockGuiConnection)
      for (const [n, id] of [[A, R_ID], [C, C_ID]] as const) expect((await postJson(n.baseUrl, '/__dsh_a2a/join', { id })).status).toBe(200)
      const requester = 'charlie/cccccccc'
      // A: the team is the canvas team `team` (its router), taking agents' requests on the rule `deps`.
      expect(await post(A, '/__dsh_a2a/canvas', { action: 'add-member', name: 'team', id: R_ID })).toMatchObject({ ok: true })
      const rules = [{ name: 'deps', text: 'Bump a pinned dependency when an agent reports it.' }]
      expect(await post(A, '/__dsh_a2a/superagent', { action: 'settings', settings: { canvas: 'team', router: R_ID, sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [requester] }, rules } })).toMatchObject({ ok: true })
      await vi.waitFor(async () => { const s = await get(A, '/__dsh_a2a/superagent'); expect(s.a2a.address !== null && s.a2a.health['a2a-deposit']?.state === 'ready').toBe(true) }, { timeout: 20_000 })
      // A's card advertises the bound canvas as its superagent team.
      const qualified = (await get(A, '/__dsh_a2a/state')).canvas.teams.find((t: any) => t.name === 'team').id as string
      expect(qualified).toMatch(/^alpha\/canvas\/team@[0-9a-f]{8}$/)
      // A's owner links C's session by hand (a canvas remote reference): the transport admits it (Q1).
      expect(await post(A, '/__dsh_a2a/canvas', { action: 'add-member', name: 'requesters', id: requester, peer: url(pC) })).toMatchObject({ ok: true })

      // Design M8/M9: C's team list has A's team, and only a listed team on a joined session can be sent to.
      await vi.waitFor(async () => {
        await get(C, '/__dsh_a2a/state')
        const row = (await get(C, '/__dsh_a2a/superagent/teams')).teams?.find((x: any) => x.remote === true)
        expect(row).toMatchObject({ canvas: 'team', address: qualified, open: true })
      }, { timeout: 30_000 })
      expect(await post(C, '/__dsh_a2a/superagent/teams', { action: 'send', address: 'alpha/canvas/other@00000000', session: C_ID, text: 'x' })).toMatchObject({ ok: false, code: 'not-listed' })
      expect(await post(C, '/__dsh_a2a/superagent/teams', { action: 'send', address: qualified, session: 'session-nobody', text: 'x' })).toMatchObject({ ok: false, code: 'not-joined' })

      // C: a teamless session has no network (S3) …
      const teamless = await tool(C, 'a2a_route', { team: qualified, message: '无团队的请求', async: true })
      expect(teamless.ok).toBe(false)
      // … one that declares a team on C needs no seat on A's team canvas.
      expect(await post(C, '/__dsh_a2a/canvas', { action: 'add-member', name: 'mine', id: C_ID })).toMatchObject({ ok: true })
      const asked = await tool(C, 'a2a_route', { team: qualified, message: '依赖 lib-7 有新版本', async: true })
      expect(asked.ok, JSON.stringify(asked)).toBe(true)
      const taskId = asked.task_id as string

      // A's router hears it as the listed agent's candidate and accepts it.
      await vi.waitFor(() => { expect(texts(A).some(t => t.includes('[superagent candidate]') && t.includes(requester))).toBe(true) }, { timeout: 40_000 })
      const card = texts(A).find(t => t.includes('[superagent candidate]') && t.includes(requester))!
      const trigger = /trigger (\S+) · /.exec(card)![1]!
      const accepted = await tool(A, 'superagent_route', { items: [{ trigger_id: trigger, kind: 'accept', title: 'bump lib-7', scope: 'one dep', reason: 'matches deps', rules: ['deps'] }] })
      expect(accepted.results[0], JSON.stringify(accepted)).toMatchObject({ ok: true })

      // C's owed row is acknowledged (still owed) …
      const owedOnC = async (): Promise<any[]> => (await get(C, '/__dsh_a2a/state')).tasks as any[]
      await vi.waitFor(async () => { expect((await owedOnC()).find(t => t.taskId === taskId)).toMatchObject({ status: 'pending', acknowledgedAt: expect.any(Number) }) }, { timeout: 30_000 })
      // … and settled as host-face once the owner stops the ticket and A sends the ending receipt.
      expect(await post(A, '/__dsh_a2a/superagent', { action: 'stop', ticket_id: accepted.results[0].ticket_id, reason: '验收：结束' })).toMatchObject({ ok: true })
      await vi.waitFor(async () => { expect((await owedOnC()).some(t => t.taskId === taskId)).toBe(false) }, { timeout: 30_000 })
      const archived = (await get(C, '/__dsh_a2a/state')).archived as any[]
      expect(archived.find(r => r.taskId === taskId)).toMatchObject({ outcome: 'abandoned', settledBy: { chain_role: 'host-face' } })
      // The right bar's way in reaches the same mailbox, as the same session.
      const sent = await post(C, '/__dsh_a2a/superagent/teams', { action: 'send', address: qualified, session: C_ID, text: '从右栏发的需求' })
      expect(sent, JSON.stringify(sent)).toMatchObject({ sender: requester })
      await vi.waitFor(() => { expect(texts(A).some(t => t.includes('[superagent candidate]') && t.includes('从右栏发的需求'))).toBe(true) }, { timeout: 40_000 })
    } finally { await A.dispose(); await C.dispose() }
  }, 120_000)
})
