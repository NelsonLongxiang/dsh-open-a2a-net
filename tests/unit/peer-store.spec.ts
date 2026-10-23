/**
 * Peer-store unit tests: seeding, bounded growth, quality scoring, eviction,
 * seed immunity, and whole-file persistence semantics (slice 2).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FAILURE_PENALTY, INITIAL_SCORE, PEER_CAP, PeerStore, SUCCESS_REWARD } from '../../src/peer-store.ts'

/** A fresh persistence path under a per-test directory. */
function storePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-peers-')), 'a2a', 'peers.json')
}

describe('PeerStore seeding and ordering', () => {
  it('tracks seeds first and offered peers by descending score', () => {
    const store = new PeerStore(['http://a', 'http://b'], '')
    expect(store.list()).toEqual(['http://a', 'http://b'])
    store.offer('http://c')
    store.offer('http://d')
    store.noteSuccess('http://d')
    expect(store.list()).toEqual(['http://a', 'http://b', 'http://d', 'http://c'])
  })

  it('skips empty seed URLs', () => {
    const store = new PeerStore(['', 'http://a'], '')
    expect(store.list()).toEqual(['http://a'])
  })

  it('downgrades a persisted seed whose URL left the config — the config is authoritative both ways (board-stale-peer fix)', () => {
    const path = storePath()
    mkdirSync(dirname(path), { recursive: true })
    // An old config generation seeded 'http://stale' and the store persisted
    // it; the operator removed the URL from config days ago. The stale seed
    // bit must NOT survive: the record downgrades to referral-learned so
    // noteFailure can decay and evict it — otherwise a dead URL renders on
    // the workbench board forever (owner sighting: .157:13082).
    writeFileSync(path, JSON.stringify({ peers: [{ url: 'http://stale', score: 4321, seed: true }, { url: 'http://keep', score: 4321, seed: true }] }))
    const store = new PeerStore(['http://keep'], path)
    expect(store.listSeeded()).toEqual(['http://keep'])
    // The downgrade persisted: a fresh boot over the same file agrees.
    const reloaded = new PeerStore(['http://keep'], path)
    expect(reloaded.listSeeded()).toEqual(['http://keep'])
    // And the downgraded record is now evictable: failures decay it out.
    for (let i = 0; i < 44; i += 1) reloaded.noteFailure('http://stale')
    expect(reloaded.list()).toEqual(['http://keep'])
  })
})

describe('PeerStore bounds and offers', () => {
  it('bounds the store at PEER_CAP peers', () => {
    const store = new PeerStore([], '')
    for (let index = 0; index < PEER_CAP; index++) store.offer(`http://p${String(index)}`)
    expect(store.offer('http://overflow')).toBe(false)
    expect(store.list()).toHaveLength(PEER_CAP)
  })

  it('refuses an empty referral, accepts a known one, and refuses past the cap', () => {
    const store = new PeerStore(['http://a'], '', 3)
    expect(store.offer('')).toBe(false)
    expect(store.offer('http://b')).toBe(true)
    expect(store.offer('http://b')).toBe(true)
    expect(store.offer('http://c')).toBe(true)
    expect(store.offer('http://d')).toBe(false)
    expect(store.list()).toEqual(['http://a', 'http://b', 'http://c'])
  })
})

