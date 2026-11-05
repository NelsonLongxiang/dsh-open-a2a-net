/**
 * The /__dsh_a2a/nodes face (node-identity N1, owner ruling §8-2): identity
 * writes need the host apiKey in X-API-Key EVEN ON LOOPBACK, and a host with
 * no apiKey refuses them outright. Reads ride the ordinary control trust.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../../src/index.ts'

async function harness(apiKey: string): Promise<{ base: string; home: string }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const home = mkdtempSync(join(tmpdir(), 'a2a-nodes-face-'))
  apply(ctx, {
    apiKey, session: 'nodes-test', team: 'dsh', routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000, announce: false, agentName: 'nodes node', peers: [],
    delegates: [], sessionNodes: true, wakeJoinedOnBoot: false, wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0, wakeBootStaggerMs: 3_000, stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000, remoteRowsTtlMs: 15_000,
    dshHome: home, cardTtlMs: 172_800_000,
  })
  return { base: 'http://127.0.0.1:' + String((ctx as unknown as { webServer: WebServer }).webServer.port), home }
}

const post = (base: string, body: unknown, key?: string): Promise<Response> =>
  fetch(base + '/__dsh_a2a/nodes', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key !== undefined ? { 'X-API-Key': key } : {}) }, body: JSON.stringify(body) })

describe('/__dsh_a2a/nodes — identity writes', () => {
  it('a host without apiKey refuses identity writes even from loopback (403), but still serves reads', async () => {
    const { base, home } = await harness('')
    const r = await post(base, { action: 'create', name: 'review-1' })
    expect(r.status).toBe(403)
    expect((await r.json()).error).toMatch(/§8-2/)
    expect(existsSync(join(home, 'a2a', 'nodes.json'))).toBe(false)
    const list = await fetch(base + '/__dsh_a2a/nodes')
    expect(list.status).toBe(200)
    expect((await list.json()).nodes).toEqual([])
  })

  it('with apiKey: loopback without the key is 401, a wrong key is 401, the right key writes', async () => {
    const { base } = await harness('k-secret')
    expect((await post(base, { action: 'create', name: 'review-1' })).status).toBe(401)
    expect((await post(base, { action: 'create', name: 'review-1' }, 'nope')).status).toBe(401)
    const ok = await post(base, { action: 'create', name: 'review-1', role: ['review'], teams: ['dsh/canvas/core'], by: 'owner' }, 'k-secret')
    expect(ok.status).toBe(200)
    expect((await ok.json()).value).toMatchObject({ name: 'review-1', created_by: 'human:owner' })
    // Reads with apiKey set ride controlAuthorized (key required off loopback AND on).
    expect((await fetch(base + '/__dsh_a2a/nodes')).status).toBe(401)
    const view = await (await fetch(base + '/__dsh_a2a/nodes?name=review-1', { headers: { 'X-API-Key': 'k-secret' } })).json()
    expect(view.node.name).toBe('review-1')
    expect(view.versions).toEqual({ core: [], mutable: [] })
  })

  it('layer writes go through CAS and answer conflict / quota with distinct statuses', async () => {
    const { base } = await harness('k')
    await post(base, { action: 'create', name: 'dev-1' }, 'k')
    const v1 = await (await post(base, { action: 'write-core', name: 'dev-1', text: '身份：开发席', reason: 'seed', expected_sha256: '' }, 'k')).json()
    expect(v1.value.version).toBe(1)
    expect((await post(base, { action: 'write-core', name: 'dev-1', text: 'x', reason: 'r', expected_sha256: '' }, 'k')).status).toBe(409)
    expect((await post(base, { action: 'write-mutable', name: 'dev-1', sections: { 当前状态: 'x'.repeat(1001) }, reason: 'r', expected_sha256: '' }, 'k')).status).toBe(413)
    expect((await post(base, { action: 'update', name: 'dev-1', rename: 'dev-2' }, 'k')).status).toBe(400)
    expect((await post(base, { action: 'wat' }, 'k')).status).toBe(400)
  })

  it('a non-object body is a 400 and the host keeps serving (no uncaught throw)', async () => {
    const { base } = await harness('k')
    for (const raw of ['null', '[]', '42']) {
      const r = await fetch(base + '/__dsh_a2a/nodes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'k' }, body: raw })
      expect(r.status).toBe(400)
    }
    expect((await post(base, { action: 'create', name: 'alive-1' }, 'k')).status).toBe(200)
  })

  it('full identity flow over the wire: mutable write, GET current, strict layer, rollback, archive, no reuse', async () => {
    const { base } = await harness('k')
    await post(base, { action: 'create', name: 'n-1' }, 'k')
    const w1 = await (await post(base, { action: 'write-mutable', name: 'n-1', sections: { 当前状态: 'one' }, reason: 'r', expected_sha256: '' }, 'k')).json()
    const w2 = await (await post(base, { action: 'write-mutable', name: 'n-1', sections: { 当前状态: 'two' }, reason: 'r', expected_sha256: w1.value.sha256 }, 'k')).json()
    const view = await (await fetch(base + '/__dsh_a2a/nodes?name=n-1', { headers: { 'X-API-Key': 'k' } })).json()
    expect(view.current.mutable.sections['当前状态']).toBe('two')
    expect(view.versions.mutable).toEqual([1, 2])
    expect((await post(base, { action: 'rollback', name: 'n-1', layer: 'CORE', to: 1, reason: 'r', expected_sha256: w2.value.sha256 }, 'k')).status).toBe(400)
    const back = await (await post(base, { action: 'rollback', name: 'n-1', layer: 'mutable', to: 1, reason: 'two was worse', expected_sha256: w2.value.sha256 }, 'k')).json()
    expect(back.value).toMatchObject({ version: 3, rollback_of: 1, sections: { 当前状态: 'one' } })
    expect((await post(base, { action: 'update', name: 'n-1', label: '评审一' }, 'k')).status).toBe(200)
    expect((await post(base, { action: 'archive', name: 'n-1' }, 'k')).status).toBe(200)
    expect((await post(base, { action: 'create', name: 'n-1' }, 'k')).status).toBe(409)
  })
})
