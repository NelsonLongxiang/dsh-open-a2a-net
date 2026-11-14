// @vitest-environment node
/**
 * #697 review R1 (adapted from the reviewer's v3 counterexample, 3723d3d): an intake task's provenance is its own birth —
 * the origin and key of the host it was admitted from — written once and named by the team Source's signed admission
 * query. A later host with the same caller handle neither replaces it nor revives a task whose host is no longer linked,
 * and a query that names no task never counts as an intake link.
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootNode, ghostNode, mockGuiLogin, postJson, reservePort, tmpHome, type MeshNode } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { admissionQueryPayload } from '../../src/cli-deposit.ts'

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
function hostCard(session: string) {
  const { privateKey } = generateKeyPairSync('ed25519')
  const card: any = { ...signCard({ name: session, session, team: 'dsh', capabilities: { route: true, async: true }, expiresAt: Date.now() + 3600000 }, privateKey), peers: [], sessionTeams: [{ team: caller, name: 'remote session', description: '' }] }
  return { privateKey, card }
}
async function direct(a: MeshNode, host: any, privateKey: any, task: string) {
  const url = a.baseUrl + '/a2a/direct', body = JSON.stringify({ team: 'dsh/canvas/finance', caller_session: caller, callback: caller, task_id: task, message: 'intake provenance regression fixture', wait: false })
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signOriginClaim({ url, method: 'POST', body }, { caller: 'dsh', callerUrl: host.baseUrl, privateKey, unbound: false, now: Date.now() }) }, body })
  return await response.json() as any
}
/** The team identity's signed admission query, as `a2a-net admission <caller> [--task]` sends it. */
async function query(a: MeshNode, task?: string) {
  const identity = JSON.parse(readFileSync(join(a.home, 'a2a/superagent/team-cli/cli.json'), 'utf8'))
  const ts = Date.now(), handle = identity.handle, ingress = 'wire' as const
  const sig = sign(null, Buffer.from(admissionQueryPayload(handle, caller, ingress, ts, task)), createPrivateKey(identity.privateKeyPem)).toString('base64')
  return await post(a, '/__dsh_a2a/cli-deposit', { action: 'admission', handle, caller, ingress, ts, sig, ...(task !== undefined ? { task } : {}) })
}

it('B unlinks, then a namesake C is admitted: B\'s task stays not linked, C\'s own task is linked, a taskless query never is', async () => {
  const B = hostCard('host-B'), C = hostCard('host-C')
  const b = await ghostNode(B.card), c = await ghostNode(C.card)
  const port = await reservePort(), aUrl = 'http://127.0.0.1:' + port
  B.card.peers = [aUrl]; C.card.peers = [aUrl]
  const a = await bootNode({ name: 'A', session: 'A', team: 'dsh', agentId: owner, port, home: tmpHome(), peers: [b.baseUrl, c.baseUrl], sessionNodes: true, superagent: true, cardCacheTtlMs: 3600000, remoteRowsTtlMs: 3600000 } as never)
  try {
    await readyTeam(a)
    expect((await direct(a, b, B.privateKey, 'direct-birth-B')).routed).toBe(true)
    expect(await query(a, 'direct-birth-B')).toMatchObject({ ok: true, admitted: true, rule: 'superagent-intake' })
    // A query naming no task is never an intake link.
    expect(await query(a)).toMatchObject({ ok: true, admitted: false })
    // A replay of B's task id under C's key is refused: the birth is written once.
    expect((await direct(a, c, C.privateKey, 'direct-birth-B')).routed).not.toBe(true)

    // B withdraws the bilateral link; a fresh B attempt refreshes its card and is refused.
    B.card.peers = []
    expect((await direct(a, b, B.privateKey, 'direct-B-after-unlink')).routed).not.toBe(true)
    expect(await query(a, 'direct-birth-B')).toMatchObject({ ok: true, admitted: false })

    // C, linked, with the same handle, is admitted for its own task …
    expect((await direct(a, c, C.privateKey, 'direct-birth-C')).routed).toBe(true)
    expect(await query(a, 'direct-birth-C')).toMatchObject({ ok: true, admitted: true, rule: 'superagent-intake' })
    // … and does not revive B's task (its birth stays B's, unlinked).
    expect(await query(a, 'direct-birth-B')).toMatchObject({ ok: true, admitted: false })
    const rows = JSON.parse(readFileSync(join(a.home, 'a2a/superagent-intake.json'), 'utf8')).rows as Array<{ task: string; origin: string }>
    expect(rows.find(r => r.task === 'direct-birth-B')?.origin).toBe(new URL(b.baseUrl).origin)
    expect(rows.find(r => r.task === 'direct-birth-C')?.origin).toBe(new URL(c.baseUrl).origin)
    // Unknown task: fail closed.
    expect(await query(a, 'direct-never-seen')).toMatchObject({ ok: true, admitted: false })
  } finally { await a.dispose(); await b.close(); await c.close() }
}, 150000)
