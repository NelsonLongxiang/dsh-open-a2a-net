/**
 * Server-side idempotency keys (work-order P3 / B3): one caller-born task id
 * executes at most once per TTL window — exact replays answer
 * 409/-32003/replay:true without re-steering, key conflicts answer
 * 409/-32002, expiry re-opens the window, and every path is total.
 */
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
import {
  IdempotencyStore,
  OUTCOME_TEXT_CAP,
  WIRE_ERROR_IDEMPOTENCY_CONFLICT,
  WIRE_ERROR_REPLAY_REJECTED,
  peerPayloadFingerprint,
  type IdempotencyOptions,
} from '../src/idempotency-store.ts'

describe('idempotency store', () => {
  function tmpStore(options?: IdempotencyOptions): { store: IdempotencyStore; file: string } {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-idem-')), 'idempotency.json')
    return { store: new IdempotencyStore(file, options), file }
  }

  it('fresh claim records the fingerprint; identical re-claim answers replay; different payload answers conflict', () => {
    const { store } = tmpStore()
    expect(store.claim('t-1', 'hash-a')).toBe('fresh')
    expect(store.claim('t-1', 'hash-a')).toBe('replay')
    expect(store.has('t-1')).toBe(true)
    expect(store.claim('t-1', 'hash-b')).toBe('conflict')
  })

  it('expired keys re-open after the TTL (injectable clock)', () => {
    let now = 1_000_000
    const { store } = tmpStore({ now: () => now, ttlMs: 1_000 })
    expect(store.claim('t-1', 'hash-a')).toBe('fresh')
    now += 1_500
    expect(store.has('t-1')).toBe(false)
    expect(store.claim('t-1', 'hash-a')).toBe('fresh')
  })

  it('capacity evicts oldest-inserted first', () => {
    const { store } = tmpStore({ cap: 2 })
    expect(store.claim('a', 'h')).toBe('fresh')
    expect(store.claim('b', 'h')).toBe('fresh')
    expect(store.claim('c', 'h')).toBe('fresh') // evicts 'a'
    expect(store.has('a')).toBe(false)
    expect(store.claim('b', 'h')).toBe('replay')
  })

  it('empty ids bypass claiming entirely (always fresh, never stored)', () => {
    const { store } = tmpStore()
    expect(store.claim('', 'h')).toBe('fresh')
    expect(store.has('')).toBe(false)
  })

  it('the window persists across restarts (including conflict memory)', () => {
    const { store, file } = tmpStore()
    expect(store.claim('t-1', 'hash-x')).toBe('fresh')
    const restored = new IdempotencyStore(file)
    expect(restored.claim('t-1', 'hash-y')).toBe('conflict')
    expect(restored.claim('t-1', 'hash-x')).toBe('replay')
  })
})

class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): Agent {
    throw new Error('none')
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
    session: 'sess-idem',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'idem node',
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

async function mount(overrides: Partial<Config> = {}): Promise<{ port: number; registry: FakeAgentsService; dispose: () => Promise<void> }> {
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
  apply(ctx, makeConfig({ announce: true, session: 'peer-node', dshHome: mkdtempSync(join(tmpdir(), 'dsh-a2a-idem-host-')), ...overrides }))
  const port = (ctx as unknown as { webServer: WebServer }).webServer.port
  return {
    port,
    registry,
    dispose: async () => {
      await ctx.fiber.dispose()
    },
  }
}

describe('/a2a/direct idempotency enforcement', () => {
  it('first delivery executes; exact replay refuses with -32003+replay:true and never re-steers', async () => {
    const { port, dispose } = await mount()
    try {
      // Only explicit caller-born task_ids can collide: the minted-direct-*
      // fallback randomizes every run, which is exactly the contract.
      const pinned = JSON.stringify({ team: 'dsh', message: 'pin me', caller_session: 'idem-runner', task_id: 'pinned-task' })
      const p1 = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pinned })
      expect(p1.status).toBe(200)
      const p2 = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pinned })
      expect(p2.status).toBe(409)
      const parsed = await p2.json() as { code: number; replay: boolean; task_id?: string }
      expect(parsed.code).toBe(WIRE_ERROR_REPLAY_REJECTED)
      expect(parsed.replay).toBe(true)
      expect(parsed.task_id).toBe('pinned-task')
      // Byte-level shape pin (frozen surface): the whole 409 body, not just
      // its fields — any shape drift must fail here first.
      expect(parsed).toEqual({ error: 'duplicate task id within the idempotency window', code: WIRE_ERROR_REPLAY_REJECTED, task_id: 'pinned-task', replay: true })
    } finally {
      await dispose()
    }
  })

  it('same key + different payload answers hard conflict -32002', async () => {
    const { port, dispose } = await mount()
    try {
      const first = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh', message: 'version A', caller_session: 'idem-runner', task_id: 'clash-1' }),
      })
      expect(first.status).toBe(200)
      const second = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh', message: 'version B tampered', caller_session: 'idem-runner', task_id: 'clash-1' }),
      })
      expect(second.status).toBe(409)
      const parsed = await second.json() as { code: number; replay?: boolean }
      expect(parsed.code).toBe(WIRE_ERROR_IDEMPOTENCY_CONFLICT)
      // Explicit false, not absent: machines branch on a total field.
      expect(parsed.replay).toBe(false)
    } finally {
      await dispose()
    }
  })
})

