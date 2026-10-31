/**
 * refreshPeerCard (single owner + mirror): the mirror re-reads a peer's card
 * after a change ping or a relayed edit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshPeerCard, registerCanvasNotify, CANVAS_NOTIFY_DEBOUNCE_MS, type CanvasNotifyDeps } from '../../src/faces/canvas-notify.ts'
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

  it('a miss no longer restores mid-loop — both passes run genuine refetches; keeping the old card belongs to cachedCardFetch (integration-pinned)', async () => {
    const d = deps([undefined], card('good'))
    await refreshPeerCard(d, URL_A)
    // This mock writes the miss itself; production cachedCardFetch keeps the
    // last good card through the missAt window (pinned in card-cache.spec).
    expect(d.calls()).toBe(2)
    expect(d.cardCache.get(URL_A)?.card).toBeUndefined()
  })

  it('with nothing cached, a miss stays a miss', async () => {
    const d = deps([undefined, undefined])
    await refreshPeerCard(d, URL_A)
    expect(d.cardCache.get(URL_A)?.card).toBeUndefined()
  })
})

describe('change ping recipients', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('a peer whose link the change just ended still hears about that change, once', async () => {
    vi.useFakeTimers()
    const pinged: string[] = []
    vi.stubGlobal('fetch', async (url: string) => { pinged.push(url); return new Response('{"ok":true}') })
    const linked = new Set([URL_A])
    let change: () => void = () => {}
    const cardCache = new Map<string, CardCacheEntry>([[URL_A, { at: Date.now(), card: card('A') }]])
    const d = {
      ctx: { effect: (fn: () => unknown) => { fn() } },
      logger: { debug: () => {} },
      peerStore: { list: () => [URL_A] },
      canvasStore: { onChange: (fn: () => void) => { change = fn; return () => {} } },
      cardCache,
      originClaimHeaders: () => ({}),
      verifyOriginClaim: async () => ({ ok: false, reason: 'absent' }),
      callerLinkedToThisHost: (_c: string, url: string) => linked.has(url),
      cachedCardFetch: async () => undefined,
    } as unknown as CanvasNotifyDeps
    registerCanvasNotify({ register: () => () => {} } as never, d)
    const flush = async (): Promise<void> => { change(); await vi.advanceTimersByTimeAsync(CANVAS_NOTIFY_DEBOUNCE_MS + 10) }
    await flush()
    expect(pinged).toEqual([`${URL_A}/a2a/canvas-changed`])
    linked.clear() // e.g. the dissolved team was the only one naming A's handle
    await flush()
    expect(pinged).toHaveLength(2) // told once more: its next card read drops the mirror
    await flush()
    expect(pinged).toHaveLength(2) // and no longer after that
  })
})
