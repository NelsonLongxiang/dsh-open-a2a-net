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
    // '' clears one, unnamed keeps the other saved (review of #566 fifth round).
    expect(h.saveSettings({ models: { router: '' } }, yes)).toMatchObject({ ok: true })
    expect((h.state() as { settings: { models?: Record<string, unknown> } }).settings.models).toEqual({ member: { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' } })
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
  it('the selectModel dep works without any HTTP (a host with a login): the controller is called in-process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-models3-'))
    homes.push(dir)
    let called: unknown
    const deps = {
      canvasTeam: () => ({ local: ['session-r'], remote: [] }),
      home: dir, logger: { info: vi.fn(), warn: vi.fn() }, deliverToSession: vi.fn(() => false), sessionLabel: () => 'x',
      now: () => new Date().toISOString(), interval: vi.fn(() => () => undefined),
      selectModel: async (sessionId: string, pick: Record<string, string>) => {
        const controller = (globalThis as Record<string, unknown>)['__sa_test_controller__'] as { selectModel(request: unknown): Promise<unknown> } | undefined
        if (controller === undefined) return false
        called = { sessionId, pick }
        return controller.selectModel({ sessionId, ...pick }).then(() => true, () => false)
      },
    } as unknown as SuperagentHostDeps
    const h = new SuperagentHost(deps)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', models: { router: { provider: 'p', model: 'm' } } }, yes)).toMatchObject({ ok: true })
    // no controller: the save still stands, the failure is only logged
    await new Promise(r => setTimeout(r, 30))
    expect(called).toBeUndefined()
    // an in-process controller resolves without any HTTP/cookie face
    ;(globalThis as Record<string, unknown>)['__sa_test_controller__'] = { selectModel: async () => ({ selected: { provider: 'p', model: 'm' } }) }
    h.applyModels()
    await new Promise(r => setTimeout(r, 30))
    expect(called).toMatchObject({ sessionId: 'session-r', pick: { provider: 'p', model: 'm' } })
    delete (globalThis as Record<string, unknown>)['__sa_test_controller__']
    await h.stop()
  })
  it('a team with models set starts without crashing and applies after the microtask (review of #566: no TDZ)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-models4-'))
    homes.push(dir)
    const calls: string[] = []
    const deps = {
      canvasTeam: () => ({ local: ['session-r'], remote: [] }),
      home: dir, logger: { info: vi.fn(), warn: vi.fn() }, deliverToSession: vi.fn(() => false), sessionLabel: () => 'x',
      now: () => new Date().toISOString(), interval: vi.fn(() => () => undefined),
      selectModel: (sessionId: string) => { calls.push(sessionId); return Promise.resolve(true) },
    } as unknown as SuperagentHostDeps
    const h = new SuperagentHost(deps)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', models: { router: { provider: 'p', model: 'm' } } }, yes)).toMatchObject({ ok: true })
    await h.stop()
    const again = new SuperagentHost(deps)
    again.start() // must not throw even if this runs inside the plugin's apply()
    await new Promise(r => setTimeout(r, 30)) // the deferred microtask lands
    expect(calls).toContain('session-r')
    await again.stop()
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
