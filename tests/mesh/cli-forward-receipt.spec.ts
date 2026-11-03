// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { signCard } from '../../src/card.ts'
import { bootNode, reservePort, type MeshNode } from './harness.ts'
beforeEach(() => vi.stubGlobal('WebSocket', function noSocket() { throw Error('no socket') }))
afterEach(() => vi.unstubAllGlobals())
const handle = 'receipt-cli/a1b2c3d4e5f60718'
const privateKey = generateKeyPairSync('ed25519').privateKey
const targetId = 'session-bbbbbbbb33334444'
const targetHandle = 'beta/bbbbbbbb'
const post = async (node: MeshNode, path: string, body: unknown): Promise<any> => await fetch(node.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => await r.json())
const state = async (node: MeshNode): Promise<any> => await fetch(node.baseUrl + '/__dsh_a2a/state').then(async r => await r.json())
async function cli(home: string, args: string[]) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const p = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: { ...process.env, A2A_CLI_HOME: home } })
    let stdout = '', stderr = ''
    p.stdout.on('data', x => { stdout += String(x) }); p.stderr.on('data', x => { stderr += String(x) })
    p.on('error', reject); p.on('close', code => resolve({ code, stdout, stderr }))
  })
}
async function setup(directLink = true, extraHome = false, replayAtHome = false) {
  const pa = await reservePort(), pb = await reservePort()
  const pc = extraHome ? await reservePort() : undefined
  const scoped = { sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, settlementAuth: 'enforce' as const, forwardDirect: true, cardCacheTtlMs: 0 }
  const a = await bootNode({ name: 'A', session: 'receipt-home', team: 'alpha', port: pa, peers: ['http://127.0.0.1:' + pb, ...(replayAtHome && pc !== undefined ? ['http://127.0.0.1:' + pc] : [])], ...scoped })
  const c = pc === undefined ? undefined : await bootNode({ name: 'C', session: 'receipt-namesake', team: 'gamma', port: pc, peers: ['http://127.0.0.1:' + pb, ...(replayAtHome ? [a.baseUrl] : [])], ...scoped })
  const b = await bootNode({ name: 'B', session: 'receipt-target', team: 'beta', agentId: targetId, port: pb, peers: [...(c === undefined ? [] : [c.baseUrl]), a.baseUrl], ...scoped })
  const home = mkdtempSync(join(tmpdir(), 'cli-receipt-'))
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: 'receipt-cli', uuid: 'a1b2c3d4e5f60718', handle, home: a.baseUrl, privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 })
  const card = JSON.stringify(signCard({ name: 'receipt-cli', session: 'cli-receipt', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, privateKey))
  expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
  if (c !== undefined) expect((await post(c, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
  await post(b, '/__dsh_a2a/join', { id: targetId })
  if (c !== undefined) await post(c, '/__dsh_a2a/canvas', { action: 'add-member', name: 'intercept', id: targetHandle })
  await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle })
  if (directLink) await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: targetHandle })
  expect((await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: a.baseUrl })).ok).toBe(true)
  await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: targetId })
  const agent = b.agents.agent as any
  agent.steer = (payload: any) => {
    b.steered.push(payload)
    agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
    setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'roundtrip completed at B' }] } } }); b.ctx.emit('agent/status', { agent, status: 'idle' }) }, 180)
  }
  return { a, b, c, home }
}
describe('#234 CLI forwarded receipt roundtrip with enforce and scope on both hosts', () => {
  it('a CLI deposited in A canvas receives automatic receipts from A local sessions', async () => {
    const { a, b, home } = await setup()
    try {
      const id = 'session-0123456789abcdef'
      await post(a, '/__dsh_a2a/join', { id })
      expect((await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })).ok).toBe(true)
      const agent = a.agents.agent as any
      agent.steer = (payload: any) => {
        a.steered.push(payload)
        agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
        setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'local work completed at A' }] } } }); a.ctx.emit('agent/status', { agent, status: 'idle' }) }, 180)
      }
      const task = 'direct-cli-local-canvas'
      const result = await cli(home, ['route', 'alpha/01234567', 'local canvas CLI request', '--task', task])
      expect(result.code, result.stderr).toBe(0)
      await vi.waitFor(async () => {
        const inbox = await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })
        expect(inbox.mail.some((row: any) => row.text.includes(task) && row.text.includes('local work completed at A'))).toBe(true)
      }, { timeout: 5000, interval: 80 })
      const inbox = await cli(home, ['inbox'])
      expect(inbox.code, inbox.stderr).toBe(0)
      expect(inbox.stdout).toContain(task)
      expect(inbox.stdout).toContain('local work completed at A')
    } finally { await a.dispose(); await b.dispose() }
  }, 20000)
  it('a replayed CLI card cannot auto-pin local A away, while an explicit operator pin still wins', async () => {
    const { a, b, c, home } = await setup(true, true, true)
    try {
      const snapshot = () => JSON.parse(readFileSync(join(a.home, 'a2a', 'canvas.json'), 'utf8'))
      expect(snapshot().cliHome?.[handle]).toBeUndefined()
      const id = 'session-0123456789abcdef'
      await post(a, '/__dsh_a2a/join', { id })
      await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })
      await post(c!, '/__dsh_a2a/canvas', { action: 'add-member', name: 'receipt-link', id: 'alpha/01234567' })
      const agent = a.agents.agent as any
      agent.steer = (payload: any) => {
        a.steered.push(payload)
        agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
        setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'local receipt ownership result' }] } } }); a.ctx.emit('agent/status', { agent, status: 'idle' }) }, 180)
      }
      const first = 'direct-local-no-auto-home'
      expect((await cli(home, ['route', 'alpha/01234567', 'local before explicit home', '--task', first])).code).toBe(0)
      await vi.waitFor(async () => { expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(first))).toBe(true) }, { timeout: 5000, interval: 80 })
      expect((await post(c!, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(first))).toBe(false)
      expect((await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: c!.baseUrl })).ok).toBe(true)
      expect(snapshot().cliHome?.[handle]).toBe(c!.baseUrl)
      const second = 'direct-local-explicit-home'
      expect((await cli(home, ['route', 'alpha/01234567', 'local after explicit home', '--task', second])).code).toBe(0)
      await vi.waitFor(async () => { expect((await post(c!, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(second))).toBe(true) }, { timeout: 5000, interval: 80 })
      expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(second))).toBe(false)
    } finally { await a.dispose(); await b.dispose(); if (c !== undefined) await c.dispose() }
  }, 30000)
  it('an expired local CLI tombstone also blocks automatic foreign home pins after restart', async () => {
    const pa = await reservePort(), pc = await reservePort()
    const home = mkdtempSync(join(tmpdir(), 'cli-offline-home-'))
    const card = JSON.stringify(signCard({ name: 'receipt-cli', session: 'cli-receipt', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, privateKey))
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'cli-deposits.json'), JSON.stringify({ deposits: [{ handle, name: 'receipt-cli', cardJson: card, depositedAt: Date.now() - 18000000, expiresAt: Date.now() - 1000, expiredAt: Date.now() - 1000 }], mailbox: {} }))
    const c = await bootNode({ name: 'C', session: 'offline-replay', team: 'gamma', port: pc, peers: ['http://127.0.0.1:' + pa], sessionNodes: true, teamScopeRouting: true })
    const a = await bootNode({ name: 'A', session: 'offline-home', team: 'alpha', port: pa, home, peers: [c.baseUrl], sessionNodes: true, teamScopeRouting: true })
    try {
      expect((await post(c, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
      expect((await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle })).ok).toBe(true)
      expect(JSON.parse(readFileSync(join(home, 'a2a', 'canvas.json'), 'utf8')).cliHome?.[handle]).toBeUndefined()
      const persisted = JSON.parse(readFileSync(join(home, 'a2a', 'cli-deposits.json'), 'utf8'))
      expect(persisted.deposits.find((row: any) => row.handle === handle).expiredAt).toBeDefined()
      expect((await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: c.baseUrl })).ok).toBe(true)
      expect(JSON.parse(readFileSync(join(home, 'a2a', 'canvas.json'), 'utf8')).cliHome?.[handle]).toBe(c.baseUrl)
    } finally { await a.dispose(); await c.dispose() }
  }, 20000)
  for (const canvas of [false, true]) it((canvas ? 'canvas' : 'session') + ': automatic target-member receipt settles A and is readable by shipped CLI inbox', async () => {
    const { a, b, home } = await setup()
    const task = canvas ? 'direct-receipt-canvas' : 'direct-receipt-session'
    try {
      const result = await cli(home, ['route', canvas ? 'beta/canvas/ops' : targetHandle, 'roundtrip request', '--task', task])
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain(task)
      await vi.waitFor(async () => {
        const current = await state(a)
        const row = current.archived.find((r: any) => r.taskId === task)
        expect(row).toMatchObject({ outcome: 'completed', forwarded: true, direction: 'outbound', sender: { kind: 'cli', id: handle }, settledBy: { caller: targetHandle } })
        expect(row.settledBy.chain_role).not.toBe('off-chain')
        expect(current.tasks.some((r: any) => r.taskId === task)).toBe(false)
        expect(current.settlement.refusals).toEqual([])
      }, { timeout: 9000, interval: 80 })
      const inbox = await cli(home, ['inbox'])
      expect(inbox.code, inbox.stderr).toBe(0)
      expect(inbox.stdout).toContain(task)
      expect(inbox.stdout).toContain('roundtrip completed at B')
      const ledger = JSON.parse(readFileSync(join(a.home, 'a2a', 'tasks.json'), 'utf8'))
      expect([...ledger.tasks, ...ledger.archived].filter((r: any) => r.taskId === task)).toHaveLength(1)
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
  it('automatic receipt ignores a higher-priority namesake CLI deposit and goes only to pinned A', async () => {
    const { a, b, c, home } = await setup(true, true)
    try {
      const card = JSON.stringify(signCard({ name: 'receipt-cli', session: 'cli-receipt', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, privateKey))
      expect((await post(b, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true) // a local namesake still loses to an operator pin
      const task = 'direct-receipt-pinned-home'
      const sent = await cli(home, ['route', targetHandle, 'pinned-home receipt', '--task', task])
      expect(sent.code, sent.stderr).toBe(0)
      await vi.waitFor(async () => { expect((await state(a)).archived.some((row: any) => row.taskId === task && row.settledBy?.caller === targetHandle)).toBe(true) }, { timeout: 8000, interval: 80 })
      const namesake = await post(c!, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })
      expect(namesake.mail.some((row: any) => row.text.includes(task))).toBe(false)
      expect((await post(b, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(task))).toBe(false)
      expect((await cli(home, ['inbox'])).stdout).toContain(task)
    } finally { await a.dispose(); await b.dispose(); if (c !== undefined) await c.dispose() }
  }, 30000)
  it('sync receives B final text through the same authenticated home forwarding path', async () => {
    const { a, b, home } = await setup()
    try { const result = await cli(home, ['route', targetHandle, 'sync roundtrip', '--sync', '--task', 'direct-receipt-sync']); expect(result.code, result.stderr).toBe(0); expect(result.stdout).toContain('roundtrip completed at B') }
    finally { await a.dispose(); await b.dispose() }
  }, 30000)
  it('a peer-org canvas alone must not open a return path the home operator never linked', async () => {
    const { a, b, home } = await setup(false)
    try {
      const result = await cli(home, ['route', 'beta/canvas/ops', 'canvas without direct member link', '--task', 'direct-receipt-unlinked'])
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('direct operator link')
      expect(b.steered).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
})
