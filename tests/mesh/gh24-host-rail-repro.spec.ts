// @vitest-environment node
/**
 * gh#24 repro spec (the review seat's three cases, landed in-repo as a
 * permanent guard rather than an external probe):
 *   1. a FRESH FAILED contact renders the red lamp (recency alone used to
 *      glow green — the true positive this fix answers);
 *   2. lastContactOk/lastContactAt round-trip through persistence (the H2
 *      residual: restore silently dropped the stamp);
 *   3. the seed-downgrade path transmits session + both stamps intact
 *      (only the immunity bit changes).
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PeerStore } from '../../src/peer-store.ts'

function storePath(): string {
  return join(mkdtempSync(join(tmpdir(), 'gh24-')), 'a2a', 'peers.json')
}

describe('gh#24 host-rail repro (three cases)', () => {
  it('1. a fresh FAILED contact is recorded as !ok — the lamp input that used to glow green', async () => {
    const path = storePath()
    const store = new PeerStore([], path)
    store.offer('http://dead:13080')
    store.noteFailure('http://dead:13080')
    await store.flush()
    expect(store.lastContactOk('http://dead:13080')).toBe(false)
    expect(typeof store.lastContact('http://dead:13080')).toBe('number')
    // The DOM mapping of !ok within the recent window is is-fail (pinned in
    // nexus-stage/tests/workbench-dom.spec.ts gh#24 case).
  })

  it('2. both stamps round-trip a restart (H2: restore used to drop them)', async () => {
    const path = storePath()
    const store = new PeerStore([], path)
    store.offer('http://up:13080')
    store.noteSuccess('http://up:13080')
    store.offer('http://down:13080')
    store.noteFailure('http://down:13080')
    await store.flush()
    const reloaded = new PeerStore([], path)
    expect(reloaded.lastContactOk('http://up:13080')).toBe(true)
    expect(reloaded.lastContactOk('http://down:13080')).toBe(false)
    const stamp = reloaded.lastContact('http://up:13080')
    expect(typeof stamp).toBe('number')
    expect(Date.now() - (stamp ?? 0)).toBeLessThan(60_000)
  })

  it('3. the seed-downgrade path keeps session and both stamps (only immunity changes)', async () => {
    const path = storePath()
    mkdirSync(dirname(path), { recursive: true })
    // An old generation seeded http://legacy and the store learned its
    // session + stamps; the config no longer lists it.
    writeFileSync(path, JSON.stringify({ peers: [
      { url: 'http://legacy:13080', score: 4321, seed: true, session: 'node-legacy', lastContactAt: 1700000000000, lastContactOk: false },
    ] }))
    const store = new PeerStore([], path, undefined, 0)
    // Downgraded: no longer a seed…
    expect(store.listSeeded()).toEqual([])
    // …but every learned fact survived.
    expect(store.bySession('node-legacy')).toBe('http://legacy:13080')
    expect(store.lastContact('http://legacy:13080')).toBe(1700000000000)
    expect(store.lastContactOk('http://legacy:13080')).toBe(false)
    // The downgrade is memory-state until the next write; a mutation now
    // persists the downgraded record (seed:false with the facts intact).
    store.offer('http://fresh:13080')
    await store.flush()
    const persisted = JSON.parse(readFileSync(path, 'utf8')) as { peers: Array<Record<string, unknown>> }
    expect(persisted.peers.find(row => row.url === 'http://legacy:13080')).toMatchObject({ seed: false, session: 'node-legacy', lastContactOk: false })
  })
})
