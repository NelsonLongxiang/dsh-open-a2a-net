/**
 * #61/#63 owner ruling 2026-11-17 (probe tiering, partial): a2a_probe gives every probed row a four-value verdict —
 * reachable, slow (answered slower than maxLatencyMs; still reachable), rejected (answered with a card that does not
 * verify) or unreachable. Real sockets: a delayed ghost card, an expired card and a closed port.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootNode, craftCard, ghostNode, reservePort, runContext, type MeshNode } from './harness.ts'
import { PROBE_MAX_LATENCY_CAP_MS, PROBE_MAX_LATENCY_MS, probeLatencyBound } from '../../src/tools/info.ts'

// Scope-off: these rows test the probe's verdict, not team admission.
const LEGACY_OPEN_SCOPE = { teamScopeRouting: false, teamScopeInfo: false } as const
type Row = { url: string; reachable: boolean; verdict?: string; ms?: number; error?: string }
const probe = async (node: MeshNode, args: Record<string, unknown> = {}): Promise<Row[]> =>
  (await node.ctx.tools.get('a2a_probe')?.execute(args, runContext()) as { results: Row[] }).results

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('the decentralized client opens no socket') })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a2a_probe four-value verdict', () => {
  it('reports a slow peer as slow but still reachable, and as reachable under a looser bound', async () => {
    const { card } = craftCard({ name: 'sluggish', session: 'ghost-slow', team: 'sluggish', expiresAt: Date.now() + 60_000 })
    const ghost = await ghostNode(card, 150)
    const alpha = await bootNode({ ...LEGACY_OPEN_SCOPE, name: 'alpha', session: 'mesh-alpha', team: 'alpha', peers: [ghost.baseUrl] })
    try {
      const tight = (await probe(alpha, { url: ghost.baseUrl, maxLatencyMs: 50 }))[0]
      expect(tight).toMatchObject({ reachable: true, verdict: 'slow' })
      expect(tight?.ms).toBeGreaterThan(50)
      const loose = (await probe(alpha, { url: ghost.baseUrl, maxLatencyMs: 10_000 }))[0]
      expect(loose).toMatchObject({ reachable: true, verdict: 'reachable' })
    } finally {
      await alpha.dispose()
      await ghost.close()
    }
  })

  it('a card that does not verify is rejected; a closed port is unreachable', async () => {
    const { card } = craftCard({ name: 'skewed', session: 'ghost-skewed', team: 'skewed', expiresAt: Date.now() - 1_000 })
    const ghost = await ghostNode(card)
    const deadPort = await reservePort()
    const dead = `http://127.0.0.1:${String(deadPort)}`
    const alpha = await bootNode({ ...LEGACY_OPEN_SCOPE, name: 'alpha', session: 'mesh-alpha', team: 'alpha', peers: [ghost.baseUrl, dead] })
    try {
      const rows = await probe(alpha)
      expect(rows.find(row => row.url === ghost.baseUrl)).toMatchObject({ reachable: false, verdict: 'rejected' })
      expect(rows.find(row => row.url === dead)).toMatchObject({ reachable: false, verdict: 'unreachable' })
    } finally {
      await alpha.dispose()
      await ghost.close()
    }
  })

  it('maxLatencyMs falls back to the default when it is not a positive number, and is capped', () => {
    for (const bad of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, '300']) expect(probeLatencyBound(bad)).toBe(PROBE_MAX_LATENCY_MS)
    expect(probeLatencyBound(250)).toBe(250)
    expect(probeLatencyBound(10 * PROBE_MAX_LATENCY_CAP_MS)).toBe(PROBE_MAX_LATENCY_CAP_MS)
  })
})