describe('PeerStore quality scoring', () => {
  it('degrades a failing peer and evicts it at the floor', () => {
    const store = new PeerStore([], '')
    store.offer('http://a')
    for (let index = 0; index < INITIAL_SCORE / FAILURE_PENALTY - 1; index++) store.noteFailure('http://a')
    expect(store.list()).toEqual(['http://a'])
    store.noteFailure('http://a')
    expect(store.list()).toEqual([])
  })

  it('never penalizes a seed regardless of failures', () => {
    const store = new PeerStore(['http://a'], '')
    for (let index = 0; index < INITIAL_SCORE / FAILURE_PENALTY + 5; index++) store.noteFailure('http://a')
    expect(store.list()).toEqual(['http://a'])
  })

  it('rewards a successful fetch and persists the score', async () => {
    const path = storePath()
    const store = new PeerStore(['http://a'], path, PEER_CAP, 0)
    store.noteSuccess('http://a')
    await store.flush()
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as { peers: { url: string; score: number; lastContactAt?: number }[] }
    // #20 W-C: noteSuccess also stamps the last-contact time (host-rail
    // lamp) — assert the identity fields and that the stamp is recent.
    expect(snapshot.peers).toHaveLength(1)
    expect(snapshot.peers[0]).toMatchObject({ url: 'http://a', score: INITIAL_SCORE + SUCCESS_REWARD, seed: true })
    expect(typeof snapshot.peers[0]!.lastContactAt).toBe('number')
    expect(Date.now() - (snapshot.peers[0]!.lastContactAt ?? 0)).toBeLessThan(60_000)
  })

  it('coalesces a burst of changes into one debounced write', async () => {
    const path = storePath()
    const store = new PeerStore(['http://a'], path, 60, 5)
    for (let index = 0; index < 50; index++) store.offer(`http://p${String(index)}`)
    store.noteSuccess('http://a')
    await new Promise(resolve => setTimeout(resolve, 30))
    await store.flush()
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as { peers: { url: string }[] }
    // One write carries the whole burst: all 51 peers in the final state.
    expect(snapshot.peers).toHaveLength(51)
  })

  it('resets the debounce window on every change (trailing coalesce, no write mid-drip)', async () => {
    const path = storePath()
    const store = new PeerStore([], path, 60, 50)
    store.offer('http://a')
    await new Promise(resolve => setTimeout(resolve, 30))
    store.offer('http://b')
    // 65ms after the first change: past that change's window, still inside the
    // second change's reset window — a per-change timer would have written
    // here, a trailing debounce has not.
    await new Promise(resolve => setTimeout(resolve, 35))
    expect(existsSync(path)).toBe(false)
    await store.flush()
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as { peers: { url: string }[] }
    expect(snapshot.peers.map(peer => peer.url).sort()).toEqual(['http://a', 'http://b'])
  })

  it('ignores fetch outcomes for unknown peers', () => {
    const path = storePath()
    const store = new PeerStore([], path)
    store.noteFailure('http://ghost')
    store.noteSuccess('http://ghost')
    expect(store.list()).toEqual([])
    expect(existsSync(path)).toBe(false)
  })
})

describe('PeerStore persistence', () => {
  it('restores offered peers with their scores and non-seed flags', async () => {
    const path = storePath()
    const first = new PeerStore([], path, PEER_CAP, 0)
    first.offer('http://a')
    await first.flush()
    const second = new PeerStore([], path)
    expect(second.list()).toEqual(['http://a'])
    // Restored as a non-seed: repeated failures evict it.
    for (let index = 0; index < INITIAL_SCORE / FAILURE_PENALTY; index++) second.noteFailure('http://a')
    expect(second.list()).toEqual([])
  })

  it('re-marks a persisted peer that the config names as a seed', async () => {
    const path = storePath()
    const first = new PeerStore([], path, PEER_CAP, 0)
    first.offer('http://a')
    await first.flush()
    const reboot = new PeerStore(['http://a'], path)
    for (let index = 0; index < INITIAL_SCORE / FAILURE_PENALTY + 5; index++) reboot.noteFailure('http://a')
    expect(reboot.list()).toEqual(['http://a'])
  })

  it('orders a restored discovered peer behind later-arriving seeds', async () => {
    const path = storePath()
    const first = new PeerStore([], path, PEER_CAP, 0)
    first.offer('http://d1')
    await first.flush()
    const store = new PeerStore(['http://s1', 'http://s2'], path)
    store.offer('http://d2')
    store.offer('http://d3')
    store.noteSuccess('http://d3')
    // Equal scores keep first-tracked order (stable sort): d1 precedes d2.
    expect(store.list()).toEqual(['http://s1', 'http://s2', 'http://d3', 'http://d1', 'http://d2'])
  })

  it('falls back to seeds when the store file is corrupt, then recovers on the next write', async () => {
    const path = storePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'not json')
    const store = new PeerStore(['http://a'], path, PEER_CAP, 0)
    expect(store.list()).toEqual(['http://a'])
    store.offer('http://b')
    await store.flush()
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as { peers: unknown[] }
    expect(snapshot.peers).toHaveLength(2)
  })

  it('skips invalid snapshot entries and non-finite scores', () => {
    const path = storePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({
      peers: [
        { url: 'http://a', score: null },
        { url: '', score: 5 },
        { url: 7, score: 5 },
        'http://d',
        { url: 'http://e', score: 1200, seed: 'yes' },
      ],
    }))
    const store = new PeerStore([], path)
    // http://a falls back to the initial score; http://e keeps 1200 and a false seed flag.
    expect(store.list()).toEqual(['http://a', 'http://e'])
    for (let index = 0; index < INITIAL_SCORE / FAILURE_PENALTY; index++) store.noteFailure('http://a')
    expect(store.list()).toEqual(['http://e'])
  })

  it('skips a snapshot whose peers member is not an array', () => {
    const path = storePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ peers: 7 }))
    expect(new PeerStore(['http://x'], path).list()).toEqual(['http://x'])
  })

  it('degrades to memory-only when the store file cannot be written', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-a2a-peers-'))
    const store = new PeerStore(['http://a'], directory)
    store.offer('http://b')
    store.noteSuccess('http://a')
    expect(store.list()).toEqual(['http://a', 'http://b'])
  })

  it('does not persist without a path', () => {
    const store = new PeerStore(['http://a'], '')
    store.offer('http://b')
    store.noteSuccess('http://a')
    store.noteFailure('http://b')
    expect(store.list()).toEqual(['http://a', 'http://b'])
  })
})

