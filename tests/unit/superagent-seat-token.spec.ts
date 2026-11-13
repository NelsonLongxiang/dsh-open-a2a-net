// @vitest-environment node
/**
 * docs/design/superagent-team-mcp.md revision 2026-11-13: seat tokens exchanged under the node key, held in memory, renewed
 * before expiry, never replaced by a long-lived token; team MCP calls made as the member's seat. Against a fake market.
 */
import { generateKeyPairSync, sign as edSign, verify as edVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SEAT_TOKEN_REFRESH_MS, SeatTokens, seatTokenCanonical, type SeatSigner } from '../../src/superagent/host/seat-token.ts'
import { McpError, TeamMcp, type McpTransport, type TeamMcpServer } from '../../src/superagent/host/team-mcp.ts'

const MARKET = 'https://market.example'
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const signer: SeatSigner = { root: () => 'https://host.example', host: () => 'a1b2c3d4', sign: text => edSign(undefined, Buffer.from(text, 'utf8'), privateKey).toString('base64') }

type Exchange = { status: number; body?: unknown; retryAfter?: string }
/** A fake market: verifies each exchange's signature with the node's public key, answers what `next` says. */
function market(next: (req: Record<string, any>, n: number) => Exchange) {
  const seen: Array<Record<string, any>> = []
  const fetch = async (url: string, init: { body: string }) => {
    expect(url).toBe(`${MARKET}/api/a2a/seat-token`)
    const req = JSON.parse(init.body) as Record<string, any>
    const ok = edVerify(undefined, Buffer.from(seatTokenCanonical(req.root, req.host, req.seat_id, req.ts, req.nonce, req.aud), 'utf8'), publicKey, Buffer.from(req.sig, 'base64'))
    seen.push({ ...req, verified: ok })
    const out = next(req, seen.length)
    return { status: out.status, headers: { get: (n: string) => n === 'retry-after' ? out.retryAfter ?? null : null }, json: async () => out.body }
  }
  return { fetch, seen }
}
const token = (req: Record<string, any>, n: number, now: number): Exchange => ({ status: 200, body: { token: `tok-${req.seat_id}-${String(n)}`, token_type: 'Bearer', expires_at: new Date(now + 3_600_000).toISOString(), expires_in: 3600, seat: { host: req.host, seat_id: req.seat_id } } })

describe('the seat-token exchange', () => {
  it('signs the canonical string with the node key, names root/host/seat/aud, and a fresh nonce each time', async () => {
    let now = 1_000_000
    const m = market((req, n) => token(req, n, now))
    const tokens = new SeatTokens(MARKET, { signer, fetch: m.fetch as never, now: () => now })
    expect(await tokens.tokenFor('seat-aaa')).toBe('tok-seat-aaa-1')
    expect(m.seen[0]).toMatchObject({ v: 1, root: 'https://host.example', host: 'a1b2c3d4', seat_id: 'seat-aaa', ts: now, aud: MARKET, verified: true })
    expect(m.seen[0]!.nonce).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
    // Held while more than 5 minutes are left; exchanged again inside the margin, with a new nonce.
    now += 3_600_000 - SEAT_TOKEN_REFRESH_MS - 1
    expect(await tokens.tokenFor('seat-aaa')).toBe('tok-seat-aaa-1')
    now += 2
    expect(await tokens.tokenFor('seat-aaa')).toBe('tok-seat-aaa-2')
    expect(m.seen[1]!.nonce).not.toBe(m.seen[0]!.nonce)
    expect(tokens.status().map(s => s.seatId)).toEqual(['seat-aaa'])
  })

  it('one exchange at a time per seat; seats are apart', async () => {
    const m = market((req, n) => token(req, n, Date.now()))
    const tokens = new SeatTokens(MARKET, { signer, fetch: m.fetch as never })
    const [a, b, c] = await Promise.all([tokens.tokenFor('seat-a'), tokens.tokenFor('seat-a'), tokens.tokenFor('seat-b')])
    expect(a).toBe(b)
    expect(c).not.toBe(a)
    expect(m.seen.map(r => r.seat_id).sort()).toEqual(['seat-a', 'seat-b'])
  })

  it('says why there is no token: refused, rate-limited (with Retry-After), bad request, unreachable, a wrong answer, a bad seat id', async () => {
    const cases: Array<[Exchange | Error, string]> = [
      [{ status: 401, body: { error: 'seat_token_refused' } }, 'refused'],
      [{ status: 429, body: { error: 'seat_token_rate_limited' }, retryAfter: '120' }, 'rate-limited'],
      [{ status: 400, body: { error: 'seat_token_bad_request' } }, 'bad-request'],
      [new Error('ECONNREFUSED'), 'unreachable'],
      [{ status: 200, body: { token: 't', token_type: 'Bearer', expires_in: 3600, seat: { host: 'a1b2c3d4', seat_id: 'someone-else' } } }, 'unreachable'],
    ]
    for (const [answer, code] of cases) {
      const fetch = async () => { if (answer instanceof Error) throw answer; return { status: answer.status, headers: { get: (n: string) => n === 'retry-after' ? answer.retryAfter ?? null : null }, json: async () => answer.body } }
      const tokens = new SeatTokens(MARKET, { signer, fetch: fetch as never })
      await expect(tokens.tokenFor('seat-x')).rejects.toMatchObject({ code, ...(code === 'rate-limited' ? { retryAfterSeconds: 120 } : {}) })
    }
    await expect(new SeatTokens(MARKET, { signer, fetch: (async () => { throw new Error('not called') }) as never }).tokenFor('bad seat id')).rejects.toMatchObject({ code: 'no-seat' })
  })
})

