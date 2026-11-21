/**
 * #787: a claim signed by the current plugin must verify on the published
 * 0.6.42 verifier when the mapped Tailscale card URL is readable, and must
 * fail closed when only the LAN URL would be fetched.
 */
import { generateKeyPairSync } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { verifyOriginClaim as verifyOriginClaim0642 } from '../fixtures/a2a-net-0.6.42/origin-claim.js'

const LAN = 'http://192.168.50.10:13080'
const TS = 'http://100.64.0.10:13080'
const CLOUD = 'https://hub.example.invalid'
const { privateKey } = generateKeyPairSync('ed25519')
const card = signCard({ name: 'host', session: 'host-1', team: 'dsh', expiresAt: Date.now() + 60_000 }, privateKey)

function reqFrom(headers: Record<string, string>): IncomingMessage {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { headers: lower, method: 'POST', url: '/a2a/direct', socket: { localAddress: '127.0.0.1', localPort: 443 } } as IncomingMessage
}

describe('#787 current signer vs published 0.6.42 verifier', () => {
  async function verifyAt(callerUrl: string, fetchImpl: (url: string) => Promise<Response>) {
    const body = '{"ok":true}'
    const headers = signOriginClaim({ url: `${CLOUD}/a2a/direct`, method: 'POST', body }, {
      caller: 'dsh', callerUrl, privateKey, unbound: false, now: Date.now(),
    })
    return await verifyOriginClaim0642(reqFrom(headers), {
      cardCache: new Map(),
      fetch: async (url: string) => await fetchImpl(String(url)),
      audiences: [CLOUD],
      unboundOpen: false,
      onUnbound: () => undefined,
      loopbackArrival: false,
      now: Date.now(),
      rawBody: new TextEncoder().encode(body),
    })
  }

  it('bound+Sig3 passes when the TS card is readable and refuses no-card when only LAN is reachable', async () => {
    const tsOnly = async (url: string) => String(url).startsWith(TS)
      ? new Response(JSON.stringify(card), { status: 200 })
      : new Response('', { status: 599 })
    expect(await verifyAt(TS, tsOnly)).toMatchObject({ ok: true, bound: true, bodyBound: true, callerUrl: TS })
    expect(await verifyAt(LAN, tsOnly)).toMatchObject({ ok: false, reason: 'no-card' })
  })

  it('wrong audience, body, and a foreign card key fail closed on 0.6.42', async () => {
    const body = '{"ok":true}'
    const headers = signOriginClaim({ url: `${CLOUD}/a2a/direct`, method: 'POST', body }, {
      caller: 'dsh', callerUrl: TS, privateKey, unbound: false, now: Date.now(),
    })
    const base = {
      cardCache: new Map([[TS, { at: Date.now(), card }]]),
      fetch: async () => new Response(JSON.stringify(card), { status: 200 }),
      audiences: [CLOUD],
      unboundOpen: false,
      onUnbound: () => undefined,
      loopbackArrival: false,
      now: Date.now(),
      rawBody: new TextEncoder().encode(body),
    }
    expect(await verifyOriginClaim0642(reqFrom({ ...headers, 'X-A2A-Caller-Aud': 'https://other.example.invalid' }), base)).toMatchObject({ ok: false, reason: 'wrong-audience' })
    expect(await verifyOriginClaim0642(reqFrom(headers), { ...base, rawBody: new TextEncoder().encode('{"ok":false}') })).toMatchObject({ ok: false, reason: 'body-mismatch' })
    const other = generateKeyPairSync('ed25519')
    const foreign = signCard({ name: 'other', session: 'o', team: 'dsh', expiresAt: Date.now() + 60_000 }, other.privateKey)
    expect(await verifyOriginClaim0642(reqFrom(headers), {
      ...base,
      cardCache: new Map([[TS, { at: Date.now(), card: foreign }]]),
      fetch: async () => new Response(JSON.stringify(foreign), { status: 200 }),
    })).toMatchObject({ ok: false, reason: 'bad-sig' })
  })
})
