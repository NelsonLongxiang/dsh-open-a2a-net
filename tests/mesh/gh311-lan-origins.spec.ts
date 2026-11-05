// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { networkInterfaces } from 'node:os'
import { selectLanIPv4 } from '../../src/lan-ip.ts'
import { bootNode, ghostNode, craftCard, reservePort, runContext } from './harness.ts'

const state = async (url: string): Promise<any> => { const r = await fetch(url + '/__dsh_a2a/state'); const text = await r.text(); expect(r.status, text || 'empty state response').toBe(200); return JSON.parse(text) }
describe('#311 state projection on real adapters and origin aliases', () => {
  it.each([undefined, 'http://explicit.example:13080'])('publishes ranked adapters and signs with override=%s', async (override) => {
    const interfaces = networkInterfaces()
    const expected = selectLanIPv4(interfaces)
    const node = await bootNode({ name: 'lan311', session: 'lan311', team: 'lab', sessionNodes: true, host: '0.0.0.0', ...(override === undefined ? {} : { originClaimUrl: override }) })
    try {
      expect((await state(node.baseUrl)).host.lanIp).toBe(expected)
      // Outbound claim signing must keep the explicit advertised origin, not replace it with the chosen LAN IP.
      let callerUrl: string | undefined
      const remote = await bootNode({ name: 'remote311', session: 'remote311', team: 'other', sessionNodes: true, peers: [node.baseUrl] })
      try {
        const rawFetch = globalThis.fetch
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
          const headers = new Headers(init?.headers)
          if (headers.has('X-A2A-Caller-Url')) callerUrl = headers.get('X-A2A-Caller-Url') ?? undefined
          return rawFetch(input, init)
        })
        try {
          await node.ctx.tools.get('a2a_probe')!.execute({ url: remote.baseUrl }, runContext())
          expect(callerUrl).toBe(override ?? 'http://' + (expected || '127.0.0.1') + ':' + node.port)
        } finally { fetchSpy.mockRestore() }
      } finally { await remote.dispose() }
      console.log('gh311 real-adapter state', JSON.stringify({ at: new Date().toISOString(), interfaces: Object.values(interfaces).flat().filter(r => r?.family === 'IPv4').map(r => r?.address), host: (await state(node.baseUrl)).host }))
    } finally { await node.dispose() }
  })
  it('state peers[].link recognizes the configured audience origin', async () => {
    const pa = await reservePort()
    const alias = 'http://localhost:' + pa
    // Signed fixture isolates badge alias projection from the newer peers relationship-disclosure gate.
    const core = craftCard({ name: 'b311', session: 'b311', team: 'beta', expiresAt: Date.now() + 60_000 }).card
    const b = await ghostNode({ ...core, peers: [alias] })
    const a = await bootNode({ name: 'a311', session: 'a311', team: 'alpha', sessionNodes: true, port: pa, peers: [b.baseUrl], originClaimAudiences: [alias], teamScopeInfo: false })
    try {
      await a.ctx.tools.get('a2a_probe')!.execute({ url: b.baseUrl }, runContext())
      await vi.waitFor(async () => {
        const s = await state(a.baseUrl)
        expect(s.peers.find((p: any) => p.url === b.baseUrl)).toMatchObject({ link: 'linked', verified: true })
      })
      console.log('gh311 alias-state', JSON.stringify({ at: new Date().toISOString(), host: (await state(a.baseUrl)).host, peers: (await state(a.baseUrl)).peers.map((p: any) => ({url:p.url, link:p.link, verified:p.verified})) }))
    } finally { await a.dispose(); await b.close() }
  })
})
