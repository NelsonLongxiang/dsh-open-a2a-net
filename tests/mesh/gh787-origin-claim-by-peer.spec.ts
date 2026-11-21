// @vitest-environment node
/**
 * #787: per-peer OriginClaim callerUrl selection on real plugin nodes.
 * Example addresses from the issue are unit-tested; this file uses loopback
 * ports as LAN vs TS stand-ins so nothing here names a real host, key, or handle.
 */
import net from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootNode, reservePort, runContext, steerText } from './harness.ts'

const SCOPE = { teamScopeRouting: false, teamScopeInfo: false, sessionNodes: true } as const

/**
 * The TS stand-in: a second loopback origin for the same host. Linux routes all of 127/8 to lo, so 127.0.0.2 works there
 * (bound on 0.0.0.0, as before). macOS has only 127.0.0.1 on lo0 unless an alias is added, and a connect to 127.0.0.2
 * hangs; there the stand-in is the `localhost` spelling of the same 0.0.0.0 bind (the test web server binds only
 * 127.0.0.1 or 0.0.0.0). Both are loopback to the claim checks (origin-claim.ts) and a distinct origin from 127.0.0.1, so
 * the test means the same on either platform; nothing is skipped.
 */
async function secondLoopback(): Promise<{ readonly bind: string; readonly host: string }> {
  const reachable = await new Promise<boolean>(resolve => {
    const server = net.createServer().listen(0, '0.0.0.0', () => {
      const socket = net.connect({ host: '127.0.0.2', port: (server.address() as net.AddressInfo).port })
      const done = (ok: boolean): void => { socket.destroy(); server.close(); resolve(ok) }
      socket.setTimeout(500)
      socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false))
    })
  })
  return reachable ? { bind: '0.0.0.0', host: '127.0.0.2' } : { bind: '0.0.0.0', host: 'localhost' }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

const stateOf = async (url: string): Promise<any> => {
  const r = await fetch(`${url}/__dsh_a2a/state`)
  const text = await r.text()
  expect(r.status, text || 'empty state').toBe(200)
  return JSON.parse(text)
}

async function callerUrlSentTo(target: string, action: () => Promise<unknown>): Promise<string | undefined> {
  let callerUrl: string | undefined
  const raw = globalThis.fetch
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    if (url.startsWith(target) && headers.has('X-A2A-Caller-Url')) callerUrl = headers.get('X-A2A-Caller-Url') ?? undefined
    return raw(input, init)
  })
  try {
    await action()
    return callerUrl
  } finally { spy.mockRestore() }
}

