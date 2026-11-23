// @vitest-environment node
/**
 * 3.65 (2026-11-23): a CLI identity's receipt forwarded by its home host settled the owed inbound row before the forward,
 * so a refused forward (delivery not-sent) left the row archived as completed while nothing was sent, and the transport id
 * recorded as failed made the outbox's resend a replay the CLI reads as gone. Settle only after the forward went out; a
 * not-sent refusal frees the receipt's transport id for a resend.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, createPrivateKey } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { bootNode, reservePort, type MeshNode, cliEnv } from './harness.ts'

beforeEach(() => vi.stubGlobal('WebSocket', function noSocket() { throw Error('no socket') }))
afterEach(() => vi.unstubAllGlobals())

const handle = 'owing-cli/a1b2c3d4e5f60911'
const privateKey = generateKeyPairSync('ed25519').privateKey
const targetId = 'session-bbbbbbbb55556666'
const targetHandle = 'beta/bbbbbbbb'
const post = async (node: MeshNode, path: string, body: unknown): Promise<any> => await fetch(node.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => await r.json())
const state = async (node: MeshNode): Promise<any> => await fetch(node.baseUrl + '/__dsh_a2a/state').then(async r => await r.json())
const cli = async (home: string, args: string[]) => await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
  const p = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
  let stdout = ''
  p.stdout.on('data', x => { stdout += String(x) }); p.on('error', reject); p.on('close', code => resolve({ code, stdout }))
})
/** A request to A's /a2a/direct signed by B's node key, as B's host sends one. */
async function fromB(a: MeshNode, b: MeshNode, body: unknown): Promise<any> {
  const url = a.baseUrl + '/a2a/direct', raw = JSON.stringify(body)
  const key = createPrivateKey(readFileSync(join(b.home, 'a2a', 'node-key.pem'), 'utf8'))
  const headers = signOriginClaim({ url, method: 'POST', body: raw }, { caller: 'beta', callerUrl: b.baseUrl, privateKey: key, unbound: false, now: Date.now() })
  return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw }).then(async r => await r.json())
}
async function setup(forwardDirect = true) {
  const pa = await reservePort(), pb = await reservePort()
  const opts = { sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, forwardDirect: true, cardCacheTtlMs: 0 }
  const a = await bootNode({ name: 'A', session: 'owing-home', team: 'alpha', port: pa, peers: ['http://127.0.0.1:' + String(pb)], ...opts, forwardDirect })
  const b = await bootNode({ name: 'B', session: 'requester', team: 'beta', agentId: targetId, port: pb, peers: [a.baseUrl], ...opts })
  const home = mkdtempSync(join(tmpdir(), 'owing-cli-'))
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: 'owing-cli', uuid: 'a1b2c3d4e5f60911', handle, home: a.baseUrl, privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 })
  // The identity owes receipts: a delivery to it books an inbound row on A until its own receipt settles it.
  const card = JSON.stringify(signCard({ name: 'owing-cli', session: 'cli-owing', team: handle, capabilities: { route: true, async: true, owes: true }, expiresAt: Date.now() + 172_800_000 }, privateKey))
  expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
  await post(b, '/__dsh_a2a/join', { id: targetId })
  for (const id of [handle, targetHandle]) await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })
  expect((await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: a.baseUrl })).ok).toBe(true)
  await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: targetId })
  const agent = b.agents.agent as any
  agent.steer = (payload: any) => { b.steered.push(payload) }
  return { a, b, home }
}
/** B's task to the owing identity on A: A books the inbound row the identity owes. */
async function owe(a: MeshNode, b: MeshNode, task: string): Promise<void> {
  const sent = await fromB(a, b, { team: handle, caller_session: targetHandle, task_id: task, message: 'please reconcile', wait: false })
  expect(sent.routed ?? sent.delivered, JSON.stringify(sent)).toBe(true)
  await vi.waitFor(async () => expect((await state(a)).tasks.find((r: any) => r.taskId === task)).toMatchObject({ direction: 'inbound', status: 'pending' }), { timeout: 4000 })
}

describe('3.65: a forwarded CLI receipt settles the owed row only once it went out', () => {
  it('a not-sent refusal leaves the row owed and the same receipt can be sent again (never gone)', async () => {
    // Forwarding off on the home host: the forward is refused at its first check, before any dispatch (delivery not-sent),
    // the same refusal class as 3.65's team-scope refusal. Delivering B's task into the mailbox needs no forwarding.
    const { a, b, home } = await setup(false)
    const task = 'owed-refused-1'
    try {
      await owe(a, b, task)
      const first = await cli(home, ['receipt', task, '--to', targetHandle, '--json', '--exit-class', 'done'])
      expect(first.code, first.stdout).toBe(1)
      expect(JSON.parse(first.stdout)).toMatchObject({ delivery: 'not-sent', class: 'retry', error: expect.stringContaining('forwardDirect is off') })
      const s = await state(a)
      expect(s.tasks.find((r: any) => r.taskId === task)).toMatchObject({ direction: 'inbound', status: 'pending' })
      expect(s.archived.find((r: any) => r.taskId === task)).toBeUndefined()
      // The outbox's resend: the same receipt again is a fresh attempt, not a replay of a failed one (exit 4, gone).
      const again = await cli(home, ['receipt', task, '--to', targetHandle, '--json', '--exit-class', 'done'])
      expect(again.code, again.stdout).toBe(1)
      expect(JSON.parse(again.stdout).class).toBe('retry')
      expect((await state(a)).tasks.find((r: any) => r.taskId === task)).toMatchObject({ status: 'pending' })
    } finally { await a.dispose(); await b.dispose() }
  }, 40000)

  it('control: a receipt the forward delivered settles the owed row (endedBy receipt)', async () => {
    const { a, b, home } = await setup()
    const task = 'owed-delivered-1'
    try {
      await owe(a, b, task)
      const sent = await cli(home, ['receipt', task, '--to', targetHandle, '--json', '--exit-class', 'done'])
      expect(sent.code, sent.stdout).toBe(0)
      await vi.waitFor(async () => expect((await state(a)).archived.find((r: any) => r.taskId === task)).toMatchObject({ endedBy: 'receipt' }), { timeout: 4000 })
      expect((await state(a)).tasks.find((r: any) => r.taskId === task)).toBeUndefined()
    } finally { await a.dispose(); await b.dispose() }
  }, 40000)
})
