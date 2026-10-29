/**
 * refreshPeerCard (single owner + mirror): the mirror re-reads a peer's card
 * after a change ping or a relayed edit.
 */
import { describe, expect, it } from 'vitest'
import { refreshPeerCard } from '../../src/faces/canvas-notify.ts'
import type { CardCacheEntry } from '../../src/runtime.ts'
import type { A2aPeerCard } from '../../src/types.ts'

const card = (tag: string): A2aPeerCard => ({ name: tag, team: 'dsh' }) as unknown as A2aPeerCard
const URL_A = 'http://127.0.0.1:1'

/** A single-flight cache stand-in that answers the queued results in order. */
function deps(answers: Array<A2aPeerCard | undefined>, start?: A2aPeerCard) {
  const cardCache = new Map<string, CardCacheEntry>()
  if (start !== undefined) cardCache.set(URL_A, { at: Date.now(), card: start })
  let calls = 0
  return {
    cardCache,
    calls: () => calls,
    cachedCardFetch: async (url: string) => {
      calls += 1
      const next = answers.shift()
      cardCache.set(url, { at: Date.now(), card: next })
      return next
    },
  }
}

describe('refreshPeerCard', () => {
  it('a first fetch that joined a pre-change flight is followed by a fresh one', async () => {
    const d = deps([card('old'), card('new')], card('old'))
    await refreshPeerCard(d, URL_A)
    expect(d.calls()).toBe(2)
    expect(d.cardCache.get(URL_A)?.card?.name).toBe('new')
  })

  it('a failed refetch keeps the last good card instead of blanking the mirror', async () => {
    const d = deps([undefined], card('good'))
    await refreshPeerCard(d, URL_A)
    expect(d.cardCache.get(URL_A)?.card?.name).toBe('good')
    expect(d.cardCache.get(URL_A)!.at).toBeGreaterThan(0)
  })

  it('with nothing cached, a miss stays a miss', async () => {
    const d = deps([undefined, undefined])
    await refreshPeerCard(d, URL_A)
    expect(d.cardCache.get(URL_A)?.card).toBeUndefined()
  })
})