describe('team MCP calls as the member\'s seat', () => {
  const server: TeamMcpServer = { name: 'market', url: `${MARKET}/mcp`, transport: 'streamable-http' }
  /** A fake MCP endpoint: accepts the tokens in `valid`, answers tools/list and tools/call. */
  function mcp(valid: Set<string>) {
    const calls: Array<{ method: string; auth: string; seat: string }> = []
    const transport: McpTransport = async (_url, headers, body) => {
      const req = JSON.parse(body) as { id?: number; method: string; params?: { name?: string } }
      calls.push({ method: req.method, auth: headers.authorization ?? '', seat: headers['x-team-seat'] ?? '' })
      const status = valid.has((headers.authorization ?? '').replace(/^Bearer /, '')) ? 200 : 401
      const result = req.method === 'tools/list' ? { tools: [{ name: 'list_benches', description: 'benches', inputSchema: { type: 'object', properties: {} } }] } : req.method === 'tools/call' ? { content: [{ type: 'text', text: `called ${String(req.params?.name)}` }] } : {}
      return { status, headers: { get: (n: string) => n === 'mcp-session-id' ? 'sess-1' : n === 'content-type' ? 'application/json' : null }, text: async () => JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) }
    }
    return { transport, calls }
  }
  const make = (fetch: unknown, transport: McpTransport, seat: string | null = 'seat-m1', withSigner = true) => new TeamMcp({ servers: () => [server], now: () => new Date().toISOString(), catalogSeat: () => seat ?? undefined, ...(withSigner ? { signer } : {}), tokenFetch: fetch as never, transport })

  it('reads the tool list as a member seat and calls a tool as the calling member\'s seat, with that seat\'s token', async () => {
    const m = market((req, n) => token(req, n, Date.now()))
    const valid = new Set(['tok-seat-m1-1', 'tok-seat-m2-2'])
    const t = mcp(valid)
    const team = make(m.fetch, t.transport)
    await team.refreshTools('market')
    expect(team.status()[0]).toMatchObject({ name: 'market', state: 'ready', offered: 1 })
    const out = await team.callTool('market', 'list_benches', {}, { by: 'session-m2', seat: 'seat-m2', ticketId: 't-1' })
    expect(out.text).toContain('called list_benches')
    expect(t.calls.filter(c => c.method === 'tools/call')).toEqual([{ method: 'tools/call', auth: 'Bearer tok-seat-m2-2', seat: 'seat-m2' }])
    expect(team.calls().at(-1)).toMatchObject({ seatId: 'seat-m2', outcome: 'ok', ticketId: 't-1' })
  })

  it('a refused token is exchanged again once and the call retried once; a second refusal fails as token-refused', async () => {
    const m = market((req, n) => token(req, n, Date.now()))
    const valid = new Set<string>(['tok-seat-m1-2'])
    const t = mcp(valid)
    const team = make(m.fetch, t.transport)
    // First token (…-1) is refused; the second (…-2) is accepted.
    const out = await team.callTool('market', 'list_benches', {}, { by: 's', seat: 'seat-m1' })
    expect(out.isError).toBe(false)
    expect(m.seen).toHaveLength(2)
    valid.clear()
    await expect(team.callTool('market', 'list_benches', {}, { by: 's', seat: 'seat-m1' })).rejects.toMatchObject({ code: 'token-refused' })
    expect(team.calls().at(-1)).toMatchObject({ outcome: 'token-refused' })
  })

  it('no token, no call: a refused exchange, no seat, or no node key fail with the reason — never another credential', async () => {
    const refused = market(() => ({ status: 401, body: { error: 'seat_token_refused' } }))
    const t = mcp(new Set())
    const team = make(refused.fetch, t.transport)
    const failed = await team.callTool('market', 'list_benches', {}, { by: 's', seat: 'seat-m1' }).catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(McpError)
    expect(failed).toMatchObject({ code: 'token-unavailable', message: expect.stringContaining('refused') })
    expect(t.calls).toEqual([])
    await expect(team.callTool('market', 'list_benches', {}, { by: 's' })).rejects.toMatchObject({ code: 'no-seat' })
    await expect(make(refused.fetch, t.transport, 'seat-m1', false).callTool('market', 'list_benches', {}, { by: 's', seat: 'seat-m1' })).rejects.toMatchObject({ code: 'token-unavailable' })
    // Health: no seat in the team, or no token to be had.
    const noSeat = make(refused.fetch, t.transport, null)
    await noSeat.refreshTools('market')
    expect(noSeat.status()[0]).toMatchObject({ state: 'no-seat' })
    await team.refreshTools('market')
    expect(team.status()[0]).toMatchObject({ state: 'unavailable', problem: expect.stringContaining('refused') })
  })
})

