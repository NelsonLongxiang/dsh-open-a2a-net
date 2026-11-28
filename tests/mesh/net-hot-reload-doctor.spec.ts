// @vitest-environment node
/**
 * #838 H + A on real hosts: a home-layer write changes the four hot network keys without a restart (the state face, the
 * warm card cache and the doctor all follow), and the double-sided check works between two real peers and refuses a
 * stranger without saying why.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Config } from '../../src/config.ts'
import { writeHomeA2a } from '../../src/owner-settings.ts'
import { bootNode, reservePort } from './harness.ts'

const fs = { exists: existsSync, read: (p: string) => readFileSync(p, 'utf8'), write: (p: string, s: string) => writeFileSync(p, s, 'utf8'), mkdir: (p: string) => { mkdirSync(p, { recursive: true }) } }
const defaults = Config({} as never) as unknown as Record<string, unknown>
type State = { peers: Array<{ url: string; name?: string }>; host: { originClaimAudiences: string[]; originClaimByPeer: Record<string, string> } }
const stateOf = async (base: string) => await (await fetch(base + '/__dsh_a2a/state')).json() as State
const waitFor = async (check: () => Promise<boolean>, what: string): Promise<void> => {
  for (let i = 0; i < 100; i += 1) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error('timed out waiting for ' + what)
}

describe('hot network keys on a real host', () => {
  it('a home write shows at once in the state face and the doctor, and a removed peer loses its warm card', async () => {
    const portA = await reservePort(); const portC = await reservePort()
    const c = await bootNode({ name: 'C', session: 'hot-c', team: 'gamma', port: portC, sessionNodes: true, peers: [`http://127.0.0.1:${String(portA)}`] })
    const a = await bootNode({ name: 'A', session: 'hot-a', team: 'alpha', port: portA, sessionNodes: true, peers: [c.baseUrl], originClaimAudiences: ['http://alias.example:1'], originClaimByPeer: { [c.baseUrl]: 'http://self-c.example:2' } })
    try {
      await waitFor(async () => (await stateOf(a.baseUrl)).peers.some(peer => peer.url === c.baseUrl && peer.name !== undefined), 'the peer card to be cached')
      expect((await stateOf(a.baseUrl)).host.originClaimAudiences).toEqual(['http://alias.example:1'])
      const written = writeHomeA2a(a.home, { network: { peers: [], originClaimAudiences: [], originClaimByPeer: {} } }, Config({ peers: [c.baseUrl] } as never) as never, defaults, fs)
      expect(written).toMatchObject({ ok: true })
      // No restart, no waiting: the very next read already shows the tightened configuration.
      const after = await stateOf(a.baseUrl)
      expect(after.peers.find(peer => peer.url === c.baseUrl)).toBeUndefined()
      expect(after.host).toMatchObject({ originClaimAudiences: [], originClaimByPeer: {} })
      const doctor = await (await fetch(a.baseUrl + '/__dsh_a2a/net-doctor')).json() as { rows: Array<{ key: string; running: unknown; source: string; fileState: string }> }
      expect(doctor.rows.find(row => row.key === 'peers')).toMatchObject({ running: [], source: 'home', fileState: 'same' })
    } finally { await a.dispose(); await c.dispose() }
  })

  it('a malformed written value is ignored and the previous configuration keeps running', async () => {
    const a = await bootNode({ name: 'A', session: 'hot-bad', team: 'alpha', port: await reservePort(), sessionNodes: true, originClaimAudiences: ['http://alias.example:1'] })
    try {
      writeHomeA2a(a.home, { network: { originClaimAudiences: 'not-a-list' as never } }, Config({} as never) as never, defaults, fs)
      expect((await stateOf(a.baseUrl)).host.originClaimAudiences).toEqual(['http://alias.example:1'])
    } finally { await a.dispose() }
  })
})

describe('the double-sided check between two real peers', () => {
  it('a peer that has us answers with facts about us; one that does not have us refuses without a reason', async () => {
    const portA = await reservePort(); const portC = await reservePort(); const portD = await reservePort()
    const a = await bootNode({ name: 'A', session: 'lc-a', team: 'alpha', port: portA, sessionNodes: true, peers: [`http://127.0.0.1:${String(portC)}`, `http://127.0.0.1:${String(portD)}`] })
    const c = await bootNode({ name: 'C', session: 'lc-c', team: 'gamma', port: portC, sessionNodes: true, peers: [a.baseUrl] })
    const stranger = await bootNode({ name: 'D', session: 'lc-d', team: 'delta', port: portD, sessionNodes: true })
    try {
      const own = async (peer: string) => await (await fetch(a.baseUrl + '/__dsh_a2a/net-doctor?peer=' + encodeURIComponent(peer))).json() as { ok: boolean; peerCheck: { status: string; httpStatus?: number; answer?: { you: Record<string, unknown> } } }
      const known = await own(c.baseUrl)
      expect(known.peerCheck.status).toBe('ok')
      expect(known.peerCheck.answer!.you).toMatchObject({ caller: 'alpha', inPeers: true })
      // The only address in the answer is the one the caller itself dialled (the Host header), never a socket address.
      expect(known.peerCheck.answer!.you.dialledHost).toBe('127.0.0.1:' + String(portC))
      expect(Object.keys(known.peerCheck.answer!)).toEqual(['ok', 'you'])
      const refused = await own(stranger.baseUrl)
      expect(refused.peerCheck).toMatchObject({ status: 'refused', httpStatus: 404 })
      const notPeer = await fetch(a.baseUrl + '/__dsh_a2a/net-doctor?peer=' + encodeURIComponent('http://elsewhere.example:9'))
      expect(notPeer.status).toBe(400)
    } finally { await a.dispose(); await c.dispose(); await stranger.dispose() }
  })
})
