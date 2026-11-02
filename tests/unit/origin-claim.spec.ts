/**
 * OriginClaim audience binding (docs/protocol/delivery-origin-auth.md §2.1):
 * A verified source requires a bound envelope at the root caller URL, and
 * a signed bound miss never falls back to an unbound signature. Legacy-only
 * envelopes can still be accepted as key possession during migration.
 */
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { signCard } from '../../src/card.ts'
import { isRootOriginUrl, requestAudiences, signOriginClaim, unboundCanonical, verifyOriginClaim } from '../../src/origin-claim.ts'
import type { CardCacheEntry } from '../../src/runtime.ts'
import type { A2aPeerCard } from '../../src/types.ts'

const { privateKey } = generateKeyPairSync('ed25519')
const CALLER_URL = 'http://10.0.0.1:13080'
const card = signCard({ name: 'A', session: 'a-sess', team: 'dsh', capabilities: { route: true, async: true }, expiresAt: Date.now() + 3_600_000 }, privateKey)

const sign = (url: string, method = 'POST', unbound = true): Record<string, string> =>
  signOriginClaim({ url, method }, { caller: 'dsh', callerUrl: CALLER_URL, privateKey, unbound, now: Date.now() })

/** A request as the receiving host sees it: lower-cased headers, its own socket end. */
const req = (headers: Record<string, string>, at: { url: string; method?: string; local?: string; port?: number; tls?: boolean }): IncomingMessage => ({
  headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  method: at.method ?? 'POST',
  url: at.url,
  socket: { localAddress: at.local ?? '127.0.0.1', localPort: at.port ?? 4000, ...(at.tls === true ? { encrypted: true } : {}) },
}) as unknown as IncomingMessage

/** The receiving host's own card URL — always among its configured audiences. */
const OWN = 'http://127.0.0.1:4000'

function verify(request: IncomingMessage, options: { unboundOpen?: boolean; audiences?: string[]; loopbackArrival?: boolean; now?: number; cacheCard?: boolean; fetch?: (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; redirect?: 'follow' | 'error' | 'manual' }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }> } = {}) {
  const cardCache = new Map<string, CardCacheEntry>(options.cacheCard === false ? [] : [[CALLER_URL, { at: Date.now(), card }]])
  let unbound = 0
  let boundMiss = 0
  const verdict = verifyOriginClaim(request, {
    cardCache,
    fetch: options.fetch ?? (async () => { throw new Error('no fetch: the card is cached') }),
    audiences: options.audiences ?? [OWN],
    unboundOpen: options.unboundOpen ?? true,
    onUnbound: () => { unbound += 1 },
    onBoundMiss: () => { boundMiss += 1 },
    ...(options.loopbackArrival === undefined ? {} : { loopbackArrival: options.loopbackArrival }),
    now: options.now ?? Date.now(),
  })
  return verdict.then(v => ({ v, unbound, boundMiss }))
}

const strip = (headers: Record<string, string>, ...names: string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([k]) => !names.includes(k)))

