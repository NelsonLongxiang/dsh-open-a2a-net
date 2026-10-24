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

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
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
/**
 * Eviction cooldown (the zombie-referral breaker): an evicted dead address
 * is refused by {@link PeerStore.offer} for this long — without it the
 * address comes straight back through a linked peer's card advertising
 * (evict → learn → fail → evict forever; observed grinding .156:3081 down
 * 3400 points). v1 keeps the window FIXED at 24h (dead-letter TTL
 * convention); progressive backoff is a future note, not this slice.
 */
export const EVICTION_COOLDOWN_MS = 24 * 60 * 60 * 1000
/** Ledger bound: the newest 64 evictions survive (LRU by evictedAt). */
export const EVICTION_LEDGER_CAP = 64

/** One eviction-ledger row: when a URL was evicted (epoch ms). */
export interface EvictionRecord {
  readonly url: string
  readonly evictedAt: number
}

/** One tracked peer. */
export interface PeerRecord {
  readonly url: string
  score: number
  readonly seed: boolean
  /** The signed-card session the peer served last, when a fetch revealed it. */
  readonly session?: string
  /** Epoch ms of the last contact attempt (success or failure) — the host
   *  rail's health lamp reads the recency of this (#20 W-C). */
  lastContactAt?: number
  /** Whether that last attempt SUCCEEDED (gh#24): the lamp distinguishes a
   *  fresh success (green) from a fresh failure (red); recency alone made
   *  a dead peer glow green. */
  lastContactOk?: boolean
}

/** The persisted store document (whole-file read/write, small by design). */
export interface PeerStoreSnapshot {
  readonly peers: readonly PeerRecord[]
  /** Eviction ledger (gh#46): absent on pre-cooldown files = empty. */
  readonly evictions?: readonly EvictionRecord[]
}

/**
 * Bounded, quality-scored peer collection with whole-file persistence.
 * Pure of any network: the caller drives fetch outcomes through
 * {@link noteFailure} / {@link noteSuccess} and feeds referral URLs through
 * {@link offer}.
 */
export class PeerStore {
  private readonly peers = new Map<string, PeerRecord>()
  /** Eviction ledger (gh#46): url → when it was evicted. Seeds never enter. */
  private readonly evictions = new Map<string, number>()
  private readonly now: () => number

