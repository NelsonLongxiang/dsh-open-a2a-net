/**
 * Self-referral suppression: decentralized gossip mirrors peer lists back
 * and forth, so every alias of this node's own address comes home as an
 * inbound referral within minutes of being dropped. Fetching one is the
 * identity check that drops it (the fetched card carries our session id),
 * but the next inbound referral re-offers the same URL seconds later, and
 * the peer store flickers between present and dropped forever.
 *
 * This filter remembers each URL whose fetch revealed selfhood for a window
 * far beyond any realistic offer cadence: offers inside the window are
 * refused without a network round-trip. Shape-agnostic on purpose — alias
 * spellings never seen before (localhost vs 127.0.0.1 vs a hostname) suppress
 * naturally once their first fetch unmasks them.
 * @module @nelsonlongxiang/dsh-open-a2a-net/self-suppress
 */

/** How long a self-revealing URL stays suppressed after its unmasking fetch. */
export const SELF_REFERRAL_SUPPRESS_MS = 6 * 60 * 60_000

/** Bounded memory of URLs whose recent fetch proved they serve this node. */
export class SelfReferralFilter {
  private readonly remembered = new Map<string, number>()
  private readonly now: () => number

  /** @param now - injectable clock for deterministic tests. */
  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  /**
   * Record that fetching `url` served this node's own card. Expired entries
   * prune first, so the map stays bounded by the live offer cadence.
   */
  remember(url: string): void {
    if (url === '') return
    this.prune(this.now())
    this.remembered.set(url, this.now())
  }

  /**
   * Whether one inbound referral is still worth offering to the store.
   * A URL unmasked as self inside the suppression window refuses without a
   * fetch; every other URL passes through unchanged.
   */
  shouldOffer(url: string): boolean {
    const at = this.remembered.get(url)
    if (at === undefined) return true
    if (this.now() - at > SELF_REFERRAL_SUPPRESS_MS) {
      this.remembered.delete(url)
      return true
    }
    return false
  }

  /** Drop entries past the window (called from the mutating entry points). */
  private prune(at: number): void {
    for (const [url, since] of this.remembered) {
      if (at - since > SELF_REFERRAL_SUPPRESS_MS) this.remembered.delete(url)
    }
  }
}
