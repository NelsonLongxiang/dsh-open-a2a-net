// @vitest-environment node
/**
 * #189: callerLinkedToThisHost read the ORIGIN of any verified claim URL, so the publisher of one
 * path under a seeded peer's origin passed basis 3 ("we seed them, their card reciprocates") and
 * could edit this host's canvas teams through /a2a/canvas-op. Only a ROOT claim URL speaks for its
 * origin now (the 已验证来源 badge and #188's settlement rule read it the same way).
 *
 * One origin F serves two cards: its own host card at the root (key R) and an attacker card under
 * /evil (key E). A seeds F; both cards list A among their peers. Counter-example: the /evil claim is
 * refused and creates nothing; the root claim of the same origin still links.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import { createServer } from 'node:http'
import { bootNode, reservePort } from './harness.ts'
import { signCard } from '../../src/card.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

describe('#189 a path-prefixed claim never links its origin', () => {
  it('canvas-op: the /evil claim under a seeded origin is refused; that origin\'s root claim still links', async () => {
    const root = generateKeyPairSync('ed25519').privateKey
    const evil = generateKeyPairSync('ed25519').privateKey
    const pA = await reservePort()
    const aUrl = `http://127.0.0.1:${String(pA)}`
    const cardOf = (key: KeyObject, session: string) => signCard({ name: 'cargo', session, team: 'cargo', capabilities: { route: true }, peers: [aUrl], expiresAt: Date.now() + 3_600_000 } as never, key)
    const rootCard = cardOf(root, 'cargo-host')
    const evilCard = cardOf(evil, 'evil-s')
    const F = createServer((q, res) => {
      const body = q.url === '/.well-known/agent-card.json' ? rootCard : q.url === '/evil/.well-known/agent-card.json' ? evilCard : undefined
      if (body === undefined) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
    await new Promise<void>(resolve => F.listen(0, '127.0.0.1', () => resolve()))
    const fUrl = `http://127.0.0.1:${String((F.address() as { port: number }).port)}`
    const A = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', agentId: 'session-aaaaaaaa11112222', sessionNodes: true, port: pA, peers: [fUrl] } as never)
    const signed = (key: KeyObject, callerUrl: string, path: string): Record<string, string> => {
      const ts = Date.now()
      const sig2 = edSign(undefined, Buffer.from(JSON.stringify(['a2a-origin-claim/2', 'cargo', callerUrl, ts, A.baseUrl, 'POST', path])), key).toString('base64')
      return { 'Content-Type': 'application/json', 'X-A2A-Caller': 'cargo', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig2': sig2, 'X-A2A-Caller-Aud': A.baseUrl }
    }
    const canvasOp = async (key: KeyObject, callerUrl: string, name: string): Promise<{ status: number; body: unknown }> => {
      const res = await globalThis.fetch(`${A.baseUrl}/a2a/canvas-op`, { method: 'POST', headers: signed(key, callerUrl, '/a2a/canvas-op'), body: JSON.stringify({ op: 'create', name }) })
      return { status: res.status, body: await res.json().catch(() => null) }
    }
    const stateHas = async (name: string): Promise<boolean> => JSON.stringify(await globalThis.fetch(`${A.baseUrl}/__dsh_a2a/state`).then(async r => await r.json())).includes(name)
    try {
      const attack = await canvasOp(evil, `${fUrl}/evil`, 'pwned')
      // This face refuses with 200 + ok:false (the canvas-op convention).
      expect(attack.body).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining('not linked to this host') }))
      expect(await stateHas('pwned')).toBe(false)
      // The same origin's own root card is still a seeded, reciprocating peer.
      const legit = await canvasOp(root, fUrl, 'shared-team')
      expect(legit.status).toBe(200)
      expect((legit.body as { ok?: boolean } | null)?.ok).toBe(true)
      expect(await stateHas('shared-team')).toBe(true)
    } finally {
      F.close()
      await A.dispose()
    }
  }, 60_000)
})
