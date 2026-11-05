// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync, createPrivateKey } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { CliDepositStore } from '../../src/cli-deposit.ts'
import { canvasOwnerFingerprint } from '../../src/canvas-id.ts'
import { bootNode, reservePort, type MeshNode, cliEnv } from './harness.ts'
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
    const p = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
    let stdout = '', stderr = ''
    p.stdout.on('data', x => { stdout += String(x) }); p.stderr.on('data', x => { stderr += String(x) })
    p.on('error', reject); p.on('close', code => resolve({ code, stdout, stderr }))
  })
}
async function setup(directLink = true, extraHome = false, replayAtHome = false, latePublish = false, waitMs?: number, settlementAuth: 'observe' | 'enforce' = 'enforce') {
  const pa = await reservePort(), pb = await reservePort()
  const pc = extraHome ? await reservePort() : undefined
  const scoped = { sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, settlementAuth, forwardDirect: true, cardCacheTtlMs: 0, ...(waitMs !== undefined ? { flushTimeoutMs: waitMs } : {}) }
  const a = await bootNode({ name: 'A', session: 'receipt-home', team: 'alpha', port: pa, peers: ['http://127.0.0.1:' + pb, ...(replayAtHome && pc !== undefined ? ['http://127.0.0.1:' + pc] : [])], ...scoped })
  const c = pc === undefined ? undefined : await bootNode({ name: 'C', session: 'receipt-namesake', team: 'gamma', port: pc, peers: ['http://127.0.0.1:' + pb, ...(replayAtHome ? [a.baseUrl] : [])], ...scoped })
  const b = await bootNode({ name: 'B', session: 'receipt-target', team: 'beta', agentId: targetId, port: pb, peers: [...(c === undefined ? [] : [c.baseUrl]), a.baseUrl], ...scoped })
  const home = mkdtempSync(join(tmpdir(), 'cli-receipt-'))
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: 'receipt-cli', uuid: 'a1b2c3d4e5f60718', handle, home: a.baseUrl, privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 })
  const card = JSON.stringify(signCard({ name: 'receipt-cli', session: 'cli-receipt', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, privateKey))
  if (!latePublish) expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
  if (c !== undefined) expect((await post(c, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
  await post(b, '/__dsh_a2a/join', { id: targetId })
  if (c !== undefined) await post(c, '/__dsh_a2a/canvas', { action: 'add-member', name: 'intercept', id: targetHandle })
  await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle })
  const pinBeforePublish = latePublish ? JSON.parse(readFileSync(join(a.home, 'a2a', 'canvas.json'), 'utf8')).cliHome?.[handle] : undefined
  if (latePublish) {
    expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'publish', card: '{bad-card' })).ok).toBe(false)
    expect(JSON.parse(readFileSync(join(a.home, 'a2a', 'canvas.json'), 'utf8')).cliHome?.[handle]).toBe(pinBeforePublish)
  }
  const localPublish = latePublish ? await post(a, '/__dsh_a2a/cli-deposit', { action: 'publish', card }) : undefined
  if (latePublish) expect(localPublish.ok).toBe(true)
  if (directLink) await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: targetHandle })
  expect((await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: a.baseUrl })).ok).toBe(true)
  await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: targetId })
  const agent = b.agents.agent as any
  agent.steer = (payload: any) => {
    b.steered.push(payload)
    agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
    setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'roundtrip completed at B' }] } } }); b.ctx.emit('agent/status', { agent, status: 'idle' }) }, 180)
  }
  return { a, b, c, home, pinBeforePublish, localPublish }
}

