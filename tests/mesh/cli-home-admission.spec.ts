// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, createPrivateKey } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { bootNode, reservePort, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })
const handle = 'ops-cli/a1b2c3d4e5f60718'
const key = generateKeyPairSync('ed25519').privateKey
const post = async (base: string, path: string, body: unknown): Promise<Record<string, any>> =>
  await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(body) }).then(async r => await r.json() as Record<string, any>)
const cliCard = (until = Date.now() + 4 * 60 * 60_000): string => JSON.stringify(signCard({ name: 'ops-cli', session: 'cli-ops', team: handle, capabilities: { route: true, async: true }, expiresAt: until }, key))
const deposit = async (home: MeshNode, until?: number): Promise<void> => { const row = await post(home.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'publish', card: cliCard(until) }); expect(row.ok, JSON.stringify(row)).toBe(true) }
async function pair(twoHomes = false): Promise<{ target: MeshNode; homes: MeshNode[] }> {
  const targetPort = await reservePort()
  const homePorts = await Promise.all(Array.from({ length: twoHomes ? 2 : 1 }, () => reservePort()))
  const homes: MeshNode[] = []
  for (let i = 0; i < homePorts.length; i++) homes.push(await bootNode({ name: 'H' + i, session: 'mesh-cli-home-' + i, team: 'home' + i, port: homePorts[i], sessionNodes: true, peers: ['http://127.0.0.1:' + targetPort] }))
  const target = await bootNode({ name: 'H2', session: 'mesh-cli-target', team: 'target', port: targetPort, sessionNodes: true, peers: homes.map(h => h.baseUrl) })
  await post(target.baseUrl, '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })
  return { target, homes }
}
async function link(target: MeshNode, home?: string): Promise<Record<string, any>> { return await post(target.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, ...(home === undefined ? {} : { home }) }) }
async function direct(target: MeshNode, signer: MeshNode, id: string, slash = false): Promise<Record<string, any>> {
  const url = target.baseUrl + '/a2a/direct'
  const secret = createPrivateKey(readFileSync(join(signer.home, 'a2a', 'node-key.pem'), 'utf8'))
  const headers = signOriginClaim({ url, method: 'POST' }, { caller: signer.team, callerUrl: signer.baseUrl + (slash ? '/' : ''), privateKey: secret, unbound: false, now: Date.now() })
  return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ team: 'target/01234567', message: 'CLI linked home report', caller_session: handle, task_id: id, wait: false }) }).then(async r => await r.json() as Record<string, any>)
}

async function peerOp(target: MeshNode, signer: MeshNode, body: unknown): Promise<Record<string, any>> {
  const url = target.baseUrl + '/a2a/canvas-op'
  const privateKey = createPrivateKey(readFileSync(join(signer.home, 'a2a', 'node-key.pem'), 'utf8'))
  const headers = signOriginClaim({ url, method: 'POST' }, { caller: signer.team, callerUrl: signer.baseUrl, privateKey, unbound: false, now: Date.now() })
  return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async r => await r.json() as Record<string, any>)
}
const pinOf = (target: MeshNode): string | undefined => JSON.parse(readFileSync(join(target.home, 'a2a', 'canvas.json'), 'utf8')).cliHome?.[handle]

