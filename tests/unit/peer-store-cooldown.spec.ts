/**
 * gh#46 eviction cooldown (the zombie-referral breaker, review-seat spec):
 * an evicted dead address, still advertised by a linked peer's card, used
 * to be re-learned instantly — evict → learn → fail → evict forever
 * (observed grinding .156:3081 down 3400 points in the loop). The ledger
 * refuses offer() for 24h; past the window the address re-enters fresh.
 * Five acceptance pins, spec-verbatim:
 *   ① evict → refused inside the window
 *   ② clock-injected expiry → re-admitted at INITIAL_SCORE
 *   ③ ledger round-trips across restart
 *   ④ seeds/config peers are never affected
 *   ⑤ LRU bound: the 65th eviction squeezes the oldest out
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PeerStore, EVICTION_COOLDOWN_MS, INITIAL_SCORE, FAILURE_PENALTY, EVICTION_LEDGER_CAP, type PeerStoreSnapshot } from '../../src/peer-store.ts'

/** A clock the test pushes forward. */
function clock(start = 1_000_000): { now: () => number; tick: (ms: number) => void } {
  let t = start
  return { now: () => t, tick: ms => { t += ms } }
}

/** Evict one learned peer by grinding it to the floor. */
function evict(store: PeerStore, url: string): void {
  store.offer(url)
  for (let i = 0; i < Math.ceil(INITIAL_SCORE / FAILURE_PENALTY); i += 1) store.noteFailure(url)
  expect(store.score(url)).toBeUndefined() // gone
}

describe('gh#46 eviction cooldown ledger', () => {
  it('① an evicted address is refused by offer() inside the 24h window', () => {
    const c = clock()
    const store = new PeerStore([], '', undefined, undefined, c.now)
    evict(store, 'http://dead')
    c.tick(EVICTION_COOLDOWN_MS - 1)
    expect(store.offer('http://dead')).toBe(false)
    expect(store.score('http://dead')).toBeUndefined()
  })

  it('② past the window the address re-enters fresh (INITIAL_SCORE)', () => {
    const c = clock()
    const store = new PeerStore([], '', undefined, undefined, c.now)
    evict(store, 'http://fixed')
    c.tick(EVICTION_COOLDOWN_MS + 1)
    expect(store.offer('http://fixed')).toBe(true)
    expect(store.score('http://fixed')).toBe(INITIAL_SCORE)
  })

  it('③ the ledger round-trips across restart (refusal survives reload)', async () => {
    const c = clock()
    const path = join(mkdtempSync(join(tmpdir(), 'gh46-')), 'peers.json')
    const first = new PeerStore([], path, undefined, undefined, c.now)
    evict(first, 'http://dead')
    await first.flush()
    // Restart on the same file: the fresh clock sits INSIDE the window.
    const reloaded = new PeerStore([], path, undefined, undefined, () => c.now())
    expect(reloaded.offer('http://dead')).toBe(false)
    // And the ledger is on disk (backward-compatible field).
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as PeerStoreSnapshot
    expect(onDisk.evictions?.some(row => row.url === 'http://dead')).toBe(true)
  })

  it('④ seeds/config peers are exempt: never evicted, never refused', () => {
    const c = clock()
    const store = new PeerStore(['http://seed'], '', undefined, undefined, c.now)
    for (let i = 0; i < Math.ceil((INITIAL_SCORE / FAILURE_PENALTY) * 3); i += 1) store.noteFailure('http://seed')
    expect(store.score('http://seed')).toBeDefined() // grinding cannot evict it
    expect(store.offer('http://seed')).toBe(true) // tracked config peer, unaffected
  })

  it('⑤ the ledger keeps its LRU bound: eviction 65 squeezes the oldest out', () => {
    const c = clock()
    const store = new PeerStore([], '', undefined, undefined, c.now)
    const cap = EVICTION_LEDGER_CAP
    // Peer i evicted at t = 10*(i+1), through the REAL path (score decay).
    for (let i = 0; i <= cap; i += 1) {
      const url = `http://d${String(i)}`
      store.offer(url)
      for (let k = 0; k < Math.ceil(INITIAL_SCORE / FAILURE_PENALTY); k += 1) store.noteFailure(url)
      c.tick(10)
    }
    // The oldest (d0) fell off the cap → inside the window it is admissible
    // again; the newest (d64) is still refused.
    expect(store.offer('http://d0')).toBe(true)
    expect(store.offer(`http://d${String(cap)}`)).toBe(false)
  })
})