describe('#690 review F3–F5 negative regressions', () => {
  const server: TeamMcpServer = { name: 'market', url: `${MARKET}/mcp`, transport: 'streamable-http' }
  function mcp(valid: Set<string>) {
    const calls: Array<{ url: string; method: string; session?: string }> = []
    const transport: McpTransport = async (url, headers, body) => {
      const req = JSON.parse(body) as { id?: number; method: string }
      calls.push({ url, method: req.method, ...(headers['mcp-session-id'] !== undefined ? { session: headers['mcp-session-id'] } : {}) })
      const status = valid.has((headers.authorization ?? '').replace(/^Bearer /, '')) ? 200 : 401
      const result = req.method === 'tools/list' ? { tools: [{ name: 'list_benches' }] } : {}
      return { status, headers: { get: (n: string) => n === 'mcp-session-id' ? `sess-${url}` : n === 'content-type' ? 'application/json' : null }, text: async () => JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) }
    }
    return { transport, calls }
  }

  it('F5: an answer already expired when it arrives, or claiming more than the one-hour token, is not kept and nothing reaches MCP', async () => {
    const now = 1_800_000_000_000
    for (const expires_at of [new Date(now - 1_000).toISOString(), new Date(now + 24 * 3_600_000).toISOString()]) {
      const m = market(req => ({ status: 200, body: { token: 'tok-x', token_type: 'Bearer', expires_at, seat: { host: req.host, seat_id: req.seat_id } } }))
      const t = mcp(new Set(['tok-x']))
      const team = new TeamMcp({ servers: () => [server], now: () => new Date(now).toISOString(), nowMs: () => now, catalogSeat: () => 'seat-m1', signer, tokenFetch: m.fetch as never, transport: t.transport })
      await expect(team.callTool('market', 'list_benches', {}, { by: 's', seat: 'seat-m1' })).rejects.toMatchObject({ code: 'token-unavailable', message: expect.stringContaining('one-hour') })
      expect(t.calls).toEqual([])
      const seats = new SeatTokens(MARKET, { signer, now: () => now, fetch: m.fetch as never })
      await expect(seats.tokenFor('seat-m1')).rejects.toMatchObject({ code: 'unreachable' })
      expect(seats.status()).toEqual([])
    }
  })

  it('F3: a seat refused at a call after the list was read makes the server not ready, with a health problem, until a refresh recovers it', async () => {
    const m = market((req, n) => token(req, n, Date.now()))
    const valid = new Set<string>(['tok-seat-m1-1'])
    const t = mcp(valid)
    const team = new TeamMcp({ servers: () => [server], now: () => new Date().toISOString(), catalogSeat: () => 'seat-m1', signer, tokenFetch: m.fetch as never, transport: t.transport })
    await team.refreshTools('market')
    expect(team.status()[0]).toMatchObject({ state: 'ready' })
    await expect(team.callTool('market', 'list_benches', {}, { by: 's2', seat: 'seat-m2' })).rejects.toMatchObject({ code: 'token-refused' })
    expect(team.status()[0]).toMatchObject({ state: 'unavailable', problem: expect.stringContaining('seat-m2'), faults: [{ seatId: 'seat-m2' }] })
    // The market accepts seat-m2 again: the recovery pass exchanges for it and the server is ready again.
    valid.add('tok-seat-m1-4').add('tok-seat-m1-5').add('tok-seat-m2-6')
    await team.refreshAll()
    expect(team.status()[0]).toMatchObject({ state: 'ready' })
    expect(team.status()[0]).not.toHaveProperty('faults')
  })

  it('F4: a new endpoint on the same origin drops the old session and tool list; the next call starts a new session there', async () => {
    let url = `${MARKET}/mcp`
    const m = market((req, n) => token(req, n, Date.now()))
    const t = mcp(new Set(['tok-seat-m1-1']))
    const team = new TeamMcp({ servers: () => [{ ...server, url }], now: () => new Date().toISOString(), catalogSeat: () => 'seat-m1', signer, tokenFetch: m.fetch as never, transport: t.transport })
    await team.refreshTools('market')
    expect(team.status()[0]).toMatchObject({ state: 'ready', offered: 1 })
    url = `${MARKET}/mcp-v2`
    expect(team.status()[0]).toMatchObject({ state: 'unavailable', offered: 0 })
    t.calls.length = 0
    await team.callTool('market', 'list_benches', {}, { by: 's', seat: 'seat-m1' })
    expect(t.calls.map(c => c.url)).toEqual([url, url, url])
    expect(t.calls[0]).toMatchObject({ method: 'initialize' })
    expect(t.calls[0]).not.toHaveProperty('session')
    expect(t.calls[2]).toMatchObject({ method: 'tools/call', session: `sess-${url}` })
    // Same origin: the token was kept (one exchange in all).
    expect(m.seen).toHaveLength(1)
  })
})
