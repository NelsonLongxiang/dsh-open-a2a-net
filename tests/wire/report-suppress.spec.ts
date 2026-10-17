/**
 * Fix ④ (report loop circuit-breaker): the SAME session reporting the SAME
 * text ≥3 times inside a 10 minutes is a loop, not a situation — the first
 * copies go through, the breaker refuses with a named 循环检测 reason, and a
 * DIFFERENT text still passes (the suppression keys on session+content).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import { apply } from '../../src/index.ts'

async function harness(): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TimerService)
  const home = mkdtempSync(join(tmpdir(), 'a2a-suppress-'))
  mkdirSync(join(home, 'a2a'), { recursive: true })
  apply(ctx, { dshHome: home, session: 'suppress-test', peers: [], delegates: [] })
  return { ctx }
}

describe('fix ④: report loop circuit-breaker (10min window, ≥3 same-text)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T08:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts the first copies, refuses the 4th same-text with 循环检测, and a different text still passes', async () => {
    const { ctx, dispose } = await harness()
    {
      const report = ctx.tools.get('a2a_report')!
      const agentless = { signal: new AbortController().signal } as never
      const same = { message: 'supervision: 85 节点批次候入库' }

      const r1 = await report.execute({ ...same }, agentless) as { ok: boolean }
      expect(r1.ok).toBe(true)
      vi.advanceTimersByTime(31_000)
      const r2 = await report.execute({ ...same }, agentless) as { ok: boolean }
      expect(r2.ok).toBe(true)
      vi.advanceTimersByTime(31_000)
      const r3 = await report.execute({ ...same }, agentless) as { ok: boolean }
      expect(r3.ok).toBe(true)

      vi.advanceTimersByTime(31_000)
      const r4 = await report.execute({ ...same }, agentless) as { ok: boolean; error?: string }
      expect(r4.ok).toBe(false)
      expect(r4.error).toContain('循环检测')

      // A DIFFERENT text at the same moment still passes — the suppression
      // keys on session+content, not the session alone.
      const other = await report.execute({ message: 'different: 事故复盘结论' }, agentless) as { ok: boolean }
      expect(other.ok).toBe(true)
    }
  })

  it('the window slides: after 10 minutes the same text passes again', async () => {
    const { ctx, dispose } = await harness()
    {
      const report = ctx.tools.get('a2a_report')!
      const agentless = { signal: new AbortController().signal } as never
      const same = { message: '窗口滑动验证文本' }
      for (let i = 0; i < 3; i++) {
        const r = await report.execute({ ...same }, agentless) as { ok: boolean }
        expect(r.ok).toBe(true)
        vi.advanceTimersByTime(31_000)
      }
      const blocked = await report.execute({ ...same }, agentless) as { ok: boolean }
      expect(blocked.ok).toBe(false)
      vi.advanceTimersByTime(600_000)
      const after = await report.execute({ ...same }, agentless) as { ok: boolean }
      expect(after.ok).toBe(true)
    }
  })
})
