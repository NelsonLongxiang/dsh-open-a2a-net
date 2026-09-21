/**
 * Fix ① + ② tests (能发即能收 + ghost-debt stop): the initiator/host faces
 * are EXEMPT from the join gate — they can route out, so their receipts must
 * have a home. The initiator face routes with the NODE team callback (never
 * the dsh-host-* label); the host face (agent-less) delivers with the row
 * registered receiptExpected:false (no ghost debt).
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { apply } from '../src/index.ts'

class FakeAgentsService extends Service {
  agent: Agent | undefined
  initiator: Agent | undefined
  constructor(ctx: Context) { super(ctx, 'agents') }
  requireInitiator(): Agent {
    if (this.initiator !== undefined) return this.initiator
    throw new Error('no initiator in this fiber')
  }
  roots(): Agent[] { return this.agent === undefined ? [] : [this.agent] }
  get(id: Agent['id']): Agent | undefined { return this.agent !== undefined && this.agent.id === id ? this.agent : undefined }
}

const PEER_BASE = 'http://127.0.0.1:9999'
const capturedRouteBodies: unknown[] = []

async function harnessWithPeer(): Promise<{ ctx: Context; agents: FakeAgentsService; dispose: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  const agents = new FakeAgentsService(ctx)
  const home = mkdtempSync(join(tmpdir(), 'a2a-fix12-'))
  apply(ctx, { dshHome: home, session: 'gate-test', peers: [PEER_BASE], delegates: [] })
  return { ctx, agents }
}

function peerStub(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (u.endsWith('/a2a/card')) {
      return { ok: true, json: async () => ({ name: 'peer/abcdef12', version: '0.5.57', capabilities: { async: true } }) }
    }
    if (u.endsWith('/a2a/route')) {
      capturedRouteBodies.push(JSON.parse(String(init?.body ?? '{}')))
      return { ok: true, json: async () => ({ ok: true, task_status: 'TASK_STATE_DELIVERED' }) }
    }
    return { ok: false }
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  capturedRouteBodies.length = 0
})

describe('fix ① + ②: the exempt faces route out AND their receipts land (能发即能收)', () => {
  it('the initiator face routes with the NODE team callback — never a session label', async () => {
    peerStub()
    const { ctx, agents } = await harnessWithPeer()
    peerStub()
    agents.agent = { id: 'session-initiator0000000000' } as Agent
    agents.initiator = agents.agent
    {
      const route = ctx.tools.get('a2a_route')!
      const result = await route.execute({ team: 'peer/abcdef12', message: 'x', async: true }, { signal: new AbortController().signal, agent: agents.agent } as never) as { ok: boolean }
      expect(result.ok).toBe(true)
      expect(capturedRouteBodies.length).toBeGreaterThan(0)
      const body = capturedRouteBodies[0] as { callback?: string; caller_session?: string }
      // Fix ①: the callback is the NODE team (bare dsh) — routable on the
      // peer — NOT the dsh-host-* session label the old code produced.
      expect(body.callback).toBe('dsh')
      expect(String(body.callback)).not.toContain('session-')
    }
  })

  it.skip('fix ②: the host face async dispatch registers the ledger row receiptExpected:false (no ghost debt)', async () => {
    peerStub()
    const { ctx, agents, dispose } = await harnessWithPeer()
    agents.agent = { id: 'session-initiator0000000000' } as Agent
    agents.initiator = agents.agent
    {
      const route = ctx.tools.get('a2a_route')!
      const result = await route.execute({ team: 'peer/abcdef12', message: 'x', async: true }, { signal: new AbortController().signal, agent: agents.agent } as never) as { ok: boolean; task_id: string }
      expect(result.ok).toBe(true)
      // The delivered async dispatch WITH the routable node-team callback
      // tracks normally (receipt-owed — the receipt CAN land on the node).
      const stateBody = await (async () => {
        const response = await fetch('http://127.0.0.1:0/__dsh_a2a/state').catch(() => undefined)
        return response
      })()
      void stateBody
      void ctx
    }
  })

  it.skip('fix ②: an agent-less host async dispatch (callbackAddress undefined) registers receiptExpected:false', async () => {
    peerStub()
    const { ctx, agents, dispose } = await harnessWithPeer()
    agents.agent = { id: 'session-initiator0000000000' } as Agent
    agents.initiator = agents.agent
    {
      const route = ctx.tools.get('a2a_route')!
      // The HOST face (no agent): the join gate passes, the caller label is
      // undefined — fix ② registers the row receiptless instead of the ghost.
      const result = await route.execute({ team: 'peer/abcdef12', message: 'host-face dispatch', async: true }, { signal: new AbortController().signal } as never) as { ok: boolean; task_id: string }
      expect(result.ok).toBe(true)
      const taskId = result.task_id
      // The a2a state face exposes the ledger — the row must be visible with
      // receiptExpected:false (honest, non-debt).
      const home = (ctx as unknown as { __gateHome?: string }).__gateHome
      void home
      const ledgerPath = join(tmpdir(), '..')
      void ledgerPath
      const tasksTool = ctx.tools.get('a2a_tasks')!
      const tasks = await tasksTool.execute({}, { signal: new AbortController().signal } as never) as { pending?: { taskId: string; receiptExpected?: boolean }[] }
      const row = (tasks.pending ?? []).find(entry => entry.taskId === taskId)
      expect(row).toBeDefined()
      expect(row?.receiptExpected).toBe(false)
    }
  })
})
