// @vitest-environment node
// Reviewer repro (PR #145): the report loop circuit-breaker ring must be
// per-apply() state, as it was before the split. Four independent plugin
// instances in one process each file ONE identical host report; none of
// them has had 3 prior reports, so none may be loop-refused.
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { apply, type Config } from '../../src/index.ts'

async function mount(): Promise<Context> {
  const home = mkdtempSync(joinPath(tmpdir(), 'rv145-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  apply(ctx, {
    apiKey: '', session: 'host-rv145', team: 'dsh', routeTimeoutMs: 5_000,
    flushTimeoutMs: 300_000, announce: false, agentName: 'rv145', peers: [],
    delegates: [], sessionNodes: false, wakeJoinedOnBoot: false, dshHome: home,
    cardTtlMs: 172_800_000, teamJoinAllowlist: [],
  } as Config)
  return ctx
}

describe('rv145: report loop ring is per-apply', () => {
  it('a fresh apply() does not inherit another instance\'s loop window', async () => {
    const results: Array<{ ok: boolean; error?: string }> = []
    for (let i = 0; i < 4; i++) {
      const ctx = await mount()
      try {
        results.push(await ctx.tools.get('a2a_report')?.execute({ message: 'same text' }, { signal: new AbortController().signal } as never) as { ok: boolean; error?: string })
      } finally { await ctx.fiber.dispose() }
    }
    expect(results.map(r => r.ok)).toEqual([true, true, true, true])
  }, 30_000)
})
