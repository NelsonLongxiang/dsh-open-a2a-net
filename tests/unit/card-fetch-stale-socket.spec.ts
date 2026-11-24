/**
 * gh362 F3b hardening (root cause: kb 343686fe2f): the read-only card GET retries once, on a fresh connection, when a
 * pooled keep-alive socket was already dead (UND_ERR_SOCKET / ECONNRESET / EPIPE); an HTTP status, a bad card or our
 * own timeout is never retried, and a write (POST /a2a/direct) never retries at all.
 */
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { A2aClient, staleSocket, type A2aFetch } from '../../src/a2a-client.ts'
import { signCard } from '../../src/card.ts'

const never = () => () => {}
const stale = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code }) })
const card = () => signCard({ name: 'peer', session: 'peer', team: 'beta/bbbbbbbb', capabilities: { route: true }, expiresAt: Date.now() + 3_600_000 }, generateKeyPairSync('ed25519').privateKey)

function client(steps: Array<(headers: Record<string, string>) => Promise<{ status: number; body: unknown }>>) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = []
  const fetch: A2aFetch = async (url, init) => {
    calls.push({ method: init.method, url, headers: init.headers })
    const step = steps[calls.length - 1]
    if (step === undefined) throw new Error('unexpected extra request')
    const r = await step(init.headers)
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) }
  }
  return { calls, c: new A2aClient({ apiKey: '', sessionId: 's', cardCaller: '', schedule: never, fetch }) }
}

describe('staleSocket', () => {
  it('only a stale-socket transport code on the error or its cause', () => {
    for (const code of ['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE']) expect(staleSocket(stale(code)), code).toBe(true)
    expect(staleSocket(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true)
    expect(staleSocket(stale('ECONNREFUSED'))).toBe(false)
    expect(staleSocket(Object.assign(stale('ECONNRESET'), { statusCode: 502 }))).toBe(false)
    expect(staleSocket(Object.assign(stale('ECONNRESET'), { ownBudgetExhausted: true }))).toBe(false)
    expect(staleSocket(Object.assign(new Error('aborted'), { name: 'AbortError', cause: { code: 'ECONNRESET' } }))).toBe(false)
    expect(staleSocket('ECONNRESET')).toBe(false)
  })
})

describe('fetchCardDetail on a stale pooled socket', () => {
  it('retries once on a fresh connection (Connection: close) and returns the card', async () => {
    for (const code of ['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE']) {
      const good = card()
      const { calls, c } = client([async () => { throw stale(code) }, async () => ({ status: 200, body: good })])
      const out = await c.fetchCardDetail('http://127.0.0.1:1')
      expect(out.ok, code).toBe(true)
      expect(calls.map(x => x.method)).toEqual(['GET', 'GET'])
      expect(calls[0]!.headers).not.toHaveProperty('Connection')
      expect(calls[1]!.headers).toMatchObject({ Connection: 'close' })
    }
  })
  it('a second stale socket is reported, not retried again', async () => {
    const { calls, c } = client([async () => { throw stale('ECONNRESET') }, async () => { throw stale('ECONNRESET') }])
    expect(await c.fetchCardDetail('http://127.0.0.1:1')).toMatchObject({ ok: false, stage: 'unreachable' })
    expect(calls).toHaveLength(2)
  })
  it('an HTTP 404, a bad card, a refused connection or an abort is never retried', async () => {
    const cases: Array<() => Promise<{ status: number; body: unknown }>> = [
      async () => ({ status: 404, body: { error: 'not found' } }),
      async () => ({ status: 200, body: { ...card(), name: 'tampered' } }),
      async () => { throw stale('ECONNREFUSED') },
      async () => { throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }) },
    ]
    for (const step of cases) {
      const { calls, c } = client([step])
      expect((await c.fetchCardDetail('http://127.0.0.1:1')).ok).toBe(false)
      expect(calls).toHaveLength(1)
    }
  })
})

describe('the retry stays inside the one budget', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('gets only what is left of the budget, and none at all once it is spent', async () => {
    for (const [elapsed, retried] of [[14_000, true], [15_000, false]] as const) {
      let now = 1_000_000
      vi.spyOn(Date, 'now').mockImplementation(() => now)
      const budgets: number[] = []
      const calls: string[] = []
      const fetch: A2aFetch = async (_url, init) => {
        calls.push(init.method)
        if (calls.length === 1) { now += elapsed; throw stale('ECONNRESET') }
        return { ok: true, status: 200, text: async () => JSON.stringify(card()) }
      }
      const c = new A2aClient({ apiKey: '', sessionId: 's', cardCaller: '', schedule: (_fn, ms) => { budgets.push(ms); return () => {} }, fetch })
      expect((await c.fetchCardDetail('http://127.0.0.1:1')).ok, String(elapsed)).toBe(retried)
      expect(calls, String(elapsed)).toHaveLength(retried ? 2 : 1)
      expect(budgets, String(elapsed)).toEqual(retried ? [15_000, 1_000] : [15_000])
      vi.restoreAllMocks()
    }
  })
})

describe('writes never retry', () => {
  it('routeDirect POST on ECONNRESET fails once, with no second request', async () => {
    const { calls, c } = client([async () => { throw stale('ECONNRESET') }])
    const result = await c.routeDirect('http://127.0.0.1:1', 'beta/bbbbbbbb', 'work')
    expect(result.ok, JSON.stringify(result)).toBe(false)
    expect(calls.map(x => x.method)).toEqual(['POST'])
    expect(calls[0]!.headers).not.toHaveProperty('Connection')
  })
})