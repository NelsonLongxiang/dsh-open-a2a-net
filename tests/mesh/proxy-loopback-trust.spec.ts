// @vitest-environment node
/**
 * A reverse proxy on the node's own host (Caddy, nginx, a tunnel agent) connects over loopback for every
 * remote client. Loopback trust — the workbench shell's injected apiKey on a keyed host, and keyless control —
 * must not reach a request that carries a forwarding header, or a public HTTPS front leaks the key to anyone.
 */
import { describe, expect, it } from 'vitest'
import { bootNode, reservePort } from './harness.ts'

const proxied = [{ 'X-Forwarded-For': '203.0.113.7' }, { Forwarded: 'for=203.0.113.7;proto=https' }, { 'X-Real-IP': '203.0.113.7' }]

describe('proxy-fronted loopback is not the local operator', () => {
  it('the keyed workbench shell carries the key only to a direct loopback GET', async () => {
    const node = await bootNode({ name: 'P', session: 'proxy-keyed', team: 'alpha', port: await reservePort(), sessionNodes: true, apiKey: 'proxy-test-key' })
    try {
      const shell = async (headers: Record<string, string> = {}): Promise<string> => await (await fetch(node.baseUrl + '/__dsh_a2a_nexus/', { headers })).text()
      expect(await shell()).toContain('__DSH_A2A_KEY__')
      for (const headers of proxied) {
        const html = await shell(headers)
        expect(html, JSON.stringify(headers)).toContain('</head>')
        expect(html, JSON.stringify(headers)).not.toContain('proxy-test-key')
        expect(html, JSON.stringify(headers)).not.toContain('__DSH_A2A_KEY__')
      }
      // The key itself still works through the proxy.
      expect((await fetch(node.baseUrl + '/__dsh_a2a/state', { headers: { ...proxied[0], 'X-API-Key': 'proxy-test-key' } })).status).toBe(200)
    } finally { await node.dispose() }
  })
  it('a keyless host trusts a direct loopback caller but not one a proxy forwarded', async () => {
    const node = await bootNode({ name: 'Q', session: 'proxy-keyless', team: 'alpha', port: await reservePort(), sessionNodes: true })
    try {
      expect((await fetch(node.baseUrl + '/__dsh_a2a/state')).status).toBe(200)
      for (const headers of proxied) expect((await fetch(node.baseUrl + '/__dsh_a2a/state', { headers })).status, JSON.stringify(headers)).not.toBe(200)
    } finally { await node.dispose() }
  })
})