describe('#787 per-peer OriginClaim callerUrl (mesh)', () => {
  it('unconfigured: a LAN peer still receives the default callerUrl and a bilateral link', async () => {
    const portA = await reservePort()
    const b = await bootNode({ ...SCOPE, name: 'lan-b', session: 'mesh-787-b', team: 'beta', peers: [`http://127.0.0.1:${String(portA)}`] })
    const a = await bootNode({ ...SCOPE, name: 'lan-a', session: 'mesh-787-a/1a2b3c4d', team: 'alpha', port: portA, peers: [b.baseUrl] })
    try {
      const callerUrl = await callerUrlSentTo(b.baseUrl, async () => {
        await a.ctx.tools.get('a2a_probe')!.execute({ url: b.baseUrl }, runContext())
      })
      expect(callerUrl).toBe(a.baseUrl)
      await vi.waitFor(async () => {
        const peers = (await stateOf(a.baseUrl)).peers as Array<{ url: string; link: string; verified: boolean }>
        expect(peers.find(row => row.url === b.baseUrl)).toMatchObject({ link: 'linked', verified: true })
      })
      const routed = await a.ctx.tools.get('a2a_route')!.execute({ team: 'beta', message: 'ping lan' }, runContext()) as { ok: boolean; reply?: string }
      expect(routed.ok, JSON.stringify(routed)).toBe(true)
      expect(routed.reply).toContain('ok from lan-b:')
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })

  it('declares TS only to the named cloud peer; the LAN peer still sees LAN; admission matches display; receipts keep their task id', async () => {
    const portD = await reservePort()
    // Same process, two loopback origins: 127.0.0.1 is LAN, the second loopback stands in for the Tailscale address (issue examples are unit-tested).
    const second = await secondLoopback()
    const lan = `http://127.0.0.1:${String(portD)}`
    const ts = `http://${second.host}:${String(portD)}`
    const portL = await reservePort()
    const portC = await reservePort()
    const lanPeer = await bootNode({ ...SCOPE, name: 'lan-peer', session: 'mesh-787-lan', team: 'lanpeer', port: portL, peers: [lan] })
    const cloud = await bootNode({ ...SCOPE, name: 'cloud', session: 'mesh-787-cloud/aabbccdd', team: 'cloud', port: portC, peers: [ts] })
    const host = await bootNode({
      ...SCOPE,
      name: 'dsh-host',
      session: 'mesh-787-dsh/11223344',
      team: 'dsh',
      host: second.bind,
      port: portD,
      originClaimUrl: lan,
      originClaimByPeer: { [cloud.baseUrl]: ts },
      peers: [lanPeer.baseUrl, cloud.baseUrl],
    })
    try {
      expect((await stateOf(host.baseUrl)).host.originClaimByPeer).toEqual({ [cloud.baseUrl]: ts })

      const toLan = await callerUrlSentTo(lanPeer.baseUrl, async () => {
        await host.ctx.tools.get('a2a_probe')!.execute({ url: lanPeer.baseUrl }, runContext())
      })
      expect(toLan).toBe(lan)

      const toCloud = await callerUrlSentTo(cloud.baseUrl, async () => {
        await host.ctx.tools.get('a2a_probe')!.execute({ url: cloud.baseUrl }, runContext())
      })
      expect(toCloud).toBe(ts)

      await vi.waitFor(async () => {
        const s = await stateOf(host.baseUrl)
        const rows = s.peers as Array<{ url: string; link: string; verified: boolean }>
        expect(rows.find(row => row.url === cloud.baseUrl)).toMatchObject({ link: 'linked', verified: true })
        expect(rows.find(row => row.url === lanPeer.baseUrl)).toMatchObject({ link: 'linked', verified: true })
      })

      expect((await fetch(`${host.baseUrl}/__dsh_a2a/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'session-0123456789abcdef' }) }).then(r => r.json()) as { ok?: boolean }).ok).not.toBe(false)
      const outbound = await host.ctx.tools.get('a2a_route')!.execute({ team: 'cloud', message: 'via mapped claim', async: true }, runContext(host.agents.agent)) as { ok: boolean; task_id?: string }
      expect(outbound.ok, JSON.stringify(outbound)).toBe(true)
      expect(typeof outbound.task_id).toBe('string')
      const taskId = outbound.task_id!
      await vi.waitFor(async () => {
        expect(steerText(cloud.steered.at(-1))).toContain('via mapped claim')
      })
      await vi.waitFor(async () => {
        const tasks = (await stateOf(host.baseUrl)).tasks as Array<{ taskId: string; status: string }>
        const row = tasks.find(item => item.taskId === taskId)
        expect(row, 'original transport/task id must be kept').toBeDefined()
        expect(row!.taskId).toBe(taskId)
      })

      const inbound = await cloud.ctx.tools.get('a2a_route')!.execute({ team: 'dsh', message: 'cloud back to dsh' }, runContext()) as { ok: boolean; reply?: string }
      expect(inbound.ok, JSON.stringify(inbound)).toBe(true)
      expect(inbound.reply).toContain('ok from dsh-host:')
    } finally {
      await host.dispose()
      await cloud.dispose()
      await lanPeer.dispose()
    }
  })

  it('a LAN peer that lists only the TS address is neither admitted nor shown as linked', async () => {
    const portD = await reservePort()
    const second = await secondLoopback()
    const lan = `http://127.0.0.1:${String(portD)}`
    const ts = `http://${second.host}:${String(portD)}`
    const portL = await reservePort()
    const portC = await reservePort()
    const lanPeer = await bootNode({ ...SCOPE, name: 'lan-only-ts', session: 'mesh-787-lants', team: 'lanpeer', port: portL, peers: [ts] })
    const cloud = await bootNode({ ...SCOPE, name: 'cloud-ts', session: 'mesh-787-cloud2', team: 'cloud', port: portC, peers: [ts] })
    const host = await bootNode({
      ...SCOPE,
      name: 'dsh-host',
      session: 'mesh-787-dsh2',
      team: 'dsh',
      host: second.bind,
      port: portD,
      originClaimUrl: lan,
      originClaimByPeer: { [cloud.baseUrl]: ts },
      peers: [lanPeer.baseUrl, cloud.baseUrl],
    })
    try {
      await host.ctx.tools.get('a2a_probe')!.execute({ url: lanPeer.baseUrl }, runContext())
      await host.ctx.tools.get('a2a_probe')!.execute({ url: cloud.baseUrl }, runContext())
      await vi.waitFor(async () => {
        const rows = (await stateOf(host.baseUrl)).peers as Array<{ url: string; link: string; verified: boolean }>
        expect(rows.find(row => row.url === lanPeer.baseUrl)).toMatchObject({ link: 'stranger', verified: true })
        expect(rows.find(row => row.url === cloud.baseUrl)).toMatchObject({ link: 'linked', verified: true })
      })
    } finally {
      await host.dispose()
      await cloud.dispose()
      await lanPeer.dispose()
    }
  })
})
