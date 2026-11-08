// @vitest-environment node
/**
 * superagent design v4, PR-C2: a member on another host. Team host A runs the engine and its router; member host B serves
 * A's team with its session. A pins B's key (from B's signed card) for the member ref; B pins A's key for the team. Work
 * goes A → B and reports B → A as signed, body-bound requests — no A2A route, no ledger debt. An impostor host E, sharing
 * B's zone label and the member's id8 but not B's key, can neither report for the member nor be assigned work.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, postJson, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const R_ID = 'session-aaaaaaaa00001111', B_ID = 'session-bbbbbbbb00002222', E_ID = 'session-bbbbbbbb99998888'
const url = (p: number): string => `http://127.0.0.1:${String(p)}`
const sa = async (n: MeshNode, body: unknown): Promise<Record<string, any>> => await (await postJson(n.baseUrl, '/__dsh_a2a/superagent', body)).json() as Record<string, any>
const state = async (n: MeshNode): Promise<Record<string, any>> => await (await globalThis.fetch(`${n.baseUrl}/__dsh_a2a/superagent`)).json() as Record<string, any>
const tool = async (n: MeshNode, name: string, args: Record<string, unknown>): Promise<Record<string, any>> => await n.ctx.tools.get(name)!.execute(args, runContext(n.agents.agent)) as Record<string, any>
const texts = (n: MeshNode): string[] => n.steered.map(p => typeof p === 'string' ? p : JSON.stringify(p))

describe('superagent members on other hosts', () => {
  for (const sameZone of [true, false]) {
    it(`${sameZone ? 'one zone label (instances on one machine)' : 'distinct zones (physical nodes)'}: assign A→B, report B→A, impostor refused`, async () => {
      const [pA, pB, pE] = await Promise.all([reservePort(), reservePort(), reservePort()])
      const zA = sameZone ? 'dsh' : 'alpha', zB = sameZone ? 'dsh' : 'bravo'
      const common = { sessionNodes: true, superagent: true }
      // B's and E's agents only record what reaches them (they work slowly): reports are explicit tool calls.
      const A = await bootNode({ name: 'A', session: 'hostA', team: zA, agentId: R_ID, port: pA, peers: [url(pB), url(pE)], home: tmpHome(), ...common } as never)
      const B = await bootNode({ name: 'B', session: 'hostB', team: zB, agentId: B_ID, port: pB, peers: [url(pA)], home: tmpHome(), silent: true, ...common } as never)
      const E = await bootNode({ name: 'E', session: 'hostE', team: zB, agentId: E_ID, port: pE, peers: [url(pA)], home: tmpHome(), silent: true, ...common } as never)
      try {
        for (const [n, id] of [[A, R_ID], [B, B_ID], [E, E_ID]] as const) expect((await postJson(n.baseUrl, '/__dsh_a2a/join', { id })).status).toBe(200)
        const member = `${zB}/bbbbbbbb`
        expect(await sa(A, { action: 'settings', settings: { router: R_ID } })).toMatchObject({ ok: true })
        // E publishes the same handle: without naming B the owner could not tell them apart — naming B pins B's key.
        expect(await sa(A, { action: 'add-remote-member', ref: member, peer: url(pB) })).toMatchObject({ ok: true })
        const pinned = (await state(A)).executor.remoteMembers
        expect(pinned).toHaveLength(1)
        expect(pinned[0]).toMatchObject({ url: url(pB) })
        // B and E both serve A's team (each pins A's key); only B is A's member.
        const served = await sa(B, { action: 'serve-team', peer: url(pA), members: [B_ID] }); expect(served, JSON.stringify(served)).toMatchObject({ ok: true })
        expect(await sa(E, { action: 'serve-team', peer: url(pA), members: [E_ID] })).toMatchObject({ ok: true })

        // A request on A becomes a ticket; the executor assigns it to B's session across hosts.
        const asked = await sa(A, { action: 'request', text: '跨主机：给节点列表加搜索框' })
        await vi.waitFor(() => { expect(texts(A).some(t => t.includes(asked.triggerId))).toBe(true) }, { timeout: 10_000 })
        const routed = await tool(A, 'superagent_route', { items: [{ trigger_id: asked.triggerId, kind: 'accept', title: '搜索框', scope: '小', reason: '属主', acknowledgement: '收到' }] })
        const ticketId = routed.results[0].ticket_id as string
        await vi.waitFor(() => { expect(texts(B).some(t => t.includes('[superagent assignment]') && t.includes(ticketId))).toBe(true) }, { timeout: 10_000 })
        expect(texts(E).some(t => t.includes('[superagent assignment]'))).toBe(false)
        expect((await state(A)).executor.bindings).toMatchObject([{ ticketId }])

        // PR-F: the owner adds a message; B's member acknowledges it by its trigger id — signed to A, a reply on the thread.
        const extra = await sa(A, { action: 'request', text: '补充：搜索要支持拼音', thread: asked.thread })
        await vi.waitFor(() => { expect(texts(B).some(t => t.includes('[superagent input]') && t.includes(`trigger ${String(extra.triggerId)}`))).toBe(true) }, { timeout: 10_000 })
        expect(await tool(B, 'a2a_ticket_ack', { trigger_id: extra.triggerId, text: '收到，会支持拼音。' })).toMatchObject({ ok: true, ticketId })
        await vi.waitFor(async () => { expect((await state(A)).threads.some((t: any) => t.replies.some((r: any) => r.message.text === '收到，会支持拼音。'))).toBe(true) }, { timeout: 10_000 })
        // The impostor cannot acknowledge for the member either.
        expect((await tool(E, 'a2a_ticket_ack', { trigger_id: extra.triggerId, text: '冒名确认' })).ok).toBe(false)

        // The impostor's report for the same handle is refused on A (another key); the ticket stays open.
        const forged = await tool(E, 'a2a_ticket_report', { state: 'ready', summary: 'forged by an instance sharing the handle' })
        expect(forged.ok, JSON.stringify(forged)).toBe(false)
        expect((await state(A)).tickets[0].ended).toBeUndefined()
        // An unsigned assignment to B is refused; a signed one from E (not A's key) is refused too.
        const unsigned = await (await postJson(B.baseUrl, '/a2a/superagent-member', { op: 'assign', member: member, text: 'unsigned work' })).json() as Record<string, any>
        expect(unsigned).toMatchObject({ ok: false, code: 'untrusted-origin' })
        // PR-F: identity refusals are counted where they happen — the impostor's acknowledgement and report on A, the
        // unsigned assignment on B.
        const onA = (await state(A)).refusals.counts as Record<string, number>
        expect((onA['superagent-not-signer'] ?? 0) + (onA['superagent-not-member'] ?? 0), JSON.stringify(onA)).toBe(2)
        expect((await state(B)).refusals.counts).toMatchObject({ 'superagent-untrusted-origin': 1 })

        // B's member reports ready: A takes it (key pinned), the ticket completes, A's router hears the report.
        const report = await tool(B, 'a2a_ticket_report', { state: 'ready', summary: '已提交 PR https://example.invalid/pr/7' })
        expect(report, JSON.stringify(report)).toMatchObject({ ok: true, ticketId })
        await vi.waitFor(async () => { expect((await state(A)).tickets[0].ended !== undefined).toBe(true) }, { timeout: 10_000 })
        expect((await state(A)).tickets[0].ended).toMatchObject({ outcome: 'completed' })
        await vi.waitFor(() => { expect(texts(A).some(t => t.includes('[superagent report]') && t.includes(ticketId))).toBe(true) }, { timeout: 10_000 })
        // The served member takes and sends no A2A work on its own host either.
        const outbound = await tool(B, 'a2a_route', { team: `${zA}/aaaaaaaa`, message: '成员私下找总工', async: true })
        expect(String(outbound.error)).toContain('superagent-member-outbound')
      } finally { await A.dispose(); await B.dispose(); await E.dispose() }
    }, 90_000)
  }
})
