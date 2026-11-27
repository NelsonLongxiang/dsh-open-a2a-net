// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { acceptScopedUserDelegate, checkUserScopeEcho, createUserClient } from '../../src/sdk/user.ts'
import { issueOwnerDelegate, revokeOwnerDelegate } from '../../src/superagent/host/owner-delegate.ts'
import { bootNode, tmpHome } from './harness.ts'

const id = 'session-0123456789abcdef'
const requested = ['session.list', 'session.read', 'session.prompt', 'session.stop'] as const

it('verifies issuance and collection echoes, and refuses a legacy node before use', () => {
  expect(checkUserScopeEcho(requested, undefined)).toMatchObject({ ok: false, code: 'scope-not-confirmed' })
  expect(acceptScopedUserDelegate(requested, { ok: true, delegate: {}, token: 'test-delegate' })).toMatchObject({ ok: false, code: 'scope-not-confirmed' })
  expect(acceptScopedUserDelegate(requested, { state: 'approved', scope: [...requested].reverse(), token: 'test-delegate' }).ok).toBe(false)
  expect(acceptScopedUserDelegate(requested, { state: 'approved', scope: requested, token: 'test-delegate' }).ok).toBe(true)
})

it('returns a structured failure without retrying or following a redirect', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('failed'))
  const c = createUserClient({ baseUrl: 'https://fixture.invalid', controlKey: 'test-key', delegate: 'test-delegate', fetch })
  expect(await c.stop(id)).toEqual({ ok: false, status: 0, code: 'node-unavailable', error: 'the node request did not complete' })
  expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL('https://fixture.invalid/__dsh_a2a/user/session/stop'), expect.objectContaining({ cache: 'no-store', redirect: 'error' }))
})

describe('sdk/user against a keyed node', () => {
  it('lists, reads, prompts and stops an idle seat with scoped credentials only', async () => {
    const home = tmpHome()
    mkdirSync(join(home, 'a2a'), { recursive: true })
    const file = join(home, 'a2a', 'owner-delegates.json')
    const sessionDir = join(home, 'sessions', 'fixture', id)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'session.v1.jsonl'), '')
    const io = {
      read: (path: string) => { try { return readFileSync(path, 'utf8') } catch { return undefined } },
      write: (path: string, value: string) => writeFileSync(path, value),
      random: () => ({ id: 'market', token: 'fixture-market-delegate' }),
      now: () => new Date(),
    }
    const issued = issueOwnerDelegate(file, 'Market', 1, io, requested)
    const proof = acceptScopedUserDelegate(requested, { ok: true, delegate: issued.record, token: issued.token })
    if (!proof.ok) throw new Error(proof.code)
    const node = await bootNode({ name: 'sdk-user-fixture', session: 'sdk-user-fixture', team: 'test', home, initialStatus: 'idle', sessionNodes: true, silent: true, apiKey: 'fixture-control-key' })
    try {
      const joined = await fetch(node.baseUrl + '/__dsh_a2a/join', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'fixture-control-key' }, body: JSON.stringify({ id }) })
      expect(joined.status).toBe(200)
      const c = createUserClient({ baseUrl: node.baseUrl, delegate: proof.delegate, onBehalfOf: { id: 'person', name: '小明' } })
      expect(await c.sessions()).toMatchObject({ ok: true, sessions: [expect.objectContaining({ id, joined: true })] })
      expect(await c.read(id)).toMatchObject({ ok: true, id })
      expect(await c.prompt(id, { mode: 'steer', text: 'hello' })).toMatchObject({ ok: true, delivered: 'steered' })
      expect(node.steered).toEqual([expect.objectContaining({ source: expect.objectContaining({ onBehalfOf: { id: 'person', name: '小明' } }) })])
      expect(await c.stop(id, { requestId: 's1' })).toMatchObject({ ok: true, stopped: false })
      const restricted = acceptScopedUserDelegate(['session.read'], { state: 'approved', scope: ['session.read'], token: issueOwnerDelegate(file, 'Reader', 1, { ...io, random: () => ({ id: 'reader', token: 'fixture-reader-delegate' }) }, ['session.read']).token })
      if (!restricted.ok) throw new Error(restricted.code)
      expect(await createUserClient({ baseUrl: node.baseUrl, delegate: restricted.delegate }).stop(id)).toMatchObject({ ok: false, status: 403, code: 'owner-delegate-scope' })
      revokeOwnerDelegate(file, issued.record.id, io)
      expect(await c.sessions()).toMatchObject({ ok: false, status: 401 })
    } finally { await node.dispose() }
  })
})
