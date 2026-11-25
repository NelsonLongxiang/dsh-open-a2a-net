/**
 * #933: device-code pairing for an owner delegate. A terminal on another machine asks a node for a pairing; the node
 * answers a short code (shown in the terminal and on the node's team page) and a secret only the terminal holds. The owner,
 * logged in on that node's page, checks the code and allows it; the node then issues the delegate and hands its token once
 * to whoever polls with the secret. Nothing here is authenticated by itself — starting and polling are open by nature — so
 * the limits are: few pending at once, a short life, a per-address start budget, the owner matching the code, and a secret
 * compared in constant time with one answer for "unknown" and "wrong secret". The delegate is issued only when the terminal
 * collects it: an approved pairing that is never collected (it expired, or the node restarted) leaves no credential behind.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/owner-pairing
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

/** How long a pairing waits for the owner and for its terminal, in milliseconds (10 minutes). */
export const PAIRING_TTL_MS = 10 * 60_000
/** At most this many pairings wait at once on a node. */
export const PAIRINGS_PENDING_MAX = 3
/** Starts one address may make per window, and the window. */
export const PAIRING_STARTS_PER_ADDRESS = 5, PAIRING_START_WINDOW_MS = 10 * 60_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** What the owner sees of a pairing on the team page: never its secret, never a token. */
export interface PairingView { readonly id: string; readonly code: string; readonly name: string; readonly days: number; readonly at: string; readonly expiresAt: string; readonly state: 'waiting' | 'approved' }

interface Pairing {
  readonly id: string; readonly code: string; readonly name: string; readonly days: number; readonly at: number; readonly expires: number
  readonly secretHash: Buffer; state: 'waiting' | 'approved' | 'denied'
}

/** A poll's answer. `not-found` covers an unknown id and a wrong secret alike. */
export type PairingPoll = { readonly state: 'waiting'; readonly expiresAt: string } | { readonly state: 'approved'; readonly token: string; readonly delegateId: string } | { readonly state: 'retry'; readonly error: string } | { readonly state: 'denied' | 'expired' | 'not-found' }

const hash = (secret: string): Buffer => createHash('sha256').update(secret, 'utf8').digest()