describe('#222 F1 remote CLI pinned-home admission (real hosts; scope on)', () => {
  it('one linked home pins on add and its bound signer delivers with carrier_url audit', async () => {
    const { target, homes } = await pair()
    try {
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true)
      const store = JSON.parse(readFileSync(join(target.home, 'a2a', 'canvas.json'), 'utf8')) as { cliHome?: Record<string, string> }
      expect(store.cliHome?.[handle]).toBe(homes[0]!.baseUrl)
      const unsigned = await post(target.baseUrl, '/a2a/direct', { team: 'target/01234567', message: 'unsigned CLI', caller_session: handle, wait: false })
      expect(unsigned.routed).not.toBe(true) // the legacy unsigned-envelope window never grants remote-ref-cli
      const answer = await direct(target, homes[0]!, 'direct-cli-home-success')
      expect(answer.routed, JSON.stringify(answer)).toBe(true)
      const ledger = JSON.parse(readFileSync(join(target.home, 'a2a', 'tasks.json'), 'utf8')) as { tasks: Array<{ auth?: { via: string; carrier_url: string; admission_rule: string } }> }
      expect(ledger.tasks.some(x => x.auth?.carrier_url === homes[0]!.baseUrl && x.auth.via === 'canvas-member' && x.auth.admission_rule === 'remote-ref-cli')).toBe(true)
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 20_000)
  it('N4b: a signer callerUrl with a trailing slash stores only canonical carrier origin', async () => {
    const { target, homes } = await pair()
    try {
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true)
      const reply = await direct(target, homes[0]!, 'direct-cli-home-slash', true)
      expect(reply.routed, JSON.stringify(reply)).toBe(true)
      const ledger = JSON.parse(readFileSync(join(target.home, 'a2a', 'tasks.json'), 'utf8'))
      expect(ledger.tasks.find((row: any) => row.taskId === 'direct-cli-home-slash').auth.carrier_url).toBe(homes[0]!.baseUrl)
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 20_000)
  it('owner home options read fresh cards without pinning and explicit submission revalidates them', async () => {
    const { target, homes } = await pair(true)
    try {
      for (const home of homes) await deposit(home)
      expect((await link(target)).ok).toBe(true)
      const before = readFileSync(join(target.home, 'a2a', 'canvas.json'), 'utf8')
      const inspect = () => post(target.baseUrl, '/__dsh_a2a/canvas', { action: 'cli-home-options', name: 'ops', id: handle })
      expect(await inspect()).toMatchObject({ ok: true, homes: expect.arrayContaining(homes.map(x => x.baseUrl)) })
      expect(readFileSync(join(target.home, 'a2a', 'canvas.json'), 'utf8')).toBe(before)
      await post(homes[1]!.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'revoke', handle })
      const updated = await inspect()
      expect(updated.homes).toEqual([homes[0]!.baseUrl]) // no stale cached advertiser
      expect((await link(target, homes[1]!.baseUrl)).ok).toBe(false)
      await homes[1]!.dispose()
      const offline = await inspect()
      expect(offline).toMatchObject({ ok: true, homes: [homes[0]!.baseUrl] })
      expect(offline.unreadable).toBeGreaterThanOrEqual(1)
      expect(pinOf(target)).toBeUndefined()
      expect((await link(target, homes[0]!.baseUrl)).ok).toBe(true)
      expect(pinOf(target)).toBe(homes[0]!.baseUrl)
      expect((await post(target.baseUrl, '/__dsh_a2a/canvas', { action: 'cli-home-options', name: 'missing', id: handle })).ok).toBe(false)
      expect((await post(target.baseUrl, '/__dsh_a2a/canvas', { action: 'cli-home-options', name: 'ops', id: 'home0/01234567' })).ok).toBe(false)
    } finally { await target.dispose(); await homes[0]!.dispose() }
  }, 30_000)
  it('two linked homes advertising the same handle leave the pin unknown and refuse delivery', async () => {
    const { target, homes } = await pair(true)
    try {
      for (const home of homes) await deposit(home)
      expect((await link(target)).ok).toBe(true)
      const state = await fetch(target.baseUrl + '/__dsh_a2a/state').then(async r => await r.json() as { canvas: { teams: Array<{ members: Array<{ id: string; cliHome?: string | null }> }> } })
      expect(state.canvas.teams[0]?.members.find(m => m.id === handle)?.cliHome).toBeNull()
      expect((await direct(target, homes[0]!, 'direct-cli-home-ambiguous')).error).toContain('home is not pinned')
      expect((await link(target, 'https://unlinked.example')).ok).toBe(false)
      expect((await link(target, homes[0]!.baseUrl)).ok).toBe(true)
      expect((await direct(target, homes[0]!, 'direct-cli-home-explicit')).routed).toBe(true)
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 20_000)
  it('a second linked signer cannot borrow a pin established for the first home', async () => {
    const { target, homes } = await pair(true)
    try {
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true)
      await deposit(homes[1]!)
      expect((await direct(target, homes[1]!, 'direct-cli-home-forged')).error).toContain('signer does not match pinned home')
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 20_000)
  it('a linked peer cannot create or replace a CLI pin through signed canvas ops or the fleet relay', async () => {
    const { target, homes } = await pair(true)
    try {
      await deposit(homes[0]!)
      expect((await peerOp(target, homes[0]!, { op: 'add-member', name: 'ops', id: handle })).ok).toBe(true)
      expect(pinOf(target)).toBeUndefined() // peer-side composition never auto-pins
      expect((await link(target)).ok).toBe(true)
      await deposit(homes[1]!)
      const attack = await peerOp(target, homes[1]!, { op: 'add-member', name: 'ops', id: handle, home: homes[1]!.baseUrl })
      expect(attack.ok).toBe(false)
      expect(attack.error).toContain('local control')
      expect((await peerOp(target, homes[1]!, { op: 'add-member', name: 'ops', id: handle })).ok).toBe(true)
      expect((await post(homes[1]!.baseUrl, '/__dsh_a2a/fleet-canvas-op', { peer: target.baseUrl, op: 'add-member', name: 'ops', id: handle, home: homes[1]!.baseUrl })).ok).toBe(true)
      expect(pinOf(target)).toBe(homes[0]!.baseUrl)
      expect((await direct(target, homes[1]!, 'direct-cli-peer-pin-attack')).routed).not.toBe(true)
      expect((await direct(target, homes[0]!, 'direct-cli-original-pin')).routed).toBe(true)
      expect((await link(target)).ok).toBe(true)
      expect(pinOf(target)).toBe(homes[0]!.baseUrl)
      expect((await link(target, homes[1]!.baseUrl + '/')).ok).toBe(true) // only explicit local control may re-pin
      expect(pinOf(target)).toBe(homes[1]!.baseUrl)
      expect((await direct(target, homes[0]!, 'direct-cli-old-pin')).routed).not.toBe(true)
      expect((await direct(target, homes[1]!, 'direct-cli-local-repin')).routed).toBe(true)
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 30_000)
  it('N1c: an implicit local re-add cannot replace a pin even when the other home is the sole live advertiser', async () => {
    const { target, homes } = await pair(true)
    try {
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true)
      await post(homes[0]!.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'revoke', handle })
      await deposit(homes[1]!)
      expect((await link(target)).ok).toBe(true)
      expect(pinOf(target)).toBe(homes[0]!.baseUrl)
      expect((await direct(target, homes[1]!, 'direct-cli-implicit-repin')).routed).not.toBe(true)
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 20_000)
  it('an unreadable tracked stranger keeps auto-pin conservative and an explicit fresh home remains selectable', async () => {
    const { target, homes } = await pair(true)
    try {
      await deposit(homes[0]!)
      // Read its genuine minimal card without a reciprocal peer listing: this peer is a known stranger.
      const realFetch = globalThis.fetch
      let unavailable = false
      vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
        if (String(args[0]) === homes[1]!.baseUrl + '/.well-known/agent-card.json') {
          if (unavailable) throw new Error('known unlinked peer is offline')
          const response = await realFetch(...args)
          const card = await response.json() as Record<string, any>
          card.peers = []
          return new Response(JSON.stringify(card), { status: 200, headers: response.headers })
        }
        return await realFetch(...args)
      })
      expect((await link(target)).ok).toBe(true)
      expect((await post(target.baseUrl, '/__dsh_a2a/canvas', { action: 'remove-member', name: 'ops', id: handle })).ok).toBe(true)
      unavailable = true
      expect((await link(target)).ok).toBe(true)
      expect(pinOf(target)).toBeUndefined()
      expect((await link(target, homes[0]!.baseUrl)).ok).toBe(true)
      expect(pinOf(target)).toBe(homes[0]!.baseUrl)
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 20_000)
  it('link-time fresh reads do not treat an unreadable linked home as absent', async () => {
    const { target, homes } = await pair(true)
    try {
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true) // cache both host cards before the second CLI publishes
      expect((await post(target.baseUrl, '/__dsh_a2a/canvas', { action: 'remove-member', name: 'ops', id: handle })).ok).toBe(true)
      await deposit(homes[1]!)
      await homes[0]!.dispose()
      expect((await link(target)).ok).toBe(true)
      expect(pinOf(target)).toBeUndefined()
      expect((await direct(target, homes[1]!, 'direct-cli-incomplete-candidates')).error).toContain('home is not pinned')
      expect((await link(target, homes[1]!.baseUrl)).ok).toBe(true) // fresh successful explicit candidate remains selectable
      expect(pinOf(target)).toBe(homes[1]!.baseUrl)
    } finally { await target.dispose(); await homes[1]!.dispose() }
  }, 30_000)
  it('a cold restart cannot pin a liar while the canvas-only linked real home is unreadable', async () => {
    const { target, homes } = await pair(true)
    let cold: MeshNode | undefined
    try {
      await deposit(homes[0]!)
      await post(homes[0]!.baseUrl,'/__dsh_a2a/join',{id:'session-0123456789abcdef'})
      expect((await post(target.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'host-link', id: 'home0/01234567',peer:homes[0]!.baseUrl })).ok).toBe(true)
      await deposit(homes[1]!)
      await target.dispose()
      await homes[0]!.dispose()
      // Home0 survives only as a learned tracked peer and an operator canvas ref, not a config seed or CLI pin.
      writeFileSync(join(target.home, 'a2a', 'peers.json'), JSON.stringify({ peers: homes.map((host, index) => ({ url: host.baseUrl, score: 10000, seed: index === 1 })) }))
      cold = await bootNode({ name: 'H2', session: 'mesh-cli-target', team: 'target', port: target.port, home: target.home, sessionNodes: true, peers: [homes[1]!.baseUrl] })
      expect((await link(cold)).ok).toBe(true)
      expect(pinOf(cold)).toBeUndefined()
      expect((await direct(cold, homes[1]!, 'direct-cli-cold-home-liar')).error).toContain('home is not pinned')
    } finally { if (cold !== undefined) await cold.dispose(); await homes[1]!.dispose() }
  }, 30_000)
  it('allowlist observation rechecks only the CLI link and pinned carrier, not old request signatures', async () => {
    const { target, homes } = await pair()
    try {
      target.agents.agent!.followup=()=>{} // Keep this authorization-observation fixture pending.
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true)
      const task = 'direct-cli-observer'
      expect((await direct(target, homes[0]!, task)).routed).toBe(true)
      await post(target.baseUrl, '/__dsh_a2a/canvas', { action: 'create', name: 'unrelated' })
      const state = await fetch(target.baseUrl + '/__dsh_a2a/state').then(async r => await r.json() as Record<string, any>)
      expect(state.authorization.affected.flatMap((entry: any) => entry.tasks).some((row: any) => row.taskId === task)).toBe(false)
      await post(target.baseUrl, '/__dsh_a2a/canvas', { action: 'remove-member', name: 'ops', id: handle })
      const revoked = await fetch(target.baseUrl + '/__dsh_a2a/state').then(async r => await r.json() as Record<string, any>)
      expect(revoked.authorization.affected.flatMap((entry: any) => entry.tasks).some((row: any) => row.taskId === task && row.verdict === 'would-revoke')).toBe(true)
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 20_000)
  it('a home card marking its CLI row OFFLINE refuses delivery even from the pinned signer', async () => {
    const { target, homes } = await pair()
    try {
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true)
      const realFetch = globalThis.fetch
      // The host's sessionTeams field is served-fresh unsigned metadata; inject the same OFFLINE row its tombstone publishes.
      vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
        const response = await realFetch(...args)
        if (String(args[0]) !== homes[0]!.baseUrl + '/.well-known/agent-card.json') return response
        const card = await response.json() as { sessionTeams?: Array<{ team: string; offline?: boolean }> }
        if (card.sessionTeams?.some(x => x.team === handle)) for (const row of card.sessionTeams) if (row.team === handle) row.offline = true
        return new Response(JSON.stringify(card), { status: response.status, headers: response.headers })
      })
      expect((await direct(target, homes[0]!, 'direct-cli-home-offline')).error).toContain('offline or home card could not be read')
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 20_000)
  it('the warm verified signer is still refused when a new home-card fetch fails', async () => {
    const { target, homes } = await pair()
    try {
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true)
      await homes[0]!.dispose()
      expect((await direct(target, homes[0]!, 'direct-cli-home-unreachable')).error).toContain('OriginClaim verification failed (no-card)')
    } finally { await target.dispose() }
  }, 20_000)
  it('a cold H2 card cache with an unreadable pinned home refuses the forwarded CLI body', async () => {
    const { target, homes } = await pair()
    let cold: MeshNode | undefined
    try {
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true)
      await target.dispose()
      await homes[0]!.dispose()
      // Reboot with the same canvas.json pin but an empty in-memory card cache.
      cold = await bootNode({ name: 'H2', session: 'mesh-cli-target', team: 'target', port: target.port, home: target.home, sessionNodes: true, peers: [homes[0]!.baseUrl] })
      const answer = await direct(cold, homes[0]!, 'direct-cli-home-cold')
      expect(answer.routed, JSON.stringify(answer)).not.toBe(true)
      expect(cold.steered).toHaveLength(0)
    } finally { if (cold !== undefined) await cold.dispose() }
  }, 20_000)
})
