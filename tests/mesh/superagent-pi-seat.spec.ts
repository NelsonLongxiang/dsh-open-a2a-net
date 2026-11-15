// @vitest-environment node
/**
 * docs/design/superagent-pi-platform.md PR-B, on a live host: a Pi seat publishes its deposit (its own signed card declares
 * piSeat), the owner adds it to the team canvas (its key is pinned), and its CLI-signed, body-bound ops on the team face
 * reach the team. Another CLI handle cannot join the team canvas; an unsigned or body-unbound op is refused.
 */
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootNode, postJson, tmpHome, type MeshNode } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const R_ID = 'session-aaaaaaaa00001111'
const SEAT = 'fleet-pi/0123456789abcdef', OTHER = 'req-cli/fedcba9876543210'
const json = async (r: Response): Promise<Record<string, any>> => await r.json() as Record<string, any>

function deposit(name: string, handle: string, capabilities: Record<string, unknown>): { card: string; key: KeyObject } {
  const { privateKey } = generateKeyPairSync('ed25519')
  return { card: JSON.stringify(signCard({ name, session: `cli-${name}`, team: handle, capabilities, expiresAt: Date.now() + 3_600_000 }, privateKey)), key: privateKey }
}

async function teamOp(n: MeshNode, handle: string, name: string, key: KeyObject, body: Record<string, unknown>, sign: 'body' | 'bound' = 'body'): Promise<Record<string, any>> {
  const url = `${n.baseUrl}/a2a/superagent-team`
  const text = JSON.stringify(body)
  const headers = signOriginClaim({ url, method: 'POST', ...(sign === 'body' ? { body: text } : {}) } as never, { caller: name, callerUrl: `${n.baseUrl}/a2a/cli/${encodeURIComponent(handle)}`, privateKey: key, unbound: false, now: Date.now() })
  return await json(await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: text }))
}

describe('a Pi seat on its team host', () => {
  it('joins the team canvas with its key pinned and is heard through CLI-signed ops; another CLI handle cannot join', async () => {
    const A = await bootNode({ name: 'A', session: 'hostA', team: 'dsh', agentId: R_ID, home: tmpHome(), sessionNodes: true, superagent: true } as never)
    try {
      expect((await postJson(A.baseUrl, '/__dsh_a2a/join', { id: R_ID })).status).toBe(200)
      const seat = deposit('fleet-pi', SEAT, { piSeat: true }), other = deposit('req-cli', OTHER, { route: true })
      for (const d of [seat, other]) expect(await json(await postJson(A.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'publish', card: d.card }))).toMatchObject({ ok: true })
      const canvas = async (body: unknown): Promise<Record<string, any>> => await json(await postJson(A.baseUrl, '/__dsh_a2a/canvas', body))
      expect(await canvas({ action: 'add-member', name: 'team', id: R_ID })).toMatchObject({ ok: true })
      expect(await json(await postJson(A.baseUrl, '/__dsh_a2a/superagent', { action: 'settings', settings: { canvas: 'team', router: R_ID } }))).toMatchObject({ ok: true })
      // R4 as revised: the Pi seat joins; an ordinary CLI handle is a requester and is refused, with the reason.
      const added = await canvas({ action: 'add-member', name: 'team', id: SEAT })
      expect(added, JSON.stringify(added)).toMatchObject({ ok: true })
      expect(await canvas({ action: 'add-member', name: 'team', id: OTHER })).toMatchObject({ ok: false, error: expect.stringContaining('not a Pi seat') })
      const pinned = (await json(await globalThis.fetch(`${A.baseUrl}/__dsh_a2a/superagent`))).executor.remoteMembers
      expect(pinned).toEqual([expect.objectContaining({ ref: SEAT, platform: 'pi' })])
      // Its signed, body-bound op reaches the team; a body-unbound one, or one for another member, does not.
      expect(await teamOp(A, SEAT, 'fleet-pi', seat.key, { op: 'idle', member: SEAT, report: { ticket_id: 't-none', run_id: 'r-none', event_id: 'e-1' } })).toMatchObject({ ok: true })
      expect(await teamOp(A, SEAT, 'fleet-pi', seat.key, { op: 'idle', member: SEAT, report: { ticket_id: 't-none', run_id: 'r-none', event_id: 'e-2' } }, 'bound')).toMatchObject({ ok: false, code: 'untrusted-origin' })
      expect(await teamOp(A, SEAT, 'fleet-pi', seat.key, { op: 'idle', member: OTHER })).toMatchObject({ ok: false, code: 'not-signer' })
      // A CLI identity that is not the seat, signing for itself, is no member.
      expect(await teamOp(A, OTHER, 'req-cli', other.key, { op: 'idle', member: OTHER })).toMatchObject({ ok: false, code: 'not-member' })
    } finally { await A.dispose() }
  })
})
