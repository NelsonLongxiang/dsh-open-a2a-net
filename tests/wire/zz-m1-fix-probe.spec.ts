/* M1 re-verification: one-sided seeding must now get MINIMAL — DELETE AFTER USE */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { createPrivateKey, sign as edSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { apply, type Config } from '../../src/index.ts'

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '', session: 'sess-1', team: 'dsh', routeTimeoutMs: 60_000, flushTimeoutMs: 300_000,
    announce: true, agentName: 'test node', peers: [], delegates: [], sessionNodes: true,
    wakeJoinedOnBoot: false, stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000, cardTtlMs: 172_800_000,
    dshHome: '', ...overrides,
  } as Config
}

async function boot(home: string, peers: string[]): Promise<{ ctx: Context; port: number }> {
  mkdirSync(join(home, 'a2a'), { recursive: true })
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  apply(ctx, makeConfig({ dshHome: home, peers }))
  return { ctx, port: (ctx as unknown as { webServer: { port: number } }).webServer.port }
}

describe('M1 fix: one-sided seeding stays minimal', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('stranger seeds target only -> minimal card', async () => {
    vi.stubGlobal('WebSocket', function () { throw new Error('no socket') })
    const tHome = mkdtempSync(join(tmpdir(), 'a2a-m1f-t-'))
    mkdirSync(join(tHome, 'a2a'), { recursive: true })
    writeFileSync(join(tHome, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['session-0123456789abcdef'] }))
    const target = await boot(tHome, [])
    const sHome = mkdtempSync(join(tmpdir(), 'a2a-m1f-s-'))
    const stranger = await boot(sHome, ['http://127.0.0.1:' + String(target.port)])
    await new Promise(r => setTimeout(r, 400))
    const key = createPrivateKey(readFileSync(join(sHome, 'a2a', 'node-key.pem'), 'utf8'))
    const callerUrl = 'http://127.0.0.1:' + String(stranger.port)
    const ts = Date.now()
    const sig = edSign(undefined, Buffer.from(JSON.stringify(['dsh', callerUrl, ts]), 'utf8'), key).toString('base64')
    const card = JSON.parse(await (await globalThis.fetch('http://127.0.0.1:' + String(target.port) + '/.well-known/agent-card.json', {
      headers: { 'X-A2A-Caller': 'dsh', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': sig },
    })).text()) as { sessionTeams?: unknown }
    console.log('one-sided seeding full card granted (must be false):', card.sessionTeams !== undefined)
    expect(card.sessionTeams).toBeUndefined()
    await stranger.ctx.fiber.dispose()
    await target.ctx.fiber.dispose()
  }, 30000)
})
