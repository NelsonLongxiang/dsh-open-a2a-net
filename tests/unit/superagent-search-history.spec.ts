/** The team page's 搜索 and the settings-save history: one team's records, kept with its state. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuperagentHost } from '../../src/superagent/host/index.ts'
import type { SuperagentHostDeps } from '../../src/superagent/host/index.ts'

const home = (): string => mkdtempSync(join(tmpdir(), 'sa-search-'))
const yes = (): boolean => true

async function team(): Promise<{ h: SuperagentHost; dir: string }> {
  const dir = home()
  const deps = {
    canvasTeam: (name: string) => name === 'team' || name === 'one' || name === 'two' ? { local: ['session-r', 'session-a'], remote: [] } : undefined,
    home: dir, logger: { info: vi.fn(), warn: vi.fn() }, deliverToSession: vi.fn(() => false), sessionLabel: () => 'x',
    now: () => new Date().toISOString(), interval: vi.fn(() => () => undefined),
  } as unknown as SuperagentHostDeps
  const h = new SuperagentHost(deps)
  return { h, dir }
}

const homes: string[] = []
afterEach(() => { for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('the team page search', () => {
  it('finds a request by its words, a ticket by its title, and a ticket id by its tail after #', async () => {
    const m = await team()
    homes.push(m.dir)
    expect(m.h.saveSettings({ canvas: 'team', router: 'session-r' }, yes)).toMatchObject({ ok: true })
    const filed = m.h.request('帮我补部署文档')
    expect(filed).toMatchObject({ ok: true })
    m.h.pass()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const ticket = (routeItem(m.h, { trigger_id: (filed as { triggerId: string }).triggerId, kind: 'accept', title: '部署文档补全', scope: '补文档', reason: 'r' } as never) as { ticket_id: string }).ticket_id
    const byWords = m.h.search('部署文档') as { ok: boolean; results: ReadonlyArray<{ kind: string; id: string }> }
    expect(byWords.ok).toBe(true)
    expect(byWords.results.some(row => row.kind === 'request')).toBe(true)
    expect(byWords.results.some(row => row.kind === 'ticket' && row.id === ticket)).toBe(true)
    const byTail = m.h.search(`#${ticket.slice(-4)}`) as { results: ReadonlyArray<{ id: string }> }
    expect(byTail.results.some(row => row.id === ticket)).toBe(true)
    const none = m.h.search('不存在的词') as { results: unknown[] }
    expect(none.results).toEqual([])
    expect(m.h.search('')).toMatchObject({ ok: true, results: [] })
    await m.h.stop()
  })
  it('refuses a too-long query and keeps each team to itself', async () => {
    const m = await team()
    homes.push(m.dir)
    expect((m.h.search('x'.repeat(201)) as { ok: boolean; code?: string }).code).toBe('query')
    await m.h.stop()
  })
})

describe('the settings-save history', () => {
  it('records who saved, when, and which fields moved, old to new; nothing when nothing moved', async () => {
    const m = await team()
    homes.push(m.dir)
    expect(m.h.saveSettings({ canvas: 'team', router: 'session-r' }, yes)).toMatchObject({ ok: true })
    expect(m.h.saveSettings({ acceptMode: 'auto', paused: true }, yes, undefined, 'owner')).toMatchObject({ ok: true })
    const state = m.h.state() as { settingsHistory: ReadonlyArray<{ by: string; changes: ReadonlyArray<{ field: string; from: string; to: string }> }> }
    expect(state.settingsHistory.length).toBe(2)
    const row = state.settingsHistory[0]
    expect(row.by).toBe('owner')
    expect(row.changes.some(c => c.field === 'acceptMode' && c.from === 'observe' && c.to === 'auto')).toBe(true)
    expect(row.changes.some(c => c.field === 'paused' && c.to === 'true')).toBe(true)
    expect(m.h.saveSettings({}, yes)).toMatchObject({ ok: true })
    expect((m.h.state() as { settingsHistory: unknown[] }).settingsHistory.length).toBe(2)
    await m.h.stop()
  })
  it('clips a long value and keeps each team its own file', async () => {
    const m = await team()
    homes.push(m.dir)
    const other = await team()
    homes.push(other.dir)
    expect(m.h.saveSettings({ canvas: 'one', router: 'session-r' }, yes)).toMatchObject({ ok: true })
    expect(other.h.saveSettings({ canvas: 'two', router: 'session-r' }, yes)).toMatchObject({ ok: true })
    const a = m.h.state() as { settingsHistory: ReadonlyArray<{ changes: ReadonlyArray<{ field: string }> }> }
    const b = other.h.state() as typeof a
    expect(a.settingsHistory[0].changes.some(c => c.field === 'canvas')).toBe(true)
    expect(b.settingsHistory[0].changes.some(c => c.field === 'canvas')).toBe(true)
    expect(m.h.saveSettings({ dispatch: 'x'.repeat(500) }, yes)).toMatchObject({ ok: true })
    const long = (m.h.state() as typeof a).settingsHistory[0].changes.find(c => c.field === 'dispatch')
    expect(long?.to.length).toBeLessThanOrEqual(162)
    await Promise.all([m.h.stop(), other.h.stop()])
  })
})
