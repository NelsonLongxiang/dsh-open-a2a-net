// @vitest-environment node
/**
 * gh#113 on a real host: mailbox rows carry seq, the inbox face names its
 * seq bounds and loss counter, a cut text is marked, and the state face
 * totals the loss for the team verifier.
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

const json = async (url: string, body?: unknown): Promise<Record<string, any>> =>
  await globalThis.fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => await r.json() as Record<string, any>)

describe('gh#113 CLI mailbox shape (real host)', () => {
  it('seq, bounds, truncation and the state-face totals', async () => {
    const port = await reservePort()
    const a = await bootNode({ name: 'A', session: 'mesh-gh113', team: 'dsh', sessionNodes: true, port })
    try {
      const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, privateKey)
      expect((await json(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).ok).toBe(true)
      const callerUrl = `${a.baseUrl}/a2a/cli/${encodeURIComponent(HANDLE)}`
      const send = async (message: string) => {
        const ts = Date.now()
        const sig = edSign(undefined, Buffer.from(JSON.stringify(['ops-cli', callerUrl, ts])), privateKey).toString('base64')
        return await globalThis.fetch(`${a.baseUrl}/a2a/direct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': 'ops-cli', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Ts': String(ts), 'X-A2A-Sig': sig },
          body: JSON.stringify({ team: HANDLE, message, caller_session: HANDLE, wait: false }),
        }).then(async r => await r.json() as { delivered?: boolean })
      }
      expect((await send('one')).delivered).toBe(true)
      expect((await send('y'.repeat(4500))).delivered).toBe(true)
      expect((await send('three')).delivered).toBe(true)

      const box = await json(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'inbox', handle: HANDLE })
      expect(box).toMatchObject({ ok: true, next_seq: 4, oldest_seq: 1, dropped: 0 })
      expect(typeof box.epoch).toBe('string')
      expect(box.mail.map((m: { seq: number }) => m.seq)).toEqual([3, 2, 1])
      expect(box.mail[1]).toMatchObject({ truncated: true, chars: 4500 })
      const newer = await json(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'inbox', handle: HANDLE, after_seq: 2 })
      expect(newer.mail.map((m: { text: string }) => m.text)).toEqual(['three'])

      const state = await json(`${a.baseUrl}/__dsh_a2a/state`)
      expect(state.cliMailbox).toEqual({ dropped: 0, truncated: 1 })
    } finally {
      await a.dispose()
    }
  }, 30_000)
})
