// @vitest-environment node
/**
 * docs/design/superagent-root-team.md R7, through the owner's canvas route on a live node: set-root, a child that is not
 * a superagent team is refused with the reason, and so is a child added to a team that is no root.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasOwnerFingerprint } from '../../src/canvas-id.ts'
import { bootNode, reservePort } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const post = async (target: string, body: unknown): Promise<Record<string, any>> => {
  const res = await globalThis.fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  try { return JSON.parse(text) as Record<string, any> } catch { throw new Error(`${String(res.status)} ${target} ${JSON.stringify(body)}: ${text.slice(0, 200)}`) }
}

describe('the canvas route\'s root actions on a live node', () => {
  it('marks a root, and refuses a child that is no superagent team or a parent that is no root, with the reason', async () => {
    const port = await reservePort()
    const node = await bootNode({ name: 'R', session: 'r-session', team: 'dsh', port, peers: [], sessionNodes: true } as never)
    try {
      const canvas = `${node.baseUrl}/__dsh_a2a/canvas`
      expect((await post(canvas, { action: 'create', name: 'root' })).ok).toBe(true)
      expect((await post(canvas, { action: 'create', name: 'docs' })).ok).toBe(true)
      expect(await post(canvas, { action: 'set-root', name: 'root', root: true })).toMatchObject({ ok: true, roots: ['root'] })
      const card = await globalThis.fetch(`${node.baseUrl}/.well-known/agent-card.json`).then(async r => await r.json() as { publicKey: string })
      const fp = canvasOwnerFingerprint(card.publicKey)
      const refused = await post(canvas, { action: 'add-team', name: 'root', team: `dsh/canvas/docs@${fp}` })
      expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('not a superagent team') })
      expect(await post(canvas, { action: 'add-team', name: 'docs', team: `dsh/canvas/root@${fp}` })).toMatchObject({ ok: false, error: expect.stringContaining('not a root') })
    } finally { await node.dispose() }
  })
})
