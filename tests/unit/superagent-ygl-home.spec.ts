// @vitest-environment node
/** docs/design/superagent-ygl-memory.md Y1b: the host creates the team's ygl-trees workspace. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureTeamYglHome, teamYglHome, YGL_DB_FILE, type YglRun } from '../../src/superagent/host/ygl-home.ts'

const quiet = { warn: () => {} }
const fresh = () => join(mkdtempSync(join(tmpdir(), 'sa-ygl-')), 'team')

describe('the team ygl-trees workspace', () => {
  it('is the same place the presets mount', () => {
    expect(teamYglHome({ SUPERAGENT_YGL_HOME: '/x/team' })).toBe('/x/team')
    expect(teamYglHome({ HOME: '/home/a' })).toBe(join('/home/a', '.ygl-trees-superagent'))
    expect(teamYglHome({ USERPROFILE: 'C:/Users/z' })).toBe(join('C:/Users/z', '.ygl-trees-superagent'))
  })
  it('runs ygl-trees db init with YGL_HOME when there is no database', async () => {
    const home = fresh(), calls: Array<[readonly string[], string | undefined]> = []
    const run: YglRun = async (args, env) => { calls.push([args, env.YGL_HOME]); writeFileSync(join(home, YGL_DB_FILE), '') }
    expect(await ensureTeamYglHome({ logger: quiet, home, run })).toBe('created')
    expect(calls).toEqual([[['db', 'init'], home]])
  })
  it('leaves a workspace that has a database alone', async () => {
    const home = fresh(), calls: unknown[] = []
    await ensureTeamYglHome({ logger: quiet, home, run: async () => { calls.push(1); writeFileSync(join(home, YGL_DB_FILE), '') } })
    expect(await ensureTeamYglHome({ logger: quiet, home, run: async () => { calls.push(2) } })).toBe('present')
    expect(calls).toEqual([1])
  })
  it('does nothing, quietly, without the command; logs any other failure', async () => {
    const warned: string[] = [], logger = { warn: (f: string, ...a: unknown[]) => { warned.push(String(a[0])) } }
    expect(await ensureTeamYglHome({ logger, home: fresh(), run: async () => { throw Object.assign(new Error('spawn ygl-trees ENOENT'), { code: 'ENOENT' }) } })).toBe('unavailable')
    expect(warned).toEqual([])
    expect(await ensureTeamYglHome({ logger, home: fresh(), run: async () => { throw Object.assign(new Error('locked'), { code: 1 }) } })).toBe(process.platform === 'win32' ? 'unavailable' : 'failed')
  })
})
