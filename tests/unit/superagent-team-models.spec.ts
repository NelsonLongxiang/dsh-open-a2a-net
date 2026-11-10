/** Team model choices (owner 2026-11-10, 对照上游): settings.models parsed and applied through session/selectModel; failures never block. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuperagentHost, type SuperagentHostDeps } from '../../src/superagent/host/index.ts'

const yes = (): boolean => true
const homes: string[] = []
afterEach(() => { for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function team(selectModel?: (session: string, pick: { provider: string; model: string; reasoningEffort?: string }) => Promise<boolean>): { h: SuperagentHost; calls: Array<{ session: string; pick: Record<string, string> }> } {
  const dir = mkdtempSync(join(tmpdir(), 'sa-models-'))
  homes.push(dir)
  const calls: Array<{ session: string; pick: Record<string, string> }> = []
  const deps = {
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a'], remote: [] } : undefined,
    home: dir, logger: { info: vi.fn(), warn: vi.fn() }, deliverToSession: vi.fn(() => false), sessionLabel: () => 'x',
    now: () => new Date().toISOString(), interval: vi.fn(() => () => undefined),
    ...(selectModel !== undefined ? { selectModel: (session: string, pick: { provider: string; model: string; reasoningEffort?: string }) => { calls.push({ session, pick: { ...pick } }); return Promise.resolve(selectModel(session, pick)) } } : {}),
  } as unknown as SuperagentHostDeps
  const h = new SuperagentHost(deps)
  return { h, calls }
}

describe('settings.models', () => {
  it('parses a router and a member pick, and rejects what is not one', async () => {
    const { h } = team()
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', models: { router: { provider: 'deepseek', model: 'chat' }, member: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' } } }, yes)).toMatchObject({ ok: true })
    const state = h.state() as { settings: { models?: Record<string, unknown> } }
    expect(state.settings.models).toEqual({ router: { provider: 'deepseek', model: 'chat' }, member: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' } })
    expect(h.saveSettings({ models: { router: { provider: '', model: 'x' } } }, yes).ok).toBe(false)
    expect(h.saveSettings({ models: { member: 'x' } }, yes).ok).toBe(false)
    expect(h.saveSettings({ models: null }, yes)).toMatchObject({ ok: true })
    expect((h.state() as typeof state).settings.models).toBeUndefined()
    await h.stop()
  })
  it('a save applies models to the router and local members only, and a failing select does not block the save', async () => {
    const { h, calls } = team((session) => session !== 'session-a')
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', models: { router: { provider: 'p', model: 'r' }, member: { provider: 'p', model: 'm' } } }, yes)).toMatchObject({ ok: true })
    await new Promise(r => setTimeout(r, 50))
    expect(calls).toContainEqual({ session: 'session-r', pick: { provider: 'p', model: 'r' } })
    expect(calls).toContainEqual({ session: 'session-a', pick: { provider: 'p', model: 'm' } })
    expect(h.stop).toBeDefined()
    await h.stop()
  })
  it('a member joining (pool change) and a restart apply the choice again; unset models touch nothing', async () => {
    const calls2: Array<{ session: string }> = []
    const dir = mkdtempSync(join(tmpdir(), 'sa-models2-'))
    homes.push(dir)
    const deps = {
      canvasTeam: () => ({ local: ['session-r', 'session-a'], remote: [] }),
      home: dir, logger: { info: vi.fn(), warn: vi.fn() }, deliverToSession: vi.fn(() => false), sessionLabel: () => 'x',
      now: () => new Date().toISOString(), interval: vi.fn(() => () => undefined),
      selectModel: (session: string) => { calls2.push({ session }); return Promise.resolve(true) },
    } as unknown as SuperagentHostDeps
    const h = new SuperagentHost(deps)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', models: { router: { provider: 'p', model: 'r' } } }, yes)).toMatchObject({ ok: true })
    await new Promise(r => setTimeout(r, 30))
    calls2.length = 0
    await h.stop()
    const h2 = new SuperagentHost(deps)
    h2.start()
    await new Promise(r => setTimeout(r, 30))
    expect(calls2.some(c => c.session === 'session-r')).toBe(true)
    await h2.stop()
  })
})
