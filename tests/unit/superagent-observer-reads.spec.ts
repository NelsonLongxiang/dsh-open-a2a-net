// @vitest-environment node
/** Observer phase 1 (workbench-market 18 #883): the observer reads the same host's prompt-template library and log. */
import { mkdtempSync } from '../temp-dirs.ts'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function team(read?: (path: string) => Promise<{ status: number; body: unknown }>) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-o': 'superagent-observer' }
  const paths: string[] = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', 'session-o'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-reads-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
    ...(read !== undefined ? { templatesRead: async (path: string) => { paths.push(path); return read(path) } } : {}),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true, id => presets[id])).toMatchObject({ ok: true })
  return { h, paths }
}

describe('observer phase 1: reading the prompt-template plugin', () => {
  it('reads the library, one session\'s own templates and the log, with their filters', async () => {
    const items = [{ id: 'c1', name: '行动审视', active_version: null, stored_versions: [{ version: 'atelier-5.16.1' }], content_sha256: 'x' }]
    const m = await team(async () => ({ status: 200, body: { schema: 9, items } }))
    expect(await m.h.promptTemplates('library')).toEqual({ ok: true, available: true, schema: 9, items })
    expect(await m.h.promptTemplates('templates', { session_id: 'session-m' })).toMatchObject({ ok: true, available: true })
    expect(await m.h.promptTemplates('interventions', { session_id: 'session-m', since: '2026-11-20T00:00:00Z', source: 'manual', limit: 20 })).toMatchObject({ ok: true, available: true })
    expect(m.paths).toEqual(['library', 'library?session_id=session-m', 'interventions?since=2026-11-20T00%3A00%3A00.000Z&source=manual&session_id=session-m&limit=20'])
    expect(await m.h.promptTemplates('templates')).toMatchObject({ ok: false, code: 'session_id' })
    await m.h.stop()
  })
  it('a host without the plugin, with an old one, or unreachable answers available: false, never an error', async () => {
    const absent = await team(async () => ({ status: 404, body: undefined }))
    expect(await absent.h.promptTemplates('library')).toMatchObject({ ok: true, available: false, reason: expect.stringContaining('not installed') })
    const old = await team(async () => ({ status: 200, body: { items: [] } }))
    expect(await old.h.promptTemplates('library')).toMatchObject({ ok: true, available: false, reason: expect.stringContaining('0.16') })
    // #762 review: fixed words to the observer; the plugin's own error text goes to the log only.
    const down = await team(async () => { throw new Error('connection refused at secret-host') })
    const downOut = await down.h.promptTemplates('interventions')
    expect(downOut).toMatchObject({ ok: true, available: false, reason: 'dsh-prompt-templates could not be read on this host right now' })
    expect(JSON.stringify(downOut)).not.toContain('secret-host')
    const noHome = await team()
    expect(await noHome.h.promptTemplates('library')).toMatchObject({ ok: true, available: false, reason: 'dsh-prompt-templates could not be read on this host right now' })
    for (const m of [absent, old, down, noHome]) await m.h.stop()
  })
  it('#762 review: templates and interventions stay within the observer\'s own team; inputs are checked and the limit kept', async () => {
    const rows = [{ session_id: 'session-m', source: 'manual' }, { session_id: 'session-elsewhere', source: 'manual' }, { session_id: 'session-o', source: 'schedule' }, { session_id: 'session-r', source: 'event' }]
    const m = await team(async () => ({ status: 200, body: { schema: 9, items: rows } }))
    expect(await m.h.promptTemplates('templates', { session_id: 'session-elsewhere' })).toMatchObject({ ok: false, code: 'not-in-team' })
    expect(await m.h.promptTemplates('interventions', { session_id: 'session-elsewhere' })).toMatchObject({ ok: false, code: 'not-in-team' })
    expect(m.paths).toEqual([])
    // Without a session: the widest page, kept to this team's sessions.
    const all = await m.h.promptTemplates('interventions')
    expect((all['items'] as Array<{ session_id: string }>).map(r => r.session_id)).toEqual(['session-m', 'session-o', 'session-r'])
    expect(m.paths.at(-1)).toBe('interventions?limit=500')
    expect(((await m.h.promptTemplates('interventions', { limit: 2 }))['items'] as unknown[]).length).toBe(2)
    await m.h.promptTemplates('interventions', { session_id: 'session-m', limit: 100_000 })
    expect(m.paths.at(-1)).toBe('interventions?session_id=session-m&limit=500')
    await m.h.promptTemplates('interventions', { session_id: 'session-m', limit: -5 })
    expect(m.paths.at(-1)).toBe('interventions?session_id=session-m&limit=1')
    expect(await m.h.promptTemplates('interventions', { since: 'yesterday' })).toMatchObject({ ok: false, code: 'since' })
    expect(await m.h.promptTemplates('interventions', { source: 'other' })).toMatchObject({ ok: false, code: 'source' })
    // The library is the host's shared card set: no team filter.
    expect(await m.h.promptTemplates('library')).toMatchObject({ ok: true, available: true })
    await m.h.stop()
  })
  it('the persona asks the observer to record every trigger and count the two outcomes', () => {
    const text = readFileSync(join(__dirname, '../../src/superagent/prompts/observer.md'), 'utf8')
    expect(text).toContain('Record every trigger')
    expect(text).toContain('adopted it, kept its own plan, or it had no effect')
    expect(text).toContain('where the owner stepped in by hand')
    expect(text).toContain('kind interventions')
    expect(text).toContain('team-<the team\'s canvas name>')
    expect(text).toContain('ygl.project')
  })
})
