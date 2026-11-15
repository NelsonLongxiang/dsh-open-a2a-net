// @vitest-environment node
/**
 * docs/design/superagent-root-team.md R8 (S3): the state the board reads — a root team's row carries root: true and its
 * children with label, slots, the open count and the state, on a live node through the owner's canvas route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootNode, reservePort } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const post = async (target: string, body: unknown): Promise<Record<string, any>> => {
  const res = await globalThis.fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const text = await res.text()
  try { return JSON.parse(text) as Record<string, any> } catch { throw new Error(`${String(res.status)} ${target} ${JSON.stringify(body)}: ${text.slice(0, 200)}`) }
}

describe('the state carries a root team and its children for the board', () => {
  it('a root row has root:true and children[] with label/slots/open/state; a plain team has neither', async () => {
    const port = await reservePort()
    const node = await bootNode({ name: 'R', session: 'r-session', team: 'dsh', port, peers: [], sessionNodes: true } as never)
    try {
      const canvas = `${node.baseUrl}/__dsh_a2a/canvas`
      expect((await post(canvas, { action: 'create', name: 'root' })).ok).toBe(true)
      expect((await post(canvas, { action: 'create', name: 'plain' })).ok).toBe(true)
      expect((await post(canvas, { action: 'set-root', name: 'root', root: true })).ok).toBe(true)
      const state = await post(`${node.baseUrl}/__dsh_a2a/state`, {})
      const teams = state.canvas?.teams as Array<Record<string, any>> ?? []
      const root = teams.find(row => row.name === 'root')
      const plain = teams.find(row => row.name === 'plain')
      expect(root?.root).toBe(true)
      expect(Array.isArray(root?.children)).toBe(true)
      expect(plain?.root).toBeUndefined()
      expect(plain?.children).toBeUndefined()
    } finally { await node.dispose() }
  })
})
