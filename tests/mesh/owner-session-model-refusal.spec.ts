// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { issueOwnerDelegate, OWNER_DELEGATE_HEADER } from '../../src/superagent/host/owner-delegate.ts'
import { bootNode, tmpHome } from './harness.ts'

it('requires the control key and owner proof before refusing unsupported model selection', async () => {
  const home = tmpHome()
  const id = 'session-0123456789abcdef'
  const key = 'fixture-control-key'
  const dir = join(home, 'a2a')
  mkdirSync(dir, { recursive: true })
  const { token } = issueOwnerDelegate(join(dir, 'owner-delegates.json'), 'fixture', 1, {
    read: () => undefined, write: writeFileSync, now: () => new Date(),
    random: () => ({ id: 'fixture', token: 'fixture-owner-delegate' }),
  })
  const node = await bootNode({ name: 'seat-model-refusal', session: 'seat-model-refusal', team: 'test', home, apiKey: key, agentId: id, initialStatus: 'idle', sessionNodes: true, silent: true })
  try {
    async function post(path: string, body: object, headers: Record<string, string>) {
      return fetch(node.baseUrl + '/__dsh_a2a/' + path, {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
      })
    }
    expect((await post('join', { id }, { 'x-api-key': key })).status).toBe(200)
    const request = { id, provider: 'provider', model: 'model' }
    expect((await post('user/session/model', request, { [OWNER_DELEGATE_HEADER]: token })).status).toBe(401)
    const withoutOwner = await post('user/session/model', request, { 'x-api-key': key })
    expect(withoutOwner.status).toBe(503)
    expect(await withoutOwner.json()).toMatchObject({ code: 'owner-auth-unavailable' })
    const response = await post('user/session/model', request, { 'x-api-key': key, [OWNER_DELEGATE_HEADER]: token })
    expect(response.status).toBe(501)
    expect(await response.json()).toMatchObject({ ok: false, code: 'no-model-api' })
    expect(node.steered).toEqual([])
    const audit = join(dir, 'owner-delegates-audit.jsonl')
    expect(() => readFileSync(audit, 'utf8')).toThrow(expect.objectContaining({ code: 'ENOENT' }))
  } finally { await node.dispose() }
})
