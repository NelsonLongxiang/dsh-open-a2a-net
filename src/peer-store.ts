/**
 * Bounded, quality-scored peer store (GNUnet hostlist semantics, slice 2).
 * The configured peer list is a seed set, not the network: referral URLs
 * learned from fetched cards join the store, are bounded and quality-scored,
 * and persist across restarts. Failed fetches degrade a peer; a bad peer that
 * keeps failing is evicted, while seeds stay for the lifetime of the config
 * that named them. Design basis:
 * .agents/notes/proposed/feature/2026-08-16-gnunet-prior-art-for-a2a-topology.md.
 * @module @nelsonlongxiang/dsh-open-a2a-net/peer-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Hard cap on tracked peers, seeds included (hostlist bound: 30). */
export const PEER_CAP = 30
/** Initial quality score of a seed or newly offered peer. */
export const INITIAL_SCORE = 10_000
/** Quality penalty on a failed fetch. */
export const FAILURE_PENALTY = 100
/** Quality reward on a successful fetch. */
export const SUCCESS_REWARD = 100
/** Score floor: at or below this a non-seed peer is evicted. */
export const EVICTION_FLOOR = 0

/** One tracked peer. */
export interface PeerRecord {
  readonly url: string
  score: number
  readonly seed: boolean
}

/** The persisted store document (whole-file read/write, small by design). */
export interface PeerStoreSnapshot {
  readonly peers: readonly PeerRecord[]
}

/**
 * Bounded, quality-scored peer collection with whole-file persistence.
 * Pure of any network: the caller drives fetch outcomes through
 * {@link noteFailure} / {@link noteSuccess} and feeds referral URLs through
 * {@link offer}.
 */
export class PeerStore {
  private readonly peers = new Map<string, PeerRecord>()

  /**
   * @param seeds - the configured seed URLs; always retained (never evicted).
   * @param path - persistence file (`<dsh-home>/a2a/peers.json`); empty = no persistence.
   * @param cap - peer bound, seeds included (default {@link PEER_CAP}).
   */
  constructor(
    seeds: readonly string[],
    private readonly path: string,
    private readonly cap = PEER_CAP,
  ) {
    this.restore()
    for (const seed of seeds) {
      if (seed === '') continue
      // The config is authoritative for a seed: it is (re)marked as one —
      // immune to eviction — and restarts from the initial score regardless
      // of the persisted one. Replacing the record wholesale keeps PeerRecord
      // fields readonly.
      this.peers.set(seed, { url: seed, score: INITIAL_SCORE, seed: true })
    }
  }

  /**
   * Every tracked peer URL: seeds first (in first-tracked order), then
   * offered peers by score descending (equal scores keep first-tracked order).
   * @returns the ordered peer URLs.
   */
  list(): readonly string[] {
    return [...this.peers.values()]
      .sort((a, b) => (a.seed === b.seed ? b.score - a.score : a.seed ? -1 : 1))
      .map(peer => peer.url)
  }

  /** Whether the store has room for one more peer. */
  private hasRoom(): boolean {
    return this.peers.size < this.cap
  }

  /**
   * Offer a referral URL learned from a fetched card. Bounded: an unknown
   * URL only joins when under the cap; a known URL changes nothing.
   * @param url - the referred card URL.
   * @returns whether the peer is tracked (freshly joined or already known).
   */
  offer(url: string): boolean {
    if (url === '') return false
    if (this.peers.has(url)) return true
    if (!this.hasRoom()) return false
    this.peers.set(url, { url, score: INITIAL_SCORE, seed: false })
    this.persist()
    return true
  }

  /**
   * Note a failed fetch of one peer. A non-seed's score drops; an
   * at-or-below-floor peer is evicted, so a bad referral disappears rather
   * than degrading forever. Seeds are config-owned and never penalized.
   * @param url - the peer that failed.
   */
  noteFailure(url: string): void {
    const peer = this.peers.get(url)
    if (peer === undefined || peer.seed) return
    peer.score -= FAILURE_PENALTY
    if (peer.score <= EVICTION_FLOOR) this.peers.delete(url)
    this.persist()
  }

  /**
   * Note a successful fetch of one peer.
   * @param url - the peer that answered with a verified card.
   */
  noteSuccess(url: string): void {
    const peer = this.peers.get(url)
    if (peer === undefined) return
    peer.score += SUCCESS_REWARD
    this.persist()
  }

  /** Load a persisted snapshot on construction, if present. */
  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as PeerStoreSnapshot | null
      const peers = snapshot?.peers
      if (!Array.isArray(peers)) return
      for (const entry of peers) {
        const peer = entry as Partial<PeerRecord> | null
        if (typeof peer?.url !== 'string' || peer.url === '') continue
        this.peers.set(peer.url, {
          url: peer.url,
          score: typeof peer.score === 'number' && Number.isFinite(peer.score) ? peer.score : INITIAL_SCORE,
          seed: peer.seed === true,
        })
      }
    } catch {
      // A corrupt store is not fatal: fall back to seeds only.
    }
  }

  /** Persist the current peer set (no-op when no path was configured). */
  private persist(): void {
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const snapshot: PeerStoreSnapshot = {
        peers: [...this.peers.values()].map(peer => ({ ...peer })),
      }
      writeFileSync(this.path, JSON.stringify(snapshot), { mode: 0o600 })
    } catch {
      // An unwritable home must not break routing; the store degrades to memory-only.
    }
  }
}
