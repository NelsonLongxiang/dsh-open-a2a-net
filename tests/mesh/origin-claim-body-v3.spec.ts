// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPrivateKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootNode, reservePort, runContext, type MeshNode } from './harness.ts'
import { signOriginClaim, originBodySha256 } from '../../src/origin-claim.ts'
const nodes: MeshNode[] = []
afterEach(async () => { for (const n of nodes.splice(0)) await n.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const post = async (url: string, body: unknown, headers = {}): Promise<any> => await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(r => r.json())
async function pair() {
  vi.stubGlobal('WebSocket', function () { throw Error('no socket') })
  const pa = await reservePort(), pb = await reservePort()
  const a = await bootNode({ name: 'A', session: 'v3-a', team: 'dsh', agentId: 'session-aaaaaaaa11112222', port: pa, peers: ['http://127.0.0.1:' + pb], sessionNodes: true, originClaimUnboundWindow: true, targetQueueCap: 0 })
  nodes.push(a)
  const b = await bootNode({ name: 'B', session: 'v3-b', team: 'dsh', port: pb, peers: [a.baseUrl], sessionNodes: true, originClaimUnboundWindow: true, targetQueueCap: 0 })
  nodes.push(b)
  await post(b.baseUrl + '/__dsh_a2a/join', { id: 'session-0123456789abcdef' })
  await b.ctx.tools.get('a2a_teams')!.execute({}, runContext()) // warm the tracked caller card for canvas-changed
  const key = createPrivateKey(readFileSync(join(a.home, 'a2a', 'node-key.pem'), 'utf8'))
  const sign = (path: string, body?: string) => signOriginClaim({ url: b.baseUrl + path, method: 'POST', ...(body !== undefined ? { body } : {}) }, { caller: a.team, callerUrl: a.baseUrl, privateKey: key, unbound: true, now: Date.now() })
  return { a, b, sign }
}
describe('#227 native body-bound peer envelopes', () => {
  it.each(['/a2a/direct', '/a2a/canvas-op', '/a2a/canvas-changed'])('%s accepts exact bytes/v2 legacy and rejects tampered or relabelled v2 signatures before effects', async path => {
    const { b, sign } = await pair()
    const object = path === '/a2a/direct' ? { team: 'dsh/01234567', caller_session: 'dsh', message: 'signed 中文', task_id: 'v3-good', wait: false } : path === '/a2a/canvas-op' ? { op: 'create', name: 'v3-canvas' } : {}
    const body = '  ' + JSON.stringify(object), headers = sign(path, body)
    expect(headers['X-A2A-Caller-Sig2']).toBeTypeOf('string')
    expect(headers['X-A2A-Caller-Sig3']).toBeTypeOf('string')
    const before = b.steered.length
    const wrongBytes = await post(b.baseUrl + path, JSON.stringify(object), headers)
    expect(String(wrongBytes.error)).toContain('body-mismatch')
    const changed = JSON.stringify({ ...object, injected: 'modified body' })
    const resignedDigestOnly = await post(b.baseUrl + path, changed, { ...headers, 'X-A2A-Body-Sha256': originBodySha256(changed) })
    expect(String(resignedDigestOnly.error)).toContain('bad-sig')
    const emptyV3 = await post(b.baseUrl + path, body, { ...headers, 'X-A2A-Caller-Sig3': '' })
    expect(String(emptyV3.error)).toContain('body-mismatch')
    const relabel = await post(b.baseUrl + path, body, { ...headers, 'X-A2A-Caller-Sig3': headers['X-A2A-Caller-Sig2']! })
    expect(String(relabel.error)).toContain('bad-sig')
    const badSig = await post(b.baseUrl + path, body, { ...headers, 'X-A2A-Caller-Sig3': Buffer.alloc(64).toString('base64') })
    expect(String(badSig.error)).toContain('bad-sig')
    expect(b.steered).toHaveLength(before)
    if (path === '/a2a/canvas-op') {
      const s = await fetch(b.baseUrl + '/__dsh_a2a/state').then(r => r.json()) as any
      expect(s.canvas.teams.some((team: any) => team.name === 'v3-canvas')).toBe(false)
    }
    const good = await post(b.baseUrl + path, body, headers)
    expect(path === '/a2a/direct' ? good.delivered : good.ok, JSON.stringify(good)).toBe(true)
    const legacyObject = path === '/a2a/direct' ? { ...object, task_id: 'v2-old' } : path === '/a2a/canvas-op' ? { op: 'create', name: 'v2-canvas' } : {}
    const legacyBody = JSON.stringify(legacyObject)
    const legacy = sign(path)
    delete legacy['X-A2A-Caller-Sig'] // only Sig2, not unbound fallback
    const accepted = await post(b.baseUrl + path, legacyBody, legacy)
    expect(path === '/a2a/direct' ? accepted.delivered : accepted.ok, JSON.stringify(accepted)).toBe(true)
  })
  it('real outbound direct, canvas-op and change notification all sign the same bytes they send', async () => {
    const { a, b } = await pair()
    await post(a.baseUrl + '/__dsh_a2a/join', { id: 'session-aaaaaaaa11112222' })
    for (const n of [a, b]) {
      await post(n.baseUrl + '/__dsh_a2a/canvas', { action: 'create', name: 'shared' })
      for (const id of ['dsh/aaaaaaaa', 'dsh/01234567']) await post(n.baseUrl + '/__dsh_a2a/canvas', { action: 'add-member', name: 'shared', id })
    }
    const seen: Array<{ path: string; body: string; headers: Record<string, string> }> = []
    const original = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname
      if (String(url).startsWith(b.baseUrl) && ['/a2a/direct', '/a2a/canvas-op', '/a2a/canvas-changed'].includes(path) && typeof init?.body === 'string') seen.push({ path, body: init.body, headers: init.headers as Record<string, string> })
      return await original(url, init)
    })
    const routed = await a.ctx.tools.get('a2a_route')!.execute({ team: 'dsh/01234567', message: 'outbound signed', async: true }, runContext(a.agents.agent)) as any
    expect(routed.ok, JSON.stringify(routed)).toBe(true)
    expect((await post(a.baseUrl + '/__dsh_a2a/fleet-canvas-op', { peer: b.baseUrl, op: 'create', name: 'signed-op' })).ok).toBe(true)
    await post(a.baseUrl + '/__dsh_a2a/canvas', { action: 'create', name: 'notify' })
    await post(a.baseUrl + '/__dsh_a2a/canvas', { action: 'add-member', name: 'notify', id: 'dsh/01234567' })
    await vi.waitFor(() => expect(seen.some(row => row.path === '/a2a/canvas-changed')).toBe(true), { timeout: 5000 })
    for (const path of ['/a2a/direct', '/a2a/canvas-op', '/a2a/canvas-changed']) {
      const row = seen.find(row => row.path === path)!
      expect(row, path).toBeDefined()
      expect(row.headers['X-A2A-Caller-Sig2']).toBeTypeOf('string')
      expect(row.headers['X-A2A-Caller-Sig3']).toBeTypeOf('string')
      expect(row.headers['X-A2A-Body-Sha256']).toBe(originBodySha256(row.body))
    }
  })
})
