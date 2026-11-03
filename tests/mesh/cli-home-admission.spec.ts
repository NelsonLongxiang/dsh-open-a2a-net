// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, createPrivateKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { bootNode, reservePort, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })
const handle = 'ops-cli/a1b2c3d4e5f60718'
const key = generateKeyPairSync('ed25519').privateKey
const post = async (base: string, path: string, body: unknown): Promise<Record<string, any>> =>
  await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => await r.json() as Record<string, any>)
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
async function direct(target: MeshNode, signer: MeshNode, id: string): Promise<Record<string, any>> {
  const url = target.baseUrl + '/a2a/direct'
  const secret = createPrivateKey(readFileSync(join(signer.home, 'a2a', 'node-key.pem'), 'utf8'))
  const headers = signOriginClaim({ url, method: 'POST' }, { caller: signer.team, callerUrl: signer.baseUrl, privateKey: secret, unbound: false, now: Date.now() })
  return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ team: 'target/01234567', message: 'CLI linked home report', caller_session: handle, task_id: id, wait: false }) }).then(async r => await r.json() as Record<string, any>)
}

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
  it('two linked homes advertising the same handle leave the pin unknown and refuse delivery', async () => {
    const { target, homes } = await pair(true)
    try {
      for (const home of homes) await deposit(home)
      expect((await link(target)).ok).toBe(true)
      const state = await fetch(target.baseUrl + '/__dsh_a2a/state').then(async r => await r.json() as { canvas: { teams: Array<{ members: Array<{ id: string; cliHome?: string | null }> }> } })
      expect(state.canvas.teams[0]?.members.find(m => m.id === handle)?.cliHome).toBeNull()
      expect((await direct(target, homes[0]!, 'direct-cli-home-ambiguous')).routed).not.toBe(true)
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
      expect((await direct(target, homes[1]!, 'direct-cli-home-forged')).routed).not.toBe(true)
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
      expect((await direct(target, homes[0]!, 'direct-cli-home-offline')).routed).not.toBe(true)
    } finally { await target.dispose(); for (const home of homes) await home.dispose() }
  }, 20_000)
  it('the warm verified signer is still refused when a new home-card fetch fails', async () => {
    const { target, homes } = await pair()
    try {
      await deposit(homes[0]!)
      expect((await link(target)).ok).toBe(true)
      await homes[0]!.dispose()
      expect((await direct(target, homes[0]!, 'direct-cli-home-unreachable')).routed).not.toBe(true)
    } finally { await target.dispose() }
  }, 20_000)
})
