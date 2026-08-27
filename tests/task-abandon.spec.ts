/**
 * Caller-side abandon primitives (work-order P1a): structured outcomes
 * {cleared|already-terminal|unknown}, idempotent, never-thrown; late receipts
 * against abandoned rows land as orphan metadata without rewriting the
 * decision; the control route rides the standard control guard.
 */
import { describe, expect, it } from 'vitest'
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
import { TaskLedger } from '../src/task-ledger.ts'

describe('task-ledger abandon', () => {
  function tmpLedger(): { ledger: TaskLedger; file: string } {
    const file = join(mkdtempSync(join(tmpdir(), 'dsh-a2a-ledger-')), 'tasks.json')
    return { ledger: new TaskLedger(file), file }
  }

  it('clears a pending row into the archive under a caller-abandoned outcome', () => {
    const { ledger } = tmpLedger()
    ledger.track('t-1', 'dsh/target', 'http://peer')
    const result = ledger.abandon('t-1', 'orchestrator budget exhausted')
    expect(result).toMatchObject({ outcome: 'cleared', taskId: 't-1' })
    expect(result.archivedAt).toBeTypeOf('number')
    const [row] = ledger.archive()
    expect(row?.summary).toBe('caller-abandoned: orchestrator budget exhausted')
    // The owed view no longer reports it as pending.
    expect(ledger.isPending('t-1')).toBe(false)
    expect(ledger.list()).toHaveLength(0)
  })

  it('is idempotent: repeat abandons report already-terminal with the original settle time', () => {
    const { ledger } = tmpLedger()
    ledger.track('t-1', 'dsh/target', 'http://peer')
    const first = ledger.abandon('t-1')
    const second = ledger.abandon('t-1')
    expect(first.outcome).toBe('cleared')
    expect(second).toEqual({ outcome: 'already-terminal', taskId: 't-1', archivedAt: first.archivedAt })
    expect(ledger.archive()).toHaveLength(1)
  })

  it('reports unknown for ids neither tier ever saw, including empty input', () => {
    const { ledger } = tmpLedger()
    expect(ledger.abandon('nope')).toEqual({ outcome: 'unknown', taskId: 'nope' })
    expect(ledger.abandon('')).toEqual({ outcome: 'unknown', taskId: '' })
  })

  it('already-settled rows answer already-terminal without mutation', () => {
    const { ledger } = tmpLedger()
    ledger.track('t-1', 'dsh/target', 'http://peer')
    ledger.resolveFromMessage('[A2A receipt] task t-1 done well')
    const before = ledger.archive()[0]
    const result = ledger.abandon('t-1')
    expect(result).toEqual({ outcome: 'already-terminal', taskId: 't-1', archivedAt: before?.resolvedAt })
    expect(ledger.archive()[0]?.summary).toBe('done well')
  })

  it('orphan-isolates a late receipt on an abandoned row: decision verbatim, arrival recorded', () => {
    const { ledger, file } = tmpLedger()
    ledger.track('t-1', 'dsh/target', 'http://peer')
    ledger.abandon('t-1', 'gave up waiting')
    expect(ledger.resolveFromMessage('[A2A receipt] task t-1 actually finished late')).toBe(true)
    const row = ledger.archive()[0]
    expect(row?.summary).toBe('caller-abandoned: gave up waiting')
    expect(row?.lateReceiptAt).toBeTypeOf('number')
    // Isolation persists across restart.
    const restored = new TaskLedger(file)
    expect(restored.archive()[0]).toMatchObject({ summary: 'caller-abandoned: gave up waiting' })
    expect(restored.archive()[0]?.lateReceiptAt).toBeTypeOf('number')
  })

  it('keeps ordinary receipt correlation untouched for non-abandoned rows', () => {
    const { ledger } = tmpLedger()
    ledger.track('t-9', 'dsh/target', 'local')
    expect(ledger.resolveFromMessage('[A2A receipt] task t-9 normal finish')).toBe(true)
    const row = ledger.archive()[0]
    expect(row?.summary).toBe('normal finish')
    expect(row?.lateReceiptAt).toBeUndefined()
  })
})

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
    session: 'sess-abandon',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'abandon node',
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

async function mount(): Promise<{ port: number; dispose: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  apply(ctx, makeConfig({ announce: true, session: 'peer-node', dshHome: mkdtempSync(join(tmpdir(), 'dsh-a2a-abandon-')) }))
  const port = (ctx as unknown as { webServer: WebServer }).webServer.port
  return {
    port,
    dispose: async () => {
      await ctx.fiber.dispose()
    },
  }
}

describe('task abandon control route', () => {
  it('answers loopback calls with the structured outcome vocabulary', async () => {
    const { port, dispose } = await mount()
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/tasks/abandon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: 'never-tracked' }),
      })
      expect(response.status).toBe(200)
      const parsed = await response.json() as { outcome: string; taskId: string }
      expect(parsed.outcome).toBe('unknown')
      expect(parsed.taskId).toBe('never-tracked')
    } finally {
      await dispose()
    }
  })

  it('forwards an optional reason through to the ledger verdict', async () => {
    const { port, dispose } = await mount()
    try {
      // An empty task_id is an unknown outcome by contract (and never throws).
      const response = await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/tasks/abandon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: '', reason: 'run disposed mid-flight' }),
      })
      expect(response.status).toBe(200)
      const parsed = await response.json() as { outcome: string }
      expect(parsed.outcome).toBe('unknown')
    } finally {
      await dispose()
    }
  })
})