  /**
   * @param seeds - the configured seed URLs; always retained (never evicted).
   * @param path - persistence file (`<dsh-home>/a2a/peers.json`); empty = no persistence.
   * @param cap - peer bound, seeds included (default {@link PEER_CAP}).
   */
  constructor(
    seeds: readonly string[],
    private readonly path: string,
    private readonly cap = PEER_CAP,
    private readonly persistDebounceMs = 1_000,
    now?: () => number,
  ) {
    this.now = now ?? (() => Date.now())
    this.restore()
    for (const seed of seeds) {
      if (seed === '') continue
      // The config is authoritative for a seed: it is (re)marked as one —
      // immune to eviction — and restarts from the initial score regardless
      // of the persisted one. Replacing the record wholesale keeps PeerRecord
      // fields readonly. The contact stamps are observations, not config:
      // they carry over, so a restart does not blank a seed's lamp (gh#24).
      const prior = this.peers.get(seed)
      this.peers.set(seed, {
        url: seed,
        score: INITIAL_SCORE,
        seed: true,
        ...(prior?.lastContactAt !== undefined ? { lastContactAt: prior.lastContactAt } : {}),
        ...(prior?.lastContactOk !== undefined ? { lastContactOk: prior.lastContactOk } : {}),
      })
    }
    // The config is authoritative BOTH ways (board-stale-peer fix, 0.6.26):
    // a persisted record may carry seed:true from an OLD config generation
    // whose operator already removed the URL — left alone, a dead URL keeps
    // its immunity forever and the workbench board shows a peer that can
    // never evict (owner sighting: `.157:13082` survived its config removal
    // for days). Downgrade those to referral-learned, keeping the score so
    // noteFailure can decay and evict them honestly.
    const current = new Set(seeds.filter(seed => seed !== ''))
    for (const [url, peer] of this.peers) {
      if (peer.seed && !current.has(url)) {
        // Downgrade keeps every learned fact (score, session, contact
        // stamps) — only the immunity bit changes.
        this.peers.set(url, {
          url,
          score: peer.score,
          seed: false,
          ...(peer.session !== undefined ? { session: peer.session } : {}),
          ...(peer.lastContactAt !== undefined ? { lastContactAt: peer.lastContactAt } : {}),
          ...(peer.lastContactOk !== undefined ? { lastContactOk: peer.lastContactOk } : {}),
        })
      }
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

  /**
   * The operator-established subset (gh#8 N9): URLs that came from the
   * config seed set — never the referral-learned tail. Team-name resolution
   * rides this basis so a self-naming host nobody linked cannot capture
   * routes; probing and visibility keep the full list.
   */
  listSeeded(): readonly string[] {
    return [...this.peers.values()].filter(peer => peer.seed).map(peer => peer.url)
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
    // gh#46 cooldown: an address we EVICTED is refused while the window
    // holds (a linked peer's card still advertising it must not re-admit a
    // proven-dead address). Past the window it re-enters fresh — the peer
    // fixed within a day heals naturally at INITIAL_SCORE.
    const evictedAt = this.evictions.get(url)
    if (evictedAt !== undefined) {
      if (this.now() - evictedAt < EVICTION_COOLDOWN_MS) return false
      this.evictions.delete(url)
    }
    if (!this.hasRoom()) return false
    this.peers.set(url, { url, score: INITIAL_SCORE, seed: false })
    this.persist()
    return true
  }

  /**
   * Drop one tracked peer outright — a self-referral (a peer listing this
   * node's own URL back at it) must not linger as a tracked peer. Seeds are
   * config-owned and stay.
   * @param url - the peer to forget.
   */
  drop(url: string): void {
    const peer = this.peers.get(url)
    if (peer === undefined || peer.seed) return
    this.peers.delete(url)
    this.persist()
  }

  /**
   * Note a failed fetch of one peer. Every peer records the failed attempt
   * (the host-rail lamp turns red for a seed and a learned peer alike,
   * gh#24); only a non-seed's score drops, and an at-or-below-floor peer is
   * evicted, so a bad referral disappears rather than degrading forever.
   * Seeds are config-owned and never penalized.
   * @param url - the peer that failed.
   */
  noteFailure(url: string): void {
    const peer = this.peers.get(url)
    if (peer === undefined) return
    peer.lastContactAt = this.now()
    peer.lastContactOk = false
    if (!peer.seed) {
      peer.score -= FAILURE_PENALTY
      if (peer.score <= EVICTION_FLOOR) {
        this.peers.delete(url)
        // gh#46: the eviction lands in the cooldown ledger — offer() refuses
        // the URL while the window holds. Seeds never reach this branch
        // (they are never evicted, so never ledgered: config stays exempt).
        this.evictions.set(url, this.now())
        this.pruneLedger()
      }
    }
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
    peer.lastContactAt = this.now()
    peer.lastContactOk = true
    // A re-admitted URL that answers has proven itself again — its ledger
    // row (if any survived) is moot.
    this.evictions.delete(url)
    this.persist()
  }

  /**
   * The epoch ms of the last contact attempt with one tracked peer (#20 W-C
   * host-rail health lamp), or undefined when the store never touched it.
   */
  lastContact(url: string): number | undefined {
    return this.peers.get(url)?.lastContactAt
  }

  /**
   * Whether the last contact attempt succeeded (gh#24) — undefined when no
   * attempt was ever recorded.
   */
  lastContactOk(url: string): boolean | undefined {
    return this.peers.get(url)?.lastContactOk
  }

  /**
   * The current quality score of one tracked peer, for state reporting.
   * @param url - the peer URL.
   * @returns the score, or undefined when the peer is not tracked.
   */
  score(url: string): number | undefined {
    return this.peers.get(url)?.score
  }

  /**
   * Record the signed-card session a tracked peer served. The session is the
   * node identity (the same fact the self-referral guard judges), so learning
   * it per URL is what lets the caller collapse alias spellings of one node
   * (loopback vs LAN IP) into a single tracked peer.
   * @param url - the tracked peer the card came from.
   * @param session - the verified card's session label; empty is ignored.
   */
  learnSession(url: string, session: string): void {
    const peer = this.peers.get(url)
    if (peer === undefined || session === '') return
    // PeerRecord fields are readonly: replace the record wholesale.
    this.peers.set(url, { ...peer, session })
    this.persist()
  }

  /**
   * The strongest tracked URL known to serve one node identity — seeds beat
   * referrals, then the higher score wins (ties keep first-tracked order).
   * @param session - the signed-card session to look up.
   * @returns the winning peer URL, or undefined when none is tracked.
   */
  bySession(session: string): string | undefined {
    let best: PeerRecord | undefined
    for (const peer of this.peers.values()) {
      if (peer.session !== session) continue
      if (best === undefined || (best.seed === peer.seed ? peer.score > best.score : peer.seed)) best = peer
    }
    return best?.url
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
          ...(typeof peer.session === 'string' && peer.session !== '' ? { session: peer.session } : {}),
          // gh#24: the contact stamp round-trips (a restart must not forget
          // when we last reached the peer, nor whether it answered).
          ...(typeof peer.lastContactAt === 'number' && Number.isFinite(peer.lastContactAt) ? { lastContactAt: peer.lastContactAt } : {}),
          ...(typeof peer.lastContactOk === 'boolean' ? { lastContactOk: peer.lastContactOk } : {}),
        })
      }
      // gh#46: the eviction ledger round-trips (absent = empty, pre-cooldown
      // files stay fully compatible).
      const evictions = (snapshot as { evictions?: unknown }).evictions
      if (Array.isArray(evictions)) {
        for (const row of evictions) {
          const e = row as Partial<EvictionRecord> | null
          if (typeof e?.url === 'string' && e.url !== '' && typeof e.evictedAt === 'number' && Number.isFinite(e.evictedAt)) {
            this.evictions.set(e.url, e.evictedAt)
          }
        }
        this.pruneLedger()
      }
    } catch {
      // A corrupt store is not fatal: fall back to seeds only.
    }
  }

  /** Keep the ledger at its LRU bound: the oldest evictions fall off. */
  private pruneLedger(): void {
    if (this.evictions.size <= EVICTION_LEDGER_CAP) return
    const byAge = [...this.evictions.entries()].sort((a, b) => a[1] - b[1])
    const excess = this.evictions.size - EVICTION_LEDGER_CAP
    for (let i = 0; i < excess; i += 1) this.evictions.delete(byAge[i]![0])
  }

  /**
   * Persist the current peer set (no-op when no path was configured).
   * Writes are debounced and asynchronous: a sweep that settles dozens of
   * fetch outcomes must not fire one synchronous writeFileSync per change
   * (each blocks the event loop for milliseconds on Windows). The dirty
   * flag coalesces the whole window into one async write; `flush()` lets
   * tests and teardown await the final state on disk. A crash inside the
   * window loses at most `persistDebounceMs` of score deltas — seeds are
   * re-seeded from config on every boot, and scores rebuild on contact.
   */
  private dirty = false
  private writeChain: Promise<void> = Promise.resolve()
  private pendingTimer: NodeJS.Timeout | undefined

  private persist(): void {
    if (this.path === '') return
    this.dirty = true
    // Classic trailing debounce: one shared timer, reset on every change, so
    // a steady drip of outcomes still lands as one write after the last
    // change — not one write per elapsed window. Unref'd so a timer armed at
    // teardown never keeps the process alive for it.
    if (this.pendingTimer !== undefined) clearTimeout(this.pendingTimer)
    const timer = setTimeout(() => {
      this.pendingTimer = undefined
      if (!this.dirty) return
      this.dirty = false
      this.writeChain = this.writeChain.then(async () => {
        if (this.path === '') return
        try {
          await mkdir(dirname(this.path), { recursive: true })
          const snapshot: PeerStoreSnapshot = {
            peers: [...this.peers.values()].map(peer => ({ ...peer })),
            evictions: [...this.evictions.entries()].map(([url, evictedAt]) => ({ url, evictedAt })),
          }
          await writeFile(this.path, JSON.stringify(snapshot), { mode: 0o600 })
        } catch {
          // An unwritable home must not break routing; the store degrades to memory-only.
        }
      })
    }, this.persistDebounceMs)
    timer.unref?.()
    this.pendingTimer = timer
  }

  /**
   * Await the last scheduled write (tests and teardown). Resolves when the
   * debounced write chain has settled with the current in-memory state.
   */
  async flush(): Promise<void> {
    if (this.dirty) await new Promise(resolve => setTimeout(resolve, this.persistDebounceMs + 5))
    await this.writeChain
  }
}
