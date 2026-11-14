/**
 * Seat tokens for the workbench market's MCP (market spec seat-token-exchange-spec.md; owner 2026-11-13: the host signs the
 * exchange with its node key, and teams on one host are not isolated from each other — recorded legacy difference L22).
 *
 * The host exchanges, per seat, a one-hour bearer token at `POST <market origin>/api/a2a/seat-token`. The request is signed with
 * the node's Ed25519 key over `JSON.stringify(["wm-seat-token/1", root, host, seat_id, ts, nonce, aud])`. The token lives only in
 * this process's memory, is exchanged again before it expires, and is never written anywhere. When no token can be had, the
 * caller gets a clear error: there is no fallback to a long-lived token.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/seat-token
 */
import { randomBytes } from 'node:crypto'

export const SEAT_TOKEN_TAG = 'wm-seat-token/1'
/** A token is exchanged again when less than this is left of it. */
export const SEAT_TOKEN_REFRESH_MS = 5 * 60_000
/** The market issues one-hour tokens (spec: expires_in 3600); an answer claiming longer than this, counted from the request, is not believed. */
export const SEAT_TOKEN_TTL_MS = 60 * 60_000
/** Clock difference tolerated between this host and the market when checking an answer's expiry. */
const SKEW_MS = 60_000
const SEAT_ID = /^[A-Za-z0-9._:-]{1,64}$/
const TIMEOUT_MS = 15_000

/** The bytes the node key signs (the market verifies exactly these). */
export function seatTokenCanonical(root: string, host: string, seatId: string, ts: number, nonce: string, aud: string): string {
  return JSON.stringify([SEAT_TOKEN_TAG, root, host, seatId, ts, nonce, aud])
}

/** Why no token could be had: the market's answer, or the transport. */
export type SeatTokenFailure = 'refused' | 'rate-limited' | 'bad-request' | 'unreachable' | 'no-seat'

export class SeatTokenError extends Error {
  constructor(readonly code: SeatTokenFailure, message: string, readonly retryAfterSeconds?: number) { super(message) }
}

/** The node's identity at the market: its registered root, its key fingerprint, and a signer with the node key. */
export interface SeatSigner {
  /** The root (origin) this host is registered under at the market. */
  readonly root: () => string
  /** The node public key's fingerprint, first 8 hex (canvasOwnerFingerprint). */
  readonly host: () => string
  /** base64 Ed25519 signature of `text` with the node private key. */
  readonly sign: (text: string) => string
}

export type SeatTokenFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>

export interface SeatTokenDeps {
  readonly signer: SeatSigner
  readonly now?: () => number
  readonly fetch?: SeatTokenFetch
}

interface Held { readonly token: string; readonly expiresAt: number }

/** One market's seat tokens, keyed by seat id; in memory only. */
export class SeatTokens {
  private readonly held = new Map<string, Held>()
  private readonly inflight = new Map<string, Promise<string>>()

  /** @param market - the market's origin (its MCP server URL's origin); it is also the audience the request names. */
  constructor(private readonly market: string, private readonly d: SeatTokenDeps) {}

  private now(): number { return this.d.now?.() ?? Date.now() }

  /** A usable token for the seat: the held one while more than {@link SEAT_TOKEN_REFRESH_MS} is left, else a fresh exchange. */
  async tokenFor(seatId: string): Promise<string> {
    const held = this.held.get(seatId)
    if (held !== undefined && held.expiresAt - this.now() > SEAT_TOKEN_REFRESH_MS) return held.token
    const running = this.inflight.get(seatId)
    if (running !== undefined) return await running
    const exchange = this.exchange(seatId).finally(() => { this.inflight.delete(seatId) })
    this.inflight.set(seatId, exchange)
    return await exchange
  }

  /** The market refused the token on a call (401): forget it, so the next call exchanges a new one. */
  drop(seatId: string): void { this.held.delete(seatId) }

  /** Seats holding a token now and when each expires (no token), for the team page. */
  status(): Array<{ seatId: string; expiresAt: string }> {
    return [...this.held].map(([seatId, h]) => ({ seatId, expiresAt: new Date(h.expiresAt).toISOString() }))
  }

  private async exchange(seatId: string): Promise<string> {
    if (!SEAT_ID.test(seatId)) throw new SeatTokenError('no-seat', `seat id ${seatId} is not one the market's roster can hold`)
    const ts = this.now()
    const nonce = randomBytes(24).toString('base64url')
    const root = this.d.signer.root(), host = this.d.signer.host(), aud = this.market
    const sig = this.d.signer.sign(seatTokenCanonical(root, host, seatId, ts, nonce, aud))
    const body = JSON.stringify({ v: 1, root, host, seat_id: seatId, ts, nonce, aud, sig })
    const send: SeatTokenFetch = this.d.fetch ?? (async (url, init) => await fetch(url, { ...init, redirect: 'error' }))
    let response: Awaited<ReturnType<SeatTokenFetch>>
    try {
      response = await send(`${this.market}/api/a2a/seat-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (error) {
      throw new SeatTokenError('unreachable', `the market at ${this.market} could not be reached for a seat token: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`)
    }
    if (response.status === 429) {
      const after = Number(response.headers.get('retry-after'))
      throw new SeatTokenError('rate-limited', `the market limits seat-token exchanges; try again${Number.isFinite(after) && after > 0 ? ` in ${String(after)}s` : ' later'}`, Number.isFinite(after) && after > 0 ? after : undefined)
    }
    if (response.status === 401) throw new SeatTokenError('refused', 'the market refused this host a token for that seat (it checks: this host active with its pinned key, the seat in this host\'s latest roster, the seat not revoked)')
    if (response.status === 400) throw new SeatTokenError('bad-request', 'the market could not read the seat-token request')
    if (response.status !== 200) throw new SeatTokenError('unreachable', `the market answered HTTP ${String(response.status)} for a seat token`)
    let out: { token?: unknown; token_type?: unknown; expires_at?: unknown; expires_in?: unknown; seat?: { host?: unknown; seat_id?: unknown } }
    try { out = await response.json() as typeof out } catch { throw new SeatTokenError('unreachable', 'the market\'s seat-token answer was not JSON') }
    const received = this.now()
    const expires = typeof out.expires_at === 'string' ? Date.parse(out.expires_at) : typeof out.expires_in === 'number' ? received + out.expires_in * 1_000 : NaN
    if (typeof out.token !== 'string' || out.token === '' || /\s/.test(out.token) || out.token_type !== 'Bearer' || !Number.isFinite(expires) || out.seat?.seat_id !== seatId || out.seat?.host !== host) {
      throw new SeatTokenError('unreachable', 'the market\'s seat-token answer was not a token for this seat')
    }
    // Checked against when the answer arrived and the one-hour contract: an expired token, or one claiming to outlive it, is
    // never kept nor sent to an MCP server.
    if (expires <= received || expires > ts + SEAT_TOKEN_TTL_MS + SKEW_MS) {
      throw new SeatTokenError('unreachable', `the market's seat-token answer expires ${new Date(expires).toISOString()}, outside the one-hour token it issues`)
    }
    this.held.set(seatId, { token: out.token, expiresAt: expires })
    return out.token
  }
}
