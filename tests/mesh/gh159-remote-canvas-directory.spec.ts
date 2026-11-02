// @vitest-environment node
/**
 * gh#159: a peer's canvas organization is a published group, not a session
 * row. Loopback hosts prove listing, routing and the boundary around that
 * claim without any production node, membership, key or state mutation.
 */
import { generateKeyPairSync } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { signCard } from '../../src/card.ts'
import { bootNode, ghostNode, reservePort, runContext, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const A_ID = 'session-aaaaaaaa11112222'
const B_ID = 'session-bbbbbbbb33334444'
const GROUP = 'dsh/canvas/跨机协作'
const PRIVATE = 'dsh/canvas/不共享'
const base = (port: number): string => 'http://127.0.0.1:' + String(port)
const post = async (node: MeshNode, path: string, body: unknown): Promise<Record<string, unknown>> => {
  const response = await fetch(node.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const payload = await response.json() as Record<string, unknown>
  if (!response.ok || payload.ok === false || payload.error !== undefined) throw new Error(JSON.stringify(payload))
  return payload
}

type Directory = { ok: boolean; teams: Array<{ team: string; name: string; session: string; via?: string; origin?: string; local?: boolean; [key: string]: unknown }> }
type Route = { ok: boolean; error?: string; reply?: string }

describe('gh#159 remote canvas discovery and routing', () => {
  it('lists a linked member canvas, routes to its owner, and withholds an unrelated canvas', async () => {
    const pa = await reservePort()
    const pb = await reservePort()
    const a = await bootNode({ name: 'A', session: 'gh159-a', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pa, peers: [base(pb)], cardCacheTtlMs: 30_000 })
    const b = await bootNode({ name: 'B', session: 'gh159-b', team: 'dsh', agentId: B_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pb, peers: [base(pa)], cardCacheTtlMs: 30_000 })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/join', { id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '跨机协作' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: 'dsh/aaaaaaaa' })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '不共享' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '不共享', id: B_ID })
      // A's different LOCAL group has the same name as B's unrelated group.
      // Equal zone/name is not proof of membership in B's group.
      await post(a, '/__dsh_a2a/canvas', { action: 'create', name: '不共享' })
      await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: '不共享', id: A_ID })

      const listed = await a.ctx.tools.get('a2a_teams')!.execute({ query: '跨机协作' }, runContext(a.agents.agent)) as Directory
      const remote = listed.teams.find(row => row.team === GROUP)
      expect(remote).toMatchObject({ team: GROUP, name: '跨机协作', session: 'gh159-b', via: b.baseUrl })
      expect(remote?.local).not.toBe(true)
      // Membership is a scope input, never an undocumented list of members.
      expect(remote).not.toHaveProperty('members')
      expect(remote).not.toHaveProperty('canvasMembers')
      // The state face already supplies canvasOrg via peerOrg. A canvas row
      // must not also enter its remote SESSION list as a phantom node.
      const state = await fetch(a.baseUrl + '/__dsh_a2a/state').then(response => response.json()) as { remote: Array<{ team: string }>; peerOrg: Array<{ url: string; org: Array<{ team: string }> }> }
      expect(state.peerOrg.find(peer => peer.url === b.baseUrl)?.org.some(group => group.team === GROUP)).toBe(true)
      expect(state.remote.some(row => row.team === GROUP)).toBe(false)
      const privateList = await a.ctx.tools.get('a2a_teams')!.execute({ query: '不共享' }, runContext(a.agents.agent)) as Directory
      expect(privateList.teams.some(row => row.team === PRIVATE && row.via === b.baseUrl)).toBe(false)

      const delivered = await a.ctx.tools.get('a2a_route')!.execute({ team: GROUP, message: 'test shared canvas' }, runContext(a.agents.agent)) as Route
      expect(delivered.ok, JSON.stringify(delivered)).toBe(true)
      expect(b.steered).toHaveLength(1)
      const refused = await a.ctx.tools.get('a2a_route')!.execute({ team: PRIVATE, message: 'test unshared canvas' }, runContext(a.agents.agent)) as Route
      expect(refused.ok).toBe(false)
      expect(b.steered).toHaveLength(1)
    } finally { await a.dispose(); await b.dispose() }
  }, 30_000)

  it('does not deliver a cold-cache route from a non-member', async () => {
    const pa = await reservePort()
    const pb = await reservePort()
    const nativeFetch = globalThis.fetch
    const deliveries: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === base(pb) + '/a2a/direct') deliveries.push(String(init?.body ?? ''))
      return await nativeFetch(input, init)
    })
    const a = await bootNode({ name: 'A', session: 'gh159-cold-nonmember-a', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pa, peers: [base(pb)] })
    const b = await bootNode({ name: 'B', session: 'gh159-cold-nonmember-b', team: 'dsh', agentId: B_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pb, peers: [base(pa)] })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/join', { id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '不共享' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '不共享', id: B_ID })
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team: PRIVATE, message: 'must not be delivered' }, runContext(a.agents.agent)) as Route
      expect(result.ok).toBe(false)
      expect(deliveries).toHaveLength(0)
      expect(b.steered).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose() }
  }, 30_000)

  it('routes a joined remote canvas member from a cold peer-card cache', async () => {
    const pa = await reservePort()
    const pb = await reservePort()
    const a = await bootNode({ name: 'A', session: 'gh159-cold-a', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pa, peers: [base(pb)] })
    const b = await bootNode({ name: 'B', session: 'gh159-cold-b', team: 'dsh', agentId: B_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pb, peers: [base(pa)] })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/join', { id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '跨机协作' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: 'dsh/aaaaaaaa' })
      // No directory/probe/state call warms A's cache first.
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team: GROUP, message: 'cold group' }, runContext(a.agents.agent)) as Route
      expect(result.ok, JSON.stringify(result)).toBe(true)
      expect(b.steered).toHaveLength(1)
    } finally { await a.dispose(); await b.dispose() }
  }, 30_000)

  it('lists and routes a non-conflicting session in a nested canvas zone', async () => {
    const pa = await reservePort()
    const pb = await reservePort()
    const nestedId = 'session-abcdef1233334444'
    const a = await bootNode({ name: 'A', session: 'gh159-nested-a', team: 'home', agentId: A_ID, sessionNodes: true, teamScopeInfo: false, teamScopeRouting: false, port: pa, peers: [base(pb)] })
    const b = await bootNode({ name: 'B', session: 'gh159-nested-b', team: 'zone/canvas', agentId: nestedId, sessionNodes: true, teamScopeInfo: false, teamScopeRouting: false, port: pb, peers: [base(pa)] })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/join', { id: nestedId })
      const team = 'zone/canvas/abcdef12'
      const listed = await a.ctx.tools.get('a2a_teams')!.execute({ query: team }, runContext(a.agents.agent)) as Directory
      expect(listed.teams.some(row => row.team === team && row.via === b.baseUrl)).toBe(true)
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team, message: 'nested zone session' }, runContext(a.agents.agent)) as Route
      expect(result.ok, JSON.stringify(result)).toBe(true)
      expect(b.steered).toHaveLength(1)
    } finally { await a.dispose(); await b.dispose() }
  }, 30_000)

  it('fails closed when a canvas group and a legitimate nested-zone session share the same name', async () => {
    const key = generateKeyPairSync('ed25519')
    const captured: string[] = []
    const card = {
      ...signCard({ name: 'other-owner', session: 'gh159-other', team: 'dsh/canvas', capabilities: { route: true, async: true, roster: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      canvasOrg: [{ name: '跨机协作', team: GROUP, members: ['dsh/cccccccc'] }],
      // This is also a valid session alias in this peer's nested zone. The
      // address is ambiguous with B's canvas and must not pick either host.
      sessionTeams: [{ team: GROUP, name: 'nested-zone session', description: '' }],
    }
    const other = createServer((req, res) => {
      if (req.url === '/.well-known/agent-card.json') {
        const body = JSON.stringify(card)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(body)
        return
      }
      if (req.url === '/a2a/direct') {
        let body = ''
        req.on('data', chunk => { body += String(chunk) })
        req.on('end', () => {
          captured.push(body)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'fixture refuses unrelated sender', code: -32000, team: GROUP }))
        })
        return
      }
      res.writeHead(404); res.end()
    })
    await new Promise<void>((resolve, reject) => { other.once('error', reject); other.listen(0, '127.0.0.1', resolve) })
    const otherUrl = base((other.address() as AddressInfo).port)
    const pa = await reservePort()
    const pb = await reservePort()
    const a = await bootNode({ name: 'A', session: 'gh159-two-owners-a', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pa, peers: [otherUrl, base(pb)], cardCacheTtlMs: 30_000 })
    const b = await bootNode({ name: 'B', session: 'gh159-two-owners-b', team: 'dsh', agentId: B_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pb, peers: [base(pa)], cardCacheTtlMs: 30_000 })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/join', { id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '跨机协作' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: 'dsh/aaaaaaaa' })
      const directory = await a.ctx.tools.get('a2a_teams')!.execute({ query: '跨机协作' }, runContext(a.agents.agent)) as Directory
      expect(directory.teams.filter(row => row.team === GROUP).map(row => row.via)).toEqual([b.baseUrl])
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team: GROUP, message: 'private fixture payload' }, runContext(a.agents.agent)) as Route
      expect(result.ok).toBe(false)
      expect(result.error).toContain('ambiguous')
      expect(b.steered).toHaveLength(0)
      // Neither interpretation is allowed to receive the payload.
      expect(captured).toHaveLength(0)
    } finally {
      await a.dispose(); await b.dispose()
      await new Promise<void>((resolve, reject) => { other.close(error => error ? reject(error) : resolve()) })
    }
  }, 30_000)

  it('keeps local-first session routing when no remote canvas claims its name', async () => {
    const key = generateKeyPairSync('ed25519')
    const team = 'zone/canvas/abcdef12'
    const peer = await ghostNode({
      ...signCard({ name: 'replica', session: 'gh159-session-replica', team: 'zone/canvas', capabilities: { route: true, async: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      sessionTeams: [{ team, name: 'session', description: '' }],
    })
    const localId = 'session-abcdef1233334444'
    const a = await bootNode({ name: 'A', session: 'gh159-local-session-only', team: 'zone/canvas', agentId: localId, sessionNodes: true, teamScopeInfo: false, teamScopeRouting: false, peers: [peer.baseUrl] })
    try {
      await post(a, '/__dsh_a2a/join', { id: localId })
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team, message: 'local session', async: true }, runContext()) as Route
      expect(result.ok, JSON.stringify(result)).toBe(true)
      expect(a.steered).toHaveLength(1)
    } finally { await a.dispose(); await peer.close() }
  }, 30_000)

  it('preserves local-first when a local session and remote canvas share the same team', async () => {
    const key = generateKeyPairSync('ed25519')
    const team = 'zone/canvas/abcdef12'
    const remote = await ghostNode({
      ...signCard({ name: 'canvas owner', session: 'gh159-remote-owner', team: 'zone', capabilities: { route: true, async: true, roster: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      canvasOrg: [{ name: 'abcdef12', team, members: ['zone/22222222'] }],
    })
    const localId = 'session-abcdef1233334444'
    const a = await bootNode({ name: 'A', session: 'gh159-local-session', team: 'zone/canvas', agentId: localId, sessionNodes: true, teamScopeInfo: false, teamScopeRouting: false, peers: [remote.baseUrl] })
    try {
      await post(a, '/__dsh_a2a/join', { id: localId })
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team, message: 'ambiguous payload', async: true }, runContext()) as Route
      expect(result.ok, JSON.stringify(result)).toBe(true)
      expect(a.steered).toHaveLength(1)
    } finally { await a.dispose(); await remote.close() }
  }, 30_000)

  it('does not deliver after the caller aborts during cold peer-card lookup', async () => {
    const key = generateKeyPairSync('ed25519')
    const card = {
      ...signCard({ name: 'slow', session: 'gh159-slow', team: 'dsh', capabilities: { route: true, async: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      canvasOrg: [{ name: '跨机协作', team: GROUP, members: ['dsh/aaaaaaaa'] }],
    }
    let started!: () => void
    const requestStarted = new Promise<void>(resolve => { started = resolve })
    let release!: () => void
    let deliveries = 0
    const peer = createServer((req, res) => {
      if (req.url === '/a2a/direct') { deliveries++; res.writeHead(500); res.end(); return }
      if (req.url !== '/.well-known/agent-card.json') { res.writeHead(404); res.end(); return }
      release = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(card)) }
      started()
    })
    await new Promise<void>((resolve, reject) => { peer.once('error', reject); peer.listen(0, '127.0.0.1', resolve) })
    const a = await bootNode({ name: 'A', session: 'gh159-aborted-remote', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeRouting: true, peers: [base((peer.address() as AddressInfo).port)] })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      const abort = new AbortController()
      const pending = a.ctx.tools.get('a2a_route')!.execute({ team: GROUP, message: 'cancel before dispatch', async: true }, { ...runContext(a.agents.agent), signal: abort.signal }) as Promise<Route>
      await requestStarted
      abort.abort()
      release()
      const result = await pending
      expect(result.ok).toBe(false)
      expect(deliveries).toBe(0)
      expect(a.steered).toHaveLength(0)
    } finally { await a.dispose(); await new Promise<void>((resolve, reject) => { peer.close(error => error ? reject(error) : resolve()) }) }
  }, 30_000)

  it('preserves local-first for an existing local canvas with a same-named remote group', async () => {
    const pa = await reservePort()
    const pb = await reservePort()
    const a = await bootNode({ name: 'A', session: 'gh159-local-owner-a', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pa, peers: [base(pb)] })
    const b = await bootNode({ name: 'B', session: 'gh159-local-owner-b', team: 'dsh', agentId: B_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pb, peers: [base(pa)] })
    const localSteers: unknown[] = []
    const localId = 'session-cccccccc33334444'
    const localAgent = { id: SessionId(localId), session: { events: [] }, steer: (payload: unknown) => { localSteers.push(payload) } }
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      const caller = a.agents.agent
      a.agents.agent = localAgent as never
      a.ctx.emit('agent/created', { agent: localAgent as never })
      a.agents.agent = caller
      await post(a, '/__dsh_a2a/join', { id: localId })
      await post(b, '/__dsh_a2a/join', { id: B_ID })
      await post(a, '/__dsh_a2a/canvas', { action: 'create', name: '跨机协作' })
      await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: A_ID })
      await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: localId })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '跨机协作' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: 'dsh/aaaaaaaa' })
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team: GROUP, message: 'ambiguous payload', async: true }, runContext(a.agents.agent)) as Route
      expect(result.ok, JSON.stringify(result)).toBe(true)
      expect(localSteers).toHaveLength(1)
      expect(b.steered).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose() }
  }, 30_000)

  it('selects the sole matching owner when another same-named canvas excludes the caller', async () => {
    const key = generateKeyPairSync('ed25519')
    const other = await ghostNode({
      ...signCard({ name: 'other', session: 'gh159-unshared-owner', team: 'dsh', capabilities: { route: true, async: true, roster: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      canvasOrg: [{ name: '跨机协作', team: GROUP, members: ['dsh/cccccccc'] }],
    })
    const pa = await reservePort()
    const pb = await reservePort()
    const nativeFetch = globalThis.fetch
    const deliveries: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === other.baseUrl + '/a2a/direct') deliveries.push(String(init?.body ?? ''))
      return await nativeFetch(input, init)
    })
    const a = await bootNode({ name: 'A', session: 'gh159-one-owner-a', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pa, peers: [other.baseUrl, base(pb)] })
    const b = await bootNode({ name: 'B', session: 'gh159-one-owner-b', team: 'dsh', agentId: B_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pb, peers: [base(pa)] })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/join', { id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '跨机协作' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: 'dsh/aaaaaaaa' })
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team: GROUP, message: 'correct owner' }, runContext(a.agents.agent)) as Route
      expect(result.ok, JSON.stringify(result)).toBe(true)
      expect(b.steered).toHaveLength(1)
      expect(deliveries).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose(); await other.close() }
  }, 30_000)

  it('fails closed when two distinct owners advertise the same member canvas', async () => {
    const key = generateKeyPairSync('ed25519')
    const other = await ghostNode({
      ...signCard({ name: 'other', session: 'gh159-other-owner', team: 'dsh', capabilities: { route: true, async: true, roster: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      canvasOrg: [{ name: '跨机协作', team: GROUP, members: ['dsh/aaaaaaaa', 'dsh/cccccccc'] }],
    })
    const pa = await reservePort()
    const pb = await reservePort()
    const nativeFetch = globalThis.fetch
    const deliveries: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === other.baseUrl + '/a2a/direct') deliveries.push(String(init?.body ?? ''))
      return await nativeFetch(input, init)
    })
    const a = await bootNode({ name: 'A', session: 'gh159-two-groups-a', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pa, peers: [other.baseUrl, base(pb)] })
    const b = await bootNode({ name: 'B', session: 'gh159-two-groups-b', team: 'dsh', agentId: B_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pb, peers: [base(pa)] })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/join', { id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '跨机协作' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '跨机协作', id: 'dsh/aaaaaaaa' })
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team: GROUP, message: 'ambiguous payload' }, runContext(a.agents.agent)) as Route
      expect(result.ok).toBe(false)
      expect(result.error).toContain('ambiguous')
      expect(deliveries).toHaveLength(0)
      expect(b.steered).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose(); await other.close() }
  }, 30_000)

  it('does not treat a same-id8 remote member as this host under scoped discovery', async () => {
    const pa = await reservePort()
    const pb = await reservePort()
    const nativeFetch = globalThis.fetch
    const deliveries: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === base(pb) + '/a2a/direct') deliveries.push(String(init?.body ?? ''))
      return await nativeFetch(input, init)
    })
    const a = await bootNode({ name: 'A', session: 'gh159-collision-a', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, teamScopeRouting: true, port: pa, peers: [base(pb)] })
    const b = await bootNode({ name: 'B', session: 'gh159-collision-b', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, port: pb, peers: [base(pa)] })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '碰撞隔离' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '碰撞隔离', id: A_ID })
      const listed = await a.ctx.tools.get('a2a_teams')!.execute({ query: '碰撞隔离' }, runContext(a.agents.agent)) as Directory
      expect(listed.teams.some(row => row.team === 'dsh/canvas/碰撞隔离')).toBe(false)
      // A knows the name but B's colliding handle denotes B's OWN session.
      // The message must not reach B even before its admission can refuse it.
      const routed = await a.ctx.tools.get('a2a_route')!.execute({ team: 'dsh/canvas/碰撞隔离', message: 'private fixture' }, runContext(a.agents.agent)) as Route
      expect(routed.ok).toBe(false)
      expect(deliveries).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose() }
  }, 30_000)

  it('keeps the host-side initiator exemption when resolving a seeded canvas', async () => {
    const key = generateKeyPairSync('ed25519')
    const requests: string[] = []
    const card = {
      ...signCard({ name: 'peer', session: 'gh159-host-face-peer', team: 'rogue', capabilities: { route: true, async: true, roster: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      canvasOrg: [{ name: 'ops', team: 'rogue/canvas/ops', members: ['rogue/12345678'] }],
    }
    const peer = createServer((req, res) => {
      if (req.url === '/.well-known/agent-card.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(card)); return }
      if (req.url === '/a2a/direct') {
        requests.push(req.url)
        req.resume()
        req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'fixture refusal', code: -32000 })) })
        return
      }
      res.writeHead(404); res.end()
    })
    await new Promise<void>((resolve, reject) => { peer.once('error', reject); peer.listen(0, '127.0.0.1', resolve) })
    const a = await bootNode({ name: 'A', session: 'gh159-host-face', team: 'home', teamScopeInfo: false, teamScopeRouting: true, peers: [base((peer.address() as AddressInfo).port)] })
    try {
      // Agent-less host calls are exempt from teamScopeRouting; the peer can
      // still refuse under its own existing delivery rules.
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team: 'rogue/canvas/ops', message: 'host fixture' }, runContext()) as Route
      expect(result.ok).toBe(false)
      expect(requests).toHaveLength(1)
    } finally {
      await a.dispose()
      await new Promise<void>((resolve, reject) => { peer.close(error => error ? reject(error) : resolve()) })
    }
  }, 30_000)

  it('does not make a referral-only canvas claim a routing authority', async () => {
    const key = generateKeyPairSync('ed25519')
    const rogue = await ghostNode({
      ...signCard({ name: 'rogue', session: 'gh159-rogue', team: 'rogue', capabilities: { roster: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      canvasOrg: [{ name: 'ops', team: 'rogue/canvas/ops', members: ['rogue/12345678'] }],
    })
    const relay = await ghostNode({
      ...signCard({ name: 'relay', session: 'gh159-relay', team: 'relay', capabilities: { roster: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      peers: [rogue.baseUrl],
    })
    const a = await bootNode({ name: 'A', session: 'gh159-seed-check', team: 'home', teamScopeInfo: false, teamScopeRouting: false, peers: [relay.baseUrl], referralTeamResolution: false })
    try {
      // Existing open discovery may show referral-learned rows. Resolution is
      // still restricted to the operator's seed/delegate set (N9).
      const listed = await a.ctx.tools.get('a2a_teams')!.execute({ query: 'rogue/canvas/ops' }, runContext()) as Directory
      const row = listed.teams.find(entry => entry.team === 'rogue/canvas/ops')
      expect(row).toMatchObject({ team: 'rogue/canvas/ops', via: rogue.baseUrl })
      expect(row).not.toHaveProperty('canvasMembers')
      const result = await a.ctx.tools.get('a2a_route')!.execute({ team: 'rogue/canvas/ops', message: 'test N9' }, runContext()) as Route
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not published by any configured peer')
    } finally { await a.dispose(); await relay.close(); await rogue.close() }
  }, 30_000)

  it('does not disclose a canvas solely on a peer-claimed roster decoration', async () => {
    const key = generateKeyPairSync('ed25519')
    const team = 'other/canvas/ops'
    const peer = await ghostNode({
      ...signCard({ name: 'peer', session: 'gh159-roster-claim', team: 'other', capabilities: { roster: true }, expiresAt: Date.now() + 60_000 }, key.privateKey),
      canvasOrg: [{ name: 'ops', team, members: ['other/cccccccc'] }],
      teamMemberships: [{ node: team, team: 'team/shared' }],
    })
    const a = await bootNode({ name: 'A', session: 'gh159-roster-scope', team: 'home', agentId: A_ID, sessionNodes: true, teamScopeInfo: true, teamJoinAllowlist: ['team/shared'], peers: [peer.baseUrl] })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      const joined = await a.ctx.tools.get('a2a_team_join')!.execute({ team: 'team/shared', id: A_ID }, runContext(a.agents.agent)) as { ok: boolean }
      expect(joined.ok).toBe(true)
      const listed = await a.ctx.tools.get('a2a_teams')!.execute({ query: team }, runContext(a.agents.agent)) as Directory
      expect(listed.teams.some(row => row.team === team)).toBe(false)
    } finally { await a.dispose(); await peer.close() }
  }, 30_000)

  it('does not expose or route a one-sided unlinked peer canvas', async () => {
    const pa = await reservePort()
    const pb = await reservePort()
    const a = await bootNode({ name: 'A', session: 'gh159-unlinked-a', team: 'dsh', agentId: A_ID, sessionNodes: true, teamScopeInfo: false, teamScopeRouting: false, port: pa, peers: [base(pb)] })
    const b = await bootNode({ name: 'B', session: 'gh159-unlinked-b', team: 'dsh', agentId: B_ID, sessionNodes: true, teamScopeInfo: false, teamScopeRouting: false, port: pb, peers: [] })
    try {
      await post(a, '/__dsh_a2a/join', { id: A_ID })
      await post(b, '/__dsh_a2a/join', { id: B_ID })
      await post(b, '/__dsh_a2a/canvas', { action: 'create', name: '不共享' })
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: '不共享', id: B_ID })
      const listed = await a.ctx.tools.get('a2a_teams')!.execute({ query: '不共享' }, runContext(a.agents.agent)) as Directory
      expect(listed.teams.some(row => row.team === PRIVATE)).toBe(false)
      const routed = await a.ctx.tools.get('a2a_route')!.execute({ team: PRIVATE, message: 'unlinked fixture' }, runContext(a.agents.agent)) as Route
      expect(routed.ok).toBe(false)
      expect(b.steered).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose() }
  }, 30_000)

  it('ignores canvas claims attached to a card whose signed core was tampered with', async () => {
    const key = generateKeyPairSync('ed25519')
    const card = signCard({ name: 'signed', session: 'gh159-bad', team: 'rogue', capabilities: { roster: true }, expiresAt: Date.now() + 60_000 }, key.privateKey)
    const bad = await ghostNode({ ...card, name: 'tampered', canvasOrg: [{ name: 'ops', team: 'rogue/canvas/ops', members: ['rogue/12345678'] }] })
    const a = await bootNode({ name: 'A', session: 'gh159-bad-card', team: 'home', teamScopeInfo: false, teamScopeRouting: false, peers: [bad.baseUrl] })
    try {
      const listed = await a.ctx.tools.get('a2a_teams')!.execute({ query: 'ops' }, runContext()) as Directory
      expect(listed.teams.some(row => row.team === 'rogue/canvas/ops')).toBe(false)
      const routed = await a.ctx.tools.get('a2a_route')!.execute({ team: 'rogue/canvas/ops', message: 'test bad signature' }, runContext()) as Route
      expect(routed.ok).toBe(false)
      expect(routed.error).toContain('not published by any configured peer')
    } finally { await a.dispose(); await bad.close() }
  }, 30_000)
})
