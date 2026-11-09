// @vitest-environment node
/** docs/design/superagent-multi-team.md M1–M6: several teams on one DSH instance. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SuperagentTeams } from '../../src/superagent/host/teams.ts'

const canvases: Record<string, string[]> = { ops: ['session-r1', 'session-m1'], docs: ['session-r2', 'session-m2'], busy: ['session-r3'] }
function boot(home = mkdtempSync(join(tmpdir(), 'sa-teams-'))) {
  const sent: Array<[string, string]> = []
  const teams = new SuperagentTeams({
    canvasTeam: (name: string) => canvases[name] !== undefined ? { local: canvases[name]!, remote: [] } : undefined, home, logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
  } as never)
  return { teams, home, sent }
}
const yes = () => true, noPreset = () => undefined
const withTwo = () => {
  const b = boot()
  expect(b.teams.primary.saveSettings({ canvas: 'ops', router: 'session-r1' }, yes)).toMatchObject({ ok: true })
  const added = b.teams.add({ canvas: 'docs', router: 'session-r2' }, yes, noPreset) as { ok: true; id: string }
  expect(added.ok).toBe(true)
  return { ...b, id: added.id, second: b.teams.get(added.id)! }
}

describe('several teams', () => {
  it('keeps the primary team where it was, and puts a new one in its own directory', () => {
    const { teams, home, id } = withTwo()
    expect(existsSync(join(home, 'superagent', 'settings.json'))).toBe(true)
    expect(existsSync(join(home, 'superagent', 'teams', id, 'settings.json'))).toBe(true)
    expect(teams.rows()).toEqual([
      expect.objectContaining({ id: '', primary: true, canvas: 'ops', open: true }),
      expect.objectContaining({ id, primary: false, canvas: 'docs', open: true }),
    ])
  })
  it('no id is the primary team; an unknown id is no team', () => {
    const { teams } = withTwo()
    expect(teams.get()).toBe(teams.primary)
    expect(teams.get('')).toBe(teams.primary)
    expect(teams.get('ffffffff')).toBeUndefined()
  })
  it('finds a session\'s team by its role', () => {
    const { teams, second } = withTwo()
    expect(teams.ofSession('session-r2')).toBe(second)
    expect(teams.ofSession('session-m2')).toBe(second)
    expect(teams.ofSession('session-m1')).toBe(teams.primary)
    expect(teams.ofSession('session-none')).toBeUndefined()
  })
  it('keeps each team\'s work apart', async () => {
    const { teams, second, sent } = withTwo()
    teams.start()
    expect(second.request('写文档')).toMatchObject({ ok: true })
    second.pass()
    await Promise.resolve(); await Promise.resolve()
    expect(sent.filter(([id, t]) => id === 'session-r2' && t.startsWith('[superagent candidate]'))).toHaveLength(1)
    expect(sent.filter(([id]) => id === 'session-r1')).toHaveLength(0)
    expect((teams.primary.state().threads as unknown[])).toHaveLength(0)
    await teams.stop()
  })
  it('one canvas is one team, in either direction', () => {
    const { teams, id } = withTwo()
    expect(teams.add({ canvas: 'ops', router: 'session-r1' }, yes, noPreset)).toMatchObject({ ok: false, error: expect.stringContaining('already another team') })
    expect(teams.primary.saveSettings({ canvas: 'docs', router: 'session-r2' }, yes)).toMatchObject({ ok: false, error: expect.stringContaining('already another team') })
    expect(teams.rows()).toHaveLength(2)
    expect(teams.get(id)!.settings.canvas).toBe('docs')
  })
  it('a session with a role on one team cannot join another team\'s canvas', () => {
    const { teams } = withTwo()
    expect(teams.canvasMemberRefusal('docs', 'session-m1', noPreset)).toContain('sits in no other canvas')
    expect(teams.canvasMemberRefusal('docs', 'session-new', noPreset)).toBeUndefined()
  })
  it('needs a canvas and a router, and reuses a team left unbound', () => {
    const { teams } = withTwo()
    expect(teams.add({ canvas: '', router: 'x' }, yes, noPreset)).toMatchObject({ ok: false })
    const before = teams.rows().length
    const refused = teams.add({ canvas: 'nope', router: 'x' }, yes, noPreset)
    expect(refused.ok).toBe(false)
    expect(teams.rows().length).toBe(before)
    const again = teams.add({ canvas: 'busy', router: 'session-r3' }, yes, noPreset)
    expect(again.ok).toBe(true)
  })
  it('finds its teams again after a restart', () => {
    const { home, id } = withTwo()
    const after = boot(home)
    expect(after.teams.get(id)?.settings.canvas).toBe('docs')
  })
})
