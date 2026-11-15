// @vitest-environment node
/**
 * #697 review regressions (adapted from the reviewer's counterexamples, e79cd89): superagent intake's link is the host at
 * exactly the signing origin under exactly its key — never a bare legacy reference's zone match — and the caller's
 * listing is the host's card read fresh for this request, never an earlier cached listing. The legitimate path stays open.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { bootNode, ghostNode, mockGuiLogin, postJson, reservePort, tmpHome, type MeshNode } from './harness.ts'
import { seedCanvasHistory } from '../fixtures/canvas-history.ts'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function () { throw Error('fixture no sockets') }) })
afterEach(() => { vi.unstubAllGlobals() })
const owner = 'session-aaaaaaaa00001111', caller = 'dsh/dddddddd'
const login = mockGuiLogin()
async function post(node: MeshNode, path: string, body: unknown) { return await (await fetch(node.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...login }, body: JSON.stringify(body) })).json() as any }
async function get(node: MeshNode, path: string) { return await (await fetch(node.baseUrl + path)).json() as any }
async function readyTeam(a: MeshNode) {
  expect((await postJson(a.baseUrl, '/__dsh_a2a/join', { id: owner })).status).toBe(200)
  expect(await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'finance', id: owner })).toMatchObject({ ok: true })
  expect(await post(a, '/__dsh_a2a/superagent', { action: 'settings', settings: { canvas: 'finance', router: owner, sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [] } } })).toMatchObject({ ok: true })
  await vi.waitFor(async () => { expect((await get(a, '/__dsh_a2a/superagent')).a2a.health['a2a-deposit']?.state).toBe('ready') }, { timeout: 20000 })
}
function fixtureCard() { const { privateKey } = generateKeyPairSync('ed25519'); const card: any = { ...signCard({ name: 'D', session: 'fixture-D', team: 'dsh', capabilities: { route: true, async: true }, expiresAt: Date.now() + 3600000 }, privateKey), peers: [], sessionTeams: [{ team: caller, name: 'remote session', description: '' }] }; return { privateKey, card } }
async function direct(a: MeshNode, d: any, privateKey: any, task: string) {
  const url = a.baseUrl + '/a2a/direct', body = JSON.stringify({ team: 'dsh/canvas/finance', caller_session: caller, callback: caller, task_id: task, message: 'intake regression fixture', wait: false })
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signOriginClaim({ url, method: 'POST', body }, { caller: 'dsh', callerUrl: d.baseUrl, privateKey, unbound: false, now: Date.now() }) }, body })
  return { status: response.status, body: await response.json() as any }
}
const senderCards = async (a: MeshNode) => ((await get(a, '/__dsh_a2a/superagent/decisions')).decisions as any[]).filter(c => c.source === 'sender').length

it('F1: an unrelated bare legacy reference does not link a stranger host for intake (with or without it, refused)', async () => {
  for (const legacy of [false, true]) {
    const { privateKey, card } = fixtureCard(); const d = await ghostNode(card)
    const home = legacy ? seedCanvasHistory(tmpHome(), [{ name: 'unrelated-old-link', members: ['dsh/bbbbbbbb'] }]) : tmpHome()
    const a = await bootNode({ name: 'A', session: 'A', team: 'dsh', agentId: owner, port: await reservePort(), home, peers: [d.baseUrl], sessionNodes: true, superagent: true, cardCacheTtlMs: 3600000, remoteRowsTtlMs: 3600000 } as never)
    try {
      await readyTeam(a)
      await vi.waitFor(async () => { const rows = (await get(a, '/__dsh_a2a/state')).peers; expect(rows.find((p: any) => p.url === d.baseUrl)).toMatchObject({ verified: true }) }, { timeout: 10000 })
      const result = await direct(a, d, privateKey, legacy ? 'direct-intake-legacy-zone' : 'direct-intake-no-link')
      expect(result.body.routed, JSON.stringify(result)).not.toBe(true)
      await new Promise(r => setTimeout(r, 1500))
      expect(await senderCards(a)).toBe(0)
    } finally { await a.dispose(); await d.close() }
  }
}, 150000)

it('F2: a bilaterally linked host whose current card no longer lists the caller is refused; listing it again lets it through', async () => {
  const { privateKey, card } = fixtureCard(); const d = await ghostNode(card)
  const port = await reservePort(); const aUrl = 'http://127.0.0.1:' + port
  card.peers = [aUrl]
  const a = await bootNode({ name: 'A', session: 'A', team: 'dsh', agentId: owner, port, home: tmpHome(), peers: [d.baseUrl], sessionNodes: true, superagent: true, cardCacheTtlMs: 3600000, remoteRowsTtlMs: 3600000 } as never)
  try {
    await readyTeam(a)
    await vi.waitFor(async () => { const rows = (await get(a, '/__dsh_a2a/state')).peers; expect(rows.find((p: any) => p.url === d.baseUrl)).toMatchObject({ verified: true, link: 'linked' }) }, { timeout: 10000 })
    // The warm cache lists the caller; the host's current card does not.
    card.sessionTeams = []
    const stale = await direct(a, d, privateKey, 'direct-intake-stale-session')
    expect(stale.body.routed, JSON.stringify(stale)).not.toBe(true)
    // The legitimate path: the current card lists the caller again.
    card.sessionTeams = [{ team: caller, name: 'remote session', description: '' }]
    const fresh = await direct(a, d, privateKey, 'direct-intake-current-session')
    expect(fresh.body.routed, JSON.stringify(fresh)).toBe(true)
    await vi.waitFor(async () => { expect(await senderCards(a)).toBe(1) }, { timeout: 40000 })
  } finally { await a.dispose(); await d.close() }
}, 150000)
