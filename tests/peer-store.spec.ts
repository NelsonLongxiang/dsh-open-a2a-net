/**
 * Peer-store unit tests: seeding, bounded growth, quality scoring, eviction,
 * seed immunity, and whole-file persistence semantics (slice 2).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FAILURE_PENALTY, INITIAL_SCORE, PEER_CAP, PeerStore, SUCCESS_REWARD } from '../src/peer-store.ts'

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
    const snapshot = JSON.parse(readFileSync(path, 'utf8')) as { peers: { url: string; score: number }[] }
    expect(snapshot.peers).toEqual([{ url: 'http://a', score: INITIAL_SCORE + SUCCESS_REWARD, seed: true }])
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
