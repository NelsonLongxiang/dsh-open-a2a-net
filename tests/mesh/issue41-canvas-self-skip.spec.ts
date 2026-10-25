// @vitest-environment node
/**
 * Issue #41 (canvas dispatch self-loop): the dispatching session occupying
 * a canvas member slot must not capture its own dispatch — the bare-team
 * self-route rule extends to the canvas tiers. The dispatch skips the
 * initiator on the local live/cold tiers and falls through to the remote
 * members; a canvas team whose only routable member IS the initiator gets
 * an explicit loop refusal instead of an echo home.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { bootNode, reservePort, runContext, steerText } from './harness.ts'
import { signCard } from '../../src/card.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

const post = async (url: string, body?: unknown): Promise<Record<string, any>> =>
  await globalThis.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async r => await r.json() as Record<string, any>)

const AGENT_ID = 'session-0123456789abcdef'
const HANDLE = 'mesh-i41-cli/a1b2c3d4e5f60718'

describe('issue #41 canvas initiator self-skip', () => {
  it('a member routing to its own canvas team skips itself and the remote member receives', async () => {
    const portA = await reservePort()
    const portB = await reservePort()
    const a = await bootNode({ name: 'A', session: 'mesh-i41-a', team: 'dsh', sessionNodes: true, port: portA, peers: [`http://127.0.0.1:${String(portB)}`] })
    const b = await bootNode({ name: 'B', session: 'mesh-i41-b', team: 'dsh', sessionNodes: true, port: portB, peers: [`http://127.0.0.1:${String(portA)}`] })
    try {
      for (const n of [a, b]) expect((await post(`${n.baseUrl}/__dsh_a2a/join`, { id: AGENT_ID })).team).toBe("dsh/01234567")
      // Canvas team on A: the initiator's own session (live local member,
      // slot 1) + B's session team (remote ref, slot 2). Before the fix the
      // local live tier captured the dispatch and B never saw the message.
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '品味建联' })).ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '品味建联', id: AGENT_ID })).ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '品味建联', id: 'dsh/01234567' })).ok).toBe(true)

      // Warm A's directory toward B (card cache is 60ms but the first sweep
      // must have happened before the route's candidate walk).
      const teamsTool = a.ctx.tools.get('a2a_teams')
      const agent = (a as unknown as { agents: { agent: unknown } }).agents.agent
      for (let i = 0; i < 20; i += 1) {
        await teamsTool?.execute({}, { signal: new AbortController().signal, agent } as never)
        const state = await post(`${a.baseUrl}/__dsh_a2a/state`)
        const peers = (state.peers ?? []) as Array<{ url: string; ok?: boolean }>
        if (peers.some(p => p.url === b.baseUrl && p.ok === true)) break
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      const route = a.ctx.tools.get('a2a_route')
      const res = await route?.execute({ team: 'dsh/canvas/品味建联', message: '建联打招呼：工厂报告席到位' }, runContext(agent as never)) as Record<string, any>
      expect(res.ok).toBe(true)
      expect(String(res.reply)).toContain('ok from B')
      // The initiator's own steer log must NOT carry the looped message —
      // the dispatch skipped the self member slot.
      const selfLooped = a.steered.map(steerText).some(t => t.includes('建联打招呼'))
      expect(selfLooped).toBe(false)
      // The remote member's agent received it over the wire.
      const delivered = b.steered.map(steerText).some(t => t.includes('建联打招呼'))
      expect(delivered).toBe(true)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  }, 60_000)

  it('a canvas team whose only member is the initiator refuses with an explicit loop text', async () => {
    const port = await reservePort()
    const a = await bootNode({ name: 'A', session: 'mesh-i41-solo', team: 'dsh', sessionNodes: true, port })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: AGENT_ID })).team).toBe("dsh/01234567")
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '自环组' })).ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '自环组', id: AGENT_ID })).ok).toBe(true)

      const route = a.ctx.tools.get('a2a_route')
      const agent = (a as unknown as { agents: { agent: unknown } }).agents.agent
      const res = await route?.execute({ team: 'dsh/canvas/自环组', message: '绕一圈回家?' }, runContext(agent as never)) as Record<string, any>
      expect(res.ok).toBe(false)
      expect(String(res.error)).toContain('would loop')
      expect(a.steered.map(steerText).some(t => t.includes('绕一圈回家'))).toBe(false)
    } finally {
      await a.dispose()
    }
  }, 30_000)

  it('the inbound wire face still resolves the first live member (a remote caller never equals a local id)', async () => {
    const port = await reservePort()
    const a = await bootNode({ name: 'A', session: 'mesh-i41-in', team: 'dsh', sessionNodes: true, port })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: AGENT_ID })).team).toBe("dsh/01234567")
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '入站组' })).ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '入站组', id: AGENT_ID })).ok).toBe(true)

      // A deposited CLI identity (gh#45 N3) gives the wire face a verifiable
      // caller; its handle never equals a local member id, so the canvas
      // resolution on the INBOUND seam must keep hitting the live member.
      const { privateKey } = generateKeyPairSync('ed25519')
      const card = signCard({ name: 'mesh-i41-cli', session: 'cli-mesh-i41', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, privateKey)
      expect((await post(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).ok).toBe(true)
      const callerUrl = `${a.baseUrl}/a2a/cli/${encodeURIComponent(HANDLE)}`
      const ts = Date.now()
      const sig = edSign(undefined, Buffer.from(JSON.stringify(['mesh-i41-cli', callerUrl, ts])), privateKey).toString('base64')
      const res = await globalThis.fetch(`${a.baseUrl}/a2a/direct`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': 'mesh-i41-cli', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Ts': String(ts), 'X-A2A-Sig': sig },
        body: JSON.stringify({ team: 'dsh/canvas/入站组', message: 'peer caller to the canvas group', caller_session: HANDLE, wait: false }),
      }).then(async r => await r.json() as Record<string, any>)
      expect(res.error).toBeUndefined()
      expect(res.delivered).toBe(true)
      expect(a.steered.map(steerText).some(t => t.includes('peer caller to the canvas group'))).toBe(true)
    } finally {
      await a.dispose()
    }
  }, 30_000)
})
