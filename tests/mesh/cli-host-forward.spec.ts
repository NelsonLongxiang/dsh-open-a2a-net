// @vitest-environment node
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
const handle = 'ops-cli/a1b2c3d4e5f60718'
const cliKey = generateKeyPairSync('ed25519').privateKey
beforeEach(() => vi.stubGlobal('WebSocket', function noSocket() { throw Error('no socket') }))
afterEach(() => vi.unstubAllGlobals())
const post = async (node: MeshNode, path: string, body: unknown): Promise<Record<string, any>> => await (await postJson(node.baseUrl, path, body)).json() as Record<string, any>
async function fixture(options: { enabled?: boolean; isolated?: boolean; linked?: boolean; longReply?: boolean } = {}) {
  const pa = await reservePort(), pb = await reservePort()
  const a = await bootNode({ name: 'A', session: 'cli-forward-a', team: 'alpha', port: pa, peers: ['http://127.0.0.1:' + pb], sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, forwardDirect: options.enabled !== false, isolated: options.isolated === true, cardCacheTtlMs: 0 })
  const b = await bootNode({ name: 'B', session: 'cli-forward-b', team: 'beta', port: pb, peers: [a.baseUrl], sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, ...(options.longReply ? { flushTimeoutMs: 30000 } : {}) })
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
async function cliRoute(a: MeshNode, task: string, sync: boolean) {
  const home = mkdtempSync(join(tmpdir(), 'cli-forward-'))
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: 'ops-cli', uuid: 'a1b2c3d4e5f60718', handle, home: a.baseUrl, privateKeyPem: cliKey.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), 'route', 'beta/01234567', 'real CLI forward', '--task', task, ...(sync ? ['--sync'] : [])], { env: cliEnv(home) })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += String(data) }); child.stderr.on('data', data => { stderr += String(data) })
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

