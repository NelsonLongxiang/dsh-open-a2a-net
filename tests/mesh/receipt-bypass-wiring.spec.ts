// @vitest-environment node
/**
 * #853 re-review (issuecomment-7094212785 §4, second part): what src/index.ts wires into createDirectForward, and what
 * wire.ts forwardMiss does when the receiver refuses the settlement. The receipt-of-admitted bypass only applies to an
 * inbound row that carries its admission record; a CLI mailbox owes row carries none (wire.ts trackInbound), so the home
 * host's ledger is seeded with such a row (a record parseAuthorization accepts, booked as the wire would book it) and the
 * rest runs as in production: the real CLI, the home host's real forward, the real receiver.
 * F1e (the journal slot freed when nothing is settled) is not tested here: on both forwardMiss paths the response's close
 * handler (wire.ts, wakePending stays false there) frees the same slot, so dropping that release changes nothing observable.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { signCard } from '../../src/card.ts'
import { TaskLedger } from '../../src/task-ledger.ts'
import { buildAuthorization, parseAuthorization } from '../../src/task-auth.ts'
import { bootNode, reservePort, cliEnv, type MeshNode } from './harness.ts'

beforeEach(() => vi.stubGlobal('WebSocket', function noSocket() { throw Error('no socket') }))
afterEach(() => vi.unstubAllGlobals())

const handle = 'owing-cli/a1b2c3d4e5f60911', targetId = 'session-bbbbbbbb55556666', targetHandle = 'beta/bbbbbbbb'
const privateKey = generateKeyPairSync('ed25519').privateKey
const post = async (node: MeshNode, path: string, body: unknown): Promise<any> => await fetch(node.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => await r.json())
const state = async (node: MeshNode): Promise<any> => await fetch(node.baseUrl + '/__dsh_a2a/state').then(async r => await r.json())
const cli = async (home: string, args: string[]) => await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
  const p = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
  let stdout = ''
  p.stdout.on('data', x => { stdout += String(x) }); p.on('error', reject); p.on('close', code => resolve({ code, stdout }))
})

/**
 * A: the CLI's home host, holding the task the CLI owes with its admission record (receipt target: B's member).
 * B: the requester's host. bOutboundTo books B's own outbound row for the same task to another team, so B (enforce)
 * refuses to let this CLI settle it.
 */
async function setup(task: string, a2aConfig: Record<string, unknown>, b: { enforce?: boolean; outboundTo?: string } = {}) {
  const pa = await reservePort(), pb = await reservePort()
  const homeA = mkdtempSync(join(tmpdir(), 'bypass-a-')), homeB = mkdtempSync(join(tmpdir(), 'bypass-b-'))
  mkdirSync(join(homeA, 'a2a'), { recursive: true }); mkdirSync(join(homeB, 'a2a'), { recursive: true })
  const auth = buildAuthorization({ ok: true, via: 'canvas-member', rule: 'canvas-shared', basis: ['alpha/canvas/ops'] }, { caller: targetHandle, proof: 'legacy-window', ingress: 'wire', allowlistVersion: 'al1:0123456789abcdef', target: handle, receiptTarget: targetHandle, receivedAt: Date.now() })
  expect(parseAuthorization(JSON.parse(JSON.stringify(auth)))).toBeDefined()
  new TaskLedger(join(homeA, 'a2a', 'tasks.json')).trackInbound(task, handle, targetHandle, 'ctx-' + task, true, 'synthetic owed task', auth)
  if (b.outboundTo !== undefined) new TaskLedger(join(homeB, 'a2a', 'tasks.json')).track(task, b.outboundTo, 'http://127.0.0.1:' + String(pa))
  const opts = { sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, forwardDirect: true, cardCacheTtlMs: 0 }
  const a = await bootNode({ name: 'A', session: 'owing-home', team: 'alpha', port: pa, home: homeA, peers: ['http://127.0.0.1:' + String(pb)], ...opts, ...a2aConfig })
  const nb = await bootNode({ name: 'B', session: 'requester', team: 'beta', agentId: targetId, port: pb, home: homeB, peers: [a.baseUrl], ...opts, ...(b.enforce === true ? { settlementAuth: 'enforce' as const } : {}) })
  const home = mkdtempSync(join(tmpdir(), 'owing-cli-'))
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: 'owing-cli', uuid: 'a1b2c3d4e5f60911', handle, home: a.baseUrl, privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 })
  const card = JSON.stringify(signCard({ name: 'owing-cli', session: 'cli-owing', team: handle, capabilities: { route: true, async: true, owes: true }, expiresAt: Date.now() + 172_800_000 }, privateKey))
  expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
  await post(nb, '/__dsh_a2a/join', { id: targetId })
  await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle })
  expect((await post(nb, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: a.baseUrl })).ok).toBe(true)
  await post(nb, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: targetId })
  ;(nb.agents.agent as any).steer = (payload: any) => { nb.steered.push(payload) }
  // The seeded row survived A's start with its record: the bypass can apply to it.
  expect((await state(a)).tasks.find((r: any) => r.taskId === task)).toMatchObject({ direction: 'inbound', status: 'pending', auth: { receipt_target: targetHandle } })
  return { a, b: nb, home }
}
const bypassRows = async (a: MeshNode): Promise<Array<[string, boolean]>> => ((await state(a)).activity ?? []).filter((x: any) => x.dir === 'fwd' && String(x.peer).startsWith('via=')).map((x: any) => [x.peer, x.ok])

