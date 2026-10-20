/**
 * Mesh fault injection — the anomaly-discovery layer: cross-node failures a
 * flat single-node suite structurally cannot see. Each scenario plants a REAL
 * fault on the wire (clock-skewed card, tampered card, node death, restart on
 * the same port, alias spellings of one node, zone-delegation misbinding,
 * referral-learning freeze) and asserts the mesh fails CLOSED and observably:
 * rejected with the precise reason, degraded without gossip poisoning, and
 * recovered when the fault clears. Layer contract in docs/testing-layers.md.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import * as net from 'node:net'
import { bootNode, craftCard, ghostNode, preseedNodeKey, postJson, reservePort, runContext, steerText, tmpHome, type MeshNode } from './harness.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('the decentralized client opens no socket') })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function probe(node: MeshNode): Promise<{ url: string; reachable: boolean; ms?: number; team?: string; error?: string }[]> {
  const result = await node.ctx.tools.get('a2a_probe')?.execute({}, runContext()) as { ok: boolean; results: { url: string; reachable: boolean; ms?: number; team?: string; error?: string }[] }
  return result.results
}

describe('mesh faults — card validity across machines', () => {
  it('a genuinely signed but expired card (clock-skew surrogate) is rejected on the wire with the expired reason', async () => {
    // The signer's clock was behind: the signature is valid, the expiry is
    // already in the verifier's past. This is the cross-machine NTP-drift
    // failure mode a same-process test cannot reproduce.
    const { card } = craftCard({ name: 'skewed', session: 'ghost-skewed', team: 'skewed', expiresAt: Date.now() - 1_000 })
    const ghost = await ghostNode(card)
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', peers: [ghost.baseUrl] })
    try {
      const listed = await alpha.ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { ok: boolean; teams: { team: string }[] }
      expect(listed.teams.some(row => row.team === 'skewed')).toBe(false)
      const rows = await probe(alpha)
      const ghostRow = rows.find(row => row.url === ghost.baseUrl)
      expect(ghostRow?.reachable).toBe(false)
      expect(ghostRow?.error).toContain('expired')
    } finally {
      await alpha.dispose()
      await ghost.close()
    }
  })

  it('a signed-then-tampered card is rejected with the bad-signature reason', async () => {
    const { card } = craftCard({ name: 'honest', session: 'ghost-tamper', team: 'honest', expiresAt: Date.now() + 60_000 })
    // A middlebox flips one committed field after signing.
    const tampered = { ...card, name: 'honest-renamed' }
    const ghost = await ghostNode(tampered)
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', peers: [ghost.baseUrl] })
    try {
      const listed = await alpha.ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { ok: boolean; teams: { team: string }[] }
      expect(listed.teams.some(row => row.team === 'honest-renamed')).toBe(false)
      expect(listed.teams.some(row => row.team === 'honest')).toBe(false)
      const rows = await probe(alpha)
      const ghostRow = rows.find(row => row.url === ghost.baseUrl)
      expect(ghostRow?.reachable).toBe(false)
      expect(ghostRow?.error).toContain('bad-signature')
    } finally {
      await alpha.dispose()
      await ghost.close()
    }
  })
})

describe('mesh faults — partition, restart, and recovery', () => {
  it('killing the target node fails the route closed, and a same-port restart recovers discovery and routing', async () => {
    const portA = await reservePort()
    const portC = await reservePort()
    const cargoHome = tmpHome()
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', home: cargoHome, port: portC, peers: [`http://127.0.0.1:${String(portA)}`] })
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', port: portA, peers: [`http://127.0.0.1:${String(portC)}`] })
    try {
      // Baseline green before the fault.
      const first = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'before fault' }, runContext()) as { ok: boolean }
      expect(first.ok).toBe(true)

      // The machine goes down.
      await cargo.dispose()
      const down = await vi.waitFor(async () => {
        const result = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'during fault' }, runContext()) as { ok: boolean; error?: string }
        expect(result.ok).toBe(false)
        return result
      }, { timeout: 4_000 })
      // Closed failure: either no candidate resolves or every candidate fails.
      expect(String(down.error)).toMatch(/no route to "cargo"|failed on every candidate/)
      const probed = await probe(alpha)
      expect(probed.find(row => row.url === `http://127.0.0.1:${String(portC)}`)?.reachable).toBe(false)

      // The machine reboots on the same port (home preserved: same node key,
      // same identity) — discovery must recover once the negative cache
      // window (40ms in the mesh) has passed.
      const revived = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', home: cargoHome, port: portC, peers: [`http://127.0.0.1:${String(portA)}`] })
      try {
        await vi.waitFor(async () => {
          const rows = await probe(alpha)
          expect(rows.find(row => row.url === `http://127.0.0.1:${String(portC)}`)?.reachable).toBe(true)
        }, { timeout: 4_000 })
        const after = await alpha.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'after fault' }, runContext()) as { ok: boolean; reply?: string }
        expect(after.ok).toBe(true)
        expect(after.reply).toContain('ok from cargo:')
      } finally {
        await revived.dispose()
      }
    } finally {
      await alpha.dispose()
    }
  })

  it('one node under two loopback spellings collapses to a single tracked peer (learned alias, not seed)', async () => {
    const portC = await reservePort()
    const ipSpelling = `http://127.0.0.1:${String(portC)}`
    // cargo listens on all interfaces so both loopback spellings reach it.
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', host: '0.0.0.0', port: portC })
    // gh#3 (macOS 26.5 arm64): the whole-127/8 loopback assumption is
    // Linux/Windows — macOS lo0 carries only 127.0.0.1, so a 127.0.0.2
    // connect hangs the test. Detect the second loopback address at
    // runtime; fall back to the `localhost` spelling, which reaches a
    // 0.0.0.0-bound server on every platform (different string, same node
    // — exactly what alias collapse operates on).
    const aliasReachable = await new Promise<boolean>(resolve => {
      const socket = net.connect(portC, '127.0.0.2')
      const done = (ok: boolean): void => { socket.destroy(); resolve(ok) }
      socket.setTimeout(800, () => done(false))
      socket.once('connect', () => done(true))
      socket.once('error', () => done(false))
    })
    const aliasSpelling = aliasReachable
      ? `http://127.0.0.2:${String(portC)}`
      : `http://localhost:${String(portC)}`
    // relay knows cargo under the SECOND spelling only; alpha seeds the first
    // spelling plus relay — the alias arrives as a referral (non-seed), which
    // is the only shape alias collapse may drop.
    const relay = await bootNode({ name: 'relay', session: 'mesh-relay', team: 'relay', peers: [aliasSpelling] })
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', peers: [ipSpelling, relay.baseUrl] })
    try {
      // First sweep fetches both seeds; relay's card offers the alias
      // spelling. The search pass fetches it, sees the same signed session,
      // and collapses: the non-seed alias is dropped.
      const found = await alpha.ctx.tools.get('a2a_teams')?.execute({ query: 'cargo' }, runContext()) as { ok: boolean; teams: { team: string; via?: string }[] }
      expect(found.teams.some(row => row.team === 'cargo')).toBe(true)
      const rows = await probe(alpha)
      const urls = rows.map(row => row.url)
      expect(urls).toContain(ipSpelling)
      expect(urls).toContain(relay.baseUrl)
      expect(urls).not.toContain(aliasSpelling)
    } finally {
      await alpha.dispose()
      await relay.dispose()
      await cargo.dispose()
    }
  })
})

describe('mesh faults — zone delegation across real nodes', () => {
  it('a delegated team name resolves through the delegating node to its bound target', async () => {
    // cargo's node key is preseeded so alpha's delegate record can bind the
    // exact public key before either node boots.
    const cargoHome = tmpHome()
    const cargoPub = preseedNodeKey(cargoHome)
    const portC = await reservePort()
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo', home: cargoHome, port: portC })
    // alpha is the delegating zone: its signed card claims the name 'cargo'
    // resolves at cargo's URL under cargo's bound key.
    const alpha = await bootNode({
      name: 'alpha', session: 'mesh-alpha', team: 'alpha',
      delegates: [{ name: 'cargo', url: `http://127.0.0.1:${String(portC)}`, publicKey: cargoPub }],
    })
    // delta sees ONLY alpha; the name must resolve through the delegation.
    const delta = await bootNode({ name: 'delta', session: 'mesh-delta', team: 'delta', peers: [alpha.baseUrl] })
    try {
      const result = await delta.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'delegated hello' }, runContext()) as { ok: boolean; reply?: string }
      expect(result.ok).toBe(true)
      expect(result.reply).toContain('ok from cargo:')
      expect(cargo.steered).toHaveLength(1)
      expect(steerText(cargo.steered[0])).toContain('delegated hello')
    } finally {
      await delta.dispose()
      await alpha.dispose()
      await cargo.dispose()
    }
  })

  it('a delegation bound to the wrong key fails closed with the key-mismatch reason surfaced', async () => {
    const { publicKey: wrongKey } = generateKeyPairSync('ed25519')
    const wrongPublic = wrongKey.export({ format: 'der', type: 'spki' }).toString('base64')
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo' })
    // alpha binds a random key: cargo's served card can never match it.
    const alpha = await bootNode({
      name: 'alpha', session: 'mesh-alpha', team: 'alpha',
      delegates: [{ name: 'cargo', url: cargo.baseUrl, publicKey: wrongPublic }],
    })
    const delta = await bootNode({ name: 'delta', session: 'mesh-delta', team: 'delta', peers: [alpha.baseUrl] })
    try {
      const result = await delta.ctx.tools.get('a2a_route')?.execute({ team: 'cargo', message: 'must not resolve' }, runContext()) as { ok: boolean; error?: string }
      expect(result.ok).toBe(false)
      // Fail-closed: the misbound delegation is a config bug, surfaced not
      // silently swallowed — and nothing steered cargo.
      expect(String(result.error)).toMatch(/no route to "cargo"|key-mismatch/)
      expect(cargo.steered).toHaveLength(0)
    } finally {
      await delta.dispose()
      await alpha.dispose()
      await cargo.dispose()
    }
  })
})

describe('mesh faults — connection-layer boundary', () => {
  it('referralLearning: false freezes the seed set: gossip offers are neither learned nor offered', async () => {
    const cargo = await bootNode({ name: 'cargo', session: 'mesh-cargo', team: 'cargo' })
    const relay = await bootNode({ name: 'relay', session: 'mesh-relay', team: 'relay', peers: [cargo.baseUrl] })
    const alpha = await bootNode({ name: 'alpha', session: 'mesh-alpha', team: 'alpha', referralLearning: false, peers: [relay.baseUrl] })
    try {
      // The search pass would chase any offered referral hop; the freeze
      // means cargo is never offered, so the hunt cannot reach it.
      const found = await alpha.ctx.tools.get('a2a_teams')?.execute({ query: 'cargo' }, runContext()) as { ok: boolean; teams: { team: string }[] }
      expect(found.teams.some(row => row.team === 'cargo')).toBe(false)
      // The freeze is a connection-layer boundary, not blindness: the seed
      // relay itself stays listed.
      const all = await alpha.ctx.tools.get('a2a_teams')?.execute({}, runContext()) as { ok: boolean; teams: { team: string }[] }
      expect(all.teams.some(row => row.team === 'relay')).toBe(true)
      expect(all.teams.some(row => row.team === 'cargo')).toBe(false)
    } finally {
      await alpha.dispose()
      await relay.dispose()
      await cargo.dispose()
    }
  })
})
