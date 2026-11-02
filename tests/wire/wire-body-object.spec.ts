/**
 * #168: the peer faces must refuse non-object JSON bodies. `null` used to
 * reach `body.task_id` (/a2a/query, no auth gate at all — even an apiKey
 * host could be taken down by anyone reachable) and `body.team`
 * (/a2a/direct, an async 'end' callback → unhandled rejection), both
 * outside the web server's handler guard → host exit.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../../src/index.ts'

async function harness(apiKey: string): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  apply(ctx, {
    apiKey, session: 'wire-body-test', team: 'dsh', routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000, announce: false, agentName: 'wire body node', peers: [],
    delegates: [], sessionNodes: true, wakeJoinedOnBoot: false, wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0, wakeBootStaggerMs: 3_000, stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000, remoteRowsTtlMs: 15_000,
    dshHome: mkdtempSync(join(tmpdir(), 'a2a-wire-body-')), cardTtlMs: 172_800_000,
  })
  return 'http://127.0.0.1:' + String((ctx as unknown as { webServer: WebServer }).webServer.port)
}

const faults: unknown[] = []
const onFault = (error: unknown): void => { faults.push(error) }
afterEach(() => {
  process.off('uncaughtException', onFault)
  process.off('unhandledRejection', onFault)
})
const watch = (): void => {
  faults.length = 0
  process.on('uncaughtException', onFault)
  process.on('unhandledRejection', onFault)
}
// Liveness: a well-formed query (unknown task) still gets its 200 answer from the same host.
const alive = async (base: string): Promise<number> => (await fetch(base + '/a2a/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: 't', fingerprint: 'f' }), signal: AbortSignal.timeout(3000) })).status
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 50))

describe('peer faces refuse non-object JSON bodies (#168)', () => {
  it.each(['null', '[]', '42', '"x"'])('/a2a/query on an apiKey host, no credentials, body %s → 400 and the host keeps answering', async (raw) => {
    watch()
    const base = await harness('k-secret')
    const r = await fetch(base + '/a2a/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw, signal: AbortSignal.timeout(3000) })
    expect(r.status).toBe(400)
    await settle()
    expect(faults).toEqual([])
    expect(await alive(base)).toBe(200)
  })

  it.each([['no-key host', ''], ['apiKey host with the key', 'k-secret']])('/a2a/direct on a %s, body null → 400, nothing unhandled', async (_label, key) => {
    watch()
    const base = await harness(key)
    const r = await fetch(base + '/a2a/direct', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key !== '' ? { 'X-API-Key': key } : {}) }, body: 'null', signal: AbortSignal.timeout(3000) })
    expect(r.status).toBe(400)
    await settle()
    expect(faults).toEqual([])
    expect(await alive(base)).toBe(200)
  })
})
