/**
 * Transport-cap enforcement on both directions of the `/a2a/direct` wire
 * (work-order P4, B5 ruling): an oversized body is REJECTED with a structured
 * 413 + wire error code — never truncated, never connection-killed mid-read;
 * the outbound half refuses before any byte leaves the process.
 */
import { describe, expect, it, vi } from 'vitest'
import { request } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../src/index.ts'
import { A2aClient, type A2aFetch, type A2aSchedule } from '../src/a2a-client.ts'
import { MAX_ROUTE_BODY_BYTES, WIRE_ERROR_PAYLOAD_TOO_LARGE } from '../src/transport-caps.ts'

/** One recoverable root agent or none (same shape as the main spec's fake). */
class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): Agent {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return this.agent === undefined ? [] : [this.agent]
  }

  get(id: Agent['id']): Agent | undefined {
    return this.agent !== undefined && this.agent.id === id ? this.agent : undefined
  }
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '',
    session: 'sess-cap',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'cap node',
    peers: [],
    delegates: [],
    sessionNodes: false,
    wakeJoinedOnBoot: false,
    wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0,
    wakeBootStaggerMs: 3_000,
    stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000,
    cardCacheNegativeTtlMs: 30_000,
    remoteRowsTtlMs: 15_000,
    dshHome: '',
    cardTtlMs: 172_800_000,
    ...overrides,
  }
}

/** Boot one real web server exposing `/a2a/direct`, optionally with an answering agent. */
async function mount(): Promise<{ port: number; dispose: () => Promise<void>; steer: ReturnType<typeof vi.fn> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const registry = ctx.get('agents') as unknown as FakeAgentsService
  const liveAgent = {
    id: SessionId('agent-1'),
    session: { events: [] as unknown[] },
    steer: vi.fn(),
  } as unknown as Agent & { steer: ReturnType<typeof vi.fn>; session: { events: unknown[] } }
  liveAgent.steer = vi.fn(() => {
    ;(liveAgent.session.events as unknown[]).push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'peer node replied' }] } } })
    ctx.emit('agent/status', { agent: liveAgent, status: 'idle' })
  })
  registry.agent = liveAgent
  apply(ctx, makeConfig({ announce: true, session: 'peer-node', dshHome: mkdtempSync(join(tmpdir(), 'dsh-a2a-cap-')) }))
  const port = (ctx as unknown as { webServer: WebServer }).webServer.port
  return {
    port,
    dispose: async () => {
      await ctx.fiber.dispose()
    },
    steer: liveAgent.steer,
  }
}

/** Raw POST with explicit control over headers and multi-chunk writing. */
function postRaw(port: number, chunks: readonly string[], headers: Record<string, string> = {}): Promise<{ status?: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/a2a/direct', method: 'POST', headers }, res => {
      let text = ''
      res.on('data', d => {
        text += String(d)
      })
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    for (const chunk of chunks) req.write(chunk)
    req.end()
  })
}

describe('inbound transport cap (/a2a/direct)', () => {
  it('rejects an over-cap body with a structured 413 + wire error code (declared length)', async () => {
    const { port, dispose } = await mount()
    try {
      const body = JSON.stringify({ team: 'dsh', message: 'x'.repeat(MAX_ROUTE_BODY_BYTES) })
      expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(MAX_ROUTE_BODY_BYTES)
      const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      expect(response.status).toBe(413)
      const parsed = await response.json() as { error: string; code: number }
      expect(parsed.code).toBe(WIRE_ERROR_PAYLOAD_TOO_LARGE)
      expect(parsed.error).toContain('payload too large')
    } finally {
      await dispose()
    }
  })

  it('crosses the cap across streamed chunks (declared length), keeps draining, and answers once with 413', async () => {
    const { port, dispose } = await mount()
    try {
      // Explicit content-length declaring a size over the cap while the body
      // actually arrives in two separate writes: the flag is set from the
      // declaration, buffering never starts, and the stream still drains to
      // `end` before the single structured rejection goes out.
      const lead = 'a'.repeat(MAX_ROUTE_BODY_BYTES - 100)
      const tail = JSON.stringify({ team: 'dsh', message: 'z'.repeat(200) })
      const response = await postRaw(port, [lead, tail], {
        'content-length': String(lead.length + tail.length),
      })
      expect(response.status).toBe(413)
      const parsed = JSON.parse(response.text) as { error: string; code: number }
      expect(parsed.code).toBe(WIRE_ERROR_PAYLOAD_TOO_LARGE)
    } finally {
      await dispose()
    }
  })

  it('leaves the sub-cap path fully intact: a normal route still dispatches and replies', async () => {
    const { port, dispose, steer } = await mount()
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh', message: 'hello there' }),
      })
      expect(response.status).toBe(200)
      const parsed = await response.json() as { result?: { text?: string } }
      expect(parsed.result?.text).toContain('peer node replied')
      expect(steer).toHaveBeenCalledTimes(1)
    } finally {
      await dispose()
    }
  })
})

describe('outbound transport cap (a2a-client routeDirect)', () => {
  /** Recording stub: answers every dispatched call with a well-formed route result. */
  function stubFetch(): { calls: Array<{ body?: string }>; fetch: A2aFetch } {
    const calls: Array<{ body?: string }> = []
    const fetch: A2aFetch = (_url, init) => {
      calls.push(init.body !== undefined ? { body: init.body } : {})
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: 'ok', task_id: 't-1', context_id: 'ctx-1' }),
      })
    }
    return { calls, fetch }
  }

  /** Timers stay armed forever in these tests: nothing here runs long enough to time out. */
  const neverFire: A2aSchedule = () => () => undefined

  it('refuses locally before dispatch when the rendered body exceeds the cap', async () => {
    const { calls, fetch } = stubFetch()
    const subject = new A2aClient({ apiKey: '', sessionId: 'cap-tester', schedule: neverFire, fetch })
    const result = await subject.routeDirect('http://peer.example', 'dsh', 'x'.repeat(MAX_ROUTE_BODY_BYTES))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe(WIRE_ERROR_PAYLOAD_TOO_LARGE)
    expect(calls).toHaveLength(0)
  })

  it('dispatches normally just under the cap', async () => {
    const { calls, fetch } = stubFetch()
    const subject = new A2aClient({ apiKey: '', sessionId: 'cap-tester', schedule: neverFire, fetch })
    const result = await subject.routeDirect('http://peer.example', 'dsh', 'x'.repeat(MAX_ROUTE_BODY_BYTES - 1024))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.task_id).toBe('t-1')
    expect(calls).toHaveLength(1)
  })
})
