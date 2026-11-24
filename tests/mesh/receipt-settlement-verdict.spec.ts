// @vitest-environment node
/**
 * #881 v2 B2 on a real host: every receipt row a CLI mailbox keeps carries the network ledger's verdict, on the wire face
 * and on the local (in-process) face alike. Only the identity owed the answer settles it; a stranger's receipt, a receipt
 * for a task not owed here, or a second receipt for a task already settled by another identity is `none`; a replay of the
 * owner's own receipt keeps `settled`. Throwaway keys; loopback host only.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import { bootNode, postJson, reservePort, runContext, type MeshNode } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { formatReceipt } from '../../src/receipt.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

type Id = { name: string; uuid: string; key: KeyObject }
const ident = (name: string, uuid: string): Id => ({ name, uuid, key: generateKeyPairSync('ed25519').privateKey })
const handleOf = (id: Id) => `${id.name}/${id.uuid}`
const CALLER = ident('verdict-caller', 'b1b2c3d4e5f60801'), OWER = ident('verdict-ower', 'b1b2c3d4e5f60802'), STRANGER = ident('verdict-stranger', 'b1b2c3d4e5f60803')

const deposit = async (node: MeshNode, id: Id, owes: boolean) => {
  const card = signCard({ name: id.name, session: `cli-${id.name}`, team: handleOf(id), capabilities: { route: true, async: true, ...(owes ? { owes: true } : {}) }, expiresAt: Date.now() + 172_800_000 }, id.key)
  expect((await (await postJson(node.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'publish', card: JSON.stringify(card) })).json() as { ok?: boolean }).ok).toBe(true)
}
const send = async (node: MeshNode, from: Id, team: string, taskId: string, message = `work ${taskId}`) => {
  const callerUrl = `${node.baseUrl}/a2a/cli/${encodeURIComponent(handleOf(from))}`
  const ts = Date.now()
  const sig = edSign(undefined, Buffer.from(JSON.stringify([from.name, callerUrl, ts])), from.key).toString('base64')
  const res = await fetch(`${node.baseUrl}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': from.name, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': sig },
    body: JSON.stringify({ team, message, caller_session: handleOf(from), wait: false, task_id: taskId }) })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
type Row = { task_id?: string; receipt_for?: string; settlement?: string; settlement_reason?: string }
const rowFor = async (node: MeshNode, id: Id, transport: string): Promise<Row | undefined> =>
  ((await (await postJson(node.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle: handleOf(id) })).json()) as { mail: Row[] }).mail.find(m => m.task_id === transport)

describe('#881 v2 B2: the ledger verdict on each receipt row (real host)', () => {
  it('wire: the owed identity settles; a stranger, an unknown task and a second settler are none; the owner\'s replay stays settled', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-verdict-wire', team: 'dsh', sessionNodes: true, port: await reservePort() })
    try {
      for (const id of [CALLER, OWER, STRANGER]) await deposit(a, id, id === OWER)
      expect((await send(a, CALLER, handleOf(OWER), 'v-1')).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      expect((await send(a, CALLER, handleOf(OWER), 'v-2')).body).toMatchObject({ task_status: 'TASK_STATE_DELIVERED' })
      // A stranger's receipt for a task another identity owes: delivered, settles nothing, says so.
      expect((await send(a, STRANGER, handleOf(CALLER), 'v-r-stranger', '[A2A receipt] task v-2 done')).body).toMatchObject({ delivered: true })
      expect(await rowFor(a, CALLER, 'v-r-stranger')).toMatchObject({ receipt_for: 'v-2', settlement: 'none', settlement_reason: 'not-payer' })
      // A receipt for a task nobody here owes.
      await send(a, STRANGER, handleOf(CALLER), 'v-r-unknown', '[A2A receipt] task v-404 done')
      expect(await rowFor(a, CALLER, 'v-r-unknown')).toMatchObject({ settlement: 'none', settlement_reason: 'not-owed' })
      // The owed identity's receipt settles its row.
      await send(a, OWER, handleOf(CALLER), 'v-r-1', '[A2A receipt] task v-1 done')
      expect(await rowFor(a, CALLER, 'v-r-1')).toMatchObject({ receipt_for: 'v-1', settlement: 'settled' })
      expect(await rowFor(a, CALLER, 'v-r-1')).not.toHaveProperty('settlement_reason')
      // Once settled, another identity's receipt for it is endorsed by nothing (wire.ts archived shortcut closed).
      await send(a, STRANGER, handleOf(CALLER), 'v-r-late', '[A2A receipt] task v-1 done')
      expect((await rowFor(a, CALLER, 'v-r-late'))?.settlement).not.toBe('settled')
      // The rows that are not receipts carry no verdict.
      expect(await rowFor(a, OWER, 'v-1')).not.toHaveProperty('settlement')
    } finally {
      await a.dispose()
    }
  }, 90_000)

  it('local: a receipt routed in-process into a CLI mailbox carries the verdict; one for a task not owed here is none', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-verdict-local', team: 'dsh', sessionNodes: true, teamScopeRouting: false, port: await reservePort(), reply: () => '' })
    try {
      await deposit(a, CALLER, false)
      const route = a.ctx.tools.get('a2a_route')!
      const unknown = await route.execute({ team: handleOf(CALLER), message: '[A2A receipt] task l-404 done' }, runContext()) as { ok?: boolean; task_id?: string }
      expect(unknown.ok, JSON.stringify(unknown)).toBe(true)
      const box = ((await (await postJson(a.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle: handleOf(CALLER) })).json()) as { mail: Row[] }).mail
      const row = box.find(m => m.receipt_for === 'l-404')
      expect(row).toMatchObject({ settlement: 'none', settlement_reason: 'not-owed' })
      // A plain local delivery is not a receipt: no verdict.
      await route.execute({ team: handleOf(CALLER), message: 'plain local note' }, runContext())
      const plain = ((await (await postJson(a.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle: handleOf(CALLER) })).json()) as { mail: Array<Row & { text: string }> }).mail.find(m => m.text.includes('plain local note'))
      expect(plain).toBeDefined()
      expect(plain).not.toHaveProperty('settlement')
    } finally {
      await a.dispose()
    }
  }, 90_000)
})

describe('#884 review: interim receipts are judged too, and a late answer to an ended task is never settled (real host)', () => {
  const TARGET = 'dsh/01234567'
  async function forgery(settlementAuth: 'observe' | 'enforce') {
    const a = await bootNode({ name: 'A', session: `mesh-verdict-forge-${settlementAuth}`, team: 'dsh', sessionNodes: true, teamScopeRouting: true, settlementAuth, port: await reservePort(), reply: () => '' })
    expect((await postJson(a.baseUrl, '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })).status).toBe(200)
    const ops = ident('ops-cli', 'aaaaaaaaaaaaaaaa'), evil = ident('evil-cli', 'bbbbbbbbbbbbbbbb')
    for (const id of [ops, evil]) await deposit(a, id, false)
    return { a, ops, evil }
  }
  const forgeInterim = async (settlementAuth: 'observe' | 'enforce', task: string, fields: Parameters<typeof formatReceipt>[2]) => {
    const f = await forgery(settlementAuth)
    expect((await send(f.a, f.ops, TARGET, task, 'real work')).body.delivered).toBe(true)
    const forged = await send(f.a, f.evil, handleOf(f.evil), `${task}-f`, formatReceipt(task, 'trust me', fields))
    return { ...f, forged, row: await rowFor(f.a, f.evil, `${task}-f`) }
  }

  it('observe: an off-chain acknowledgement or question marks nothing positive (none / settler-off-chain, never held)', async () => {
    for (const [task, fields] of [['direct-b1a00001', { disposition: 'acknowledged' }], ['direct-b1b00001', { disposition: 'attention', question: { id: 'q1', text: 'which option?', options: ['A', 'B'] } }]] as const) {
      const f = await forgeInterim('observe', task, fields as never)
      try {
        expect(f.row, task).toMatchObject({ receipt_for: task, settlement: 'none', settlement_reason: 'settler-off-chain' })
      } finally { await f.a.dispose() }
    }
  }, 120_000)

  it('enforce: an off-chain acknowledgement is refused on the row and on the sender\'s wire response', async () => {
    const f = await forgeInterim('enforce', 'direct-b1c00001', { disposition: 'acknowledged' })
    try {
      expect(f.row).toMatchObject({ receipt_for: 'direct-b1c00001', settlement: 'refused', settlement_reason: 'settler-off-chain' })
      expect(f.forged.body.settlement).toEqual({ status: 'refused', reason: 'settler-off-chain', task_id: 'direct-b1c00001' })
    } finally { await f.a.dispose() }
  }, 90_000)

  it('local: a late final receipt for an abandoned task is refused (task-ended), never settled', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-verdict-late', team: 'dsh', sessionNodes: true, teamScopeRouting: false, port: await reservePort(), reply: () => '' })
    try {
      expect((await postJson(a.baseUrl, '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })).status).toBe(200)
      await deposit(a, CALLER, false)
      expect((await send(a, CALLER, TARGET, 'direct-b2000001', 'real work')).body.delivered).toBe(true)
      expect((await postJson(a.baseUrl, '/__dsh_a2a/tasks/abandon', { task_id: 'direct-b2000001' })).status).toBe(200)
      const routed = await a.ctx.tools.get('a2a_route')!.execute({ team: handleOf(CALLER), message: formatReceipt('direct-b2000001', 'late result', { outcome: 'completed' }) }, runContext()) as { ok?: boolean }
      expect(routed.ok, JSON.stringify(routed)).toBe(true)
      const box = ((await (await postJson(a.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle: handleOf(CALLER) })).json()) as { mail: Row[] }).mail
      expect(box.find(m => m.receipt_for === 'direct-b2000001')).toMatchObject({ settlement: 'refused', settlement_reason: 'task-ended' })
    } finally { await a.dispose() }
  }, 90_000)
})
