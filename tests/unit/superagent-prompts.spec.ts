/** Team prompt supplements (owner 2026-11-10): parsed, gated, and handed to the role sessions as labeled card lines. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuperagentHost, type SuperagentHostDeps } from '../../src/superagent/host/index.ts'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'

const yes = (): boolean => true
const homes: string[] = []
afterEach(() => { for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function team(): { h: SuperagentHost; sent: Array<[string, string]> } {
  const dir = mkdtempSync(join(tmpdir(), 'sa-prompts-'))
  homes.push(dir)
  const sent: Array<[string, string]> = []
  const deps = {
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a'], remote: [] } : undefined,
    home: dir, logger: { info: vi.fn(), warn: vi.fn() }, deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true },
    sessionLabel: () => 'x', now: () => new Date().toISOString(), interval: vi.fn(() => () => undefined),
  } as unknown as SuperagentHostDeps
  return { h: new SuperagentHost(deps), sent }
}

describe('team prompt supplements', () => {
  it('a write touching prompts needs the owner proof (D10), and the texts are parsed with a cap', async () => {
    const { h } = team()
    expect(touchesRules({ prompts: { communication: 'x' } })).toBe(true)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', prompts: { communication: '讲中文', delivery: '交付即 PR 链接' } }, yes)).toMatchObject({ ok: true })
    expect((h.state() as { settings: { prompts?: Record<string, string> } }).settings.prompts).toEqual({ communication: '讲中文', delivery: '交付即 PR 链接' })
    expect(h.saveSettings({ prompts: { communication: 'x'.repeat(4001) } }, yes).ok).toBe(false)
    // First write of one prompt alone is fine (nothing saved yet is not a refusal); '' clears one, null clears all (#567).
    expect(h.saveSettings({ prompts: { communication: '只用中文' } }, yes)).toMatchObject({ ok: true })
    expect((h.state() as { settings: { prompts?: Record<string, string> } }).settings.prompts).toEqual({ communication: '只用中文', delivery: '交付即 PR 链接' })
    expect(h.saveSettings({ prompts: { communication: '' } }, yes)).toMatchObject({ ok: true })
    expect((h.state() as { settings: { prompts?: Record<string, string> } }).settings.prompts).toEqual({ delivery: '交付即 PR 链接' })
    expect(h.saveSettings({ prompts: { communication: '英文' } }, yes)).toMatchObject({ ok: true })
    expect((h.state() as { settings: { prompts?: Record<string, string> } }).settings.prompts).toEqual({ communication: '英文', delivery: '交付即 PR 链接' })
    expect(h.saveSettings({ prompts: { delivery: 42 as unknown as string } }, yes).ok).toBe(false)
    expect(h.saveSettings({ prompts: null }, yes)).toMatchObject({ ok: true })
    expect((h.state() as { settings: { prompts?: Record<string, string> } }).settings.prompts).toBeUndefined()
    await h.stop()
  })
  it('communication rides the candidate card (the router reading) and the member notes; delivery rides the assignment notes', async () => {
    const m = team()
    const { h } = m
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', prompts: { communication: '讲中文', delivery: '交付即 PR' } }, yes)).toMatchObject({ ok: true })
    const filed = h.request('做一件事')
    expect(filed).toMatchObject({ ok: true })
    h.pass()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    routeItem(h, { trigger_id: (filed as { triggerId: string }).triggerId, kind: 'accept', title: 't', scope: 's', reason: 'r' } as never)
    await vi.waitFor(() => { expect(m.sent.some(([, t]) => t.startsWith('[superagent candidate]') && t.includes('讲中文') && t.includes('preset stands'))).toBe(true) })
    await vi.waitFor(() => { expect(m.sent.some(([id, t]) => id === 'session-a' && t.startsWith('[superagent assignment]') && t.includes('讲中文') && t.includes('交付即 PR'))).toBe(true) })
    await h.stop()
  })
  it('empty supplements add no lines at all', async () => {
    const m = team()
    expect(m.h.saveSettings({ canvas: 'team', router: 'session-r' }, yes)).toMatchObject({ ok: true })
    const filed = m.h.request('做一件事')
    m.h.pass()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    routeItem(m.h, { trigger_id: (filed as { triggerId: string }).triggerId, kind: 'accept', title: 't', scope: 's', reason: 'r' } as never)
    await vi.waitFor(() => { expect(m.sent.some(([, t]) => t.startsWith('[superagent candidate]'))).toBe(true) })
    expect(m.sent.every(([, t]) => !t.includes('preset stands'))).toBe(true)
    await m.h.stop()
  })
})
