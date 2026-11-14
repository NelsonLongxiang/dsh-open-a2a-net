/**
 * #690 re-review R1: a team MCP call's authority — the calling member, its running ticket and assignment, its seat, and its
 * team still offering the tool — is checked again after every wait and right before anything is sent. Real SuperagentHost,
 * real registered tool wrapper; generated node key, fake market and MCP transport.
 */
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SeatSigner } from '../../src/superagent/host/seat-token.ts'
import type { McpTransport } from '../../src/superagent/host/team-mcp.ts'
import { TeamMcpTools } from '../../src/superagent/host/team-mcp-tools.ts'

const MARKET = 'https://market.example'
const { privateKey } = generateKeyPairSync('ed25519')
const signer: SeatSigner = { root: () => 'https://host.example', host: () => 'a1b2c3d4', sign: text => edSign(undefined, Buffer.from(text, 'utf8'), privateKey).toString('base64') }
type Def = { name: string; execute: (args: unknown, exec: { agent?: { id: unknown } }) => Promise<Record<string, unknown>> }

async function harness(members: string[] = ['session-a']) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  let local = ['session-r', ...members]
  // Tokens live 200 s (under the 5-minute refresh margin), so every call exchanges again: the exchange is where we hold it.
  let hold: Promise<void> | undefined
  let holdAfterCall = false
  let exchanges = 0
  const tokenFetch = async (_url: string, init: { body: string }) => {
    const req = JSON.parse(init.body) as { host: string; seat_id: string }
    exchanges++
    if (hold !== undefined && (!holdAfterCall || sent.some(s => s.method === 'tools/call'))) await hold
    return { status: 200, headers: { get: () => null }, json: async () => ({ token: `tok-${String(exchanges)}`, token_type: 'Bearer', expires_in: 200, seat: { host: req.host, seat_id: req.seat_id } }) }
  }
  const sent: Array<{ method: string; tool?: string }> = []
  let refuseNextCall = false
  const transport: McpTransport = async (_url, _headers, body) => {
    const req = JSON.parse(body) as { id?: number; method: string; params?: { name?: string } }
    sent.push({ method: req.method, ...(req.params?.name !== undefined ? { tool: req.params.name } : {}) })
    if (req.method === 'tools/call' && refuseNextCall) { refuseNextCall = false; return { status: 401, headers: { get: () => null }, text: async () => '' } }
    const result = req.method === 'tools/list' ? { tools: [{ name: 'remove_record', inputSchema: { type: 'object', properties: {} } }] } : req.method === 'tools/call' ? { content: [{ type: 'text', text: 'removed' }] } : {}
    return { status: 200, headers: { get: (n: string) => n === 'mcp-session-id' ? 'sess-1' : n === 'content-type' ? 'application/json' : null }, text: async () => JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) }
  }
  const h = new SuperagentHost({
    home: mkdtempSync(join(tmpdir(), 'sa-mcp-auth-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
    canvasTeam: name => name === 'ops' ? { local, remote: [] } : undefined,
    seatSigner: signer, seatTokenFetch: tokenFetch as never, mcpTransport: transport,
  })
  expect(h.saveSettings({ canvas: 'ops', router: 'session-r', mcp: [{ name: 'm', url: `${MARKET}/mcp`, transport: 'streamable-http' }] }, () => true)).toMatchObject({ ok: true })
  h.start()
  const asked = h.request('一件事') as { triggerId: string }
  expect(routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 't', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
  await new Promise(r => setTimeout(r, 30))
  const running = h.executor.list()[0]!
  await h.mcp.refreshTools('m')
  const defs = new Map<string, Def>()
  const ctx = { tools: { register: (def: Def) => { defs.set(def.name, def); return () => { defs.delete(def.name) } } } }
  const tools = new TeamMcpTools(ctx as never, id => (h.roleOf(id) !== undefined ? h : undefined) as never, () => [h] as never, { warn: () => {} })
  tools.refresh()
  const def = defs.get('team__m__remove_record')!
  expect(def).toBeDefined()
  let release: (() => void) | undefined
  return {
    h, def, running, sent,
    held: (afterCall = false) => { holdAfterCall = afterCall; hold = new Promise<void>(r => { release = r }) },
    release: () => { const r = release; hold = undefined; r?.() },
    refuseNextCall: () => { refuseNextCall = true },
    setLocal: (next: string[]) => { local = next },
    toolCalls: () => sent.filter(s => s.method === 'tools/call').length,
  }
}

describe('team MCP calling authority at dispatch (#690 re-review R1)', () => {
  it('same authority throughout: the call goes through (the success path stays)', async () => {
    const t = await harness()
    try {
      t.held()
      const pending = t.def.execute({}, { agent: { id: t.running.member } })
      t.release()
      expect(await pending).toMatchObject({ ok: true, result: expect.stringContaining('removed') })
      expect(t.toolCalls()).toBe(1)
    } finally { void t.h.stop() }
  })

  it('the ticket ends while the call waits for its seat token: refused, and no tools/call is sent', async () => {
    const t = await harness()
    try {
      t.held()
      const pending = t.def.execute({}, { agent: { id: t.running.member } })
      await new Promise(r => setTimeout(r, 5))
      // The member's own dropped report ends the ticket: it has no running binding any more.
      expect(t.h.report(t.running.member, { state: 'dropped', summary: '不做了' })).toMatchObject({ ok: true })
      t.h.pass()
      await new Promise(r => setTimeout(r, 10))
      expect(t.h.executor.bindingOf(t.running.member)).toBeUndefined()
      t.release()
      expect(await pending).toMatchObject({ ok: false, code: 'authority', error: expect.stringContaining('no-ticket') })
      expect(t.toolCalls()).toBe(0)
      expect(t.h.mcp.calls().at(-1)).toMatchObject({ outcome: 'refused' })
    } finally { void t.h.stop() }
  })

  it('the member is removed from the team while the call waits: refused, no tools/call', async () => {
    const t = await harness()
    try {
      t.held()
      const pending = t.def.execute({}, { agent: { id: t.running.member } })
      await new Promise(r => setTimeout(r, 5))
      t.setLocal(['session-r'])
      t.h.poolChanged()
      t.release()
      expect(await pending).toMatchObject({ ok: false, code: 'authority' })
      expect(t.toolCalls()).toBe(0)
    } finally { void t.h.stop() }
  })

  it('the member\'s seat moves to another member while the call waits: refused, no tools/call', async () => {
    const t = await harness(['session-a', 'session-b'])
    try {
      const seat = t.h.mcpSeatOf(t.running.member)!
      const other = t.running.member === 'session-a' ? 'session-b' : 'session-a'
      t.held()
      const pending = t.def.execute({}, { agent: { id: t.running.member } })
      await new Promise(r => setTimeout(r, 5))
      expect(t.h.named.moveSeat(seat, other)).toMatchObject({ ok: true })
      t.release()
      expect(await pending).toMatchObject({ ok: false, code: 'authority', error: expect.stringContaining('seat-changed') })
      expect(t.toolCalls()).toBe(0)
    } finally { void t.h.stop() }
  })

  it('a 401 on the call, then the ticket ends while the token is exchanged again: the retry is not sent', async () => {
    const t = await harness()
    try {
      t.refuseNextCall()
      // Hold only the retry's exchange: the one after the first tools/call was refused.
      t.held(true)
      const pending = t.def.execute({}, { agent: { id: t.running.member } })
      await new Promise(r => setTimeout(r, 5))
      expect(t.toolCalls()).toBe(1)
      expect(t.h.report(t.running.member, { state: 'dropped', summary: '不做了' })).toMatchObject({ ok: true })
      t.h.pass()
      await new Promise(r => setTimeout(r, 10))
      t.release()
      expect(await pending).toMatchObject({ ok: false, code: 'authority' })
      expect(t.toolCalls()).toBe(1)
    } finally { void t.h.stop() }
  })
})
