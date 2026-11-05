// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { bootNode } from './harness.ts'
const listen = async (server: Server): Promise<string> => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); return 'http://127.0.0.1:' + String((server.address() as AddressInfo).port) }
const close = async (server: Server): Promise<void> => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
describe('#320 fleet canvas relay honors peer HTTP failure', () => {
  for (const status of [302, 503]) it('rejects HTTP ' + status + ' even when its JSON says ok:true', async () => {
    let redirected = 0, cardReads = 0, operations = 0
    const sink = createServer((_req, res) => { redirected++; res.end('{}') })
    const sinkUrl = await listen(sink)
    const peer = createServer((req, res) => {
      if (req.url?.startsWith('/.well-known/')) { cardReads++; res.writeHead(404); res.end(); return }
      operations++
      res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 302 ? { Location: sinkUrl + '/never' } : {}) })
      res.end(JSON.stringify({ ok: true, members: ['pretend/member'] }))
    })
    const peerUrl = await listen(peer)
    const node = await bootNode({ name: 'status-test', session: 'status-' + status, team: 'alpha', sessionNodes: true, peers: [peerUrl] })
    try {
      const reply = await fetch(node.baseUrl + '/__dsh_a2a/fleet-canvas-op', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peer: peerUrl, op: 'create', name: 'test' }) })
      expect(reply.status).toBe(200) // the local control face retains its existing JSON outcome contract
      const body = await reply.json()
      expect(body).toMatchObject({ ok: false, status, error: expect.stringContaining('HTTP ' + status) })
      expect(body.members).toBeUndefined()
      expect(operations).toBe(1)
      expect(redirected).toBe(0)
      expect(cardReads).toBe(0) // a failed op must not refresh a supposedly changed owner's card
    } finally { await node.dispose(); await close(peer); await close(sink) }
  })
})
