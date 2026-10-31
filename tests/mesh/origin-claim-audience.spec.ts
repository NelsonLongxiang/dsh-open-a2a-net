// @vitest-environment node
/**
 * OriginClaim audience binding, end-to-end (docs/protocol/delivery-origin-auth.md
 * §2.1): A and B are linked (bilateral seeds); M is a third host A talks to.
 * An envelope A made for M, presented at B, names M's origin, so B refuses
 * it; the unbound form verifies anywhere only while the window is open on
 * both ends, and closes with it.
 */
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, craftCard, reservePort, type MeshNode } from './harness.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

const call = async (url: string, init: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Record<string, any>> =>
  await globalThis.fetch(url, {
    method: init.body === undefined ? 'GET' : 'POST',
    headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).then(async r => await r.json() as Record<string, any>)

/** M: a host with a valid card that records the headers it is sent. */
async function capturingHost() {
  const { card } = craftCard({ name: 'M', session: 'mesh-aud-m', team: 'mallory', expiresAt: Date.now() + 3_600_000 })
  const seen: IncomingHttpHeaders[] = []
  const server = createServer((req, res) => {
    seen.push(req.headers)
    const body = req.url === '/.well-known/agent-card.json' ? JSON.stringify(card) : JSON.stringify({ ok: true })
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
    res.end(body)
    req.resume()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    seen,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

/** The envelope headers of A's relayed canvas op to M. */
function capturedEnvelope(seen: IncomingHttpHeaders[]): Record<string, string> {
  const h = seen.find(headers => headers['x-a2a-caller-sig2'] !== undefined && headers['content-type'] === 'application/json')
  if (h === undefined) throw new Error('M saw no relayed canvas op')
  const out: Record<string, string> = {}
  for (const name of ['x-a2a-caller', 'x-a2a-caller-url', 'x-a2a-caller-ts', 'x-a2a-caller-aud', 'x-a2a-caller-sig2', 'x-a2a-caller-sig']) {
    const value = h[name]
    if (typeof value === 'string') out[name] = value
  }
  return out
}

const without = (headers: Record<string, string>, ...names: string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([k]) => !names.includes(k)))

async function linkedPair(m: { baseUrl: string }, options: { aOpen: boolean; bOpen: boolean }): Promise<[MeshNode, MeshNode]> {
  const portA = await reservePort()
  const portB = await reservePort()
  const a = await bootNode({ name: 'A', session: 'mesh-aud-a', team: 'dsh', sessionNodes: true, port: portA, originClaimUnboundWindow: options.aOpen, peers: [`http://127.0.0.1:${String(portB)}`, m.baseUrl] })
  const b = await bootNode({ name: 'B', session: 'mesh-aud-b', team: 'dsh', sessionNodes: true, port: portB, originClaimUnboundWindow: options.bOpen, peers: [`http://127.0.0.1:${String(portA)}`] })
  return [a, b]
}

const teamsOf = async (n: MeshNode): Promise<string[]> =>
  ((await call(`${n.baseUrl}/__dsh_a2a/state`)).canvas?.teams as Array<{ name: string }>).map(t => t.name)

describe('OriginClaim audience binding (mesh)', () => {
  it('an envelope A made for M is wrong-audience at B; its unbound form is refused once B closes the window', async () => {
    const m = await capturingHost()
    const [a, b] = await linkedPair(m, { aOpen: true, bOpen: false })
    try {
      // The link is real: A regulates B through its relay (bound envelope).
      expect((await call(`${a.baseUrl}/__dsh_a2a/fleet-canvas-op`, { body: { peer: b.baseUrl, op: 'create', name: 'from-a' } })).ok).toBe(true)
      expect(await teamsOf(b)).toContain('from-a')

      // A sends M a canvas op of its own.
      await call(`${a.baseUrl}/__dsh_a2a/fleet-canvas-op`, { body: { peer: m.baseUrl, op: 'create', name: 'for-m' } })
      const forM = capturedEnvelope(m.seen)
      expect(forM['x-a2a-caller-aud']).toBe(m.baseUrl)

      const asBound = await call(`${b.baseUrl}/a2a/canvas-op`, { body: { op: 'create', name: 'other' }, headers: forM })
      expect(asBound.ok).toBe(false)
      expect(String(asBound.error)).toContain('wrong-audience')

      const asUnbound = await call(`${b.baseUrl}/a2a/canvas-op`, { body: { op: 'create', name: 'other' }, headers: without(forM, 'x-a2a-caller-aud', 'x-a2a-caller-sig2') })
      expect(asUnbound.ok).toBe(false)
      expect(String(asUnbound.error)).toContain('unbound-closed')
      expect(await teamsOf(b)).not.toContain('other')

      // The card face reads the same verdict: the minimal card.
      const card = await call(`${b.baseUrl}/.well-known/agent-card.json`, { headers: forM })
      expect(card.sessionTeams).toBeUndefined()
      expect(card.canvasOrg).toBeUndefined()
      expect((await call(`${b.baseUrl}/__dsh_a2a/state`)).unboundInbound).toBe(0)
    } finally {
      await a.dispose()
      await b.dispose()
      await m.close()
    }
  }, 60_000)

  it('with both windows open the unbound form verifies at B (counted); a sender with its window closed signs no unbound form', async () => {
    const m = await capturingHost()
    const [a, b] = await linkedPair(m, { aOpen: true, bOpen: true })
    try {
      await call(`${a.baseUrl}/__dsh_a2a/fleet-canvas-op`, { body: { peer: m.baseUrl, op: 'create', name: 'for-m' } })
      const forM = capturedEnvelope(m.seen)
      expect(String((await call(`${b.baseUrl}/a2a/canvas-op`, { body: { op: 'create', name: 'other' }, headers: forM })).error)).toContain('wrong-audience')
      const unboundAtB = await call(`${b.baseUrl}/a2a/canvas-op`, { body: { op: 'create', name: 'other' }, headers: without(forM, 'x-a2a-caller-aud', 'x-a2a-caller-sig2') })
      expect(unboundAtB.ok).toBe(true)
      expect((await call(`${b.baseUrl}/__dsh_a2a/state`)).unboundInbound).toBe(1)
    } finally {
      await a.dispose()
      await b.dispose()
    }
    m.seen.length = 0
    const [a2, b2] = await linkedPair(m, { aOpen: false, bOpen: true })
    try {
      await call(`${a2.baseUrl}/__dsh_a2a/fleet-canvas-op`, { body: { peer: m.baseUrl, op: 'create', name: 'for-m' } })
      expect(capturedEnvelope(m.seen)['x-a2a-caller-sig']).toBeUndefined()
    } finally {
      await a2.dispose()
      await b2.dispose()
      await m.close()
    }
  }, 60_000)
})
