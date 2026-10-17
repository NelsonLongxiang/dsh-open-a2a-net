/**
 * LIVE cross-machine layer (L4) — real remote DSH nodes, opt-in only.
 *
 * Skipped unless the environment points at real hosts:
 *   DSH_A2A_LIVE_MESH=http://host-a:3080,http://host-b:3080   (required)
 *   DSH_A2A_LIVE_TARGET_TEAM=dsh                              (optional route probe)
 *
 * The suite boots ONE local observer node (announce off — it joins nothing,
 * exposes nothing) seeded with the remote URLs, then exercises the three
 * cross-machine facts that only real machines provide: real RTT and firewall
 * paths (probe), real NTP skew behavior on signed cards (verified fetch, not
 * mocked clocks), and an optional real route round trip. Runbook and safety
 * notes: docs/testing-layers.md §L4.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bootNode, runContext } from '../mesh/harness.ts'

const liveMesh = process.env.DSH_A2A_LIVE_MESH ?? ''
const targetTeam = process.env.DSH_A2A_LIVE_TARGET_TEAM ?? ''
const seeds = liveMesh.split(',').map(url => url.trim()).filter(url => url !== '')
const runnable = seeds.length > 0

describe.skipIf(!runnable)('live cross-machine fleet (DSH_A2A_LIVE_MESH)', () => {
  let observer: Awaited<ReturnType<typeof bootNode>> | undefined

  beforeAll(async () => {
    vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('the decentralized client opens no socket') })
    observer = await bootNode({
      name: 'live-observer',
      session: 'live-observer',
      team: 'live-observer',
      // Observer posture: tracks the fleet, publishes nothing.
      announce: false,
      peers: seeds,
    })
  })

  afterAll(async () => {
    await observer?.dispose()
    vi.unstubAllGlobals()
  })

  it('probes every live seed: at least one verified card reachable, failures carry precise reasons', async () => {
    const result = await observer!.ctx.tools.get('a2a_probe')?.execute({}, runContext()) as { ok: boolean; results: { url: string; reachable: boolean; ms?: number; team?: string; error?: string }[] }
    expect(result.ok).toBe(true)
    expect(result.results.length).toBe(seeds.length)
    const reachable = result.results.filter(row => row.reachable)
    expect(reachable.length).toBeGreaterThan(0)
    // Real-machine anomaly signal: an unreachable row must say why — a bare
    // boolean would hide clock skew vs firewall vs dead process.
    for (const row of result.results.filter(entry => !entry.reachable)) {
      expect(row.error).toBeTruthy()
    }
  })

  it('lists the fleet directory across machines', async () => {
    const listed = await observer!.ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { ok: boolean; teams: { team: string; local?: boolean; origin?: string }[] }
    expect(listed.ok).toBe(true)
    // Own row plus at least one remote publisher.
    expect(listed.teams.filter(row => row.local !== true).length).toBeGreaterThan(0)
  })

  it.skipIf(targetTeam === '')('routes one self-contained probe message to the target team and observes the outcome', async () => {
    const result = await observer!.ctx.tools.get('a2a_route')?.execute({
      team: targetTeam,
      message: 'LIVE mesh probe: reply with the single word ACK. (Automated cross-machine test, no action needed.)',
    }, runContext()) as { ok: boolean; reply?: string; error?: string }
    // Sync round trip across real machines is minutes-scale, not guaranteed
    // inside one tool wait; delivered-shape success or a documented timeout
    // both count as observed outcomes — assertion is on the shape, and the
    // full result lands in the test log for the runbook.
    expect(typeof (result.ok === true ? result.reply : result.error)).toBe('string')
  })
})