describe('OriginClaim audience binding', () => {
  it('ordinary caller identities must use the exact origin root URL', () => {
    expect(isRootOriginUrl(CALLER_URL)).toBe(true)
    for (const suffix of ['/apps/market', '/.well-known/agent-card.json', '/path/', '?q=1', '#fragment', '/user@host']) expect(isRootOriginUrl(`${CALLER_URL}${suffix}`)).toBe(false)
    expect(isRootOriginUrl('http://user:secret@10.0.0.1:13080')).toBe(false)
    expect(isRootOriginUrl(CALLER_URL + '/')).toBe(true)
  })

  it('a same-origin child app cannot prove the origin and a redirected card is refused', async () => {
    const pathCaller = 'http://10.0.0.1:13080/apps/market'
    const pathHeaders = signOriginClaim({ url: `${OWN}/a2a/direct`, method: 'POST' }, { caller: 'dsh', callerUrl: pathCaller, privateKey, unbound: false, now: Date.now() })
    const pathResult = await verify(req(pathHeaders, { url: '/a2a/direct' }), { cacheCard: false, fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(card) }) })
    expect(pathResult.v).toEqual({ ok: false, reason: 'not-derivable' })
    const rootHeaders = signOriginClaim({ url: `${OWN}/a2a/direct`, method: 'POST' }, { caller: 'dsh', callerUrl: CALLER_URL, privateKey, unbound: false, now: Date.now() })
    const redirect = await verify(req(rootHeaders, { url: '/a2a/direct' }), { cacheCard: false, fetch: async (_url, init) => {
      expect(init.redirect).toBe('manual')
      return { ok: false, status: 302, text: async () => JSON.stringify(card) }
    } })
    expect(redirect.v).toEqual({ ok: false, reason: 'not-derivable' })
  })

  it('a bound envelope verifies at the host, method and path it was made for', async () => {
    const { v, unbound } = await verify(req(sign('http://127.0.0.1:4000/a2a/canvas-op'), { url: '/a2a/canvas-op' }))
    expect(v).toMatchObject({ ok: true, caller: 'dsh', bound: true })
    expect(unbound).toBe(0)
  })

  it('the same envelope presented at another host is wrong-audience', async () => {
    const headers = sign('http://127.0.0.1:5000/a2a/canvas-op', 'POST', false)
    expect((await verify(req(headers, { url: '/a2a/canvas-op', port: 4000 }))).v).toEqual({ ok: false, reason: 'wrong-audience' })
    expect((await verify(req(headers, { url: '/a2a/canvas-op', local: '10.0.0.9', port: 5000 }))).v).toEqual({ ok: false, reason: 'wrong-audience' })
    // A receiver with the window open has no unbound form to fall back to either.
    expect((await verify(req(headers, { url: '/a2a/canvas-op', local: '10.0.0.9', port: 5000 }), { unboundOpen: true })).v).toEqual({ ok: false, reason: 'wrong-audience' })
  })

  it('a bound audience miss can only use counted unbound migration proof', async () => {
    const headers = sign('http://b.local:13080/a2a/direct')
    const open = await verify(req(headers, { url: '/a2a/direct' }), { unboundOpen: true })
    expect(open.v).toMatchObject({ ok: true, caller: 'dsh', bound: false })
    expect([open.unbound, open.boundMiss]).toEqual([1, 1])
    const closed = await verify(req(headers, { url: '/a2a/direct' }), { unboundOpen: false })
    expect(closed.v).toEqual({ ok: false, reason: 'wrong-audience' })
    expect([closed.unbound, closed.boundMiss]).toEqual([0, 0])
  })

  it('another path or method at the right host does not verify', async () => {
    const headers = sign('http://127.0.0.1:4000/.well-known/agent-card.json', 'GET', false)
    expect((await verify(req(headers, { url: '/a2a/canvas-op' }))).v).toEqual({ ok: false, reason: 'bad-sig' })
    expect((await verify(req(headers, { url: '/.well-known/agent-card.json', method: 'POST' }))).v).toEqual({ ok: false, reason: 'bad-sig' })
    // The query is not signed: the card face's ?caller_session= still verifies.
    expect((await verify(req(headers, { url: '/.well-known/agent-card.json?caller_session=x', method: 'GET' }))).v.ok).toBe(true)
  })

  it('a bad bound signature can at most fall back to counted unbound proof', async () => {
    const headers = { ...sign('http://127.0.0.1:4000/a2a/direct'), 'X-A2A-Caller-Sig2': Buffer.from('forged').toString('base64') }
    const open = await verify(req(headers, { url: '/a2a/direct' }), { unboundOpen: true })
    expect(open.v).toMatchObject({ ok: true, caller: 'dsh', bound: false })
    expect([open.unbound, open.boundMiss]).toEqual([1, 1])
    expect((await verify(req(headers, { url: '/a2a/direct' }), { unboundOpen: false })).v).toEqual({ ok: false, reason: 'bad-sig' })
    const noValidV1 = { ...headers, 'X-A2A-Caller-Sig': headers['X-A2A-Caller-Sig2'] }
    expect((await verify(req(noValidV1, { url: '/a2a/direct' }))).v).toEqual({ ok: false, reason: 'bad-sig' })
  })

  it('an empty Sig2 header is no bound form: the unbound one decides', async () => {
    const headers = { ...strip(sign('http://127.0.0.1:4000/a2a/direct'), 'X-A2A-Caller-Sig2'), 'X-A2A-Caller-Sig2': '' }
    const { v, unbound, boundMiss } = await verify(req(headers, { url: '/a2a/direct' }))
    expect(v).toMatchObject({ ok: true, bound: false })
    expect([unbound, boundMiss]).toEqual([1, 0])
  })

  it('a correctly signed stale or future ts is bad-ts', async () => {
    const at = (now: number) => signOriginClaim({ url: 'http://127.0.0.1:4000/a2a/direct', method: 'POST' }, { caller: 'dsh', callerUrl: CALLER_URL, privateKey, unbound: true, now })
    expect((await verify(req(at(Date.now() - 6 * 60_000), { url: '/a2a/direct' }))).v).toEqual({ ok: false, reason: 'bad-ts' })
    expect((await verify(req(at(Date.now() + 6 * 60_000), { url: '/a2a/direct' }))).v).toEqual({ ok: false, reason: 'bad-ts' })
    expect((await verify(req(at(Date.now() - 4 * 60_000), { url: '/a2a/direct' }))).v.ok).toBe(true)
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

  it('a configured alias (proxy / port map) is an audience; loopback spellings of a configured loopback origin are too', async () => {
    const proxied = sign('https://b.example.com/a2a/direct', 'POST', false)
    expect((await verify(req(proxied, { url: '/a2a/direct', local: '172.17.0.2', port: 3000 }))).v).toEqual({ ok: false, reason: 'wrong-audience' })
    expect((await verify(req(proxied, { url: '/a2a/direct', local: '172.17.0.2', port: 3000 }), { audiences: ['https://b.example.com/'] })).v.ok).toBe(true)
    expect((await verify(req(sign('http://localhost:4000/a2a/direct', 'POST', false), { url: '/a2a/direct', local: '::ffff:127.0.0.1' }))).v.ok).toBe(true)
  })

  it('a loopback arrival answers to its loopback spellings — a host with no card URL yet, or bound to 0.0.0.0 and dialled locally', async () => {
    const local = { url: '/a2a/direct', local: '::ffff:127.0.0.1', port: 3080 }
    expect([...requestAudiences(req({}, local), [])].sort()).toEqual(['http://127.0.0.1:3080', 'http://[::1]:3080', 'http://localhost:3080'])
    expect((await verify(req(sign('http://localhost:3080/a2a/direct', 'POST', false), local), { audiences: [''] })).v.ok).toBe(true)
    expect((await verify(req(sign('http://127.0.0.1:3080/a2a/direct', 'POST', false), local), { audiences: ['http://192.168.1.5:3080'] })).v.ok).toBe(true)
  })

  it('behind a declared tunnel or proxy (originClaimUrl set) a loopback arrival is no audience of its own', async () => {
    // Every tunnelled request arrives on loopback; that address names no host.
    const tunnelled = { url: '/a2a/direct', local: '127.0.0.1', port: 13080 }
    const loopbackAud = sign('http://127.0.0.1:13080/a2a/direct', 'POST', false)
    expect((await verify(req(loopbackAud, tunnelled), { audiences: ['https://pub.example.com'], loopbackArrival: false })).v).toEqual({ ok: false, reason: 'wrong-audience' })
    expect((await verify(req(sign('https://pub.example.com/a2a/direct', 'POST', false), tunnelled), { audiences: ['https://pub.example.com'], loopbackArrival: false })).v.ok).toBe(true)
    expect([...requestAudiences(req({}, tunnelled), ['https://pub.example.com'], false)]).toEqual(['https://pub.example.com'])
    // A configured loopback origin still brings the other spellings of its port.
    expect([...requestAudiences(req({}, tunnelled), ['http://127.0.0.1:13080'], false)].sort()).toEqual(['http://127.0.0.1:13080', 'http://[::1]:13080', 'http://localhost:13080'])
  })

  it('a TLS arrival names an https audience', () => {
    expect([...requestAudiences(req({}, { url: '/', local: '192.168.1.5', port: 443, tls: true }), [])]).toEqual(['https://192.168.1.5'])
  })

  it('the arrival socket names the audience, never the Host header', () => {
    const r = req({ host: 'evil.example:80' }, { url: '/', local: '::ffff:192.168.1.5', port: 13080 })
    expect([...requestAudiences(r, ['', 'not a url'])]).toEqual(['http://192.168.1.5:13080'])
  })
})

