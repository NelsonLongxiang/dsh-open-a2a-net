/**
 * OriginClaim audience binding (docs/protocol/delivery-origin-auth.md §2.1):
 * a bound envelope verifies only at the origin, method and path it was
 * signed for; the unbound legacy form passes only while the window is open,
 * and a present bound signature never falls back to the unbound one.
 */
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { signCard } from '../../src/card.ts'
import { requestAudiences, signOriginClaim, unboundCanonical, verifyOriginClaim } from '../../src/origin-claim.ts'
import type { CardCacheEntry } from '../../src/runtime.ts'

const { privateKey } = generateKeyPairSync('ed25519')
const CALLER_URL = 'http://10.0.0.1:13080'
const card = signCard({ name: 'A', session: 'a-sess', team: 'dsh', capabilities: { route: true, async: true }, expiresAt: Date.now() + 3_600_000 }, privateKey)

const sign = (url: string, method = 'POST', unbound = true): Record<string, string> =>
  signOriginClaim({ url, method }, { caller: 'dsh', callerUrl: CALLER_URL, privateKey, unbound, now: Date.now() })

/** A request as the receiving host sees it: lower-cased headers, its own socket end. */
const req = (headers: Record<string, string>, at: { url: string; method?: string; local?: string; port?: number }): IncomingMessage => ({
  headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  method: at.method ?? 'POST',
  url: at.url,
  socket: { localAddress: at.local ?? '127.0.0.1', localPort: at.port ?? 4000 },
}) as unknown as IncomingMessage

function verify(request: IncomingMessage, options: { unboundOpen?: boolean; audiences?: string[] } = {}) {
  const cardCache = new Map<string, CardCacheEntry>([[CALLER_URL, { at: Date.now(), card }]])
  let unbound = 0
  const verdict = verifyOriginClaim(request, {
    cardCache,
    fetch: () => { throw new Error('no fetch: the card is cached') },
    audiences: options.audiences ?? [],
    unboundOpen: options.unboundOpen ?? true,
    onUnbound: () => { unbound += 1 },
    now: Date.now(),
  })
  return verdict.then(v => ({ v, unbound }))
}

const strip = (headers: Record<string, string>, ...names: string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([k]) => !names.includes(k)))

describe('OriginClaim audience binding', () => {
  it('a bound envelope verifies at the host, method and path it was made for', async () => {
    const { v, unbound } = await verify(req(sign('http://127.0.0.1:4000/a2a/canvas-op'), { url: '/a2a/canvas-op' }))
    expect(v).toMatchObject({ ok: true, caller: 'dsh', bound: true })
    expect(unbound).toBe(0)
  })

  it('the same envelope presented at another host is wrong-audience', async () => {
    const headers = sign('http://127.0.0.1:5000/a2a/canvas-op')
    expect((await verify(req(headers, { url: '/a2a/canvas-op', port: 4000 }))).v).toEqual({ ok: false, reason: 'wrong-audience' })
    expect((await verify(req(headers, { url: '/a2a/canvas-op', local: '10.0.0.9', port: 5000 }))).v).toEqual({ ok: false, reason: 'wrong-audience' })
  })

  it('another path or method at the right host does not verify', async () => {
    const headers = sign('http://127.0.0.1:4000/.well-known/agent-card.json', 'GET')
    expect((await verify(req(headers, { url: '/a2a/canvas-op' }))).v).toEqual({ ok: false, reason: 'bad-sig' })
    expect((await verify(req(headers, { url: '/.well-known/agent-card.json', method: 'POST' }))).v).toEqual({ ok: false, reason: 'bad-sig' })
    // The query is not signed: the card face's ?caller_session= still verifies.
    expect((await verify(req(headers, { url: '/.well-known/agent-card.json?caller_session=x', method: 'GET' }))).v.ok).toBe(true)
  })

  it('a present bound signature never falls back to the unbound one', async () => {
    const headers = { ...sign('http://127.0.0.1:4000/a2a/direct'), 'X-A2A-Caller-Sig2': Buffer.from('forged').toString('base64') }
    expect((await verify(req(headers, { url: '/a2a/direct' }))).v).toEqual({ ok: false, reason: 'bad-sig' })
  })

  it('an unbound signature does not verify as a bound one (domain-separated forms)', async () => {
    const ts = Date.now()
    const v1 = edSign(undefined, Buffer.from(unboundCanonical('dsh', CALLER_URL, ts), 'utf8'), privateKey).toString('base64')
    const headers = { 'X-A2A-Caller': 'dsh', 'X-A2A-Caller-Url': CALLER_URL, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Aud': 'http://127.0.0.1:4000', 'X-A2A-Caller-Sig2': v1 }
    expect((await verify(req(headers, { url: '/a2a/direct' }))).v).toEqual({ ok: false, reason: 'bad-sig' })
  })

  it('an unbound-only envelope passes (counted) while the window is open, and is refused once it closes', async () => {
    const unboundOnly = strip(sign('http://127.0.0.1:9999/a2a/direct'), 'X-A2A-Caller-Aud', 'X-A2A-Caller-Sig2')
    const open = await verify(req(unboundOnly, { url: '/a2a/direct' }), { unboundOpen: true })
    expect(open.v).toMatchObject({ ok: true, bound: false })
    expect(open.unbound).toBe(1)
    const closed = await verify(req(unboundOnly, { url: '/a2a/direct' }), { unboundOpen: false })
    expect(closed.v).toEqual({ ok: false, reason: 'unbound-closed' })
    expect(closed.unbound).toBe(0)
  })

  it('a host with the window closed signs no unbound form', () => {
    const headers = sign('http://127.0.0.1:4000/a2a/direct', 'POST', false)
    expect(headers['X-A2A-Caller-Sig']).toBeUndefined()
    expect(headers['X-A2A-Caller-Sig2']).toBeTypeOf('string')
    expect(headers['X-A2A-Caller-Aud']).toBe('http://127.0.0.1:4000')
  })

  it('a configured alias (proxy / port map) is an audience; loopback spellings of the arrival port are too', async () => {
    const proxied = sign('https://b.example.com/a2a/direct')
    expect((await verify(req(proxied, { url: '/a2a/direct', local: '172.17.0.2', port: 3000 }))).v).toEqual({ ok: false, reason: 'wrong-audience' })
    expect((await verify(req(proxied, { url: '/a2a/direct', local: '172.17.0.2', port: 3000 }), { audiences: ['https://b.example.com/'] })).v.ok).toBe(true)
    expect((await verify(req(sign('http://localhost:4000/a2a/direct'), { url: '/a2a/direct', local: '::ffff:127.0.0.1' }))).v.ok).toBe(true)
  })

  it('the arrival socket names the audience, never the Host header', () => {
    const r = req({ host: 'evil.example:80' }, { url: '/', local: '::ffff:192.168.1.5', port: 13080 })
    expect([...requestAudiences(r, ['', 'not a url'])]).toEqual(['http://192.168.1.5:13080'])
  })
})