describe('idempotency outcome ledger (W7 slice 2)', () => {
  function tmpStore(options?: IdempotencyOptions): { store: IdempotencyStore; file: string } {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-idem-')), 'idempotency.json')
    return { store: new IdempotencyStore(file, options), file }
  }

  it('a recorded outcome answers the completed query; the claim stays replay-gated', () => {
    const { store } = tmpStore()
    expect(store.claim('t-1', 'hash-a')).toBe('fresh')
    expect(store.query('t-1', 'hash-a')).toEqual({ found: true, status: 'pending' })
    expect(store.recordOutcome('t-1', { status: 'completed', reply: 'the product' }, 5_000)).toBe(true)
    expect(store.query('t-1', 'hash-a')).toEqual({ found: true, status: 'completed', reply: 'the product', settledAt: 5_000 })
    // The retrieval surface never weakens the gate.
    expect(store.claim('t-1', 'hash-a')).toBe('replay')
  })

  it('failed outcomes answer with the failure prose', () => {
    const { store } = tmpStore()
    store.claim('t-1', 'hash-a')
    store.recordOutcome('t-1', { status: 'failed', error: 'the prior attempt exploded at the peer' }, 6_000)
    expect(store.query('t-1', 'hash-a')).toEqual({ found: true, status: 'failed', error: 'the prior attempt exploded at the peer', settledAt: 6_000 })
  })

  it('unknown, empty, and mismatched lookups answer the honest negatives', () => {
    const { store } = tmpStore()
    store.claim('t-1', 'hash-a')
    expect(store.query('never-claimed', 'hash-a')).toEqual({ found: false, reason: 'unknown-task' })
    expect(store.query('', 'hash-a')).toEqual({ found: false, reason: 'unknown-task' })
    expect(store.query('t-1', 'wrong-fingerprint')).toEqual({ found: false, reason: 'payload-mismatch' })
  })

  it('recordOutcome is first-write-wins and ignores unknown or empty ids', () => {
    const { store } = tmpStore()
    expect(store.recordOutcome('ghost', { status: 'completed', reply: 'x' })).toBe(false)
    expect(store.recordOutcome('', { status: 'completed', reply: 'x' })).toBe(false)
    store.claim('t-1', 'hash-a')
    expect(store.recordOutcome('t-1', { status: 'completed', reply: 'first' }, 1_000)).toBe(true)
    expect(store.recordOutcome('t-1', { status: 'failed', error: 'late flip' }, 2_000)).toBe(false)
    expect(store.query('t-1', 'hash-a')).toMatchObject({ status: 'completed', reply: 'first', settledAt: 1_000 })
  })

  it('oversized outcome text truncates at the cap with a flagged marker', () => {
    const { store } = tmpStore()
    store.claim('t-1', 'hash-a')
    store.recordOutcome('t-1', { status: 'completed', reply: 'x'.repeat(70_000) })
    const answer = store.query('t-1', 'hash-a')
    expect(answer).toMatchObject({ status: 'completed', truncated: true })
    expect(answer.found === true && answer.status === 'completed' && answer.reply.length === OUTCOME_TEXT_CAP).toBe(true)
  })

  it('expired claims answer unknown-task — the outcome dies with the window', () => {
    let now = 1_000_000
    const { store } = tmpStore({ now: () => now, ttlMs: 1_000 })
    store.claim('t-1', 'hash-a')
    store.recordOutcome('t-1', { status: 'completed', reply: 'doomed to expire' })
    now += 1_500
    expect(store.query('t-1', 'hash-a')).toEqual({ found: false, reason: 'unknown-task' })
  })

  it('a v1 snapshot (claims only) restores as pending, not completed', () => {
    const { store, file } = tmpStore()
    store.claim('t-1', 'hash-x')
    const restored = new IdempotencyStore(file)
    expect(restored.query('t-1', 'hash-x')).toEqual({ found: true, status: 'pending' })
    expect(restored.claim('t-1', 'hash-y')).toBe('conflict')
  })

  it('the outcome persists across restarts and a corrupt outcome degrades to pending', () => {
    const { store, file } = tmpStore()
    store.claim('t-1', 'hash-a')
    store.recordOutcome('t-1', { status: 'completed', reply: 'survives' }, 9_000)
    store.claim('t-2', 'hash-b')
    writeFileSync(file, JSON.stringify({ entries: [
      { taskId: 't-1', fingerprint: 'hash-a', at: Date.now(), outcome: { status: 'completed', reply: 'survives' }, settledAt: 9_000 },
      { taskId: 't-2', fingerprint: 'hash-b', at: Date.now(), outcome: { status: 'weird' }, settledAt: 3 },
    ] }))
    const restored = new IdempotencyStore(file)
    expect(restored.query('t-1', 'hash-a')).toEqual({ found: true, status: 'completed', reply: 'survives', settledAt: 9_000 })
    expect(restored.query('t-2', 'hash-b')).toEqual({ found: true, status: 'pending' })
  })

  it('peerPayloadFingerprint matches the gate expression byte-for-byte', () => {
    const input = { caller: 'caller-1', message: 'hello 世界', noWait: false, team: 'dsh' }
    expect(peerPayloadFingerprint(input)).toBe(createHash('sha256').update(JSON.stringify({ caller: input.caller, message: input.message, noWait: input.noWait, team: input.team })).digest('hex'))
  })
})