/** A request to A's /a2a/direct signed by `signerHome`'s node key (Sig2+Sig3 over the body); `strip` drops Sig3, `swap` sends another body. */
async function signedPost(target: MeshNode, signerHome: string, signerZone: string, signerUrl: string, body: unknown, opts: { strip?: boolean; swap?: unknown } = {}): Promise<any> {
  const url = target.baseUrl + '/a2a/direct'
  const key = createPrivateKey(readFileSync(join(signerHome, 'a2a', 'node-key.pem'), 'utf8'))
  const raw = JSON.stringify(body)
  const headers: Record<string, string> = signOriginClaim({ url, method: 'POST', body: raw }, { caller: signerZone, callerUrl: signerUrl, privateKey: key, unbound: false, now: Date.now() })
  if (opts.strip === true) { delete headers['X-A2A-Caller-Sig3']; delete headers['X-A2A-Body-Sha256'] }
  return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: opts.swap !== undefined ? JSON.stringify(opts.swap) : raw }).then(async r => await r.json())
}
describe('#234 CLI forwarded receipt roundtrip with enforce and scope on both hosts', () => {
  it('#282 S3 review P2: a receipt that beats the dispatch answer still settles with only the owner host linked', async () => {
    const { a, b, home } = await setup(false)
    const original = globalThis.fetch
    const delay = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const response = await original(url as never, init)
      if (String(url) === b.baseUrl + '/a2a/direct' && init?.method === 'POST') await new Promise(resolve => setTimeout(resolve, 600))
      return response
    })
    const task = 'direct-race-same-team'
    try {
      expect((await cli(home, ['route', 'beta/canvas/ops', 'race', '--task', task])).code).toBe(0)
      await vi.waitFor(async () => { expect((await state(a)).archived.find((r: any) => r.taskId === task)).toMatchObject({ outcome: 'completed', settledBy: { chain_role: 'target-member' } }) }, { timeout: 8000, interval: 100 })
    } finally { delay.mockRestore(); await a.dispose(); await b.dispose() }
  }, 30000)
  it('#282 S3 review: only a body-bound receipt from a frozen receiver of B passes — other labels, free text and a stripped Sig3 do not', async () => {
    const { a, b, home } = await setup(false)
    const agent = b.agents.agent as any
    agent.steer = (payload: any) => { b.steered.push(payload) } // never completes: the row stays pending
    const task = 'direct-pending-s3'
    try {
      // A member of another zone (host C) in B's canvas: frozen as a receiver, but only C may sign for it.
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: 'gamma/cccccccc' })
      expect((await cli(home, ['route', 'beta/canvas/ops', 'hold', '--task', task])).code).toBe(0)
      await vi.waitFor(async () => expect((await state(a)).tasks.find((r: any) => r.taskId === task)).toBeDefined(), { timeout: 4000 })
      const receipt = (id: string, extra = '') => ({ team: handle, caller_session: targetHandle, task_id: id, message: `[A2A receipt] task ${task} done${extra}` })
      expect((await state(a)).tasks.find((r: any) => r.taskId === task).receiverMembers).toContain('gamma/cccccccc')
      // B signs for that frozen receiver of another zone: claimCovers must refuse (M4).
      expect((await signedPost(a, b.home, 'beta', b.baseUrl, { ...receipt('s3-gamma'), caller_session: 'gamma/cccccccc' })).routed).not.toBe(true)
      // A frozen receiver's free text with a fresh id is not a receipt (M6).
      expect((await signedPost(a, b.home, 'beta', b.baseUrl, { team: handle, caller_session: targetHandle, task_id: 's3-free', message: 'free text, not a receipt' })).routed).not.toBe(true)
      // A captured B envelope with Sig3 stripped and another body swapped in (P3-1).
      expect((await signedPost(a, b.home, 'beta', b.baseUrl, receipt('s3-orig', ' ok'), { strip: true, swap: receipt('s3-swapped', ' FORGED') })).routed).not.toBe(true)
      const mail = (await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail as Array<{ text: string }>
      expect(mail.some(m => m.text.includes('FORGED') || m.text.includes('free text'))).toBe(false)
      expect((await state(a)).tasks.find((r: any) => r.taskId === task)).toBeDefined()
      // The genuine body-bound receipt from the frozen receiver settles it.
      expect((await signedPost(a, b.home, 'beta', b.baseUrl, receipt('s3-genuine'))).routed).toBe(true)
      await vi.waitFor(async () => expect((await state(a)).archived.find((r: any) => r.taskId === task)).toMatchObject({ settledBy: { caller: targetHandle } }), { timeout: 4000 })
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
  it('#282 S2 review P1: a CLI route carrying our own @fp8 stays on this host — a local canvas is reached, a same-named remote one never is', async () => {
    const { a, b, home } = await setup()
    try {
      const fpA = canvasOwnerFingerprint((await fetch(a.baseUrl + '/.well-known/agent-card.json').then(r => r.json()) as { publicKey: string }).publicKey)
      // B owns beta/canvas/ops; our own fingerprint on that name must not escape to B through the forward path.
      const escaped = await cli(home, ['route', `beta/canvas/ops@${fpA}`, 'must stay home', '--task', 'direct-own-fp-escape'])
      expect(escaped.code).not.toBe(0)
      expect(b.steered).toHaveLength(0)
      // Our own canvas by its qualified id: the wire face strips the suffix and delivers locally.
      const id = 'session-0123456789abcdef'
      await post(a, '/__dsh_a2a/join', { id })
      expect((await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })).ok).toBe(true)
      const agent = a.agents.agent as any
      agent.steer = (payload: any) => { a.steered.push(payload) }
      const local = await cli(home, ['route', `alpha/canvas/ops@${fpA}`, 'own canvas by id', '--task', 'direct-own-fp-local'])
      expect(local.code, local.stderr).toBe(0)
      expect(a.steered).toHaveLength(1)
      expect(b.steered).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
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
  it('a local household cannot be auto-pinned or explicitly redirected and its receipts remain local', async () => {
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
      const choices = await post(a, '/__dsh_a2a/canvas', { action: 'cli-home-options', name: 'ops', id: handle })
      expect(choices).toMatchObject({ ok: true, held: true, homes: [] })
      const member = (await state(a)).canvas.teams.flatMap((team: any) => team.members).find((row: any) => row.id === handle)
      expect(member.cliHeld).toBe(true)
      const denied = await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: c!.baseUrl })
      expect(denied).toMatchObject({ ok: false, error: expect.stringContaining('revoke') })
      expect(snapshot().cliHome?.[handle]).toBeUndefined()
      const second = 'direct-local-explicit-home'
      expect((await cli(home, ['route', 'alpha/01234567', 'local after explicit home', '--task', second])).code).toBe(0)
      await vi.waitFor(async () => { expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(second))).toBe(true) }, { timeout: 5000, interval: 80 })
      expect((await post(c!, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(second))).toBe(false)
    } finally { await a.dispose(); await b.dispose(); if (c !== undefined) await c.dispose() }
  }, 30000)
  it('an old auto-pin loses to a CLI household published locally afterwards', async () => {
    const { a, b, c, home, pinBeforePublish, localPublish } = await setup(true, true, true, true)
    try {
      expect(pinBeforePublish).toBe(c!.baseUrl)
      expect(localPublish.homeCleared).toBe(true)
      const canvas = JSON.parse(readFileSync(join(a.home, 'a2a', 'canvas.json'), 'utf8'))
      expect(canvas.cliHome?.[handle]).toBeUndefined()
      expect(canvas.cliHomeCleared).toContain(handle)
      expect((await state(a)).canvas.teams.flatMap((t: any) => t.members).find((m: any) => m.id === handle).cliHomeCleared).toBe(true)
      const id = 'session-0123456789abcdef'
      await post(a, '/__dsh_a2a/join', { id })
      await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })
      const agent = a.agents.agent as any
      agent.steer = (payload: any) => {
        a.steered.push(payload)
        agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
        setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'late local household result' }] } } }); a.ctx.emit('agent/status', { agent, status: 'idle' }) }, 180)
      }
      const task = 'direct-cli-publish-after-pin'
      expect((await cli(home, ['route', 'alpha/01234567', 'publish after pin', '--task', task])).code).toBe(0)
      await vi.waitFor(async () => { expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(task))).toBe(true) }, { timeout: 5000, interval: 80 })
      expect((await post(c!, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(task))).toBe(false)
      expect(await post(a, '/__dsh_a2a/canvas', { action: 'cli-home-options', name: 'ops', id: handle })).toMatchObject({ ok: true, held: true, homes: [] })
    } finally { await a.dispose(); await b.dispose(); if (c !== undefined) await c.dispose() }
  }, 30000)
  it('a local publish-cleared pin cannot revive when the household expires across restart', async () => {
    const { a, b, c, home } = await setup(true, true, true, true)
    let cold: MeshNode | undefined
    try {
      const path = join(a.home, 'a2a', 'cli-deposits.json')
      await a.dispose()
      const snapshot = JSON.parse(readFileSync(path, 'utf8'))
      for (const row of snapshot.deposits) if (row.handle === handle) { row.expiresAt = Date.now() - 1000; row.expiredAt = Date.now() - 1000 }
      writeFileSync(path, JSON.stringify(snapshot))
      cold = await bootNode({ name: 'A', session: 'receipt-home', team: 'alpha', port: a.port, home: a.home, peers: [b.baseUrl, c!.baseUrl], sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, settlementAuth: 'enforce', forwardDirect: true })
      const canvas = JSON.parse(readFileSync(join(a.home, 'a2a', 'canvas.json'), 'utf8'))
      expect(canvas.cliHome?.[handle]).toBeUndefined()
      expect(canvas.cliHomeCleared).toContain(handle)
      const row = (await state(cold)).canvas.teams.flatMap((t: any) => t.members).find((m: any) => m.id === handle)
      expect(row).toMatchObject({ cliHeld: true, cliHome: null, cliHomeCleared: true })
      expect(await post(cold, '/__dsh_a2a/canvas', { action: 'cli-home-options', name: 'ops', id: handle })).toMatchObject({ ok: true, held: true, homes: [] })
    } finally { if (cold !== undefined) await cold.dispose(); await b.dispose(); if (c !== undefined) await c.dispose() }
  }, 20000)
  it('local receipt expiry between household selection and mailbox delivery never falls back to a namesake directory', async () => {
    const { a, b, c, home } = await setup(true, true, true)
    const originalGet = CliDepositStore.prototype.get
    let armed = false, reads = 0, secondRead = false
    const spy = vi.spyOn(CliDepositStore.prototype, 'get').mockImplementation(function(this: CliDepositStore, name: string) {
      if (armed && name === handle && (this as unknown as { path: string }).path === join(a.home, 'a2a', 'cli-deposits.json')) {
        if (++reads === 1) return originalGet.call(this, name)
        secondRead = true; return undefined
      }
      return originalGet.call(this, name)
    })
    try {
      const id = 'session-0123456789abcdef'
      await post(a, '/__dsh_a2a/join', { id })
      await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })
      await post(c!, '/__dsh_a2a/canvas', { action: 'add-member', name: 'return-link', id: 'alpha/01234567' })
      const agent = a.agents.agent as any
      const task = 'direct-cli-mid-delivery-expiry'
      agent.steer = (payload: any) => {
        a.steered.push(payload)
        const text = typeof payload === 'string' ? payload : payload.content?.find((block: any) => block.type === 'text')?.text ?? ''
        if (text.startsWith('[A2A receipt]')) return
        agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
        setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'expiry-race result' }] } } }); armed = true; a.ctx.emit('agent/status', { agent, status: 'idle' }) }, 180)
      }
      expect((await cli(home, ['route', 'alpha/01234567', 'receipt expiry race', '--task', task])).code).toBe(0)
      await vi.waitFor(() => { expect(secondRead, JSON.stringify({armed,reads,steered:a.steered})).toBe(true); expect(a.steered.slice(1).some(payload => JSON.stringify(payload).includes('[A2A receipt]') && JSON.stringify(payload).includes(task)), JSON.stringify(a.steered)).toBe(true) }, { timeout: 5000, interval: 80 })
      expect((await post(c!, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(task))).toBe(false)
    } finally { spy.mockRestore(); await a.dispose(); await b.dispose(); if (c !== undefined) await c.dispose() }
  }, 20000)
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
      expect(await post(a, '/__dsh_a2a/canvas', { action: 'cli-home-options', name: 'ops', id: handle })).toMatchObject({ ok: true, held: true, homes: [] })
      expect((await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: c.baseUrl })).ok).toBe(false)
      expect(JSON.parse(readFileSync(join(home, 'a2a', 'canvas.json'), 'utf8')).cliHome?.[handle]).toBeUndefined()
    } finally { await a.dispose(); await c.dispose() }
  }, 20000)
  it('an offline local household uses its existing pinned foreign home for automatic receipts', async () => {
    const pa = await reservePort(), pc = await reservePort()
    const home = mkdtempSync(join(tmpdir(), 'cli-offline-pinned-'))
    const card = JSON.stringify(signCard({ name: 'receipt-cli', session: 'cli-receipt', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, privateKey))
    mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a', 'cli-deposits.json'), JSON.stringify({ deposits: [{ handle, name: 'receipt-cli', cardJson: card, depositedAt: Date.now() - 18000000, expiresAt: Date.now() - 1000, expiredAt: Date.now() - 1000 }], mailbox: {} }))
    const c = await bootNode({ name: 'C', session: 'offline-pin-home', team: 'gamma', port: pc, peers: ['http://127.0.0.1:' + pa], sessionNodes: true, teamScopeRouting: true, settlementAuth: 'enforce', forwardDirect: true })
    const localId = 'session-0123456789abcdef'
    writeFileSync(join(home, 'a2a', 'canvas.json'), JSON.stringify({ teams: [{ name: 'ops', members: [handle, localId] }], cliHome: { [handle]: c.baseUrl } }))
    const a = await bootNode({ name: 'A', session: 'offline-pinned-target', team: 'alpha', port: pa, home, peers: [c.baseUrl], sessionNodes: true, teamScopeRouting: true, settlementAuth: 'enforce', forwardDirect: true })
    try {
      await post(c, '/__dsh_a2a/cli-deposit', { action: 'publish', card })
      await post(c, '/__dsh_a2a/canvas', { action: 'add-member', name: 'return-link', id: 'alpha/01234567' })
      await post(a, '/__dsh_a2a/join', { id: localId })
      const agent = a.agents.agent as any
      agent.steer = (payload: any) => {
        a.steered.push(payload)
        agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
        setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'offline pin result' }] } } }); a.ctx.emit('agent/status', { agent, status: 'idle' }) }, 180)
      }
      const url = a.baseUrl + '/a2a/direct'
      const hostKey = createPrivateKey(readFileSync(join(c.home, 'a2a', 'node-key.pem'), 'utf8'))
      const headers = signOriginClaim({ url, method: 'POST' }, { caller: c.team, callerUrl: c.baseUrl, privateKey: hostKey, unbound: false, now: Date.now() })
      const task = 'direct-offline-pinned-receipt'
      const accepted = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ team: 'alpha/01234567', caller_session: handle, task_id: task, message: 'offline household receipt', wait: false }) }).then(async r => await r.json() as any)
      expect(accepted.routed, JSON.stringify(accepted)).toBe(true)
      await vi.waitFor(async () => { expect((await post(c, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(task))).toBe(true) }, { timeout: 5000, interval: 80 })
      expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(task))).toBe(false)
      expect(await post(a, '/__dsh_a2a/canvas', { action: 'cli-home-options', name: 'ops', id: handle })).toMatchObject({ ok: true, held: true, homes: [] })
    } finally { await a.dispose(); await c.dispose() }
  }, 20000)
  it('#298 the receipt of a sync-answered forward stays in the mailbox in full, marked a duplicate and folded by the CLI; an async one is not', async () => {
    const { a, b, home } = await setup()
    try {
      const synced = await cli(home, ['route', targetHandle, 'sync request', '--task', 'dup-sync', '--sync'])
      expect(synced.code, synced.stderr).toBe(0)
      expect(synced.stdout).toContain('roundtrip completed at B')
      expect((await cli(home, ['route', targetHandle, 'async request', '--task', 'dup-async'])).code).toBe(0)
      const mailOf = async (task: string): Promise<any[]> => ((await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail as any[]).filter(m => String(m.text).includes('[A2A receipt] task ' + task))
      await vi.waitFor(async () => { expect(await mailOf('dup-sync')).toHaveLength(1); expect(await mailOf('dup-async')).toHaveLength(1) }, { timeout: 9000, interval: 80 })
      const [dup] = await mailOf('dup-sync'), [fresh] = await mailOf('dup-async')
      expect(dup).toMatchObject({ dup: 'sync-answered' })
      expect(dup.text).toContain('roundtrip completed at B') // kept in full
      expect(fresh.dup).toBeUndefined()
      const inbox = await cli(home, ['inbox'])
      expect(inbox.code, inbox.stderr).toBe(0)
      const line = (task: string): string => inbox.stdout.split('\n').find(l => l.includes('task ' + task)) ?? ''
      expect(line('dup-sync')).toContain('duplicate receipt')
      expect(line('dup-async')).not.toContain('duplicate receipt')
      expect((await cli(home, ['inbox', '--json'])).stdout).toContain('"dup": "sync-answered"')
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
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
        expect(row.auth).toMatchObject({ caller: handle, proof: 'cli-identity', ingress: 'wire', target: canvas ? 'beta/canvas/ops' : targetHandle, receipt_target: handle })
        if (canvas) expect(row.receiverMembers).toContain(targetHandle)
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
  for (const localDeposit of [false, true]) it(localDeposit ? 'B owner-established local CLI household takes precedence over a previous foreign pin' : 'automatic receipt ignores a higher-priority namesake CLI deposit and goes only to pinned A', async () => {
    const { a, b, c, home } = await setup(true, true)
    try {
      const card = JSON.stringify(signCard({ name: 'receipt-cli', session: 'cli-receipt', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, privateKey))
      // A local household requires B operator control, so it takes precedence over an old pin.
      if (localDeposit) expect((await post(b, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
      const task = 'direct-receipt-pinned-home'
      const sent = await cli(home, ['route', targetHandle, 'pinned-home receipt', '--task', task])
      expect(sent.code, sent.stderr).toBe(0)
      if (localDeposit) {
        await vi.waitFor(async () => { expect((await post(b, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(task))).toBe(true) }, { timeout: 5000, interval: 80 })
        expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(task))).toBe(false)
      } else await vi.waitFor(async () => { expect((await state(a)).archived.some((row: any) => row.taskId === task && row.settledBy?.caller === targetHandle)).toBe(true) }, { timeout: 8000, interval: 80 })
      const namesake = await post(c!, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })
      expect(namesake.mail.some((row: any) => row.text.includes(task))).toBe(false)
      if (!localDeposit) {
        expect((await post(b, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes(task))).toBe(false)
        expect((await cli(home, ['inbox'])).stdout).toContain(task)
      }
    } finally { await a.dispose(); await b.dispose(); if (c !== undefined) await c.dispose() }
  }, 30000)
  it('#272 an older peer missing delivered_to settles a canvas member under enforce using peer snapshot', async () => {
    const { a, b, home } = await setup()
    const original = globalThis.fetch
    const strip = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const response = await original(url, init)
      if (String(url) === b.baseUrl + '/a2a/direct' && init?.method === 'POST') {
        const body = await response.json() as Record<string, unknown>
        delete body.delivered_to
        return new Response(JSON.stringify(body), { status: response.status, headers: { 'Content-Type': 'application/json' } })
      }
      return response
    })
    try {
      const task = 'direct-272-old-peer-canvas'
      expect((await cli(home, ['route', 'beta/canvas/ops', 'old peer member reply', '--task', task])).code).toBe(0)
      await vi.waitFor(async () => {
        const s = await state(a), row = s.archived.find((row: any) => row.taskId === task)
        expect(row).toMatchObject({ auth: { caller: handle }, receiverMembers: [targetHandle], settledBy: { caller: targetHandle, chain_role: 'target-member' } })
        expect(s.settlement.refusals.filter((r: any) => r.taskId === task)).toEqual([])
      }, { timeout: 5000 })
    } finally { strip.mockRestore(); await a.dispose(); await b.dispose() }
  }, 15000)

  it('#272 a late final after a forwarded synchronous wait expires still auto-receipts the original task', async () => {
    const { a, b, home } = await setup(true, false, false, false, 25000, 'observe')
    try {
      const agent = b.agents.agent as any
      agent.steer = (payload: any) => {
        b.steered.push(payload)
        agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
        setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'late forwarded sync result' }] } } }); b.ctx.emit('agent/status', { agent, status: 'idle' }) }, 16500)
      }
      const task = 'direct-272-late-sync'
      const result = await cli(home, ['route', targetHandle, 'late forwarded sync', '--sync', '--task', task])
      expect(result.code, result.stderr).not.toBe(0) // the existing transport budget is deliberately hit
      await vi.waitFor(async () => {
        const s = await state(a)
        expect(s.archived.find((row: any) => row.taskId === task)).toMatchObject({ endedBy: 'receipt' })
        const box = await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })
        expect(box.mail.some((row: any) => row.text.includes('[A2A receipt] task ' + task) && row.text.includes('late forwarded sync result'))).toBe(true)
      }, { timeout: 7000, interval: 100 })
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)

  it('#272 an immediately completed forwarded sync turn still emits its original automatic receipt', async () => {
    const { a, b, home } = await setup()
    try {
      const agent = b.agents.agent as any
      agent.steer = (payload: any) => {
        b.steered.push(payload)
        agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
        agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'immediate sync product' }] } } })
        b.ctx.emit('agent/status', { agent, status: 'idle' })
      }
      const task = 'direct-272-immediate-sync'
      expect((await cli(home, ['route', targetHandle, 'instant sync', '--sync', '--task', task])).code).toBe(0)
      await vi.waitFor(async () => expect((await state(a)).archived.find((row: any) => row.taskId === task)).toMatchObject({ endedBy: 'receipt' }), { timeout: 3000 })
    } finally { await a.dispose(); await b.dispose() }
  }, 10000)

  it('sync receives B final text through the same authenticated home forwarding path', async () => {
    const { a, b, home } = await setup()
    const original = globalThis.fetch
    const delayReply = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const response = await original(url, init)
      if (String(url) === b.baseUrl + '/a2a/direct' && init?.method === 'POST') await new Promise(resolve => setTimeout(resolve, 350))
      return response
    })
    try {
      const result = await cli(home, ['route', targetHandle, 'sync roundtrip', '--sync', '--task', 'direct-receipt-sync'])
      expect(result.code, result.stderr).toBe(0); expect(result.stdout).toContain('roundtrip completed at B')
      await vi.waitFor(async () => expect((await state(a)).archived.find((row: any) => row.taskId === 'direct-receipt-sync')).toMatchObject({ endedBy: 'receipt' }), { timeout: 3000 })
    }
    finally { delayReply.mockRestore(); await a.dispose(); await b.dispose() }
  }, 30000)
  it('#282 S3 same team authorizes: with only the owner host linked, a canvas forward settles on-chain under enforce; a non-member still cannot reach the CLI mailbox', async () => {
    const { a, b, home } = await setup(false)
    const task = 'direct-receipt-same-team'
    try {
      const result = await cli(home, ['route', 'beta/canvas/ops', 'canvas with only the owner host linked', '--task', task])
      expect(result.code, result.stderr).toBe(0)
      expect(b.steered).toHaveLength(1)
      await vi.waitFor(async () => {
        const current = await state(a)
        const row = current.archived.find((r: any) => r.taskId === task)
        expect(row).toMatchObject({ outcome: 'completed', forwarded: true, sender: { kind: 'cli', id: handle }, settledBy: { caller: targetHandle } })
        expect(row.settledBy.chain_role).not.toBe('off-chain')
        expect(row.receiverMembers).toContain(targetHandle)
        expect(current.settlement.refusals).toEqual([])
      }, { timeout: 9000, interval: 80 })
      const inbox = await cli(home, ['inbox'])
      expect(inbox.stdout).toContain(`[A2A receipt] task ${task}`)
      // Negative: B's session that is NOT in B's canvas `ops` has no shared team with the CLI on A.
      const outsider = 'beta/cccccccc'
      const url = a.baseUrl + '/a2a/direct'
      const hostKey = createPrivateKey(readFileSync(join(b.home, 'a2a', 'node-key.pem'), 'utf8'))
      const headers = signOriginClaim({ url, method: 'POST' }, { caller: b.team, callerUrl: b.baseUrl, privateKey: hostKey, unbound: false, now: Date.now() })
      const refused = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ team: handle, caller_session: outsider, task_id: 'direct-outsider-mail', message: 'not a member' }) }).then(r => r.json()) as any
      expect(refused.routed).not.toBe(true)
      expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'inbox', handle })).mail.some((row: any) => row.text.includes('not a member'))).toBe(false)
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
})
