// @vitest-environment node
/**
 * gh#20 W-A: state-face peers carry {link, verified} — the badge data
 * source. linked = an operator-established basis holds (bilateral seeding
 * OR an exact uniquely advertised nonlocal canvas session handle); stranger =
 * no link (a verified key is not a relationship); verified = a
 * signature-valid cached card.
 * A minimal card without sessionTeams cannot prove handle ownership. Shared
 * zones/local refs never grant badge links; admission is intentionally unchanged.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, reservePort, tmpHome, type MeshNode } from './harness.ts'
import { seedCanvasHistory } from '../fixtures/canvas-history.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

async function canvasAddMember(node: MeshNode, canvas: string, id: string): Promise<void> {
  const res = await globalThis.fetch(`http://127.0.0.1:${String(node.port)}/__dsh_a2a/canvas`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add-member', name: canvas, id }),
  })
  if (!res.ok) throw new Error(`add-member ${res.status}: ${await res.text()}`)
  const body = await res.json() as { ok?: boolean }
  if (body.ok !== true) throw new Error(`rejected: ${JSON.stringify(body)}`)
}

async function peerRow(host: MeshNode, peerUrl: string): Promise<{ link?: string; verified?: boolean }> {
  const state = await (await globalThis.fetch(`http://127.0.0.1:${String(host.port)}/__dsh_a2a/state`)).json() as { peers: Array<{ url: string; link?: string; verified?: boolean }> }
  return state.peers.find(row => row.url === peerUrl) ?? {}
}

async function warmCards(a: MeshNode, b: MeshNode): Promise<void> {
  // One directory sweep each way so both card caches hold the other.
  await a.ctx.tools.get('a2a_teams')?.execute({}, { signal: new AbortController().signal } as never)
  await b.ctx.tools.get('a2a_teams')?.execute({}, { signal: new AbortController().signal } as never)
}

describe('W-A state-face link fields', () => {
  it('two dsh hosts remain distinct: our own handle cannot mark an unlinked same-zone host as linked', async () => {
    const pa = await reservePort(), pb = await reservePort(), pc = await reservePort()
    const a = await bootNode({ name: 'A', session: 'badge-a', team: 'dsh', port: pa, peers: [`http://127.0.0.1:${pb}`, `http://127.0.0.1:${pc}`], sessionNodes: true })
    const b = await bootNode({ name: 'B', session: 'badge-b', team: 'dsh', port: pb, peers: [a.baseUrl], sessionNodes: true })
    const c = await bootNode({ name: 'C', session: 'badge-c', team: 'dsh', port: pc, sessionNodes: true })
    try {
      await fetch(a.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: 'session-0123456789abcdef' }) })
      await canvasAddMember(a, 'own', 'session-0123456789abcdef')
      await warmCards(a, b); await warmCards(a, c)
      expect(await peerRow(a, b.baseUrl)).toMatchObject({ link: 'linked', verified: true })
      expect(await peerRow(a, c.baseUrl)).toMatchObject({ link: 'stranger', verified: true })
    } finally { await a.dispose(); await b.dispose(); await c.dispose() }
  })
  it('bilateral seeds show linked, but a minimal card cannot prove exact canvas-member ownership', async () => {
    const pa = await reservePort()
    const pb = await reservePort()
    const alice = await bootNode({ name: 'alice', session: 'mesh-alice', team: 'alice-zone', sessionNodes: true, port: pa, peers: [`http://127.0.0.1:${String(pb)}`] })
    const bob = await bootNode({ name: 'bob', session: 'mesh-bob', team: 'bob-zone', sessionNodes: true, port: pb, peers: [`http://127.0.0.1:${String(pa)}`] })
    try {
      // bob joins so its card carries a session team (the handle surface).
      const joinRes = await globalThis.fetch(`http://127.0.0.1:${String(bob.port)}/__dsh_a2a/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'session-0123456789abcdef' }),
      })
      expect(joinRes.status).toBe(200)
      await warmCards(alice, bob)
      // Bilateral seeds hold: alice's view of bob is linked + verified.
      const before = await peerRow(alice, bob.baseUrl)
      expect(before.link).toBe('linked')
      expect(before.verified).toBe(true)
      expect(before.link).not.toBe('stranger')

      // Canvas ref basis on a FRESH pair (no seeds): charlie sees dave as
      // stranger until a canvas ref names dave's session team handle.
      const pc = await reservePort()
      const pd = await reservePort()
      const charlie = await bootNode({ home:seedCanvasHistory(tmpHome(),[{name:'fleet',members:['dave-zone/01234567']}]), name: 'charlie', session: 'mesh-charlie', team: 'charlie-zone', sessionNodes: true, port: pc, peers: [`http://127.0.0.1:${String(pd)}`] })
      const dave = await bootNode({ name: 'dave', session: 'mesh-dave', team: 'dave-zone', sessionNodes: true, port: pd })
      try {
        const dj = await globalThis.fetch(`http://127.0.0.1:${String(dave.port)}/__dsh_a2a/join`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'session-0123456789abcdef' }),
        })
        expect(dj.status).toBe(200)
        // ONE-WAY seed: charlie seeds dave (discovery) but dave seeds nobody
        // back — the bilateral basis fails, so charlie's view of dave is
        // STRANGER (tracked + verified card, but no operator relationship
        // from dave's side).
        await warmCards(charlie, dave)
        const cold = await peerRow(charlie, dave.baseUrl)
        expect(cold.link).toBe('stranger')
        // A one-way peer serves only its minimal card: no advertised session handle proves host ownership.
        // A canvas ref must not turn its same-zone siblings green merely from the zone prefix.
        await canvasAddMember(charlie, 'fleet', 'dave-zone/01234567')
        const linked = await peerRow(charlie, dave.baseUrl)
        expect(linked.link).toBe('stranger')
        expect(linked.verified).toBe(true)
      } finally {
        await dave.dispose()
        await charlie.dispose()
      }
    } finally {
      await bob.dispose()
      await alice.dispose()
    }
  }, 40_000)
})