describe('/a2a/query outcome retrieval', () => {
  const FINGERPRINT = peerPayloadFingerprint({ caller: 'idem-runner', message: 'pin me', noWait: false, team: 'dsh' })

  function query(port: number, body: Record<string, unknown>): Promise<{ status: number; json: () => Promise<Record<string, unknown>> }> {
    return globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }

  it('a settled sync round answers completed; wrong fingerprint answers payload-mismatch', async () => {
    const { port, dispose } = await mount()
    try {
      const pinned = JSON.stringify({ team: 'dsh', message: 'pin me', caller_session: 'idem-runner', task_id: 'pinned-task' })
      await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pinned })
      await expect(query(port, { task_id: 'pinned-task', fingerprint: FINGERPRINT }).then(r => r.json()))
        .resolves.toEqual({ found: true, status: 'completed', reply: 'peer node replied', settled_at: expect.any(String), task_id: 'pinned-task' })
      await expect(query(port, { task_id: 'pinned-task', fingerprint: 'tampered' }).then(r => r.json()))
        .resolves.toEqual({ found: false, reason: 'payload-mismatch', task_id: 'pinned-task' })
      await expect(query(port, { task_id: 'never-claimed', fingerprint: FINGERPRINT }).then(r => r.json()))
        .resolves.toEqual({ found: false, reason: 'unknown-task', task_id: 'never-claimed' })
    } finally {
      await dispose()
    }
  })

  it('malformed fields degrade to unknown-task; the answer surface is constant-200', async () => {
    const { port, dispose } = await mount()
    try {
      await expect(query(port, { task_id: '', fingerprint: FINGERPRINT }).then(r => r.json()))
        .resolves.toEqual({ found: false, reason: 'unknown-task', task_id: '' })
      await expect(query(port, { fingerprint: FINGERPRINT }).then(r => r.json()))
        .resolves.toEqual({ found: false, reason: 'unknown-task', task_id: '' })
      await expect(query(port, { task_id: 'pinned-task' }).then(r => r.json()))
        .resolves.toEqual({ found: false, reason: 'unknown-task', task_id: 'pinned-task' })
    } finally {
      await dispose()
    }
  })

  it('a failed round records the failure prose on the claim row', async () => {
    const { port, dispose } = await mount()
    try {
      const fingerprint = peerPayloadFingerprint({ caller: 'idem-runner', message: 'to a team nobody serves', noWait: false, team: 'nosuch' })
      const direct = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'nosuch', message: 'to a team nobody serves', caller_session: 'idem-runner', task_id: 'doomed-task' }),
      })
      expect((await direct.json() as { error?: string }).error).toContain('No live DSH session node')
      await expect(query(port, { task_id: 'doomed-task', fingerprint }).then(r => r.json()))
        .resolves.toMatchObject({ found: true, status: 'failed', error: expect.stringContaining('No live DSH session node') })
    } finally {
      await dispose()
    }
  })
})


