// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { issueOwnerDelegate, revokeOwnerDelegate } from '../../src/superagent/host/owner-delegate.ts'
import type { OwnerAction } from '../../src/superagent/host/owner-delegate-scope.ts'
import { bootNode, tmpHome } from './harness.ts'

// This fixture exercises the HTTP authorization path. An asynchronous workspace bootstrap can outlive the node.
vi.mock('../../src/superagent/host/ygl-home.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/superagent/host/ygl-home.ts')>(),
  ensureTeamYglHome: async () => 'present',
  ensureTeamYglProject: async () => 'present',
}))

const agentId = 'session-0123456789abcdef'
const controlKey = 'test-control-key'
const read = '/__dsh_a2a/user/session?id=' + agentId
const prompt = '/__dsh_a2a/user/session/prompt'

async function fixture() {
  const home = tmpHome()
  mkdirSync(join(home, 'a2a'), { recursive: true })
  const store = join(home, 'a2a', 'owner-delegates.json')
  const audit = join(home, 'a2a', 'owner-delegates-audit.jsonl')
  const sessionDir = join(home, 'sessions', 'fixture', agentId)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'session.v1.jsonl'), '')
  let next = 0
  const io = {
    read: (path: string) => { try { return readFileSync(path, 'utf8') } catch { return undefined } },
    write: (path: string, value: string) => writeFileSync(path, value),
    random: () => { const id = String(++next); return { token: 'fixture-delegate-' + id, id } },
    now: () => new Date(),
  }
  const issue = (scope?: readonly OwnerAction[]) => issueOwnerDelegate(store, 'Market', 1, io, scope)
  const n = await bootNode({ home, name: 'delegate-fixture', session: 'delegate-fixture', team: 'test', agentId, apiKey: controlKey, sessionNodes: true, superagent: true, silent: true })
  const send = (path: string, options: { token?: string; method?: string; key?: boolean; behalf?: string; body?: object } = {}) => fetch(n.baseUrl + path, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(options.key ? { 'x-api-key': controlKey } : {}), ...(options.token === undefined ? {} : { 'x-dsh-owner-delegate': options.token }), ...(options.behalf === undefined ? {} : { 'x-dsh-on-behalf-of': options.behalf }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  return { issue, n, send, audit: () => io.read(audit) ?? '', revoke: (id: string) => revokeOwnerDelegate(store, id, io) }
}

describe('scoped owner delegate', () => {
  it('opens only mapped methods and paths with a valid scoped delegate and preserves the legacy key requirement', async () => {
    const f = await fixture()
    try {
      const reader = f.issue(['session.read'])
      expect((await f.send(read, { token: reader.token })).status).toBe(200)
      const accepted = f.audit()
      const denied = await f.send(prompt, { token: reader.token, method: 'POST', body: { id: agentId, mode: 'steer', text: 'fixture prompt' } })
      expect(denied.status).toBe(403)
      expect(await denied.json()).toMatchObject({ code: 'owner-delegate-scope' })
      expect((await f.send(prompt, { token: reader.token, key: true, method: 'POST' })).status).toBe(403)
      expect((await f.send('/__dsh_a2a/state', { token: reader.token })).status).toBe(401)
      expect((await f.send('/__dsh_a2a/superagent/decisions', { token: f.issue(['team.read']).token, method: 'POST' })).status).toBe(403)
      const legacy = f.issue()
      expect((await f.send(read, { token: legacy.token })).status).toBe(401)
      expect(f.audit()).toBe(accepted)
      expect((await f.send(read, { token: legacy.token, key: true })).status).toBe(200)
      expect((await f.send('/__dsh_a2a/superagent/teams', { token: f.issue(['team.read']).token })).status).toBe(200)
      f.revoke(reader.record.id)
      expect((await f.send(read, { token: reader.token })).status).toBe(401)
    } finally { await f.n.dispose() }
  })

  it('attributes an accepted prompt and refuses malformed attribution before delivery or audit', async () => {
    const f = await fixture()
    try {
      await f.send('/__dsh_a2a/join', { method: 'POST', key: true, body: { id: agentId } })
      const token = f.issue(['session.prompt']).token
      const body = { id: agentId, mode: 'steer', text: 'fixture prompt', request_id: 'prompt-1' }
      expect((await f.send(prompt, { token, method: 'POST', behalf: '{}', body })).status).toBe(400)
      expect(f.audit()).toBe('')
      expect(f.n.steered).toHaveLength(0)
      const onBehalfOf = { id: 'person-1', name: 'Morgan' }
      const ok = await f.send(prompt, { token, method: 'POST', behalf: JSON.stringify({ id: 'person-1', name: '[Morgan]' }), body })
      expect(ok.status).toBe(200)
      expect(f.n.steered).toEqual([expect.objectContaining({
        source: expect.objectContaining({ kind: 'a2a-owner-proxy', onBehalfOf }),
        content: [{ type: 'text', text: '[属主代输入 · Market · Morgan · steer]\nfixture prompt' }],
      })])
      expect(JSON.parse(f.audit())).toMatchObject({ onBehalfOf, action: 'prompt-steer' })
      expect(f.audit()).not.toContain(body.text)
    } finally { await f.n.dispose() }
  })
})
