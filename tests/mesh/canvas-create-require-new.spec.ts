// @vitest-environment node
/**
 * #650: composing a root starts from a team that is surely new. The owner's canvas route takes `requireNew` on create:
 * two clients racing for one name — exactly one gets `created: true`; plain create keeps its idempotent answer. The
 * state's team rows carry each team's canvas address (`id`, the form add-team takes) and the superagent marker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasOwnerFingerprint } from '../../src/canvas-id.ts'
import { bootNode, MockGuiConnection, mockGuiLogin, postJson, reservePort, tmpHome } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const login = mockGuiLogin()
const post = async (target: string, body: unknown): Promise<Record<string, any>> => {
  const res = await globalThis.fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', ...login }, body: JSON.stringify(body) })
  const text = await res.text()
  try { return JSON.parse(text) as Record<string, any> } catch { throw new Error(`${String(res.status)} ${target} ${JSON.stringify(body)}: ${text.slice(0, 200)}`) }
}

describe('#650 canvas create with requireNew', () => {
  it('two clients race for one name: exactly one is created; plain create stays idempotent', async () => {
    const port = await reservePort()
    const node = await bootNode({ name: 'R', session: 'r-session', team: 'dsh', port, peers: [], sessionNodes: true } as never)
    try {
      const canvas = `${node.baseUrl}/__dsh_a2a/canvas`
      const [a, b] = await Promise.all([post(canvas, { action: 'create', name: 'hq', requireNew: true }), post(canvas, { action: 'create', name: 'hq', requireNew: true })])
      expect([a, b].filter(out => out.ok === true && out.created === true)).toHaveLength(1)
      const loser = [a, b].find(out => out.ok !== true)
      expect(loser).toMatchObject({ ok: false, created: false, error: expect.stringContaining('already exists') })
      // Plain create: the existing team answers ok, and says it did not create it.
      expect(await post(canvas, { action: 'create', name: 'hq' })).toMatchObject({ ok: true, name: 'hq', created: false })
      expect(await post(canvas, { action: 'create', name: 'fresh' })).toMatchObject({ ok: true, name: 'fresh', created: true })
      expect(await post(canvas, { action: 'create', name: 'a/b', requireNew: true })).toMatchObject({ ok: false, created: false })
      const state = await post(`${node.baseUrl}/__dsh_a2a/state`, {})
      expect((state.canvas.teams as Array<{ name: string }>).map(t => t.name).filter(n => n === 'hq')).toHaveLength(1)
    } finally { await node.dispose() }
  })

  it('state rows carry the canvas address add-team takes, and the superagent marker only on a team taking requests', async () => {
    const R_ID = 'session-aaaaaaaa00001111'
    const port = await reservePort()
    const node = await bootNode({ name: 'A', session: 'hostA', team: 'alpha', agentId: R_ID, port, peers: [], home: tmpHome(), sessionNodes: true, superagent: true } as never)
    try {
      await node.ctx.plugin(MockGuiConnection)
      expect((await postJson(node.baseUrl, '/__dsh_a2a/join', { id: R_ID })).status).toBe(200)
      const canvas = `${node.baseUrl}/__dsh_a2a/canvas`
      expect(await post(canvas, { action: 'add-member', name: 'team', id: R_ID })).toMatchObject({ ok: true })
      expect(await post(canvas, { action: 'create', name: 'plain' })).toMatchObject({ ok: true })
      expect(await post(`${node.baseUrl}/__dsh_a2a/superagent`, { action: 'settings', settings: { canvas: 'team', router: R_ID, sources: { a2a: true }, acceptMode: 'auto' } })).toMatchObject({ ok: true })
      const card = await globalThis.fetch(`${node.baseUrl}/.well-known/agent-card.json`).then(async r => await r.json() as { publicKey: string })
      const fp = canvasOwnerFingerprint(card.publicKey)
      await vi.waitFor(async () => {
        const rows = (await post(`${node.baseUrl}/__dsh_a2a/state`, {})).canvas.teams as Array<Record<string, any>>
        expect(rows.find(t => t.name === 'team')).toMatchObject({ id: `alpha/canvas/team@${fp}`, superagentTeam: true })
      }, { timeout: 20_000 })
      const plain = ((await post(`${node.baseUrl}/__dsh_a2a/state`, {})).canvas.teams as Array<Record<string, any>>).find(t => t.name === 'plain')
      expect(plain?.id).toBe(`alpha/canvas/plain@${fp}`)
      expect(plain?.superagentTeam).toBeUndefined()
    } finally { await node.dispose() }
  })
})
