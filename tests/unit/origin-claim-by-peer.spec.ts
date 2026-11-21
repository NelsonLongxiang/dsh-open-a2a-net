import { createServer, type IncomingMessage } from 'node:http'
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { signCard } from '../../src/card.ts'
import { signOriginClaim, verifyOriginClaim, type OriginClaimVerdict } from '../../src/origin-claim.ts'
import {
  allOwnClaimUrls,
  cardListsOwnClaim,
  claimUrlForTarget,
  isOwnClaimCaller,
  matchOriginClaimByPeer,
  normalizeOriginClaimByPeer,
  originClaimByPeerMap,
  originClaimByPeerWarning,
  ownClaimUrlsForPeer,
} from '../../src/origin-claim-by-peer.ts'
import type { CardCacheEntry } from '../../src/runtime.ts'

const LAN = 'http://192.168.50.10:13080'
const TS = 'http://100.64.0.10:13080'
const CLOUD = 'https://hub.example.invalid'
const LAN_PEER = 'http://192.168.50.20:13080'

const { privateKey } = generateKeyPairSync('ed25519')
const card = signCard({ name: 'host', session: 'host-1', team: 'dsh', expiresAt: Date.now() + 60_000 }, privateKey)

function reqFrom(headers: Record<string, string>, url: string, method = 'POST', extra?: Partial<IncomingMessage>): IncomingMessage {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { headers: lower, method, url, socket: { localAddress: '127.0.0.1', localPort: 80 }, ...extra } as IncomingMessage
}