describe('#853 re-review: createDirectForward wiring in src/index.ts (X1, W1–W5)', () => {
  it('the configured progress bounds reach the forwarder; each pass is audited with its kind, the one over the bound is warned', async () => {
    // Bounds no default would give: 3 per task, no interval. Under the defaults (20, 60 s apart) the 2nd–4th would be
    // over the bound; with the two values swapped (0 per task) all four would be.
    const task = 'wired-progress-1'
    const { a, b, home } = await setup(task, { receiptBypassProgressMax: 3, receiptBypassProgressIntervalMs: 0 })
    try {
      for (const n of [1, 2, 3, 4]) {
        const sent = await cli(home, ['receipt', task, '--progress', String(n), '--state', 'working', '--to', targetHandle, '--json', '--exit-class', 'done', 'step ' + String(n)])
        expect(sent.code, sent.stdout).toBe(0)
      }
      expect(await bypassRows(a)).toEqual([
        ['via=receipt-of-admitted:progress', true],
        ['via=receipt-of-admitted:progress', true],
        ['via=receipt-of-admitted:progress', true],
        ['via=receipt-of-admitted:progress:over-limit', false],
      ])
      // Progress settles nothing: the row is still owed.
      expect((await state(a)).tasks.find((r: any) => r.taskId === task)).toMatchObject({ status: 'pending' })
    } finally { await a.dispose(); await b.dispose() }
  }, 60000)
})

describe('#853 re-review F1c: a forwarded receipt the receiver refuses to settle leaves this host\'s owed row owed', () => {
  it('the receiver (enforce) answers settlement refused: the receipt was delivered, the owed row on the home host stays pending', async () => {
    const task = 'refused-settle-1'
    const { a, b, home } = await setup(task, {}, { enforce: true, outboundTo: 'alpha/zzzzzzzz' })
    try {
      const sent = await cli(home, ['receipt', task, '--to', targetHandle, '--json', '--exit-class', 'done', 'all done'])
      expect(sent.code, sent.stdout).toBe(0)
      expect(JSON.parse(sent.stdout)).toMatchObject({ delivered: true, forwarded: true })
      expect(await bypassRows(a)).toEqual([['via=receipt-of-admitted:result', true]])
      const s = await state(a)
      expect(s.tasks.find((r: any) => r.taskId === task)).toMatchObject({ direction: 'inbound', status: 'pending' })
      expect((s.archived ?? []).find((r: any) => r.taskId === task)).toBeUndefined()
      // B kept its own row: the refusal was B's, not a lost delivery.
      expect((await state(b)).tasks.find((r: any) => r.taskId === task)).toMatchObject({ direction: 'outbound', status: 'pending' })
    } finally { await a.dispose(); await b.dispose() }
  }, 60000)

  it('control: the same receipt to a receiver that does not refuse settles the owed row on the home host', async () => {
    const task = 'accepted-settle-1'
    const { a, b, home } = await setup(task, {}, { enforce: true })
    try {
      const sent = await cli(home, ['receipt', task, '--to', targetHandle, '--json', '--exit-class', 'done', 'all done'])
      expect(sent.code, sent.stdout).toBe(0)
      await vi.waitFor(async () => expect((await state(a)).archived?.find((r: any) => r.taskId === task)).toMatchObject({ endedBy: 'receipt' }), { timeout: 4000 })
      expect((await state(a)).tasks.find((r: any) => r.taskId === task)).toBeUndefined()
    } finally { await a.dispose(); await b.dispose() }
  }, 60000)
})
