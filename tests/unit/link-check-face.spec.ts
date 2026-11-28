// @vitest-environment node
/** #838 A: the link-check gate order. Nothing before the claim step may reach the network, and no refusal says why. */
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { LINK_CHECKS_PER_MINUTE, registerNetDoctorFaces, type NetDoctorFaceDeps } from '../../src/faces/net-doctor.ts'

type Handler = (req: never, res: never) => void | Promise<void>
function setup(over: Partial<NetDoctorFaceDeps> = {}) {
  const handlers = new Map<string, Handler>()
  const webServer = { register: (r: { path: string; handler: Handler }) => { handlers.set(r.path, r.handler); return () => {} } }
  const calls = { verify: vi.fn(), admits: vi.fn(), precheck: vi.fn(), configured: vi.fn() }
  const deps: NetDoctorFaceDeps = {
    ctx: { effect: (fn: () => unknown) => { fn() } } as never,
    controlRoute: h => h as never,
    report: () => ({ rows: [], findings: [] }),
    keyPrecheck: req => { calls.precheck(req); return true },
    peerConfigured: url => { calls.configured(url); return true },
    verifyOriginClaim: async (...args) => { calls.verify(...args); return { ok: true, caller: 'zone-b', callerUrl: 'http://b.example:1/', bound: true, bodyBound: true } as never },
    peerKeyAdmits: async (...args) => { calls.admits(...args); return true },
    boundMisses: () => [{ caller: 'zone-b', audience: 'http://dialled.example:9', count: 2, lastAt: 5 }, { caller: 'zone-c', audience: 'http://other.example:9', count: 1, lastAt: 6 }],
    pinnedCliHomes: () => [['zone-b/cli-1', 'http://b.example:1'], ['zone-c/cli-2', 'http://c.example:1']],
    ...over,
  }
  registerNetDoctorFaces(webServer as never, deps)
  const call = async (path: string, init: { method?: string; headers?: Record<string, string>; body?: string; remote?: string } = {}) => {
    const req = Object.assign(Readable.from([Buffer.from(init.body ?? '{}')]), { method: init.method ?? 'POST', headers: { host: 'me.example:3', 'x-a2a-caller-url': 'http://b.example:1/', ...(init.headers ?? {}) }, socket: { remoteAddress: init.remote ?? '10.0.0.9' } })
    let status = 0; let body = ''
    await handlers.get(path)!(req as never, { writeHead: (s: number) => { status = s }, end: (b: string) => { body = b } } as never)
    return { status, body: body === '' ? {} : JSON.parse(body) as Record<string, unknown> }
  }
  return { call, calls }
}

describe('POST /a2a/link-check', () => {
  it('answers a verified, configured peer with facts about itself only', async () => {
    const { call } = setup()
    const res = await call('/a2a/link-check')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, you: { caller: 'zone-b', callerUrl: 'http://b.example:1/', inPeers: true, dialledHost: 'me.example:3', audienceMisses: [{ audience: 'http://dialled.example:9', count: 2, lastAt: 5 }], pinnedCliHomes: [{ handle: 'zone-b/cli-1', home: 'http://b.example:1' }] } })
    const text = JSON.stringify(res.body)
    expect(text).not.toContain('10.0.0.9')
    expect(text).not.toContain('zone-c')
  })
  it('a wrong key is a 404 and nothing else runs: no peer lookup, no claim verification', async () => {
    const { call, calls } = setup({ keyPrecheck: () => false })
    expect(await call('/a2a/link-check')).toEqual({ status: 404, body: { ok: false, error: 'not found' } })
    expect(calls.configured).not.toHaveBeenCalled()
    expect(calls.verify).not.toHaveBeenCalled()
  })
  it('a caller URL that is not already a peer is a 404 and the claim is NOT verified (no outbound fetch of a self-declared URL)', async () => {
    const { call, calls } = setup({ peerConfigured: () => false })
    expect(await call('/a2a/link-check')).toEqual({ status: 404, body: { ok: false, error: 'not found' } })
    expect(calls.verify).not.toHaveBeenCalled()
    expect(calls.admits).not.toHaveBeenCalled()
  })
  it('a missing caller URL header is the same 404', async () => {
    const { call, calls } = setup()
    expect(await call('/a2a/link-check', { headers: { 'x-a2a-caller-url': '' } })).toEqual({ status: 404, body: { ok: false, error: 'not found' } })
    expect(calls.verify).not.toHaveBeenCalled()
  })
  it('every refusal looks alike: failed claim, unbound, unbodied, CLI identity, failed key gate, wrong method, oversized body', async () => {
    const notFound = { status: 404, body: { ok: false, error: 'not found' } }
    expect(await setup({ verifyOriginClaim: async () => ({ ok: false, reason: 'bad-sig' }) as never }).call('/a2a/link-check')).toEqual(notFound)
    expect(await setup({ verifyOriginClaim: async () => ({ ok: true, caller: 'c', callerUrl: 'u', bound: false, bodyBound: true }) as never }).call('/a2a/link-check')).toEqual(notFound)
    expect(await setup({ verifyOriginClaim: async () => ({ ok: true, caller: 'c', callerUrl: 'u', bound: true, bodyBound: false }) as never }).call('/a2a/link-check')).toEqual(notFound)
    expect(await setup({ verifyOriginClaim: async () => ({ ok: true, caller: 'c', callerUrl: 'u', bound: true, bodyBound: true, cli: true }) as never }).call('/a2a/link-check')).toEqual(notFound)
    expect(await setup({ peerKeyAdmits: async () => false }).call('/a2a/link-check')).toEqual(notFound)
    expect(await setup().call('/a2a/link-check', { method: 'GET' })).toEqual(notFound)
    expect(await setup().call('/a2a/link-check', { body: 'x'.repeat(5000) })).toEqual(notFound)
  })
  it('limits per source address before any gate, and a different address still gets through', async () => {
    const { call, calls } = setup({ keyPrecheck: () => false })
    for (let i = 0; i < LINK_CHECKS_PER_MINUTE; i += 1) expect((await call('/a2a/link-check')).status).toBe(404)
    expect((await call('/a2a/link-check')).status).toBe(429)
    expect((await call('/a2a/link-check', { remote: '10.0.0.77' })).status).toBe(404)
    expect(calls.verify).not.toHaveBeenCalled()
  })
})

describe('GET /__dsh_a2a/net-doctor', () => {
  it('serves the host report through the control gate and only to GET', async () => {
    const { call } = setup()
    expect(await call('/__dsh_a2a/net-doctor', { method: 'GET' })).toEqual({ status: 200, body: { ok: true, rows: [], findings: [] } })
    expect((await call('/__dsh_a2a/net-doctor', { method: 'POST' })).status).toBe(405)
  })
})
