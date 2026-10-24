// @vitest-environment node
/**
 * gh#45 N3 seam: a deposited CLI handle IS an admissible caller_session on
 * the wire face — the envelope's zone derivation proved the CLI key, and
 * the handle is a published node fact (the home card's sessionTeams row).
 * The route rides the harness's real client with a hand-stamped envelope.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { bootNode, reservePort } from './harness.ts'
import { signCard } from '../../src/card.ts'

const { privateKey } = generateKeyPairSync('ed25519')
const HANDLE = 'ops-cli/a1b2c3d4e5f60718'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('gh#45 CLI caller admission (N3)', () => {
  it('a deposited handle passes the wire caller gate with a hand-stamped envelope', async () => {
    const port = await reservePort()
    const a = await bootNode({ name: 'A', session: 'mesh-gh45-n3', team: 'dsh', sessionNodes: true, port })
    try {
      const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, privateKey)
      const dep = await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }),
      }).then(async r => await r.json() as { ok: boolean })
      expect(dep.ok).toBe(true)
      // Hand-stamp the envelope exactly as the CLI does: caller = the bare
      // agent-name zone; the card is served at the deposit face.
      const callerUrl = `${a.baseUrl}/a2a/cli/${encodeURIComponent(HANDLE)}`
      const ts = Date.now()
      const sig = edSign(undefined, Buffer.from(JSON.stringify(['ops-cli', callerUrl, ts])), privateKey).toString('base64')
      // Target the CLI's own mailbox — the delivery must pass BOTH the key
      // gate (empty here) and the N3 caller gate, then land in the mailbox.
      const res = await globalThis.fetch(`${a.baseUrl}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': 'ops-cli', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Ts': String(ts), 'X-A2A-Sig': sig },
        body: JSON.stringify({ team: HANDLE, message: 'self-probe from the CLI identity', caller_session: HANDLE, wait: false }),
      }).then(async r => await r.json() as { delivered?: boolean; error?: string })
      expect(res.error).toBeUndefined()
      expect(res.delivered).toBe(true)
      const inbox = await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inbox', handle: HANDLE }),
      }).then(async r => await r.json() as { mail: Array<{ text: string }> })
      expect(inbox.mail.some(m => m.text.includes('self-probe'))).toBe(true)
    } finally {
      await a.dispose()
    }
  }, 30_000)
})
