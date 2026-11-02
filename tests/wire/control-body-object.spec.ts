/**
 * Control bodies must be JSON objects. `null` (valid JSON) used to reach the
 * route bodies, whose `body.id` read threw inside the reader's 'end'
 * callback — outside the web server's handler guard — so a loopback caller
 * with no key could take the host down with `POST /__dsh_a2a/join` + `null`.
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

async function harness(): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  apply(ctx, {
    apiKey: '', session: 'body-test', team: 'dsh', routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000, announce: false, agentName: 'body node', peers: [],
    delegates: [], sessionNodes: true, wakeJoinedOnBoot: false, wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0, wakeBootStaggerMs: 3_000, stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000, remoteRowsTtlMs: 15_000,
    dshHome: mkdtempSync(join(tmpdir(), 'a2a-body-')), cardTtlMs: 172_800_000,
  })
  return 'http://127.0.0.1:' + String((ctx as unknown as { webServer: WebServer }).webServer.port)
}

const uncaught: unknown[] = []
const onUncaught = (error: unknown): void => { uncaught.push(error) }
afterEach(() => { process.off('uncaughtException', onUncaught) })

describe('control bodies must be JSON objects', () => {
  it.each(['null', '[]', '42', '"x"'])('POST /__dsh_a2a/join with %s → 400, nothing uncaught, host still answers', async (raw) => {
    process.on('uncaughtException', onUncaught)
    uncaught.length = 0
    const base = await harness()
    const r = await fetch(base + '/__dsh_a2a/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw, signal: AbortSignal.timeout(3000) })
    expect(r.status).toBe(400)
    expect(uncaught).toEqual([])
    expect((await fetch(base + '/__dsh_a2a/state', { signal: AbortSignal.timeout(3000) })).status).toBe(200)
  })
})
