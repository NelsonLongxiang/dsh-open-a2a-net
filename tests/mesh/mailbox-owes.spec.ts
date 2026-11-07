// @vitest-environment node
/**
 * superagent p1-mailbox-owes (S33) on a real host: a CLI identity whose signed card declares `owes` gets deliveries
 * answered `delivered` (not final). The caller books a debt, this host keeps an owed inbound row the per-target cap
 * (3, per identity, across callers) counts, and only the identity's own receipt frees the slot. A resend replays, an
 * owed row expires with the ordinary stale sweep, both survive a restart, and the mailbox cap evicts an owed row into
 * the archive. A deposit without the declaration keeps today's final mailbox. Throwaway keys; loopback host only.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from '../temp-dirs.ts'
import { bootNode, cliEnv, postJson, reservePort, runContext, tmpHome, type MeshNode } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { MAILBOX_CAP } from '../../src/cli-deposit.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

type Id = { name: string; uuid: string; key: KeyObject }
const ident = (name: string, uuid: string): Id => ({ name, uuid, key: generateKeyPairSync('ed25519').privateKey })
const handleOf = (id: Id) => `${id.name}/${id.uuid}`
const OWER = ident('owes-src', 'a1b2c3d4e5f60810')
const PLAIN = ident('plain-src', 'a1b2c3d4e5f60811')
const WRITERS = [0, 1, 2, 3, 4].map(i => ident(`owes-w${String(i)}`, `a1b2c3d4e5f6082${String(i)}`))
const OTHER = ident('owes-other', 'a1b2c3d4e5f60830')

const deposit = async (node: MeshNode, id: Id, owes: boolean) => {
  const card = signCard({ name: id.name, session: `cli-${id.name}`, team: handleOf(id), capabilities: { route: true, async: true, ...(owes ? { owes: true } : {}) }, expiresAt: Date.now() + 172_800_000 }, id.key)
  const out = await (await postJson(node.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'publish', card: JSON.stringify(card) })).json() as { ok?: boolean }
  expect(out.ok).toBe(true)
}
/** A signed CLI delivery to `team` on `node`'s wire face, as the a2a-net CLI sends it. */
const send = async (node: MeshNode, from: Id, team: string, taskId: string, message = `work ${taskId}`) => {
  const callerUrl = `${node.baseUrl}/a2a/cli/${encodeURIComponent(handleOf(from))}`
  const ts = Date.now()
  const sig = edSign(undefined, Buffer.from(JSON.stringify([from.name, callerUrl, ts])), from.key).toString('base64')
  const res = await fetch(`${node.baseUrl}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': from.name, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': sig }, body: JSON.stringify({ team, message, caller_session: handleOf(from), task_id: taskId, context_id: `ctx-${taskId}`, wait: false }) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
const state = async (node: MeshNode) => await fetch(`${node.baseUrl}/__dsh_a2a/state`).then(r => r.json()) as { tasks: Array<Record<string, unknown>>; archived: Array<Record<string, unknown>> }
const owedIn = async (node: MeshNode, team: string) => (await state(node)).tasks.filter(t => t.direction === 'inbound' && t.team === team && t.status === 'pending' && t.answeredAt === undefined)
const mailbox = async (node: MeshNode, id: Id) => (await (await postJson(node.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle: handleOf(id) })).json() as { mail: Array<{ task_id?: string }> }).mail
function cliHome(node: MeshNode, id: Id): string {
  const home = mkdtempSync(join(process.cwd(), 'tmp', 'mailbox-owes-'))
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: id.name, uuid: id.uuid, handle: handleOf(id), home: node.baseUrl, privateKeyPem: id.key.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
  return home
}
const cli = (home: string, args: string[]) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
  let stdout = '', stderr = ''
  child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
  child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
})

describe('superagent p1-mailbox-owes: a deposit that owes receipts', () => {
  it('delivered, booked, capped at 3 per identity, freed only by its own receipt; resend replays; a plain deposit stays final', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
    const a = await bootNode({ name: 'A', session: 'mesh-owes', team: 'dsh', sessionNodes: true, port: await reservePort() })
    try {
      for (const id of [OWER, PLAIN, ...WRITERS, OTHER]) await deposit(a, id, id === OWER)
      const [w0, w1] = WRITERS as [Id, Id]
      // D-2: delivered, not final, with the mailbox marker; this host keeps the owed inbound row.
      const first = await send(a, w0, handleOf(OWER), 'o-1')
      expect(first.body).toMatchObject({ delivered: true, receipt: 'mailbox', task_status: 'TASK_STATE_DELIVERED', task_id: 'o-1' })
      expect((await owedIn(a, handleOf(OWER))).map(t => t.taskId)).toEqual(['o-1'])
      // A deposit without the declaration: final as before, no inbound row, no cap.
      for (const n of [1, 2, 3, 4]) expect((await send(a, w0, handleOf(PLAIN), `p-${String(n)}`)).body).toMatchObject({ receipt: 'mailbox', task_status: 'TASK_STATE_COMPLETED' })
      expect(await owedIn(a, handleOf(PLAIN))).toEqual([])
      // (e) the cap counts per identity across callers: two more from another caller fill it; the fourth is refused, nothing delivered.
      expect((await send(a, w1, handleOf(OWER), 'o-2')).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      expect((await send(a, w1, handleOf(OWER), 'o-3')).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      const full = await send(a, w0, handleOf(OWER), 'o-4')
      expect(full.body).toMatchObject({ code: -32009 })
      expect(String(full.body.error)).toContain('target-queue-full')
      expect((await mailbox(a, OWER)).map(m => m.task_id)).not.toContain('o-4')
      // (b) a same-payload resend of a task still owed reads as the first answer did (a caller whose first answer was
      // lost books the debt now), and writes nothing again: one mailbox row, one inbound row, no extra slot.
      const resend = await send(a, w0, handleOf(OWER), 'o-1')
      expect(resend.status).toBe(200)
      expect(resend.body).toEqual(first.body)
      expect((await mailbox(a, OWER)).filter(m => m.task_id === 'o-1')).toHaveLength(1)
      expect((await state(a)).tasks.filter(t => t.taskId === 'o-1')).toHaveLength(1)
      expect((await owedIn(a, handleOf(OWER))).map(t => t.taskId).sort()).toEqual(['o-1', 'o-2', 'o-3'])
      // The real CLI's retry with the same id and message reads as an ordinary delivery.
      const replayed = await cli(cliHome(a, w0), ['route', handleOf(OWER), 'work o-1', '--task', 'o-1', '--context', 'ctx-o-1'])
      expect(replayed.code, replayed.stderr).toBe(0)
      expect(replayed.stdout).toContain(`delivered → ${handleOf(OWER)} · task o-1`)
      expect((await mailbox(a, OWER)).filter(m => m.task_id === 'o-1')).toHaveLength(1)
      // Another caller with the same id and message is not the one owed. The idempotency fingerprint binds the caller,
      // so it is a conflict (409, replay false) before the owed-resend branch: nothing booked, nothing revealed.
      const stranger = await send(a, w1, handleOf(OWER), 'o-1')
      expect(stranger.status).toBe(409)
      expect(stranger.body).toMatchObject({ replay: false })
      expect(stranger.body).not.toHaveProperty('task_status')
      expect((await send(a, w0, handleOf(OWER), 'o-1')).body).toEqual(first.body)
      expect((await mailbox(a, OWER)).filter(m => m.task_id === 'o-1')).toHaveLength(1)
      // A different payload under the same id is still a conflict, never a delivery.
      expect((await send(a, w0, handleOf(OWER), 'o-1', 'something else')).status).toBe(409)
      // (a) another identity's receipt-shaped message for o-2 frees nothing.
      expect((await send(a, OTHER, handleOf(w1), 'fake-o-2', '[A2A receipt] task o-2 done')).body).toMatchObject({ delivered: true })
      expect((await owedIn(a, handleOf(OWER))).map(t => t.taskId).sort()).toEqual(['o-1', 'o-2', 'o-3'])
      // D-3: the identity's own receipt (the real CLI) answers its row and frees the slot; a new task then goes through.
      const own = await cli(cliHome(a, OWER), ['receipt', 'o-2', 'done'])
      expect(own.code, own.stderr).toBe(0)
      expect((await owedIn(a, handleOf(OWER))).map(t => t.taskId).sort()).toEqual(['o-1', 'o-3'])
      // Once answered, a resend of o-2 is the ordinary replay again: nothing is owed any more.
      expect(await send(a, w1, handleOf(OWER), 'o-2')).toMatchObject({ status: 409, body: { replay: true } })
      expect((await send(a, w0, handleOf(OWER), 'o-5')).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      expect((await send(a, w0, handleOf(OWER), 'o-6')).body).toMatchObject({ code: -32009 })
    } finally {
      await a.dispose()
    }
  }, 90_000)

  it('(a) under settlementAuth enforce the identity\'s own receipt still frees its slot; a stranger\'s still does not', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-owes-enforce', team: 'dsh', sessionNodes: true, settlementAuth: 'enforce', port: await reservePort() })
    try {
      for (const id of [OWER, ...WRITERS, OTHER]) await deposit(a, id, id === OWER)
      for (const n of [1, 2, 3]) expect((await send(a, WRITERS[0]!, handleOf(OWER), `f-${String(n)}`)).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      await send(a, OTHER, handleOf(WRITERS[0]!), 'fake-f-2', '[A2A receipt] task f-2 done')
      expect((await owedIn(a, handleOf(OWER))).map(t => t.taskId).sort()).toEqual(['f-1', 'f-2', 'f-3'])
      expect((await cli(cliHome(a, OWER), ['receipt', 'f-2', 'done'])).code).toBe(0)
      expect((await owedIn(a, handleOf(OWER))).map(t => t.taskId).sort()).toEqual(['f-1', 'f-3'])
      expect((await send(a, WRITERS[0]!, handleOf(OWER), 'f-4')).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      // Keyed on the row, not the live deposit: once the identity's deposit is gone, a stranger still cannot settle what it owed.
      expect(((await (await postJson(a.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'revoke', handle: handleOf(OWER) })).json()) as { ok?: boolean }).ok).toBe(true)
      await send(a, OTHER, handleOf(WRITERS[0]!), 'fake-f-1', '[A2A receipt] task f-1 done')
      expect((await owedIn(a, handleOf(OWER))).map(t => t.taskId)).toContain('f-1')
    } finally {
      await a.dispose()
    }
  }, 60_000)

  it('D-4 in process: a same-host caller owes the debt (its local row is the slot); the identity\'s receipt settles it', async () => {
    const SID = 'session-0123456789abcdef'
    const a = await bootNode({ name: 'A', session: 'mesh-owes-local', team: 'dsh', agentId: SID, sessionNodes: true, teamScopeRouting: false, teamScopeInfo: false, port: await reservePort() })
    try {
      await deposit(a, OWER, true)
      expect((await postJson(a.baseUrl, '/__dsh_a2a/join', { id: SID })).status).toBe(200)
      // The operator links the session and the identity in one canvas: the joined face's team membership.
      for (const id of [SID, handleOf(OWER)]) { const r = await (await postJson(a.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })).json() as { ok?: boolean }; expect(r.ok, JSON.stringify(r)).toBe(true) }
      const tool = a.ctx.tools.get('a2a_route')! as unknown as { execute: (args: unknown, ctx: unknown) => Promise<Record<string, unknown>> }
      const out = await tool.execute({ team: handleOf(OWER), message: 'please answer', async: true }, runContext(a.agents.agent))
      expect(out, JSON.stringify(out)).toMatchObject({ ok: true, task_status: 'TASK_STATE_DELIVERED' })
      const taskId = String(out.task_id)
      // One ledger on one host: the caller's own owed row (peer local) is the debt and the slot the cap counts.
      const s = await state(a)
      expect(s.tasks.filter(t => t.taskId === taskId)).toEqual([expect.objectContaining({ team: handleOf(OWER), peer: 'local', status: 'pending' })])
      expect((s.tasks.find(t => t.taskId === taskId) as { receiptExpected?: boolean }).receiptExpected).not.toBe(false)
      // The cap counts the same-host caller's rows: two more fill it, the fourth is refused before delivery.
      for (const n of [1, 2]) expect(await tool.execute({ team: handleOf(OWER), message: `more ${String(n)}`, async: true }, runContext(a.agents.agent))).toMatchObject({ ok: true, task_status: 'TASK_STATE_DELIVERED' })
      expect(await tool.execute({ team: handleOf(OWER), message: 'one too many', async: true }, runContext(a.agents.agent))).toMatchObject({ ok: false, code: -32009 })
      // (a) a stranger's receipt header for the task leaves the caller's row (the slot) alone.
      await deposit(a, OTHER, false)
      await send(a, OTHER, handleOf(OTHER), 'fake-local', `[A2A receipt] task ${taskId} done`)
      expect((await state(a)).tasks.filter(t => t.taskId === taskId)).toHaveLength(1)
      const own = await cli(cliHome(a, OWER), ['receipt', taskId, 'answered'])
      expect(own.code, own.stderr).toBe(0)
      await vi.waitFor(async () => { expect((await state(a)).archived.find(r => r.taskId === taskId)).toMatchObject({ endedBy: 'receipt' }) })
      expect((await state(a)).tasks.filter(t => t.taskId === taskId)).toEqual([])
    } finally {
      await a.dispose()
    }
  }, 60_000)

  it('(c) an owed row expires with the stale sweep and its slot comes back', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-owes-ttl', team: 'dsh', sessionNodes: true, taskStaleTtlMs: 1500, port: await reservePort() })
    try {
      for (const id of [OWER, ...WRITERS]) await deposit(a, id, id === OWER)
      for (const n of [1, 2, 3]) expect((await send(a, WRITERS[0]!, handleOf(OWER), `t-${String(n)}`)).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      expect((await send(a, WRITERS[0]!, handleOf(OWER), 't-4')).body).toMatchObject({ code: -32009 })
      await vi.waitFor(async () => { expect((await send(a, WRITERS[1]!, handleOf(OWER), `t-late-${String(Date.now())}`)).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' }) }, { timeout: 8000, interval: 500 })
      // An expired row is owed no more: its resend is the ordinary replay, not a fresh 'delivered'.
      expect(await send(a, WRITERS[0]!, handleOf(OWER), 't-1')).toMatchObject({ status: 409, body: { replay: true } })
    } finally {
      await a.dispose()
    }
  }, 60_000)

  it('(d) the declaration and the owed rows survive a restart: still delivered, the cap still counts them', async () => {
    const home = tmpHome()
    const port = await reservePort()
    const first = await bootNode({ name: 'A', session: 'mesh-owes-restart', team: 'dsh', sessionNodes: true, home, port })
    try {
      for (const id of [OWER, ...WRITERS]) await deposit(first, id, id === OWER)
      for (const n of [1, 2]) expect((await send(first, WRITERS[0]!, handleOf(OWER), `r-${String(n)}`)).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
    } finally {
      await first.dispose()
    }
    const again = await bootNode({ name: 'A', session: 'mesh-owes-restart', team: 'dsh', sessionNodes: true, home, port: await reservePort() })
    try {
      expect((await owedIn(again, handleOf(OWER))).map(t => t.taskId).sort()).toEqual(['r-1', 'r-2'])
      expect((await send(again, WRITERS[1]!, handleOf(OWER), 'r-3')).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      expect((await send(again, WRITERS[1]!, handleOf(OWER), 'r-4')).body).toMatchObject({ code: -32009 })
    } finally {
      await again.dispose()
    }
  }, 60_000)

  it('D-5: the mailbox cap pushes out an owed row; its inbound row goes to the archive as evicted and frees the slot', async () => {
    // The cap is lifted here only to fill the 64-row mailbox with owed rows; the flood guard spreads them over 5 callers.
    const a = await bootNode({ name: 'A', session: 'mesh-owes-evict', team: 'dsh', sessionNodes: true, targetQueueCap: 1000, port: await reservePort() })
    try {
      for (const id of [OWER, ...WRITERS]) await deposit(a, id, id === OWER)
      for (let i = 0; i <= MAILBOX_CAP; i += 1) expect((await send(a, WRITERS[Math.floor(i / 15)]!, handleOf(OWER), `e-${String(i)}`)).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      const s = await state(a)
      expect(s.archived.find(r => r.taskId === 'e-0')).toMatchObject({ endedBy: 'evicted', summary: 'mailbox-evicted', direction: 'inbound' })
      expect((await owedIn(a, handleOf(OWER))).map(t => t.taskId)).not.toContain('e-0')
      expect(await owedIn(a, handleOf(OWER))).toHaveLength(MAILBOX_CAP)
    } finally {
      await a.dispose()
    }
  }, 90_000)

  it('D-1: `a2a-net publish --owes` signs the declaration; a plain publish withdraws it', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-owes-publish', team: 'dsh', sessionNodes: true, port: await reservePort() })
    try {
      await deposit(a, WRITERS[0]!, false)
      const home = cliHome(a, OWER)
      expect((await cli(home, ['publish', '--owes'])).code).toBe(0)
      expect((await send(a, WRITERS[0]!, handleOf(OWER), 'd-1')).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      expect((await cli(home, ['publish'])).code).toBe(0)
      expect((await send(a, WRITERS[0]!, handleOf(OWER), 'd-2')).body).toMatchObject({ task_status: 'TASK_STATE_COMPLETED' })
    } finally {
      await a.dispose()
    }
  }, 60_000)
})