describe('/a2a/query outcome retrieval — hooks and honest negatives', () => {
  function query(port: number, body: Record<string, unknown>): Promise<{ status: number; json: () => Promise<Record<string, unknown>> }> {
    return globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }

  it('a delivered-but-unsettled noWait round answers pending — the honest registered debt', async () => {
    // noWait to a live team: delivered with no settlement hook on this path
    // (the receipt routes to the caller, not back here) — the claim row
    // stays pending and the endpoint says so, never a fabricated product.
    const { port, dispose } = await mount()
    try {
      const fingerprint = peerPayloadFingerprint({ caller: 'idem-runner', message: 'async work', noWait: true, team: 'dsh' })
      const direct = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh', message: 'async work', caller_session: 'idem-runner', task_id: 'async-task', wait: false }),
      })
      expect((await direct.json() as { delivered?: boolean }).delivered).toBe(true)
      await expect(query(port, { task_id: 'async-task', fingerprint }).then(r => r.json()))
        .resolves.toEqual({ found: true, status: 'pending', task_id: 'async-task' })
    } finally {
      await dispose()
    }
  })

  it('a wedged session answers a flush-timeout PLACEHOLDER — the placeholder never enters the ledger (gap-B bar, reply channel)', async () => {
    const { port, registry, dispose } = await mount({ flushTimeoutMs: 80 })
    try {
      // Wedge the session: the steer produces no assistant message and no
      // idle flush, so the sync round resolves with the host's timeout
      // placeholder prose.
      const agent = registry.agent as unknown as { steer: (msg: string) => void } | undefined
      if (agent !== undefined) agent.steer = () => {}
      const fingerprint = peerPayloadFingerprint({ caller: 'idem-runner', message: 'wedged work', noWait: false, team: 'dsh' })
      const direct = await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh', message: 'wedged work', caller_session: 'idem-runner', task_id: 'wedged-task' }),
      })
      const body = await direct.json() as { result?: { text?: string } }
      expect(body.result?.text).toContain('no final reply within the configured window')
      await expect(query(port, { task_id: 'wedged-task', fingerprint }).then(r => r.json()))
        .resolves.toEqual({ found: true, status: 'pending', task_id: 'wedged-task' })
    } finally {
      await dispose()
    }
  }, 10_000)

  it('a receipt line records the claimed key\'s outcome (hook 3, summary — never the envelope vocabulary)', async () => {
    const { port, dispose } = await mount()
    try {
      const fingerprint = peerPayloadFingerprint({ caller: 'idem-runner', message: 'async work', noWait: true, team: 'dsh' })
      await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh', message: 'async work', caller_session: 'idem-runner', task_id: 'receipted-task', wait: false }),
      })
      await expect(query(port, { task_id: 'receipted-task', fingerprint }).then(r => r.json()))
        .resolves.toEqual({ found: true, status: 'pending', task_id: 'receipted-task' })
      // The receipt routes back through this node: its one-line summary —
      // not the envelope's controlled vocabulary — becomes the outcome.
      await globalThis.fetch(`http://127.0.0.1:${String(port)}/a2a/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: 'dsh', message: '[A2A receipt] task receipted-task everything settled fine on the peer', caller_session: 'idem-runner' }),
      })
      await expect(query(port, { task_id: 'receipted-task', fingerprint }).then(r => r.json()))
        .resolves.toMatchObject({ found: true, status: 'completed', reply: expect.stringContaining('settled fine') })
    } finally {
      await dispose()
    }
  })

  it('store: an oversized failure prose truncates with the flag; a text-less status degrades to pending on restore', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-idem-')), 'idempotency.json')
    const store = new IdempotencyStore(file)
    store.claim('t-err', 'h1')
    store.recordOutcome('t-err', { status: 'failed', error: 'e'.repeat(70_000) })
    const failed = store.query('t-err', 'h1')
    expect(failed).toMatchObject({ status: 'failed', truncated: true })
    expect(failed.found === true && failed.status === 'failed' && failed.error.length === OUTCOME_TEXT_CAP).toBe(true)

    store.claim('t-ghost', 'h2')
    store.recordOutcome('t-ghost', { status: 'completed', reply: 'real' })
    writeFileSync(file, JSON.stringify({ entries: [
      { taskId: 't-err', fingerprint: 'h1', at: Date.now(), outcome: { status: 'failed', error: 'e'.repeat(70_000), truncated: true }, settledAt: 1 },
      { taskId: 't-ghost', fingerprint: 'h2', at: Date.now(), outcome: { status: 'completed', reply: 'real' }, settledAt: 2 },
      { taskId: 't-bare', fingerprint: 'h3', at: Date.now(), outcome: { status: 'completed' }, settledAt: 3 },
    ] }))
    const restored = new IdempotencyStore(file)
    expect(restored.query('t-err', 'h1')).toMatchObject({ status: 'failed', truncated: true })
    expect(restored.query('t-ghost', 'h2')).toEqual({ found: true, status: 'completed', reply: 'real', settledAt: 2 })
    // completed-without-text on disk → pending, never a fabricated empty reply
    expect(restored.query('t-bare', 'h3')).toEqual({ found: true, status: 'pending' })
  })
})

describe('idempotency window observability (0.5.36)', () => {
  function tmpStore(options?: IdempotencyOptions): { store: IdempotencyStore; file: string } {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-idem-')), 'idempotency.json')
    return { store: new IdempotencyStore(file, options), file }
  }

  it('counts fresh/replay/conflict cumulatively and derives the outcome split', () => {
    const { store } = tmpStore()
    store.claim('t-1', 'h1')            // fresh #1
    store.claim('t-1', 'h1')            // replay #1
    store.claim('t-1', 'h2')            // conflict #1
    store.claim('t-2', 'h2')            // fresh #2
    store.recordOutcome('t-1', { status: 'completed', reply: 'x' })
    expect(store.stats()).toMatchObject({
      window: 2, cap: 256, pending: 1, settled: 1, claimsFresh: 2, replays: 1, conflicts: 1,
    })
  })

  it('pre-stats snapshots restore with zeroed counters; persisted counters survive restart', () => {
    const { store, file } = tmpStore()
    store.claim('t-1', 'h1')
    // A pre-stats (v2) snapshot: counters unknown → zero-filled, never fabricated.
    writeFileSync(file, JSON.stringify({ entries: [{ taskId: 't-1', fingerprint: 'h1', at: Date.now() }] }))
    const legacy = new IdempotencyStore(file)
    expect(legacy.stats()).toMatchObject({ claimsFresh: 0, replays: 0, conflicts: 0 })
    // Persisted counters survive a restart.
    writeFileSync(file, JSON.stringify({
      entries: [{ taskId: 't-1', fingerprint: 'h1', at: Date.now() }],
      stats: { claimsFresh: 5, replays: 2, conflicts: 1 },
    }))
    const restored = new IdempotencyStore(file)
    expect(restored.stats()).toMatchObject({ window: 1, claimsFresh: 5, replays: 2, conflicts: 1 })
  })
})

describe('idempotency window observability — R1 regressions', () => {
  function tmpStore(options?: IdempotencyOptions): { store: IdempotencyStore; file: string } {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-idem-')), 'idempotency.json')
    return { store: new IdempotencyStore(file, options), file }
  }

  it('B-1 regression: a TTL-aged entry cannot wipe persisted counters across double restart', () => {
    const { store, file } = tmpStore()
    store.claim('aged', 'h1')
    store.claim('fresh', 'h2')
    store.recordOutcome('fresh', { status: 'completed', reply: 'x' })
    // Simulate the aged entry having expired on disk (24h later), counters intact.
    writeFileSync(file, JSON.stringify({
      entries: [
        { taskId: 'aged', fingerprint: 'h1', at: Date.now() - 48 * 3_600_000 },
        { taskId: 'fresh', fingerprint: 'h2', at: Date.now(), outcome: { status: 'completed', reply: 'x' }, settledAt: Date.now() },
      ],
      stats: { claimsFresh: 7, replays: 3, conflicts: 1 },
    }))
    // Restart 1: the expired entry prunes on restore — but the prune's
    // persist must carry the RESTORED counters, not zeros.
    const boot1 = new IdempotencyStore(file)
    expect(boot1.stats()).toMatchObject({ claimsFresh: 7, replays: 3, conflicts: 1 })
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { stats?: { claimsFresh: number } }
    expect(onDisk.stats?.claimsFresh).toBe(7)
    // Restart 2 (a silent node, no persist-triggering traffic in between):
    // the evidence must still be there.
    const boot2 = new IdempotencyStore(file)
    expect(boot2.stats()).toMatchObject({ claimsFresh: 7, replays: 3, conflicts: 1 })
  })

  it('malformed stats values degrade to zero, never climb from a poisoned base', () => {
    const { file } = tmpStore()
    writeFileSync(file, JSON.stringify({
      entries: [{ taskId: 't-1', fingerprint: 'h1', at: Date.now() }],
      stats: { claimsFresh: -7, replays: 1.5, conflicts: 'many' },
    }))
    const restored = new IdempotencyStore(file)
    expect(restored.stats()).toMatchObject({ claimsFresh: 0, replays: 0, conflicts: 0 })
  })
})
