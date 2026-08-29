/**
 * The floor stage faces: page serving over the built Vite tree (shell,
 * hashed assets, traversal guard) plus the canvas-layout control face.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { existsSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../src/index.ts'
import { MAX_LAYOUT_BODY_BYTES, WIRE_ERROR_PAYLOAD_TOO_LARGE } from '../src/transport-caps.ts'

async function harness(): Promise<number> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const home = mkdtempSync(join(tmpdir(), 'a2a-stage-'))
  apply(ctx, {
    apiKey: '', session: 'stage-test', team: 'dsh', routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000, announce: false, agentName: 'stage node', peers: [],
    delegates: [], sessionNodes: true, wakeJoinedOnBoot: false, wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0, wakeBootStaggerMs: 3_000, stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000, remoteRowsTtlMs: 15_000,
    dshHome: home, cardTtlMs: 172_800_000,
  })
  return (ctx as unknown as { webServer: WebServer }).webServer.port
}

const hasStageDist = existsSync(join(process.cwd(), 'assets', 'stageDist', 'index.html'))

const DOC_FIXTURE = {
  version: 1 as const,
  viewport: { x: 0, y: 0, scale: 1 },
  nodes: { 'session-x': { x: 10, y: 20 } },
  frames: {},
}

describe('canvas-layout control face', () => {
  it('round-trips save/get/reset and rejects junk payloads', async () => {
    const port = await harness()
    const base = 'http://127.0.0.1:' + String(port)
    const get = async (): Promise<any> => (await (await fetch(base + '/__dsh_a2a/canvas-layout')).json())
    expect((await get()).layout).toBeNull()
    const post = (b: unknown): Promise<any> => fetch(base + '/__dsh_a2a/canvas-layout', { method: 'POST', body: JSON.stringify(b) }).then(r => r.json())
    const saved = await post({ action: 'save', layout: DOC_FIXTURE })
    expect(saved.ok).toBe(true)
    expect((await get()).layout.nodes['session-x']).toEqual({ x: 10, y: 20 })
    expect((await post({ action: 'save', layout: { nope: 1 } })).ok).toBe(false)
    expect((await post({ action: 'wat' })).ok).toBe(false)
    expect((await post({ action: 'reset' })).ok).toBe(true)
    expect((await get()).layout).toBeNull()
  })

  it('saves a full-fleet document above the legacy 10 KiB control cap', async () => {
    const port = await harness()
    const base = 'http://127.0.0.1:' + String(port)
    // 256 nodes with long ids: ≈32 KiB of legitimate document — rejected by
    // the old shared control cap, inside MAX_LAYOUT_BODY_BYTES.
    const nodes: Record<string, { x: number; y: number }> = {}
    for (let i = 0; i < 256; i++) nodes[`session-${String(i).padStart(3, '0')}-${'x'.repeat(96)}`] = { x: i, y: i * 2 }
    const body = JSON.stringify({ action: 'save', layout: { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes, frames: {} } })
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(10_000)
    const response = await fetch(base + '/__dsh_a2a/canvas-layout', { method: 'POST', body })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  })

  it('answers 413 with the transport wire code above MAX_LAYOUT_BODY_BYTES', async () => {
    const port = await harness()
    const base = 'http://127.0.0.1:' + String(port)
    const nodes: Record<string, { x: number; y: number }> = {}
    for (let i = 0; i < 4000; i++) nodes[`session-${String(i).padStart(4, '0')}`] = { x: i, y: i }
    const body = JSON.stringify({ action: 'save', layout: { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes, frames: {} } })
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(MAX_LAYOUT_BODY_BYTES)
    const response = await fetch(base + '/__dsh_a2a/canvas-layout', { method: 'POST', body })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: WIRE_ERROR_PAYLOAD_TOO_LARGE })
  })
})

describe.skipIf(!hasStageDist)('floor stage page serving', () => {
  it('serves the shell with brand and hashed assets, guarding traversal', async () => {
    const port = await harness()
    const base = 'http://127.0.0.1:' + String(port) + '/__dsh_a2a_canvas'
    const shell = await fetch(base + '/')
    expect(shell.status).toBe(200)
    expect(shell.headers.get('content-type')).toContain('text/html')
    const htmlText = await shell.text()
    expect(htmlText).toContain('id="root"')
    expect(htmlText).toContain('dsh-a2a-munder-difflin')
    // Vite may order script attributes freely (crossorigin before src).
    const m = htmlText.match(/<script[^>]*src="([^"]+\.js)"/)
    expect(m).not.toBeNull()
    const jsPath = m![1]!.startsWith('/') === true ? m![1]! : '/' + String(m![1])
    const jsRes = await fetch(base + jsPath)
    expect(jsRes.status).toBe(200)
    expect(jsRes.headers.get('content-type')).toContain('javascript')
    const trav = await fetch(base + '/%2e%2e%2fpackage.json')
    expect(trav.status === 403 || trav.status === 404).toBe(true)
    expect((await fetch(base + '/nope.js')).status).toBe(404)
  })
})