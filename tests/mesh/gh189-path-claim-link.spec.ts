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

  it('a MOUNTED peer (card under /node, seeded by its exact URL) still links; /evil and /node/x under it do not', async () => {
    const mounted = generateKeyPairSync('ed25519').privateKey
    const evil = generateKeyPairSync('ed25519').privateKey
    const pA = await reservePort()
    const aUrl = `http://127.0.0.1:${String(pA)}`
    const cardOf = (key: KeyObject, session: string) => signCard({ name: 'cargo', session, team: 'cargo', capabilities: { route: true }, peers: [aUrl], expiresAt: Date.now() + 3_600_000 } as never, key)
    const cards: Record<string, unknown> = {
      '/node/.well-known/agent-card.json': cardOf(mounted, 'cargo-node'),
      '/evil/.well-known/agent-card.json': cardOf(evil, 'evil-s'),
      '/node/x/.well-known/agent-card.json': cardOf(evil, 'evil-deeper'),
    }
    const F = createServer((q, res) => {
      const body = cards[q.url ?? '']
      if (body === undefined) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
    await new Promise<void>(resolve => F.listen(0, '127.0.0.1', () => resolve()))
    const fUrl = `http://127.0.0.1:${String((F.address() as { port: number }).port)}`
    const A = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', agentId: 'session-aaaaaaaa11112222', sessionNodes: true, port: pA, peers: [`${fUrl}/node`] } as never)
    const op = async (key: KeyObject, callerUrl: string, name: string): Promise<unknown> => {
      const ts = Date.now()
      const sig2 = edSign(undefined, Buffer.from(JSON.stringify(['a2a-origin-claim/2', 'cargo', callerUrl, ts, A.baseUrl, 'POST', '/a2a/canvas-op'])), key).toString('base64')
      const res = await globalThis.fetch(`${A.baseUrl}/a2a/canvas-op`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': 'cargo', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig2': sig2, 'X-A2A-Caller-Aud': A.baseUrl }, body: JSON.stringify({ op: 'create', name }) })
      return await res.json().catch(() => null)
    }
    try {
      expect(await op(mounted, `${fUrl}/node`, 'mounted-team')).toEqual(expect.objectContaining({ ok: true }))
      expect(await op(evil, `${fUrl}/evil`, 'pwned-a')).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining('not linked') }))
      expect(await op(evil, `${fUrl}/node/x`, 'pwned-b')).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining('not linked') }))
    } finally {
      F.close()
      await A.dispose()
    }
  }, 60_000)

  it('basis 1 on the card face: a card served under THIS host\'s origin at /evil never reads as this host', async () => {
    const evil = generateKeyPairSync('ed25519').privateKey
    const root = generateKeyPairSync('ed25519').privateKey
    const pA = await reservePort()
    const aUrl = `http://127.0.0.1:${String(pA)}`
    const F = createServer((q, res) => {
      if (q.url !== '/.well-known/agent-card.json') { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(signCard({ name: 'cargo', session: 'cargo-host', team: 'cargo', capabilities: { route: true }, peers: [aUrl], expiresAt: Date.now() + 3_600_000 } as never, root)))
    })
    await new Promise<void>(resolve => F.listen(0, '127.0.0.1', () => resolve()))
    const fUrl = `http://127.0.0.1:${String((F.address() as { port: number }).port)}`
    const A = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', agentId: 'session-aaaaaaaa11112222', sessionNodes: true, port: pA, peers: [fUrl] } as never)
    // Another plugin on the shared web server could serve such a path: model it with a route of our own.
    const evilCard = signCard({ name: 'evil', session: 'evil-s', team: 'alpha', capabilities: { route: true }, peers: [], expiresAt: Date.now() + 3_600_000 } as never, evil)
    ;(A.ctx.get('webServer') as unknown as { register: (r: unknown) => () => void }).register({
      kind: 'exact', path: '/evil/.well-known/agent-card.json',
      handler: (_q: unknown, res: { writeHead: (s: number, h: Record<string, string>) => void; end: (b: string) => void }) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(evilCard)) },
    })
    expect((await globalThis.fetch(`${aUrl}/__dsh_a2a/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'session-aaaaaaaa11112222' }) })).status).toBe(200)
    expect((await globalThis.fetch(`${aUrl}/__dsh_a2a/canvas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', name: 'core' }) })).status).toBe(200)
    const cardAs = async (key: KeyObject, caller: string, callerUrl: string): Promise<Record<string, unknown>> => {
      const ts = Date.now()
      const sig2 = edSign(undefined, Buffer.from(JSON.stringify(['a2a-origin-claim/2', caller, callerUrl, ts, A.baseUrl, 'GET', '/.well-known/agent-card.json'])), key).toString('base64')
      return await globalThis.fetch(`${A.baseUrl}/.well-known/agent-card.json`, { headers: { 'X-A2A-Caller': caller, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig2': sig2, 'X-A2A-Caller-Aud': A.baseUrl } }).then(async r => await r.json() as Record<string, unknown>)
    }
    try {
      // Positive control: the linked root peer gets the full card.
      expect('sessionTeams' in await cardAs(root, 'cargo', fUrl)).toBe(true)
      // The /evil card under OUR origin does not read as this host.
      expect('sessionTeams' in await cardAs(evil, 'alpha', `${aUrl}/evil`)).toBe(false)
    } finally {
      F.close()
      await A.dispose()
    }
  }, 60_000)
})

