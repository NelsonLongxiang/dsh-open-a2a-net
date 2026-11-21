// @vitest-environment node
/** docs/design/superagent-ygl-memory.md Y1b: the host creates the team's ygl-trees workspace. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureTeamYglHome, ensureTeamYglProject, refreshYglCapabilities, teamYglHome, teamYglProject, teamYglScope, yglCapabilitiesOf, YGL_DB_FILE, type YglRun } from '../../src/superagent/host/ygl-home.ts'
import { yglCardLines, yglRouterLine } from '../../src/superagent/host/cards.ts'

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

describe('the team project (Y1c)', () => {
  it('is named after the canvas', () => { expect(teamYglProject('运维')).toBe('team-运维') })
  it('is made once, after the workspace, under the host\'s own ygl session', async () => {
    const home = fresh(), calls: Array<[readonly string[], string | undefined, string | undefined]> = []
    const run: YglRun = async (args, env) => { calls.push([args, env.YGL_HOME, env.YGL_SESSION]); if (args[0] === 'db') writeFileSync(join(home, YGL_DB_FILE), '') }
    expect(await ensureTeamYglProject('team-ops', { logger: quiet, home, run })).toBe('created')
    expect(await ensureTeamYglProject('team-ops', { logger: quiet, home, run })).toBe('present')
    // A3 (owner 2026-11-18): it lists the projects first and makes the team's only when it is missing.
    expect(calls.map(c => c[0].slice(0, 3))).toEqual([['db', 'init'], ['project', 'list', '--json'], ['project', 'new', 'team-ops']])
    expect(calls[2]![1]).toBe(home)
    expect(calls[2]![2]).toBe('superagent-host')
  })
  it('does nothing without the command', async () => {
    expect(await ensureTeamYglProject('team-x', { logger: quiet, home: fresh(), run: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) } })).toBe('unavailable')
  })
})

describe('A3: a team project that exists is not made again (owner 2026-11-18)', () => {
  it('lists first and runs no project new when the team project is there', async () => {
    const home = fresh(), calls: string[][] = []
    const run: YglRun = async (args) => { calls.push([...args]); if (args[0] === 'db') writeFileSync(join(home, YGL_DB_FILE), ''); if (args[1] === 'list') return JSON.stringify([{ name: 'team-b' }, { name: 'team-ops' }]) }
    expect(await ensureTeamYglProject('team-ops-a3', { logger: quiet, home, run })).toBe('created')
    calls.length = 0
    const other = fresh()
    const run2: YglRun = async (args) => { calls.push([...args]); if (args[0] === 'db') writeFileSync(join(other, YGL_DB_FILE), ''); if (args[1] === 'list') return JSON.stringify([{ name: 'team-ops' }]) }
    expect(await ensureTeamYglProject('team-ops', { logger: quiet, home: other, run: run2 })).toBe('present')
    expect(calls.some(c => c[1] === 'new')).toBe(false)
  })
  it('still makes it when the list cannot be read', async () => {
    const home = fresh(), calls: string[][] = []
    const run: YglRun = async (args) => { calls.push([...args]); if (args[0] === 'db') writeFileSync(join(home, YGL_DB_FILE), ''); if (args[1] === 'list') return 'not json' }
    expect(await ensureTeamYglProject('team-q', { logger: quiet, home, run })).toBe('created')
    expect(calls.at(-1)?.slice(0, 3)).toEqual(['project', 'new', 'team-q'])
  })
})

describe('Y1d: what the installed ygl-trees can do (owner 2026-11-18)', () => {
  it('reads the version into capabilities; unknown counts as the oldest', () => {
    expect(yglCapabilitiesOf(undefined)).toEqual({ briefHonorsProject: false, kbScope: false })
    expect(yglCapabilitiesOf('garbage')).toEqual({ briefHonorsProject: false, kbScope: false })
    expect(yglCapabilitiesOf('0.122.0')).toEqual({ version: '0.122.0', briefHonorsProject: false, kbScope: false })
    expect(yglCapabilitiesOf('0.123.0')).toEqual({ version: '0.123.0', briefHonorsProject: true, kbScope: false })
    expect(yglCapabilitiesOf('0.126.0\n')).toEqual({ version: '0.126.0', briefHonorsProject: true, kbScope: true })
    expect(yglCapabilitiesOf('1.0.0')).toMatchObject({ briefHonorsProject: true, kbScope: true })
  })
  it('warns once at start below 0.126.0, and says nothing when ygl-trees is absent', async () => {
    const warnings: string[] = []
    const logger = { warn: (f: string, ...a: unknown[]) => { warnings.push([f, ...a].join(' ')) } }
    expect(await refreshYglCapabilities({ logger, read: async () => '0.122.0' })).toMatchObject({ kbScope: false })
    expect(warnings.join()).toContain('0.123.0 fixes it')
    warnings.length = 0
    expect(await refreshYglCapabilities({ logger, read: async () => undefined })).toEqual({ briefHonorsProject: false, kbScope: false })
    expect(warnings).toEqual([])
    expect(await refreshYglCapabilities({ logger, read: async () => '0.126.0' })).toMatchObject({ kbScope: true })
    expect(warnings).toEqual([])
  })
})

describe('Y1e: a team kb scope (owner 2026-11-18)', () => {
  it('is bench:team-<canvas>, or a stable hash when the canvas name has other characters', () => {
    expect(teamYglScope('ops')).toBe('bench:team-ops')
    const hashed = teamYglScope('运维')
    expect(hashed).toMatch(/^bench:teamh-[0-9a-f]{16}$/)
    expect(teamYglScope('运维')).toBe(hashed)
    expect(teamYglScope('x'.repeat(80))).toMatch(/^bench:teamh-[0-9a-f]{16}$/)
    // #739 review R2: a literal canvas named after another canvas's digest does not get that canvas's scope.
    const digest = hashed.slice('bench:teamh-'.length)
    expect(teamYglScope(digest)).toBe(`bench:team-${digest}`)
    expect(teamYglScope(digest)).not.toBe(hashed)
    expect(teamYglScope(`h-${digest}`)).not.toBe(hashed)
  })
  it('the member card keeps today\'s steps on an old or unknown ygl-trees', () => {
    const old = yglCardLines('team-ops', { scope: 'bench:team-ops', caps: yglCapabilitiesOf('0.122.0') })
    expect(old.join('\n')).toContain('domain project action use name "team-ops"')
    expect(old.join('\n')).not.toContain('scope')
    expect(yglCardLines('team-ops')).toEqual(old)
  })
  it('drops the project-use step from 0.123.0, and adds the team scope from 0.126.0', () => {
    const mid = yglCardLines('team-ops', { scope: 'bench:team-ops', caps: yglCapabilitiesOf('0.123.0') }).join('\n')
    expect(mid).not.toContain('action use')
    expect(mid).toContain('domain agent action brief with project "team-ops"')
    expect(mid).not.toContain('scope')
    const now = yglCardLines('team-ops', { scope: 'bench:team-ops', caps: yglCapabilitiesOf('0.126.0') }).join('\n')
    expect(now).toContain('with scope "bench:team-ops" (this team\'s notes), then again with scope ""')
    expect(now).toContain('kb add what the next session should reuse, with scope "bench:team-ops"')
    expect(now).toContain('make no other project')
  })
  it('Y2: every card asks for a skill match first and a task for the ticket, todo to doing to done, with its id on the report', () => {
    const cards = {
      old: yglCardLines('team-ops', { scope: 'bench:team-ops', caps: yglCapabilitiesOf('0.122.0') }).join('\n'),
      mid: yglCardLines('team-ops', { scope: 'bench:team-ops', caps: yglCapabilitiesOf('0.123.0') }).join('\n'),
      now: yglCardLines('team-ops', { scope: 'bench:team-ops', caps: yglCapabilitiesOf('0.126.0') }).join('\n'),
      bare: yglCardLines().join('\n'),
    }
    for (const [name, card] of Object.entries(cards)) {
      expect(card, name).toContain('mcp__ygl__read domain agent action match with query set to this ticket\'s subject')
      expect(card, name).toContain('domain skill action show')
      expect(card, name).toContain('mcp__ygl__write domain task action add with text set to this ticket\'s title')
      expect(card, name).toContain('domain task action advance id <its id> to doing')
      expect(card, name).toContain('domain task action advance id <the task id> to done')
      expect(card, name).toContain('pass the ids you wrote in ygl on a2a_ticket_report, the task id too')
      // rel attach needs a tree node, and a team project has none until the owner decides its milestones.
      expect(card, name).not.toContain('rel attach')
      expect(card, name).not.toContain('domain rel')
    }
    for (const name of ['old', 'mid', 'now'] as const) expect(cards[name], name).toContain('title and project "team-ops", then')
    expect(cards.bare).not.toContain('and project')
    // The match and task steps come before the work; done comes before kb add.
    expect(cards.now.indexOf('action match')).toBeLessThan(cards.now.indexOf('as you go'))
    expect(cards.now.indexOf('to done')).toBeLessThan(cards.now.indexOf('kb add what the next session'))
  })
  it('the router line names the scope only when there is one', () => {
    expect(yglRouterLine('team-ops')).toContain('pass it as project')
    expect(yglRouterLine('team-ops', 'bench:team-ops')).toContain('scope "bench:team-ops", then with scope ""')
  })
})
