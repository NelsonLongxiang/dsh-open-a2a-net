// @vitest-environment node
/**
 * #114 S2 on a real host: an inbound /a2a/direct delivery is born with its
 * immutable authorization record — the caller, how its identity was proven,
 * the rule and basis that admitted it, and the allowlist version at that
 * instant — /state shows it, a replay of the id cannot overwrite it, and a
 * restart restores it whole.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { createServer } from 'node:http'
import { bootNode, reservePort, tmpHome } from './harness.ts'
import { signCard } from '../../src/card.ts'

const { privateKey } = generateKeyPairSync('ed25519')
const HANDLE = 'ops-cli/a1b2c3d4e5f60718'
const TARGET = 'dsh/01234567'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

const post = async (url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, any> }> =>
  await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }))

describe('#114 S2 inbound authorization record (real host)', () => {
  it('born on the row, shown on /state, not overwritten by a replay, restored whole after a restart', async () => {
    const port = await reservePort()
    const home = tmpHome()
    let a = await bootNode({ name: 'A', session: 'mesh-gh120', team: 'dsh', sessionNodes: true, teamScopeRouting: true, port, home })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })).status).toBe(200)
      const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, privateKey)
      expect((await post(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).body.ok).toBe(true)
      const callerUrl = `${a.baseUrl}/a2a/cli/${encodeURIComponent(HANDLE)}`
      // The envelope exactly as cli/a2a.mjs sends it today. Its header names
      // are not the ones the host verifies (#133), so the claim reads as
      // absent and the delivery rides the OriginClaim window: the record must
      // say so honestly (proof legacy-window, no claim).
      const envelope = (): Record<string, string> => {
        const ts = Date.now()
        return { 'X-A2A-Caller': 'ops-cli', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Ts': String(ts), 'X-A2A-Sig': edSign(undefined, Buffer.from(JSON.stringify(['ops-cli', callerUrl, ts])), privateKey).toString('base64') }
      }
      const body = { team: TARGET, message: 'signed task', caller_session: HANDLE, wait: false, task_id: 'direct-aaaa00000001' }
      const sent = await post(`${a.baseUrl}/a2a/direct`, body, envelope())
      expect(sent.body, JSON.stringify(sent.body)).toMatchObject({ delivered: true })

      // A keep-alive socket to the pre-restart server may be reset once: read again.
      const rowOf = async (taskId: string): Promise<Record<string, any> | undefined> => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return ((await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/state`).then(async r => await r.json())) as { tasks: Array<Record<string, any>> }).tasks.find(t => t.taskId === taskId)
          } catch (error) {
            if (attempt >= 3) throw error
            await new Promise(resolve => setTimeout(resolve, 50))
          }
        }
      }
      const row = await rowOf('direct-aaaa00000001')
      expect(row?.direction).toBe('inbound')
      expect(row?.auth).toMatchObject({
        v: 1,
        caller: HANDLE,
        proof: 'legacy-window',
        ingress: 'wire',
        via: 'cli-deposit',
        admission_rule: 'cli-deposit',
        basis: [],
        target: TARGET,
        receipt_target: HANDLE,
      })
      expect(row?.auth.claim).toBeUndefined()
      expect(row?.auth.allowlist_version).toMatch(/^al1:[0-9a-f]{16}$/)
      expect(typeof row?.auth.received_at).toBe('number')

      // A replay of the id (same payload) is refused and leaves the record as it was born.
      expect((await post(`${a.baseUrl}/a2a/direct`, body, envelope())).status).toBe(409)
      expect((await rowOf('direct-aaaa00000001'))?.auth).toEqual(row?.auth)

      // A second task while a canvas exists: the version moves with the records it hashes.
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'ops' })).body.ok).toBe(true)
      expect((await post(`${a.baseUrl}/a2a/direct`, { ...body, message: 'second task', task_id: 'direct-aaaa00000002' }, envelope())).body.delivered).toBe(true)
      expect((await rowOf('direct-aaaa00000002'))?.auth.allowlist_version).not.toBe(row?.auth.allowlist_version)

      const born = row?.auth.allowlist_version as string

      await a.dispose()
      a = await bootNode({ name: 'A', session: 'mesh-gh120', team: 'dsh', sessionNodes: true, teamScopeRouting: true, port, home })
      expect((await rowOf('direct-aaaa00000001'))?.auth).toEqual(row?.auth)
      expect((await rowOf('direct-aaaa00000001'))?.auth.allowlist_version).toBe(born)
    } finally {
      await a.dispose()
    }
  }, 60_000)

  it('review of PR #134 P1: origin-claim only when the signed zone covers the caller; otherwise claim-mismatch', async () => {
    // A foreign host's card, signed with its own key (correct OriginClaim header names).
    const far = generateKeyPairSync('ed25519').privateKey
    const card = signCard({ name: 'far', session: 'far-s', team: 'far', capabilities: { route: true }, expiresAt: Date.now() + 3_600_000 }, far)
    const srv = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(card)) })
    await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()))
    const farUrl = `http://127.0.0.1:${String((srv.address() as { port: number }).port)}`
    const a = await bootNode({ name: 'A', session: 'mesh-gh120-claim', team: 'dsh', sessionNodes: true, teamScopeRouting: true, port: await reservePort(), home: tmpHome() })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })).status).toBe(200)
      // The operator links far/aaaaaaaa as a remote member (N3/N4).
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: 'ops' })).body.ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: 'ops', id: 'far/aaaaaaaa' })).body.ok).toBe(true)
      const signed = (): Record<string, string> => {
        const ts = Date.now()
        return { 'X-A2A-Caller': 'far', 'X-A2A-Caller-Url': farUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': edSign(undefined, Buffer.from(JSON.stringify(['far', farUrl, ts])), far).toString('base64') }
      }
      // Owed rows and settled ones: a host-face receipt settles at once (the harness agent replies on steer).
      const rows = async (): Promise<Array<Record<string, any>>> => {
        const state = (await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/state`).then(async r => await r.json())) as { tasks: Array<Record<string, any>>; archived?: Array<Record<string, any>> }
        return [...state.tasks, ...(state.archived ?? [])]
      }

      const covered = await post(`${a.baseUrl}/a2a/direct`, { team: TARGET, message: 'covered', caller_session: 'far/aaaaaaaa', wait: false, task_id: 'direct-claim0001' }, signed())
      expect(covered.body.delivered, JSON.stringify(covered.body)).toBe(true)
      expect((await rows()).find(t => t.taskId === 'direct-claim0001')?.auth).toMatchObject({
        caller: 'far/aaaaaaaa', proof: 'origin-claim', claim: { caller: 'far', origin: new URL(farUrl).origin },
        via: 'canvas-member', admission_rule: 'remote-ref-foreign', basis: ['dsh/canvas/ops'],
      })

      // The signed zone "far" does not cover the host face "dsh": delivered (admission is unchanged), but never recorded as proven.
      const mismatched = await post(`${a.baseUrl}/a2a/direct`, { team: TARGET, message: 'mismatch', caller_session: 'dsh', wait: false, task_id: 'direct-claim0002' }, signed())
      expect(mismatched.body.delivered, JSON.stringify(mismatched.body)).toBe(true)
      expect((await rows()).find(t => t.taskId === 'direct-claim0002')?.auth).toMatchObject({
        caller: 'dsh', proof: 'claim-mismatch', claim: { caller: 'far' }, admission_rule: 'host-face',
      })
    } finally {
      await a.dispose()
      srv.close()
    }
  }, 60_000)
})