describe('#787 originClaimByPeer normalization and matching', () => {
  it('absent or empty mapping always returns the default callerUrl', () => {
    expect(normalizeOriginClaimByPeer(undefined).rules).toEqual([])
    expect(normalizeOriginClaimByPeer({}).rules).toEqual([])
    expect(claimUrlForTarget(`${CLOUD}/a2a/direct`, [], LAN)).toBe(LAN)
    expect(ownClaimUrlsForPeer(CLOUD, [], LAN)).toEqual([LAN])
  })

  it('selects the exact cloud origin and leaves other peers on the default LAN URL', () => {
    const { rules, ignored } = normalizeOriginClaimByPeer({ [CLOUD]: TS })
    expect(ignored).toEqual([])
    expect(claimUrlForTarget(`${CLOUD}/a2a/direct`, rules, LAN)).toBe(TS)
    expect(claimUrlForTarget(`${CLOUD}/.well-known/agent-card.json`, rules, LAN)).toBe(TS)
    expect(claimUrlForTarget(`${LAN_PEER}/a2a/direct`, rules, LAN)).toBe(LAN)
    expect(claimUrlForTarget(`${LAN_PEER}/a2a/query`, rules, LAN)).toBe(LAN)
    expect(originClaimByPeerMap(rules)).toEqual({ [CLOUD]: TS })
  })

  it('does not match a similar or suffix domain, a different scheme, or a different port', () => {
    const { rules } = normalizeOriginClaimByPeer({ [CLOUD]: TS })
    expect(matchOriginClaimByPeer('https://hub.example.invalid.evil/a2a/direct', rules)).toBeUndefined()
    expect(matchOriginClaimByPeer('https://not-hub.example.invalid/a2a/direct', rules)).toBeUndefined()
    expect(matchOriginClaimByPeer('https://example.invalid/a2a/direct', rules)).toBeUndefined()
    expect(matchOriginClaimByPeer('http://hub.example.invalid/a2a/direct', rules)).toBeUndefined()
    expect(matchOriginClaimByPeer('https://hub.example.invalid:444/a2a/direct', rules)).toBeUndefined()
    expect(claimUrlForTarget('https://hub.example.invalid.evil/a2a/direct', rules, LAN)).toBe(LAN)
  })

  it('a mount rule is exact: a sibling path or the origin root does not inherit it', () => {
    const { rules, ignored } = normalizeOriginClaimByPeer({
      'https://f.example/node': TS,
    })
    expect(ignored).toEqual([])
    expect(claimUrlForTarget('https://f.example/node/a2a/direct', rules, LAN)).toBe(TS)
    expect(claimUrlForTarget('https://f.example/node/.well-known/agent-card.json', rules, LAN)).toBe(TS)
    expect(claimUrlForTarget('https://f.example/node-other/a2a/direct', rules, LAN)).toBe(LAN)
    expect(claimUrlForTarget('https://f.example/other/a2a/direct', rules, LAN)).toBe(LAN)
    expect(claimUrlForTarget('https://f.example/a2a/direct', rules, LAN)).toBe(LAN)
  })

  it('an origin rule and a mount rule on the same host stay exact; the longer mount wins on its path', () => {
    const { rules } = normalizeOriginClaimByPeer({
      'https://f.example': LAN,
      'https://f.example/node': TS,
    })
    expect(claimUrlForTarget('https://f.example/a2a/direct', rules, 'http://fallback')).toBe(LAN)
    expect(claimUrlForTarget('https://f.example/node/a2a/direct', rules, 'http://fallback')).toBe(TS)
  })

  it('drops userinfo, non-http schemes, query/fragment, and unparsable entries', () => {
    const { rules, ignored } = normalizeOriginClaimByPeer({
      'https://user:pass@hub.example.invalid': TS,
      'ftp://hub.example.invalid': TS,
      'https://hub.example.invalid/?q=1': TS,
      'https://hub.example.invalid/#frag': TS,
      'not a url': TS,
      [CLOUD]: 'https://user:pass@100.64.0.10:13080',
      'https://other.example.invalid': 'ftp://100.64.0.10:13080',
      'https://third.example.invalid': 'http://100.64.0.10:13080/?x=1',
      'https://fourth.example.invalid': 'also bad',
    })
    expect(rules).toEqual([])
    expect(ignored.map(row => row.reason).sort()).toEqual([
      'claim-protocol',
      'claim-query-or-fragment',
      'claim-userinfo',
      'peer-protocol',
      'peer-query-or-fragment',
      'peer-query-or-fragment',
      'peer-userinfo',
      'unparsable-claim',
      'unparsable-peer',
    ].sort())
    for (const row of ignored) expect(originClaimByPeerWarning(row)).not.toMatch(/user:pass|ftp:\/\//)
  })

  it('conflicting mappings for the same normalized peer are all dropped', () => {
    const { rules, ignored } = normalizeOriginClaimByPeer({
      [CLOUD]: TS,
      [`${CLOUD}/`]: LAN,
    })
    expect(rules).toEqual([])
    expect(ignored.every(row => row.reason === 'conflict')).toBe(true)
    expect(claimUrlForTarget(`${CLOUD}/a2a/direct`, rules, LAN)).toBe(LAN)
  })

  it('duplicate keys that normalize to the same claim URL collapse to one rule', () => {
    const { rules, ignored } = normalizeOriginClaimByPeer({
      [CLOUD]: TS,
      [`${CLOUD}/`]: `${TS}/`,
    })
    expect(ignored).toEqual([])
    expect(rules).toEqual([{ kind: 'origin', key: CLOUD, claimUrl: TS }])
  })

  it('bilateral recognition is per-peer: a LAN peer listing only TS is not us', () => {
    const { rules } = normalizeOriginClaimByPeer({ [CLOUD]: TS })
    expect(cardListsOwnClaim([TS], ownClaimUrlsForPeer(CLOUD, rules, LAN))).toBe(true)
    expect(cardListsOwnClaim([LAN], ownClaimUrlsForPeer(CLOUD, rules, LAN))).toBe(true)
    expect(cardListsOwnClaim([TS], ownClaimUrlsForPeer(LAN_PEER, rules, LAN))).toBe(false)
    expect(cardListsOwnClaim([LAN], ownClaimUrlsForPeer(LAN_PEER, rules, LAN))).toBe(true)
    expect(cardListsOwnClaim(['http://example.invalid/other'], ['http://example.invalid/node'])).toBe(false)
    expect(cardListsOwnClaim(['http://example.invalid/node'], ['http://example.invalid/node'])).toBe(true)
  })

  it('self-call recognizes every operator-named local claim URL, including mapped ones', () => {
    const { rules } = normalizeOriginClaimByPeer({ [CLOUD]: TS })
    const own = allOwnClaimUrls(rules, LAN)
    expect(isOwnClaimCaller(LAN, own)).toBe(true)
    expect(isOwnClaimCaller(`${LAN}/`, own)).toBe(true)
    expect(isOwnClaimCaller(TS, own)).toBe(true)
    expect(isOwnClaimCaller(CLOUD, own)).toBe(false)
    expect(isOwnClaimCaller('http://100.64.0.11:13080', own)).toBe(false)
  })
})

describe('#787 OriginClaim signing and 0.6.42-compatible verification', () => {
  async function verifyAt(callerUrl: string, fetchImpl: (url: string) => Promise<Response>, body = '{"ok":true}', audience = CLOUD, extra?: { rawBody?: Uint8Array }): Promise<OriginClaimVerdict> {
    const headers = signOriginClaim({ url: `${CLOUD}/a2a/direct`, method: 'POST', body }, {
      caller: 'dsh', callerUrl, privateKey, unbound: false, now: Date.now(),
    })
    const cardCache = new Map<string, CardCacheEntry>()
    return await verifyOriginClaim(reqFrom(headers, '/a2a/direct'), {
      cardCache,
      fetch: async (url) => await fetchImpl(String(url)),
      audiences: [CLOUD],
      unboundOpen: false,
      onUnbound: () => undefined,
      loopbackArrival: false,
      now: Date.now(),
      rawBody: extra?.rawBody ?? new TextEncoder().encode(body),
    })
  }

  const reachable = async (url: string): Promise<Response> => {
    if (String(url).startsWith(TS)) return new Response(JSON.stringify(card), { status: 200 })
    return new Response('', { status: 599 })
  }

  it('a TS callerUrl verifies bound+Sig3 when the card is readable at TS; a LAN callerUrl is no-card if LAN cannot be fetched', async () => {
    expect(await verifyAt(TS, reachable)).toMatchObject({ ok: true, bound: true, bodyBound: true, callerUrl: TS })
    expect(await verifyAt(LAN, reachable)).toMatchObject({ ok: false, reason: 'no-card' })
  })

  it('wrong audience, body, and key fail closed', async () => {
    const body = '{"ok":true}'
    const headers = signOriginClaim({ url: `${CLOUD}/a2a/direct`, method: 'POST', body }, {
      caller: 'dsh', callerUrl: TS, privateKey, unbound: false, now: Date.now(),
    })
    const cardCache = new Map<string, CardCacheEntry>([[TS, { at: Date.now(), card }]])
    const fetchOk = async () => new Response(JSON.stringify(card), { status: 200 })
    const base = { cardCache, fetch: fetchOk, audiences: [CLOUD], unboundOpen: false, onUnbound: () => undefined, loopbackArrival: false, now: Date.now(), rawBody: new TextEncoder().encode(body) }
    expect(await verifyOriginClaim(reqFrom({ ...headers, 'X-A2A-Caller-Aud': 'https://other.example.invalid' }, '/a2a/direct'), { ...base, audiences: [CLOUD] })).toMatchObject({ ok: false, reason: 'wrong-audience' })
    const tampered = new TextEncoder().encode('{"ok":false}')
    expect(await verifyOriginClaim(reqFrom(headers, '/a2a/direct'), { ...base, rawBody: tampered })).toMatchObject({ ok: false, reason: 'body-mismatch' })
    const other = generateKeyPairSync('ed25519')
    const foreign = signCard({ name: 'other', session: 'o', team: 'dsh', expiresAt: Date.now() + 60_000 }, other.privateKey)
    expect(await verifyOriginClaim(reqFrom(headers, '/a2a/direct'), {
      ...base,
      cardCache: new Map([[TS, { at: Date.now(), card: foreign }]]),
      fetch: async () => new Response(JSON.stringify(foreign), { status: 200 }),
    })).toMatchObject({ ok: false, reason: 'bad-sig' })
  })

  it('a 3xx on the card URL is not followed and does not verify', async () => {
    const redirect = async () => new Response('', { status: 302, headers: { Location: `${LAN}/.well-known/agent-card.json` } })
    expect(await verifyAt(TS, redirect)).toMatchObject({ ok: false, reason: 'not-derivable' })
  })
})

describe('#787 outbound redirect does not carry the claim or a link key', () => {
  it('manual redirect keeps X-API-Key and OriginClaim off the Location origin', async () => {
    const seen: Array<{ url: string; keys: string[] }> = []
    const bait = await new Promise<{ url: string; close: () => Promise<void> }>((resolve, reject) => {
      const server = createServer((req, res) => {
        seen.push({ url: `http://${req.headers.host ?? ''}${req.url ?? ''}`, keys: Object.keys(req.headers).filter(name => name === 'x-api-key' || name.startsWith('x-a2a-caller')) })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr === null || typeof addr === 'string') { reject(new Error('no port')); return }
        resolve({ url: `http://127.0.0.1:${String(addr.port)}`, close: () => new Promise(r => server.close(() => r())) })
      })
    })
    const origin = await new Promise<{ url: string; close: () => Promise<void> }>((resolve, reject) => {
      const server = createServer((req, res) => {
        seen.push({ url: `http://${req.headers.host ?? ''}${req.url ?? ''}`, keys: Object.keys(req.headers).filter(name => name === 'x-api-key' || name.startsWith('x-a2a-caller')) })
        res.writeHead(302, { Location: `${bait.url}/stolen` })
        res.end()
      })
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr === null || typeof addr === 'string') { reject(new Error('no port')); return }
        resolve({ url: `http://127.0.0.1:${String(addr.port)}`, close: () => new Promise(r => server.close(() => r())) })
      })
    })
    try {
      const { rules } = normalizeOriginClaimByPeer({ [origin.url]: TS })
      const headers = signOriginClaim({ url: `${origin.url}/a2a/direct`, method: 'POST', body: '{}' }, {
        caller: 'dsh', callerUrl: claimUrlForTarget(`${origin.url}/a2a/direct`, rules, LAN), privateKey, unbound: false, now: Date.now(),
      })
      const res = await fetch(`${origin.url}/a2a/direct`, { method: 'POST', headers: { ...headers, 'X-API-Key': 'link-key-for-origin' }, body: '{}', redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`${bait.url}/stolen`)
      expect(seen).toHaveLength(1)
      expect(seen[0]!.keys).toEqual(expect.arrayContaining(['x-api-key', 'x-a2a-caller-url']))
    } finally {
      await origin.close()
      await bait.close()
    }
  })
})
