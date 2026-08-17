/**
 * Zone-resolution unit tests: direct match, delegation chains, cycle and
 * depth fail-closed, key binding, and local-team precedence (slice 3).
 */
import { describe, expect, it } from 'vitest'
import { resolveZone, ZONE_DEPTH_CAP } from '../src/zone.ts'
import type { A2aPeerCard, ZoneRecord } from '../src/types.ts'

/** A verified-card stand-in; resolution reads team/records/publicKey only. */
function card(team: string, records: readonly ZoneRecord[] = [], publicKey = 'key-a'): A2aPeerCard {
  return { name: 'zone', session: 'sess', team, capabilities: {}, expiresAt: 1, publicKey, signature: 'sig', records }
}

/** A fetch over a fixed zone table; unlisted URLs are unreachable. */
function fetchOver(zones: Record<string, A2aPeerCard>): (url: string) => Promise<A2aPeerCard | undefined> {
  return async (url: string) => zones[url]
}

describe('resolveZone', () => {
  it('resolves a name the start zone publishes directly', async () => {
    const outcome = await resolveZone(fetchOver({ 'http://a': card('research') }), 'http://a', 'research')
    expect(outcome).toMatchObject({ ok: true, url: 'http://a' })
  })

  it('prefers the zone\'s own team over a same-named delegation', async () => {
    const zones = { 'http://a': card('research', [{ type: 'delegate', name: 'research', url: 'http://b' }]), 'http://b': card('research') }
    const outcome = await resolveZone(fetchOver(zones), 'http://a', 'research')
    expect(outcome).toMatchObject({ ok: true, url: 'http://a' })
  })

  it('follows one delegation to the zone that publishes the name', async () => {
    const zones = {
      'http://a': card('team-a', [{ type: 'delegate', name: 'analysis', url: 'http://b' }]),
      'http://b': card('analysis'),
    }
    const outcome = await resolveZone(fetchOver(zones), 'http://a', 'analysis')
    expect(outcome).toMatchObject({ ok: true, url: 'http://b' })
  })

  it('walks multi-hop delegation chains', async () => {
    const zones = {
      'http://a': card('team-a', [{ type: 'delegate', name: 'deep', url: 'http://b' }]),
      'http://b': card('team-b', [{ type: 'delegate', name: 'deep', url: 'http://c' }]),
      'http://c': card('deep'),
    }
    const outcome = await resolveZone(fetchOver(zones), 'http://a', 'deep')
    expect(outcome).toMatchObject({ ok: true, url: 'http://c' })
  })

  it('fails closed on a mutual delegation cycle', async () => {
    const zones = {
      'http://a': card('team-a', [{ type: 'delegate', name: 'x', url: 'http://b' }]),
      'http://b': card('team-b', [{ type: 'delegate', name: 'x', url: 'http://a' }]),
    }
    const outcome = await resolveZone(fetchOver(zones), 'http://a', 'x')
    expect(outcome).toMatchObject({ ok: false, reason: 'cycle' })
  })

  it('fails closed on a self-delegation', async () => {
    const zones = { 'http://a': card('team-a', [{ type: 'delegate', name: 'x', url: 'http://a' }]) }
    const outcome = await resolveZone(fetchOver(zones), 'http://a', 'x')
    expect(outcome).toMatchObject({ ok: false, reason: 'cycle' })
  })

  it(`fails closed past ${String(ZONE_DEPTH_CAP)} delegation hops`, async () => {
    const zones: Record<string, A2aPeerCard> = {}
    // A chain one hop longer than the cap: the last zone publishes the name
    // but is never consulted — the walk refuses before fetching it.
    for (let index = 0; index <= ZONE_DEPTH_CAP + 1; index++) {
      zones[`http://z${String(index)}`] = index === ZONE_DEPTH_CAP + 1
        ? card('deep')
        : card(`team-${String(index)}`, [{ type: 'delegate', name: 'deep', url: `http://z${String(index + 1)}` }])
    }
    const outcome = await resolveZone(fetchOver(zones), 'http://z0', 'deep')
    expect(outcome).toMatchObject({ ok: false, reason: 'depth' })
  })

  it('fails closed when a bound delegation target presents another key', async () => {
    const zones = {
      'http://a': card('team-a', [{ type: 'delegate', name: 'analysis', url: 'http://b', publicKey: 'key-expected' }]),
      'http://b': card('analysis', [], 'key-other'),
    }
    const outcome = await resolveZone(fetchOver(zones), 'http://a', 'analysis')
    expect(outcome).toMatchObject({ ok: false, reason: 'key-mismatch' })
  })

  it('resolves a delegation bound to the target\'s key', async () => {
    const zones = {
      'http://a': card('team-a', [{ type: 'delegate', name: 'analysis', url: 'http://b', publicKey: 'key-b' }]),
      'http://b': card('analysis', [], 'key-b'),
    }
    const outcome = await resolveZone(fetchOver(zones), 'http://a', 'analysis')
    expect(outcome).toMatchObject({ ok: true, url: 'http://b' })
  })

  it('fails closed when the start zone is unreachable', async () => {
    const outcome = await resolveZone(fetchOver({}), 'http://gone', 'x')
    expect(outcome).toMatchObject({ ok: false, reason: 'unreachable' })
  })

  it('fails closed on a name no zone in the chain publishes', async () => {
    const zones = { 'http://a': card('team-a') }
    const outcome = await resolveZone(fetchOver(zones), 'http://a', 'ghost')
    expect(outcome).toMatchObject({ ok: false, reason: 'not-found' })
  })

  it('treats a card without records as publishing only its own team', async () => {
    const { records: _none, ...bare } = card('team-a')
    const outcome = await resolveZone(fetchOver({ 'http://a': bare }), 'http://a', 'ghost')
    expect(outcome).toMatchObject({ ok: false, reason: 'not-found' })
  })

  it('rejects an empty name without fetching', async () => {
    let fetched = false
    const outcome = await resolveZone(async () => {
      fetched = true
      return card('x')
    }, 'http://a', '')
    expect(outcome).toMatchObject({ ok: false, reason: 'not-found' })
    expect(fetched).toBe(false)
  })
})
