// @vitest-environment node
/**
 * Present-but-unverifiable OriginClaim envelopes are counted by claimed caller and reason on the state
 * face (claimRejectsRecent): a sender clock beyond ±5 min shows as bad-ts. Absent envelopes and valid
 * ones are not counted; the refusal itself is unchanged.
 */
import { describe, expect, it } from 'vitest'
import { createPrivateKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { bootNode, reservePort } from './harness.ts'

describe('claimRejectsRecent observability', () => {
  it('counts a skewed sender as bad-ts by caller, and nothing for absent or valid envelopes', async () => {
    const a = await bootNode({ name: 'A', session: 'rej-a', team: 'alpha', port: await reservePort(), sessionNodes: true, cardCacheTtlMs: 0 })
    const c = await bootNode({ name: 'C', session: 'rej-c', team: 'gamma', port: await reservePort(), sessionNodes: true, cardCacheTtlMs: 0 })
    try {
      // The card face verifies every envelope before any link rule, so it isolates the counter.
      const url = a.baseUrl + '/.well-known/agent-card.json'
      const key = createPrivateKey(readFileSync(join(c.home, 'a2a', 'node-key.pem'), 'utf8'))
      const get = (headers: Record<string, string>) => fetch(url, { headers }).then(r => r.status)
      const sign = (now: number) => signOriginClaim({ url, method: 'GET' }, { caller: 'gamma', callerUrl: c.baseUrl, privateKey: key, unbound: false, now })
      const state = async () => await (await fetch(a.baseUrl + '/__dsh_a2a/state')).json() as { claimRejectsInbound: number; claimRejectsRecent: Array<{ caller: string; callerUrl: string; reason: string; count: number }> }
      expect(await get({})).toBe(200) // absent envelope
      expect(await get(sign(Date.now()))).toBe(200) // valid envelope
      const before = await state()
      expect(before.claimRejectsInbound).toBe(0)
      expect(await get(sign(Date.now() - 400_000))).toBe(200) // the card face still answers (minimal card)
      await get(sign(Date.now() + 400_000))
      const after = await state()
      expect(after.claimRejectsInbound).toBe(2)
      expect(after.claimRejectsRecent.find(r => r.reason === 'bad-ts')).toMatchObject({ caller: 'gamma', callerUrl: c.baseUrl, count: 2 })
    } finally { await a.dispose(); await c.dispose() }
  })
})