/** A short code: 8 characters without look-alikes, shown as XXXX-XXXX. */
export function pairingCode(bytes: Buffer = randomBytes(8)): string {
  const chars = [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]!).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`
}

/** The pairings a node is waiting on: in memory only, so a restart drops them (a terminal just starts again). */
export class OwnerPairings {
  private readonly pairings = new Map<string, Pairing>()
  private readonly starts = new Map<string, number[]>()

  /**
   * @param now - the clock (ms).
   * @param random - fresh secret material (tests pin it).
   */
  constructor(private readonly now: () => number = () => Date.now(), private readonly random: () => { readonly id: string; readonly secret: string; readonly code: string } = () => ({ id: randomUUID(), secret: randomBytes(32).toString('base64url'), code: pairingCode() })) {}

  /** Expire what is old (an approved pairing never collected issued nothing, so nothing needs revoking). */
  sweep(): void {
    const at = this.now()
    for (const [id, p] of this.pairings) if (p.expires <= at) this.pairings.delete(id)
    for (const [address, times] of this.starts) { const kept = times.filter(t => t > at - PAIRING_START_WINDOW_MS); if (kept.length === 0) this.starts.delete(address); else this.starts.set(address, kept) }
  }

  /**
   * A terminal asks for a pairing.
   * @param address - the asking address, for the start budget.
   * @param name - the delegate's name (shown to the owner).
   * @param days - how long the delegate will live (1..365).
   * @returns the id, code, secret and expiry, or why not.
   */
  start(address: string, name: unknown, days: unknown): { ok: true; id: string; code: string; secret: string; expiresAt: string } | { ok: false; code: string; error: string } {
    const label = typeof name === 'string' ? name.trim() : ''
    if (label === '' || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) return { ok: false, code: 'input', error: 'name is required, at most 80 characters, no control characters' }
    const life = days === undefined ? 30 : days
    if (typeof life !== 'number' || !Number.isInteger(life) || life < 1 || life > 365) return { ok: false, code: 'input', error: 'days is a whole number from 1 to 365' }
    const at = this.now()
    const recent = (this.starts.get(address) ?? []).filter(t => t > at - PAIRING_START_WINDOW_MS)
    if (recent.length >= PAIRING_STARTS_PER_ADDRESS) return { ok: false, code: 'rate', error: 'too many pairing requests from this address; try again in a few minutes' }
    if ([...this.pairings.values()].filter(p => p.expires > at && p.state === 'waiting').length >= PAIRINGS_PENDING_MAX) return { ok: false, code: 'busy', error: `${String(PAIRINGS_PENDING_MAX)} pairings already wait for the owner; try again when one is answered or expires` }
    this.starts.set(address, [...recent, at])
    const { id, secret, code } = this.random()
    this.pairings.set(id, { id, code, name: label, days: life, at, expires: at + PAIRING_TTL_MS, secretHash: hash(secret), state: 'waiting' })
    return { ok: true, id, code, secret, expiresAt: new Date(at + PAIRING_TTL_MS).toISOString() }
  }

  /** The waiting and approved-uncollected pairings, for the owner's page. */
  list(): PairingView[] {
    const at = this.now()
    return [...this.pairings.values()].filter(p => p.expires > at && p.state !== 'denied')
      .map(p => ({ id: p.id, code: p.code, name: p.name, days: p.days, at: new Date(p.at).toISOString(), expiresAt: new Date(p.expires).toISOString(), state: p.state === 'approved' ? 'approved' as const : 'waiting' as const }))
  }

  /**
   * The owner allows a waiting pairing. Nothing is issued yet: the delegate is made when the terminal collects it.
   * @returns ok, or why not.
   */
  approve(id: string): { ok: true } | { ok: false; code: string; error: string } {
    const p = this.pairings.get(id)
    if (p === undefined || p.expires <= this.now() || p.state !== 'waiting') return { ok: false, code: 'not-found', error: 'no waiting pairing with that id (it expired, was answered, or never existed)' }
    p.state = 'approved'
    return { ok: true }
  }

  /** The owner refuses a waiting pairing. */
  deny(id: string): { ok: boolean } {
    const p = this.pairings.get(id)
    if (p === undefined || p.expires <= this.now() || p.state !== 'waiting') return { ok: false }
    p.state = 'denied'
    return { ok: true }
  }

  /**
   * The terminal asks how its pairing stands. An approved pairing is collected once: `issue` makes the delegate then, and
   * its token is answered; if issuing fails the pairing stays approved and the answer is `retry`. A refusal is said once;
   * after that, and for any unknown id or wrong secret, the answer is `not-found`.
   */
  poll(id: unknown, secret: unknown, issue: (name: string, days: number) => { readonly token: string; readonly id: string }): PairingPoll {
    if (typeof id !== 'string' || typeof secret !== 'string') return { state: 'not-found' }
    const p = this.pairings.get(id)
    if (p === undefined) return { state: 'not-found' }
    const given = hash(secret)
    if (given.length !== p.secretHash.length || !timingSafeEqual(given, p.secretHash)) return { state: 'not-found' }
    if (p.expires <= this.now()) { this.pairings.delete(id); return { state: 'expired' } }
    if (p.state === 'denied') { this.pairings.delete(id); return { state: 'denied' } }
    if (p.state === 'approved') {
      let issued: { readonly token: string; readonly id: string }
      try { issued = issue(p.name, p.days) } catch (error) { return { state: 'retry', error: String((error as Error).message ?? error) } }
      this.pairings.delete(id)
      return { state: 'approved', token: issued.token, delegateId: issued.id }
    }
    return { state: 'waiting', expiresAt: new Date(p.expires).toISOString() }
  }
}
