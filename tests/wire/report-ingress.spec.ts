/**
 * a2a_report ingress: the ONE thing an unjoined session may do. The join
 * gate exemption is deliberate (one-way reporting grants no presence);
 * reports land in the state face's reports ring (newest first), rate
 * limited per session, message-capped.
 */
import { describe, expect, it, vi } from 'vitest'
import { dirname, join, resolve } from 'node:path'
import { lstatSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { cleanupBeforeTempDirs, mkdtempSync } from '../temp-dirs.ts'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, type Config } from '../../src/index.ts'

class FakeAgentsService extends Service {
  agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  requireInitiator(): never {
    throw new Error('no initiator in this fiber')
  }

  roots(): Agent[] {
    return this.agent === undefined ? [] : [this.agent]
  }
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: '',
    session: 'sess-1',
    team: 'dsh',
    routeTimeoutMs: 60_000,
    flushTimeoutMs: 300_000,
    announce: false,
    agentName: 'test node',
    peers: [],
    delegates: [],
    sessionNodes: true,
    wakeJoinedOnBoot: false,
    wakePrewarmDelayMs: 0,
    wakePrewarmQuietMs: 0,
    wakeBootStaggerMs: 3_000,
    wakeReconcile: false,
    wakeReconcileIntervalMs: 60_000,
    wakeReconcileBackoffBaseMs: 5_000,
    wakeReconcileMaxBackoffMs: 600_000,
    teamJoinAllowlist: [],
    teamScopeRouting: false,
    stateColdRowsTtlMs: 5_000,
    cardCacheTtlMs: 60_000,
    cardCacheNegativeTtlMs: 30_000,
    remoteRowsTtlMs: 15_000,
    cardTtlMs: 172_800_000,
    ...overrides,
    dshHome: overrides.dshHome ?? mkdtempSync(join(tmpdir(), 'a2a-report-host-')),
  }
}

interface ReportFace {
  reports: Array<{ at: number; level: string; message: string; session: string; task?: string }>
}

async function mountHost(): Promise<{ ctx: Context; home: string; port: () => number; report: ToolDefinition | undefined }> {
  const ctx = new Context()
  cleanupBeforeTempDirs(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(FakeAgentsService)
  const config = makeConfig()
  apply(ctx, config)
  return {
    ctx, home: config.dshHome,
    port: () => (ctx as unknown as { webServer: WebServer }).webServer.port,
    report: ctx.tools.get('a2a_report'),
  }
}

async function getReports(port: number): Promise<ReportFace['reports']> {
  const body = await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/__dsh_a2a/state`)).json() as ReportFace
  return body.reports
}

describe('a2a_report unjoined-node ingress', () => {
  it.each([false, true])('normalizes optional fixture homes before composing nodes (own-undefined=%s)', ownUndefined => {
    const overrides: Partial<Config> = ownUndefined ? { dshHome: undefined } : {}
    expect(Object.hasOwn(overrides, 'dshHome')).toBe(ownUndefined)
    const first = makeConfig(overrides), second = makeConfig({ ...overrides })
    expect(typeof first.dshHome).toBe('string')
    expect(first.dshHome).not.toBe('')
    expect(typeof second.dshHome).toBe('string')
    expect(second.dshHome).not.toBe(first.dshHome)
    for (const home of [first.dshHome, second.dshHome]) {
      expect(dirname(resolve(home))).toBe(resolve(tmpdir()))
      expect(lstatSync(home).isDirectory()).toBe(true)
      expect(lstatSync(home).isSymbolicLink()).toBe(false)
    }
    expect(makeConfig({ dshHome: first.dshHome }).dshHome).toBe(first.dshHome)
    expect(makeConfig({ dshHome: '' }).dshHome).toBe('')
  })
  it('keeps same-session report hosts on independent homes, keys and report state', async () => {
    const a = await mountHost(), b = await mountHost()
    try {
      expect(a.home).not.toBe('')
      expect(b.home).not.toBe(a.home)
      expect(readFileSync(join(a.home, 'a2a', 'node-key.pem'), 'utf8'))
        .not.toBe(readFileSync(join(b.home, 'a2a', 'node-key.pem'), 'utf8'))
      const caller = { agent: { id: SessionId('same-fixture-reporter') } }
      await expect(a.report?.execute({ message: 'only first' }, caller)).resolves.toMatchObject({ ok: true })
      expect((await getReports(a.port())).map(row => row.message)).toEqual(['only first'])
      expect(await getReports(b.port())).toEqual([])
      await expect(b.report?.execute({ message: 'only second' }, caller)).resolves.toMatchObject({ ok: true })
      expect((await getReports(b.port())).map(row => row.message)).toEqual(['only second'])
      expect((await getReports(a.port())).map(row => row.message)).toEqual(['only first'])
    } finally { await a.ctx.fiber.dispose(); await b.ctx.fiber.dispose() }
  })
  it('an unjoined session can report — the join gate exemption is the point', async () => {
    const { ctx, port, report } = await mountHost()
    // The calling session is NOT a joined node and the fake has no
    // initiator — the join gate would refuse any other a2a tool outright.
    const exec = { agent: { id: SessionId('ghost-session-0000-0000-0000-000000000000') } }
    const result = await report?.execute({ message: '我离册了，请收养', level: 'warning' }, exec) as { ok: boolean; reportId?: string }
    expect(result?.ok).toBe(true)
    expect(result?.reportId).toMatch(/^report-/)
    const reports = await getReports(port())
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ level: 'warning', message: '我离册了，请收养', session: 'ghost-session-0000-0000-0000-000000000000' })
    await ctx.fiber.dispose()
  })

  it('rate limits to one report per 30s per session and caps the message at 4000 chars (K3 P2, 0.6.14)', async () => {
    const { ctx, report } = await mountHost()
    const exec = { agent: { id: SessionId('ghost-2') } }
    const first = await report?.execute({ message: 'first' }, exec) as { ok: boolean }
    expect(first?.ok).toBe(true)
    const second = await report?.execute({ message: 'second', level: 'error' }, exec) as { ok: boolean; error?: string }
    expect(second?.ok).toBe(false)
    expect(second?.error).toContain('rate limited')
    // 3999 fits where 2001 used to refuse — long verdicts (K3's five-gate reports) need no trimming now.
    const roomy = await report?.execute({ message: 'x'.repeat(3999) }, { agent: { id: SessionId('ghost-2b') } }) as { ok: boolean }; expect(roomy?.ok).toBe(true)
    const oversized = await report?.execute({ message: 'x'.repeat(4001) }, { agent: { id: SessionId('ghost-3') } }) as { ok: boolean; error?: string }
    expect(oversized?.ok).toBe(false)
    expect(oversized?.error).toContain('4000-char cap')
    const empty = await report?.execute({ message: '  ' }, { agent: { id: SessionId('ghost-4') } }) as { ok: boolean; error?: string }
    expect(empty?.ok).toBe(false)
    await ctx.fiber.dispose()
  })

  it('serves reports newest first on the state face, carrying the task reference', async () => {
    const { ctx, port, report } = await mountHost()
    await report?.execute({ message: 'older', task: 'task-a' }, { agent: { id: SessionId('ghost-5') } })
    await report?.execute({ message: 'newer', level: 'error' }, { agent: { id: SessionId('ghost-6') } })
    const reports = await getReports(port())
    expect(reports).toHaveLength(2)
    expect(reports[0]?.message).toBe('newer')
    expect(reports[1]).toMatchObject({ message: 'older', task: 'task-a' })
    await ctx.fiber.dispose()
  })
})