describe('OriginClaim — a CLI identity deposited here (gh#133)', () => {
  const { privateKey: cliKey } = generateKeyPairSync('ed25519')
  const HANDLE = 'alice/0123456789abcdef'
  const CLI_URL = 'http://100.64.0.1:13080/a2a/cli/alice%2F0123456789abcdef'
  const cliCard = signCard({ name: 'alice', session: 'cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 3_600_000 }, cliKey)
  const cliV1 = (name = 'alice'): Record<string, string> => {
    const ts = Date.now()
    return { 'X-A2A-Caller': name, 'X-A2A-Caller-Url': CLI_URL, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': edSign(undefined, Buffer.from(unboundCanonical(name, CLI_URL, ts), 'utf8'), cliKey).toString('base64') }
  }
  const cliV2 = (url: string): Record<string, string> =>
    signOriginClaim({ url, method: 'POST' }, { caller: 'alice', callerUrl: CLI_URL, privateKey: cliKey, unbound: false, now: Date.now() })
  function verifyCli(request: IncomingMessage, options: { unboundOpen?: boolean; deposit?: A2aPeerCard | undefined; optIn?: boolean } = {}) {
    let unbound = 0
    let fetched = 0
    const deposit = { handle: HANDLE, name: 'alice', card: 'deposit' in options ? options.deposit as A2aPeerCard | undefined : cliCard }
    return verifyOriginClaim(request, {
      cardCache: new Map(),
      fetch: () => { fetched += 1; throw new Error('unreachable CLI address') },
      audiences: [OWN],
      unboundOpen: options.unboundOpen ?? true,
      onUnbound: () => { unbound += 1 },
      now: Date.now(),
      ...(options.optIn === false ? {} : { cliDeposit: (url: string) => (url === CLI_URL ? deposit : undefined) }),
    }).then(v => ({ v, unbound, fetched }))
  }

  it('an unbound CLI claim is decided from the deposit, names the full handle, and is counted', async () => {
    const { v, unbound, fetched } = await verifyCli(req(cliV1(), { url: '/a2a/direct' }))
    expect(v).toMatchObject({ ok: true, caller: HANDLE, cli: true, bound: false })
    expect(unbound).toBe(1)
    expect(fetched).toBe(0)
  })

  it('an unbound CLI claim is refused once the window closes', async () => {
    expect((await verifyCli(req(cliV1(), { url: '/a2a/direct' }), { unboundOpen: false })).v).toEqual({ ok: false, reason: 'unbound-closed' })
  })

  it('a bound CLI claim verifies at its audience and is wrong-audience elsewhere', async () => {
    const boundCli = await verifyCli(req(cliV2('http://127.0.0.1:4000/a2a/direct'), { url: '/a2a/direct' }), { unboundOpen: false })
    expect(boundCli.v).toMatchObject({ ok: true, caller: HANDLE, cli: true, bound: true })
    expect(boundCli.unbound).toBe(0)
    expect((await verifyCli(req(cliV2('http://127.0.0.1:5000/a2a/direct'), { url: '/a2a/direct' }))).v).toEqual({ ok: false, reason: 'wrong-audience' })
  })

  it('a deposit that no longer verifies is no-card; a namesake signer is not-derivable; another key is bad-sig', async () => {
    expect((await verifyCli(req(cliV1(), { url: '/a2a/direct' }), { deposit: undefined })).v).toEqual({ ok: false, reason: 'no-card' })
    const { privateKey: other } = generateKeyPairSync('ed25519')
    const ts = Date.now()
    const forged = { ...cliV1(), 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': edSign(undefined, Buffer.from(unboundCanonical('alice', CLI_URL, ts), 'utf8'), other).toString('base64') }
    expect((await verifyCli(req(forged, { url: '/a2a/direct' }))).v).toEqual({ ok: false, reason: 'bad-sig' })
    expect((await verifyCli(req(cliV1('bob'), { url: '/a2a/direct' }))).v).toEqual({ ok: false, reason: 'not-derivable' })
  })

  it('a non-root CLI URL is never reclassified as an ordinary zone issuer', async () => {
    const { v, fetched } = await verifyCli(req(cliV1(), { url: '/a2a/direct' }), { optIn: false, unboundOpen: false })
    expect(v).toEqual({ ok: false, reason: 'unbound-closed' })
    expect(fetched).toBe(0)
  })
})
