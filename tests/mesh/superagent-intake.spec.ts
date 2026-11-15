// @vitest-environment node
/**
 * Owner ruling 2026-11-14 (option B): a session on a host the operator linked asks a superagent team at its canvas
 * address, even when both instances use the same zone (the default `dsh`) and no one added the session to any canvas on
 * the team's host. The host lets the request reach the team (rule `superagent-intake`); the team owner decides whether
 * it is taken — an unlisted sender waits on a sender card (M12). A host that is not linked, and an ordinary (non-
 * superagent) canvas, are refused as before.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, mockGuiLogin, postJson, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const R_ID = 'session-aaaaaaaa00001111', C_ID = 'session-cccccccc00003333', D_ID = 'session-dddddddd00004444'
const url = (p: number): string => `http://127.0.0.1:${String(p)}`
const login = mockGuiLogin()
const post = async (n: MeshNode, path: string, body: unknown): Promise<Record<string, any>> => await (await globalThis.fetch(`${n.baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...login }, body: JSON.stringify(body) })).json() as Record<string, any>
const get = async (n: MeshNode, path: string): Promise<Record<string, any>> => await (await globalThis.fetch(`${n.baseUrl}${path}`)).json() as Record<string, any>
const tool = async (n: MeshNode, name: string, args: Record<string, unknown>): Promise<Record<string, any>> => await n.ctx.tools.get(name)!.execute(args, runContext(n.agents.agent)) as Record<string, any>

describe('superagent intake from a linked host (same zone)', () => {
  it('a linked host\'s session reaches the team and waits on a sender card; an unlinked host stays refused', async () => {
    const [pA, pC, pD] = await Promise.all([reservePort(), reservePort(), reservePort()])
    // A and C seed each other (linked); D seeds A, but A does not seed D (a stranger to A).
    const A = await bootNode({ name: 'A', session: 'hostA', team: 'dsh', agentId: R_ID, port: pA, peers: [url(pC)], home: tmpHome(), sessionNodes: true, superagent: true } as never)
    const C = await bootNode({ name: 'C', session: 'hostC', team: 'dsh', agentId: C_ID, port: pC, peers: [url(pA)], home: tmpHome(), silent: true, sessionNodes: true, superagent: true } as never)
    const D = await bootNode({ name: 'D', session: 'hostD', team: 'dsh', agentId: D_ID, port: pD, peers: [url(pA)], home: tmpHome(), silent: true, sessionNodes: true } as never)
    try {
      for (const [n, id] of [[A, R_ID], [C, C_ID], [D, D_ID]] as const) expect((await postJson(n.baseUrl, '/__dsh_a2a/join', { id })).status).toBe(200)
      expect(await post(A, '/__dsh_a2a/canvas', { action: 'add-member', name: 'finance', id: R_ID })).toMatchObject({ ok: true })
      expect(await post(A, '/__dsh_a2a/superagent', { action: 'settings', settings: { canvas: 'finance', router: R_ID, sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [] } } })).toMatchObject({ ok: true })
      await vi.waitFor(async () => { const s = await get(A, '/__dsh_a2a/superagent'); expect(s.a2a.address !== null && s.a2a.health['a2a-deposit']?.state === 'ready').toBe(true) }, { timeout: 20_000 })
      const qualified = (await get(A, '/__dsh_a2a/state')).canvas.teams.find((t: any) => t.name === 'finance').id as string

      // The requesting sessions declare a team on their own hosts (the sending side's own S3 gate), nothing on A.
      expect(await post(C, '/__dsh_a2a/canvas', { action: 'add-member', name: 'mine', id: C_ID })).toMatchObject({ ok: true })
      expect(await post(D, '/__dsh_a2a/canvas', { action: 'add-member', name: 'mine', id: D_ID })).toMatchObject({ ok: true })
      // Both cards are read (the link is the bilateral seed).
      await get(A, '/__dsh_a2a/state'); await get(C, '/__dsh_a2a/state')

      // C (linked): admitted under superagent-intake, and the unlisted sender waits on A's owner (M12).
      const asked = await vi.waitFor(async () => { const out = await tool(C, 'a2a_route', { team: qualified, message: '请财务组核对 10 月报销', async: true }); expect(out.ok, JSON.stringify(out)).toBe(true); return out }, { timeout: 30_000 })
      await vi.waitFor(async () => {
        const cards = (await get(A, '/__dsh_a2a/superagent/decisions')).decisions as any[]
        expect(cards.some(c => c.source === 'sender')).toBe(true)
      }, { timeout: 40_000 })
      expect(asked.task_id).toBeDefined()

      // D (not linked by A): refused, as before.
      const stranger = await tool(D, 'a2a_route', { team: qualified, message: '陌生主机的请求', async: true })
      expect(stranger.ok, JSON.stringify(stranger)).toBe(false)
    } finally { await A.dispose(); await C.dispose(); await D.dispose() }
  }, 150_000)
})
