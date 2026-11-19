/**
 * #747 review R1: a deposited CLI routed through its home host to a host whose correspondence window is full gets the
 * typed refusal in the home host's HTTP answer (forwardMiss), sync and async — not only the prose. Nothing reaches B.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, createPrivateKey } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { signCard } from '../../src/card.ts'
import { seedCanvasHistory } from '../fixtures/canvas-history.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { guardHeader } from '../../src/recursion-guard.ts'
import { bootNode, postJson, reservePort, tmpHome, type MeshNode, cliEnv } from './harness.ts'
import { mkdirSync } from 'node:fs'
import { TaskLedger } from '../../src/task-ledger.ts'
import { TASK_DELIVERY_CAP as CAP, type TaskDelivery } from '../../src/task-delivery.ts'
const handle = 'ops-cli/a1b2c3d4e5f60718'
const cliKey = generateKeyPairSync('ed25519').privateKey
beforeEach(() => vi.stubGlobal('WebSocket', function noSocket() { throw Error('no socket') }))
afterEach(() => vi.unstubAllGlobals())
const post = async (node: MeshNode, path: string, body: unknown): Promise<Record<string, any>> => await (await postJson(node.baseUrl, path, body)).json() as Record<string, any>
function fullHome(): string {
  const home = tmpHome(), dir = join(home, 'a2a'), file = join(dir, 'tasks.json')
  mkdirSync(dir, { recursive: true })
  const row = (i: number): TaskDelivery => ({ version: 1, taskId: 'seed-' + String(i), sessionId: 'session-ffffffff00001111', messageId: 'seed-message-' + String(i), fingerprint: 'b'.repeat(64), createdAt: Date.now(), state: 'cancelled' })
  new TaskLedger(file, { warn: () => {} }).reserveDelivery(row(0))
  const snap = JSON.parse(readFileSync(file, 'utf8')) as { taskDeliveries: TaskDelivery[] }
  snap.taskDeliveries = Array.from({ length: CAP }, (_, i) => row(i))
  writeFileSync(file, JSON.stringify(snap))
  return home
}
async function fixture(options: { enabled?: boolean; isolated?: boolean; linked?: boolean; longReply?: boolean } = {}, bHome?: string) {
  const pa = await reservePort(), pb = await reservePort()
  const a = await bootNode({ name: 'A', session: 'cli-forward-a', team: 'alpha', port: pa, peers: ['http://127.0.0.1:' + pb], sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, forwardDirect: options.enabled !== false, isolated: options.isolated === true, cardCacheTtlMs: 0 })
  const b = await bootNode({ ...(bHome !== undefined ? { home: bHome } : {}), name: 'B', session: 'cli-forward-b', team: 'beta', port: pb, peers: [a.baseUrl], sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, ...(options.longReply ? { flushTimeoutMs: 30000 } : {}) })
  const card = JSON.stringify(signCard({ name: 'ops-cli', session: 'cli-ops', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, cliKey))
  expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
  expect((await postJson(b.baseUrl, '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })).status).toBe(200)
  if (options.linked !== false) {
    expect((await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle })).ok).toBe(true)
    expect((await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: 'beta/01234567' })).ok).toBe(true)
    expect((await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: a.baseUrl })).ok).toBe(true)
  }
  return { a, b }
}
async function route(a: MeshNode, id: string, noWait = true, guard?: string, team = 'beta/01234567', message = 'forward report') {
  const url = a.baseUrl + '/a2a/direct'
  const headers = signOriginClaim({ url, method: 'POST' }, { caller: 'ops-cli', callerUrl: a.baseUrl + '/a2a/cli/' + encodeURIComponent(handle), privateKey: cliKey, unbound: false, now: Date.now() })
  return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers, ...(guard === undefined ? {} : { 'X-A2A-Guard': guard }) }, body: JSON.stringify({ team, message, caller_session: handle, task_id: id, context_id: 'cli-context', wait: !noWait }) }).then(async r => await r.json() as Record<string, any>)
}
describe('#747 R1: the home host forward answer carries the typed capacity refusal', () => {
  for (const noWait of [true, false]) it(`wait=${String(!noWait)}: refusal and count reach the CLI, nothing reaches B`, async () => {
    const { a, b } = await fixture({}, fullHome())
    try {
      const out = await route(a, 'direct-747-' + (noWait ? 'async' : 'sync'), noWait) as Record<string, any>
      expect(out.code).toBe(-32004)
      expect(out.task_id).toBe('direct-747-' + (noWait ? 'async' : 'sync'))
      expect(String(out.error)).toContain('nothing was sent')
      expect(out.refusal).toMatchObject({ code: 'correspondence-capacity', notSent: true, capacity: { status: 'observed', saturated: true } })
      expect(out.capacityRefusals).toBe(1)
      expect(out.acceptance).toBeUndefined()
      expect(JSON.stringify(out.refusal)).not.toMatch(/seed-|session-f/)
      expect(b.steered).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
})
