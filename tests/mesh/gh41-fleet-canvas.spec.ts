// @vitest-environment node
/**
 * gh#41 fleet regulation, end-to-end: node B publishes its canvas org on
 * the FULL card (linked callers only); node A's relay forwards a signed
 * canvas op to B's /a2a/canvas-op; B applies it because A is linked
 * (bilateral seeds). A bare unsigned caller is refused; the minimal card
 * carries no org. Any peer composes and regulates the whole fleet.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, reservePort } from './harness.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

const post = async (url: string, body?: unknown): Promise<Record<string, any>> =>
  await globalThis.fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => await r.json() as Record<string, any>)

describe('gh#41 fleet canvas regulation', () => {
  it('a linked peer regulates my canvas via the relay; unsigned callers are refused; the org rides the full card only', async () => {
    const portA = await reservePort()
    const portB = await reservePort()
    // Bilateral seeds = the operator link (W3 basis-3). Distinct sessions so
    // the cards carry well-formed identity (a missing session field makes
    // the card malformed at verification).
    const a = await bootNode({ name: 'A', session: 'mesh-gh41-a', team: 'dsh', sessionNodes: true, port: portA, peers: [`http://127.0.0.1:${String(portB)}`] })
    const b = await bootNode({ name: 'B', session: 'mesh-gh41-b', team: 'dsh', sessionNodes: true, port: portB, peers: [`http://127.0.0.1:${String(portA)}`] })
    // Join both agents so the session teams exist (the reply carries the
    // joined node's team handle).
    for (const n of [a, b]) {
      const joinReply = await post(`${n.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })
      expect(joinReply.team).toBe('dsh/01234567')
    }
    // Compose b's local team (the org the card publishes).
    expect((await post(`${b.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '远端研发' })).ok).toBe(true)
    expect((await post(`${b.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '远端研发', id: 'session-0123456789abcdef' })).ok).toBe(true)
    try {
      // a's relay regulates b: add a's own session-team handle into b's team.
      // What URL does a's envelope carry? Read it from the owner-settings of
      // the claim: probe with a signed request is complex — instead print a's
      // own view via state (ownCardUrl is not exposed; but the seed URL is).
      const add = await post(`${a.baseUrl}/__dsh_a2a/fleet-canvas-op`, { peer: b.baseUrl, op: 'add-member', name: '远端研发', id: 'dsh/01234567' })
      expect(add.ok).toBe(true)
      const bState = await post(`${b.baseUrl}/__dsh_a2a/state`)
      const team = (bState.canvas?.teams as Array<{ name: string; members: string[] }>).find(t => t.name === '远端研发')
      expect(JSON.stringify(team?.members)).toContain('dsh/01234567')

      // The op face refuses unsigned callers (no envelope).
      const bare = await post(`${b.baseUrl}/a2a/canvas-op`, { op: 'remove-member', name: '远端研发', id: 'dsh/01234567' })
      expect(bare.ok).toBe(false)
      expect(String(bare.error)).toContain('untrusted-origin')

      // The anonymous card carries no org; the LINKED card (a's client
      // stamps the envelope during its own sweep) does — assert via a's
      // state peerOrg once the warm cache holds b's full card.
      const anonCard = await post(`${b.baseUrl}/.well-known/agent-card.json`)
      expect(anonCard.canvasOrg).toBeUndefined()
      // Trigger a's directory sweep (a2a_teams as the live agent), then read
      // peerOrg — the card cache serves within its freshness window, so poll
      // until the sweep reflects the composed org.
      const tool = a.ctx.tools.get('a2a_teams')
      const agent = (a as unknown as { agents: { agent: unknown } }).agents.agent
      let orgRow: { url: string; org: Array<{ name: string }> } | undefined
      for (let i = 0; i < 20 && orgRow?.org.some(t => t.name === '远端研发') !== true; i += 1) {
        await tool?.execute({}, { signal: new AbortController().signal, agent } as never)
        const aState = await post(`${a.baseUrl}/__dsh_a2a/state`)
        const rows = (aState.peerOrg ?? []) as Array<{ url: string; org: Array<{ name: string }> }>
        if (i === 0) console.log('PEERORG:', JSON.stringify(rows).slice(0, 300))
        orgRow = rows.find(r => r.url === b.baseUrl)
        if (orgRow?.org.some(t => t.name === '远端研发') === true) break
        await new Promise(resolve => setTimeout(resolve, 300))
      }
      expect(orgRow).toBeDefined()
      expect(orgRow!.org.some(t => t.name === '远端研发')).toBe(true)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  }, 60_000)
})