describe('#230 home host forwards a deposited CLI one hop with scope on', () => {
  it('#271 canvas failures name the owner and each missing return link, or report known-directory absence', async () => {
    const { a,b }=await fixture({enabled:false})
    try {
      await post(b,'/__dsh_a2a/canvas',{action:'add-member',name:'ops',id:'session-0123456789abcdef'})
      const owner=await route(a,'direct-271-owner',true,undefined,'beta/canvas/ops')
      expect(owner.error).toContain('canvas-owner: '+b.baseUrl)
      expect(owner.error).toContain('forwardDirect is off')
      await post(a,'/__dsh_a2a/canvas',{action:'remove-member',name:'ops',id:'beta/01234567'})
      const missing=await route(a,'direct-271-link',true,undefined,'beta/canvas/ops')
      // #282 S3: a per-member link here is no longer a prerequisite (the owner's signed canvas is the return path).
      expect(missing.error).not.toContain('missing direct operator link')
      expect(missing.error).toContain('home forwardDirect is off')
      // #282 S3: a canvas whose only advertised member is the caller has no receiver — the diagnosis says so.
      await post(b,'/__dsh_a2a/canvas',{action:'create',name:'solo'})
      await post(b,'/__dsh_a2a/canvas',{action:'add-member',name:'solo',id:handle})
      const solo=await route(a,'direct-271-solo',true,undefined,'beta/canvas/solo')
      expect(solo.error).toContain('lists no receiving member besides the caller')
      const absent=await route(a,'direct-271-absent',true,undefined,'beta/canvas/no-such-team')
      expect(absent.error).toContain('canvas-not-found')
      expect(absent.error).not.toContain('canvas-owner:')
      expect(b.steered).toHaveLength(0)
    } finally { await a.dispose();await b.dispose() }
  },15000)

  it('the shipped a2a-net CLI receives async task acknowledgement and a synchronous cross-host reply', async () => {
    const { a, b } = await fixture()
    try {
      const asyncResult = await cliRoute(a, 'direct-cli-binary-async', false)
      expect(asyncResult.code, asyncResult.stderr).toBe(0)
      expect(asyncResult.stdout).toContain('direct-cli-binary-async')
      const syncResult = await cliRoute(a, 'direct-cli-binary-sync', true)
      expect(syncResult.code, syncResult.stderr).toBe(0)
      expect(syncResult.stdout).toContain('B')
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
  it('forwarding a CLI receipt returns no-receipt semantics and creates no outbound debt', async () => {
    const { a, b } = await fixture()
    try {
      const result = await route(a, 'direct-forward-receipt', true, undefined, 'beta/01234567', '[A2A receipt] task original-work done')
      expect(result.routed, JSON.stringify(result)).toBe(true)
      expect(result.receipt).toBe('none')
      const path = join(a.home, 'a2a', 'tasks.json')
      const ledger = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
      expect([...(ledger.tasks ?? []), ...(ledger.archived ?? [])].some((row: any) => row.taskId === 'direct-forward-receipt')).toBe(false)
      expect(b.steered).toHaveLength(1)
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
  it('preserves bridge and receipt-none response through HTTP and the shipped CLI without booking debt', async () => {
    const { a, b } = await fixture()
    try {
      const realFetch = globalThis.fetch
      // Native bridge delivery has a different receipt contract; exercise the real peer transport/forward response seam.
      vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
        const response = await realFetch(...args)
        if (String(args[0]) !== b.baseUrl + '/a2a/direct') return response
        const body = await response.json() as Record<string, any>
        return new Response(JSON.stringify({ ...body, bridge: 'native-teams', receipt: 'none' }), { status: response.status, headers: response.headers })
      })
      const result = await route(a, 'direct-forward-bridge')
      expect(result).toMatchObject({ routed: true, bridge: 'native-teams', receipt: 'none' })
      const cli = await cliRoute(a, 'direct-forward-bridge-cli', false)
      expect(cli.code, cli.stderr).toBe(0)
      expect(cli.stdout).toContain('no receipt will come')
      expect(cli.stdout).not.toContain('receipt arrives in: a2a inbox')
      const path = join(a.home, 'a2a', 'tasks.json')
      const ledger = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
      expect([...(ledger.tasks ?? []), ...(ledger.archived ?? [])].some((row: any) => String(row.taskId).startsWith('direct-forward-bridge'))).toBe(false)
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
  it('returns async delivery and sync reply with the original task/context and one outbound CLI row', async () => {
    const { a, b } = await fixture()
    try {
      const asyncResult = await route(a, 'direct-forward-async')
      expect(asyncResult.routed, JSON.stringify(asyncResult)).toBe(true)
      expect(asyncResult.task_id).toBe('direct-forward-async')
      expect(asyncResult.context_id).toBe('cli-context')
      const syncResult = await route(a, 'direct-forward-sync', false)
      expect(syncResult.routed, JSON.stringify(syncResult)).toBe(true)
      expect(syncResult.result.text).toContain('B')
      const ledger = JSON.parse(readFileSync(join(a.home, 'a2a', 'tasks.json'), 'utf8')) as { tasks: any[]; archived?: any[] }
      const rows = [...ledger.tasks, ...(ledger.archived ?? [])]
      for (const task of ['direct-forward-async', 'direct-forward-sync']) {
        const found = rows.filter(row => row.taskId === task)
        expect(found).toHaveLength(1)
        expect(found[0]).toMatchObject({ direction: 'outbound', forwarded: true, sender: { kind: 'cli', id: handle }, peer: b.baseUrl, peerHost: b.session, deliveredTo: 'beta/01234567' })
      }
      const state = await fetch(a.baseUrl + '/__dsh_a2a/state').then(async r => await r.json() as Record<string, any>)
      expect(state.activity.some((x: any) => x.dir === 'fwd')).toBe(true)
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
  it('legacy unsigned and another host signer cannot borrow a local CLI deposit to forward', async () => {
    const { a, b } = await fixture()
    try {
      const body = { team: 'beta/01234567', message: 'not a local CLI proof', caller_session: handle, task_id: 'direct-forward-unsigned', wait: false }
      const unsigned = await post(a, '/a2a/direct', body)
      expect(unsigned.error).toContain('proven online local CLI')
      const url = a.baseUrl + '/a2a/direct'
      const privateKey = createPrivateKey(readFileSync(join(b.home, 'a2a', 'node-key.pem'), 'utf8'))
      const headers = signOriginClaim({ url, method: 'POST' }, { caller: b.team, callerUrl: b.baseUrl, privateKey, unbound: false, now: Date.now() })
      const foreign = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...body, task_id: 'direct-forward-foreign-signer' }) }).then(async r => await r.json() as any)
      expect(foreign.error).toContain('proven online local CLI')
      expect(b.steered).toHaveLength(0)
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
  it('uses the same scoped canvas directory for a deposited CLI and records the actual receiving member', async () => {
    const { a, b } = await fixture()
    try {
      await post(b, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: 'session-0123456789abcdef' })
      const reply = await route(a, 'direct-forward-canvas', true, undefined, 'beta/canvas/ops')
      expect(reply.routed, JSON.stringify(reply)).toBe(true)
      const ledger = JSON.parse(readFileSync(join(a.home, 'a2a', 'tasks.json'), 'utf8')) as { tasks: any[] }
      expect(ledger.tasks.find(row => row.taskId === 'direct-forward-canvas')).toMatchObject({ forwarded: true, team: 'beta/canvas/ops', deliveredTo: 'beta/01234567' })
    } finally { await a.dispose(); await b.dispose() }
  }, 30000)
  it('the 15-second synchronous transport budget returns DELIVERED-UNSETTLED and keeps one forwarded row', async () => {
    const { a, b } = await fixture({ longReply: true })
    try {
      ;(b.agents.agent as any).steer = (payload: unknown) => { b.steered.push(payload) }
      const response = await route(a, 'direct-forward-budget', false)
      expect(response.code, JSON.stringify(response)).toBe(-32005)
      expect(response.task_id).toBe('direct-forward-budget')
      const ledger = JSON.parse(readFileSync(join(a.home, 'a2a', 'tasks.json'), 'utf8')) as { tasks: any[] }
      expect(ledger.tasks.filter(row => row.taskId === 'direct-forward-budget')).toHaveLength(1)
      expect(ledger.tasks.find(row => row.taskId === 'direct-forward-budget')).toMatchObject({ direction: 'outbound', forwarded: true })
    } finally { await a.dispose(); await b.dispose() }
  }, 35000)
  it('a forwarded receipt hitting the real synchronous budget still says receipt:none and books no row', async () => {
    const { a, b } = await fixture({ longReply: true })
    try {
      ;(b.agents.agent as any).steer = (payload: unknown) => { b.steered.push(payload) }
      const reply = await route(a, 'direct-receipt-budget', false, undefined, 'beta/01234567', '[A2A receipt] task prior-work done')
      expect(reply).toMatchObject({ code: -32005, receipt: 'none', task_id: 'direct-receipt-budget' })
      const path = join(a.home, 'a2a', 'tasks.json')
      const ledger = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
      expect([...(ledger.tasks ?? []), ...(ledger.archived ?? [])].some((row: any) => row.taskId === 'direct-receipt-budget')).toBe(false)
    } finally { await a.dispose(); await b.dispose() }
  }, 35000)
  it('stale first candidate refuses without forwarding again, then the next real host accepts', async () => {
    const pa = await reservePort(), pb = await reservePort(), pc = await reservePort()
    const a = await bootNode({ name: 'A', home:seedCanvasHistory(tmpHome(),[{name:'ops',members:['beta/01234567']}]), session: 'fwd-failover-a', team: 'alpha', port: pa, peers: ['http://127.0.0.1:' + pb, 'http://127.0.0.1:' + pc], sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, forwardDirect: true, cardCacheTtlMs: 60_000, remoteRowsTtlMs: 60_000 })
    const b = await bootNode({ name: 'B', session: 'fwd-stale-b', team: 'beta', port: pb, peers: [a.baseUrl], sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, forwardDirect: true })
    const c = await bootNode({ name: 'C', session: 'fwd-live-c', team: 'beta', port: pc, peers: [a.baseUrl], sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true })
    try {
      const card = JSON.stringify(signCard({ name: 'ops-cli', session: 'cli-ops', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, cliKey))
      expect((await post(a, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
      for (const target of [b, c]) {
        await post(target, '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })
        expect((await post(target, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: a.baseUrl })).ok).toBe(true)
      }
      await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle })
      await post(a, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: 'beta/01234567' })
      // #325: hold this intentionally stale directory snapshot for the whole test, not the
      // harness 60ms TTL (which could expire between HTTP calls under parallel load).
      // Both candidates remain advertised while B really leaves; the original failover assertions stay.
      // Cache the advertised B row, then remove it. Resolution must fail over the stale positive.
      await a.ctx.tools.get('a2a_teams')!.execute({}, { signal: new AbortController().signal } as never)
      await post(b, '/__dsh_a2a/leave', { id: 'session-0123456789abcdef' })
      const realFetch = globalThis.fetch
      const dials: Array<{ url: string; guard: unknown; response: any }> = []
      vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
        const response = await realFetch(...args)
        const url = String(args[0])
        if ((url === b.baseUrl + '/a2a/direct' || url === c.baseUrl + '/a2a/direct') && args[1]?.method === 'POST') dials.push({ url, guard: new Headers(args[1]?.headers).get('X-A2A-Guard'), response: await response.clone().json() })
        return response
      })
      const result = await route(a, 'direct-forward-failover')
      expect(result.routed, JSON.stringify(result)).toBe(true)
      expect(dials.map(x => x.url)).toEqual([b.baseUrl + '/a2a/direct', c.baseUrl + '/a2a/direct'])
      expect(dials[0]!.response.error).toContain('already forwarded')
      expect(dials.every(x => typeof x.guard === 'string')).toBe(true)
      expect(b.steered).toHaveLength(0)
      expect(c.steered).toHaveLength(1)
      const state = await fetch(b.baseUrl + '/__dsh_a2a/state').then(async r => await r.json() as any)
      expect(state.activity.some((x: any) => x.dir === 'fwd')).toBe(false)
    } finally { await a.dispose(); await b.dispose(); await c.dispose() }
  }, 30000)
  for (const [name, options, guard, reason] of [
    ['disabled', { enabled: false }, undefined, 'forwardDirect is off'],
    ['isolated', { isolated: true, linked: false }, undefined, 'isolated'],
    ['outside-scope', { linked: false }, undefined, 'outside sender scope'],
    ['already-forwarded', {}, guardHeader({ visitToken: 'prior', hopBudget: 3 }), 'already forwarded'],
    ['malformed-guard', {}, 'malformed-not-a-first-hop', 'already forwarded'],
  ] as const) it(name + ' is a visible non-forwarding local miss', async () => {
    const { a, b } = await fixture(options)
    try {
      const result = await route(a, 'direct-forward-' + name, true, guard); expect(result.error).toContain(reason); expect(b.steered).toHaveLength(0)
      // #282 S1: the wire face carries the next step; a guard refusal has none.
      if (guard === undefined) expect(typeof result.next).toBe('string'); else expect(result.next).toBeUndefined()
    }
    finally { await a.dispose(); await b.dispose() }
  }, 30000)
})