describe('PeerStore node-identity dedup', () => {
  it('learns a served session and resolves the strongest URL per identity', () => {
    const store = new PeerStore(['http://seed'], '')
    store.offer('http://lan')
    store.offer('http://loop')
    store.noteSuccess('http://loop')
    store.learnSession('http://lan', 'node-1')
    store.learnSession('http://loop', 'node-1')
    // Among referrals the higher score wins; a seed beats both.
    expect(store.bySession('node-1')).toBe('http://loop')
    store.learnSession('http://seed', 'node-1')
    expect(store.bySession('node-1')).toBe('http://seed')
    // Unknown identities resolve to nothing, and empty sessions are not learnable.
    expect(store.bySession('node-2')).toBeUndefined()
    store.learnSession('http://lan', '')
    expect(store.bySession('node-1')).toBe('http://seed')
  })

  it('keeps the learned session across a persistence round-trip', async () => {
    const path = storePath()
    const first = new PeerStore([], path, PEER_CAP, 0)
    first.offer('http://a')
    first.learnSession('http://a', 'node-1')
    await first.flush()
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as { peers: { session?: string }[] }
    expect(snapshot.peers[0]?.session).toBe('node-1')
    expect(new PeerStore([], path).bySession('node-1')).toBe('http://a')
  })
})

describe('gh#24 contact outcome (host-rail lamp semantics)', () => {
  it('stamps success/failure and round-trips BOTH through persistence', async () => {
    const path = storePath()
    const store = new PeerStore(['http://ok'], path, PEER_CAP, 0)
    store.noteSuccess('http://ok')
    // A learned peer here; the seed failure path has its own case below.
    store.offer('http://bad')
    store.noteFailure('http://bad')
    await store.flush()
    expect(store.lastContactOk('http://ok')).toBe(true)
    expect(store.lastContactOk('http://bad')).toBe(false)
    // The restart must remember outcome AND time — the pre-fix restore
    // dropped the stamp silently (gh#24 H2 residual).
    const reloaded = new PeerStore([], path)
    expect(reloaded.lastContactOk('http://ok')).toBe(true)
    expect(reloaded.lastContactOk('http://bad')).toBe(false)
    expect(typeof reloaded.lastContact('http://ok')).toBe('number')
    expect(Date.now() - (reloaded.lastContact('http://ok') ?? 0)).toBeLessThan(60_000)
  })

  it('a seed failure records !ok but takes no penalty', () => {
    const store = new PeerStore(['http://seed'], '')
    store.noteSuccess('http://seed')
    const scored = store.score('http://seed')
    store.noteFailure('http://seed')
    // Same outage, same lamp as a learned peer: red, not the last success.
    expect(store.lastContactOk('http://seed')).toBe(false)
    expect(Date.now() - (store.lastContact('http://seed') ?? 0)).toBeLessThan(60_000)
    // Seeds stay config-owned: no penalty, never evicted.
    expect(store.score('http://seed')).toBe(scored)
    expect(store.list()).toEqual(['http://seed'])
  })

  it('a seed that stays configured keeps both stamps across a restart', async () => {
    const path = storePath()
    const store = new PeerStore(['http://up', 'http://down'], path, PEER_CAP, 0)
    store.noteSuccess('http://up')
    store.noteFailure('http://down')
    await store.flush()
    const stamp = store.lastContact('http://up')
    // The same seed list again: the (re)mark resets the score but must not
    // drop the observed stamps.
    const reloaded = new PeerStore(['http://up', 'http://down'], path)
    expect(reloaded.lastContact('http://up')).toBe(stamp)
    expect(reloaded.lastContactOk('http://up')).toBe(true)
    expect(reloaded.lastContactOk('http://down')).toBe(false)
    expect(typeof reloaded.lastContact('http://down')).toBe('number')
    expect(reloaded.score('http://up')).toBe(INITIAL_SCORE)
  })
})
