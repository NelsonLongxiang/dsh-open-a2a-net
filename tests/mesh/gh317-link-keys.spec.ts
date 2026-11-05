// @vitest-environment node
/**
 * #317 link keys: two keyed hosts with DIFFERENT apiKeys link through one shared link key. On the peer faces a
 * link key admits only the host it belongs to — a verified OriginClaim naming that origin, body-bound on a
 * POST — and it never opens a control route. Each host's own apiKey keeps working as before.
 */
import { describe, expect, it } from 'vitest'
import { createPrivateKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { bootNode, reservePort, type MeshNode } from './harness.ts'

const LINK = 'link-key-a-b-0123456789abcdef'
const keyOf = (node: MeshNode) => createPrivateKey(readFileSync(join(node.home, 'a2a', 'node-key.pem'), 'utf8'))
const claim = (signer: MeshNode, zone: string, url: string, method: string, body?: string): Record<string, string> =>
  signOriginClaim({ url, method, ...(body !== undefined ? { body } : {}) }, { caller: zone, callerUrl: signer.baseUrl, privateKey: keyOf(signer), unbound: false, now: Date.now() })

async function trio() {
  const pa = await reservePort(), pb = await reservePort(), pc = await reservePort()
  const a = await bootNode({ name: 'A', session: 'link-a', team: 'alpha', port: pa, sessionNodes: true, apiKey: 'fleet-key-of-a', peers: ['http://127.0.0.1:' + pb], linkKeys: { ['http://127.0.0.1:' + pb]: LINK }, cardCacheTtlMs: 0 })
  const b = await bootNode({ name: 'B', session: 'link-b', team: 'beta', port: pb, sessionNodes: true, apiKey: 'dedicated-key-of-b', peers: [a.baseUrl], linkKeys: { [a.baseUrl]: LINK }, cardCacheTtlMs: 0 })
  const c = await bootNode({ name: 'C', session: 'link-c', team: 'gamma', port: pc, sessionNodes: true, cardCacheTtlMs: 0 })
  return { a, b, c }
}

describe('#317 link keys on the peer faces', () => {
  it('a link key admits only its own verified, body-bound peer on /a2a/direct; the control routes never take it', async () => {
    const { a, b, c } = await trio()
    try {
      const url = b.baseUrl + '/a2a/direct'
      const body = JSON.stringify({ team: 'beta/00000000', message: 'probe', caller_session: 'alpha/11111111', task_id: 'link-1' })
      const post = async (headers: Record<string, string>, sent = body) => {
        const reply = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: sent })
        return { status: reply.status, text: await reply.text() }
      }
      const keyRefused = (r: { status: number; text: string }) => r.status === 401 && r.text.includes('X-API-Key required')
      // The owner peer with the link key and its own Sig3: past the key gate (admission decides from here).
      expect(keyRefused(await post({ 'X-API-Key': LINK, ...claim(a, 'alpha', url, 'POST', body) }))).toBe(false)
      // The link key alone, or with another host's valid signature, or with a body swapped under A's signature: refused at the gate.
      expect(keyRefused(await post({ 'X-API-Key': LINK }))).toBe(true)
      expect(keyRefused(await post({ 'X-API-Key': LINK, ...claim(c, 'gamma', url, 'POST', body) }))).toBe(true)
      expect(keyRefused(await post({ 'X-API-Key': LINK, ...claim(a, 'alpha', url, 'POST', body) }, body.replace('probe', 'swapped')))).toBe(true)
      // A's envelope with Sig3 stripped (Sig2 still verifies): a captured envelope could carry another body — refused.
      const stripped = claim(a, 'alpha', url, 'POST', body)
      delete stripped['X-A2A-Caller-Sig3']; delete stripped['X-A2A-Body-Sha256']
      expect(keyRefused(await post({ 'X-API-Key': LINK, ...stripped }))).toBe(true)
      // Wrong key entirely: refused; B's own apiKey: unchanged.
      expect(keyRefused(await post({ 'X-API-Key': 'fleet-key-of-a', ...claim(a, 'alpha', url, 'POST', body) }))).toBe(true)
      expect(keyRefused(await post({ 'X-API-Key': 'dedicated-key-of-b' }))).toBe(false)
      // Control routes take only B's own apiKey.
      const state = (key: string) => fetch(b.baseUrl + '/__dsh_a2a/state', { headers: { 'X-API-Key': key, ...claim(a, 'alpha', b.baseUrl + '/__dsh_a2a/state', 'GET') } }).then(r => r.status)
      expect(await state(LINK)).toBe(401)
      expect(await state('dedicated-key-of-b')).toBe(200)
    } finally { await a.dispose(); await b.dispose(); await c.dispose() }
  })
  it('the read faces take the link key with the peer signature only', async () => {
    const { a, b, c } = await trio()
    try {
      const log = b.baseUrl + '/a2a/log?caller_session=alpha%2F11111111&id=none'
      const get = (headers: Record<string, string>) => fetch(log, { headers }).then(r => r.status)
      expect(await get({ 'X-API-Key': LINK, ...claim(a, 'alpha', log, 'GET') })).not.toBe(401)
      expect(await get({ 'X-API-Key': LINK })).toBe(401)
      expect(await get({ 'X-API-Key': LINK, ...claim(c, 'gamma', log, 'GET') })).toBe(401)
      const blob = b.baseUrl + '/a2a/blob?sha256=' + '0'.repeat(64) + '&caller_session=alpha%2F11111111'
      expect(await fetch(blob, { headers: { 'X-API-Key': LINK, ...claim(a, 'alpha', blob, 'GET') } }).then(r => r.status)).not.toBe(401)
      expect(await fetch(blob, { headers: { 'X-API-Key': LINK } }).then(r => r.status)).toBe(401)
    } finally { await a.dispose(); await b.dispose(); await c.dispose() }
  })
  it('review of #318 R1: a link key needs an envelope bound to THIS request — no v1-only envelope, no envelope replayed from another path', async () => {
    const { a, b, c } = await trio()
    try {
      const log = b.baseUrl + '/a2a/log?caller_session=alpha%2F11111111&id=none'
      const get = (headers: Record<string, string>) => fetch(log, { headers }).then(r => r.status)
      // A v1-only envelope (Sig2 and Aud removed) still verifies in the unbound window — never enough for a link key.
      const v1 = signOriginClaim({ url: b.baseUrl + '/a2a/log', method: 'GET' }, { caller: 'alpha', callerUrl: a.baseUrl, privateKey: keyOf(a), unbound: true, now: Date.now() })
      delete v1['X-A2A-Caller-Sig2']; delete v1['X-A2A-Caller-Aud']
      expect(await get({ 'X-API-Key': LINK, ...v1 })).toBe(401)
      // A bound envelope A signed for its card read, replayed onto the log face.
      expect(await get({ 'X-API-Key': LINK, ...claim(a, 'alpha', b.baseUrl + '/.well-known/agent-card.json', 'GET') })).toBe(401)
      // B's own apiKey is unaffected by the stricter link-key rule.
      expect(await get({ 'X-API-Key': 'dedicated-key-of-b' })).not.toBe(401)
    } finally { await a.dispose(); await b.dispose(); await c.dispose() }
  })
  it('review of #318 R3: one key shared by two links admits each peer by its own verified origin', async () => {
    const pa = await reservePort(), pb = await reservePort(), pc = await reservePort()
    const a = await bootNode({ name: 'A', session: 'dup-a', team: 'alpha', port: pa, sessionNodes: true, cardCacheTtlMs: 0 })
    const c = await bootNode({ name: 'C', session: 'dup-c', team: 'gamma', port: pc, sessionNodes: true, cardCacheTtlMs: 0 })
    const b = await bootNode({ name: 'B', session: 'dup-b', team: 'beta', port: pb, sessionNodes: true, apiKey: 'dedicated-key-of-b', linkKeys: { [a.baseUrl]: LINK, [c.baseUrl]: LINK }, cardCacheTtlMs: 0 })
    try {
      const log = b.baseUrl + '/a2a/log?caller_session=x%2F11111111&id=none'
      const get = (signer: MeshNode, zone: string) => fetch(log, { headers: { 'X-API-Key': LINK, ...claim(signer, zone, b.baseUrl + '/a2a/log', 'GET') } }).then(r => r.status)
      expect(await get(a, 'alpha')).not.toBe(401)
      expect(await get(c, 'gamma')).not.toBe(401)
    } finally { await a.dispose(); await b.dispose(); await c.dispose() }
  })
  it('review of #318 R2: the workbench remote-log proxy reaches a linked peer with its link key and signature', async () => {
    const { a, b, c } = await trio()
    try {
      const url = a.baseUrl + '/__dsh_a2a/remote-session-log?peer=' + encodeURIComponent(b.baseUrl) + '&id=none'
      const reply = await fetch(url, { headers: { 'X-API-Key': 'fleet-key-of-a' } })
      const body = await reply.json() as { ok?: boolean; error?: string }
      expect(reply.status).toBe(200)
      expect(String(body.error ?? '')).not.toContain('X-API-Key')
      expect(String(body.error ?? '')).not.toContain('unauthorized')
    } finally { await a.dispose(); await b.dispose(); await c.dispose() }
  })
})
