// @vitest-environment node
/**
 * #800: the team builder sets a team's GitHub Source through a blueprint (`team.github.set`), with the owner's agreement and
 * the team's card like every change to a team that exists. The stub team saves through the host's own parseSettings, so the
 * change and its undo pass the same checks as the team page.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StaffingExecutor, type StaffingChange, type StaffingDeps, type StaffingTeam } from '../../src/superagent/host/staffing.ts'
import { DEFAULT_SETTINGS, parseSettings, type TeamSettings } from '../../src/superagent/host/policy.ts'
import { blueprintDiff } from '../../src/superagent/host/builder-tools.ts'
import { presetRefusal } from '../../src/superagent/host/cards.ts'
import { MEMBER_PRESET, OBSERVER_PRESET } from '../../src/superagent/host/role-tools.ts'

const M = 'session-22222222-bbbb'

function world(options: { failAdd?: string } = {}) {
  let settings: TeamSettings = { ...DEFAULT_SETTINGS, canvas: 'ops', sources: { ...DEFAULT_SETTINGS.sources, github: false } }
  const saves: unknown[] = []
  const cards: string[] = []
  const team: StaffingTeam = {
    get settings() { return settings },
    saveSettings: (raw) => { saves.push(raw); const parsed = parseSettings(raw, settings); if (!parsed.ok) return parsed; settings = parsed.settings; return { ok: true } },
    memberOfSeat: () => undefined,
    proposeStaffingCard: (change) => { cards.push(change); return `card-${String(cards.length)}` },
  }
  const deps: StaffingDeps = {
    path: join(mkdtempSync(join(tmpdir(), 'staffing-gh-')), 'staffing.json'),
    now: () => new Date().toISOString(),
    logger: { info: () => {}, warn: () => {} },
    team: id => id === 't-ops' ? team : undefined,
    teamOfCanvas: canvas => canvas === 'ops' ? 't-ops' : undefined,
    canvasExists: name => name === 'ops',
    canvasCreate: () => ({ ok: true }),
    canvasRemove: () => true,
    canvasAddLocal: async (_name, session) => session === options.failAdd ? { ok: false, error: 'wrong preset' } : { ok: true },
    canvasRemoveLocal: () => true,
    teamAdd: () => ({ ok: false, error: 'not in this test' }),
    teamUnbind: () => true,
  }
  return { x: new StaffingExecutor(deps), get settings() { return settings }, saves, cards }
}

const change = (id: string, params: Record<string, unknown>, source: StaffingChange['source'] = 'owner-local'): StaffingChange =>
  ({ id, source, by: { session: 'session-builder-0000' }, ops: [{ op: 'team.github.set', params: { team: 't-ops', ...params } }] })

describe('team.github.set (#800)', () => {
  it('waits for the owner and the team card, then turns the Source on with its people and repositories', async () => {
    const w = world()
    expect(await w.x.submit(change('gh-1', { enabled: true, allowed: ['alice'], repos: ['acme/app'], intake: 'all' }))).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    expect(w.saves).toEqual([])
    expect(w.cards).toEqual(['gh-1'])
    await w.x.agree('gh-1', 'test')
    expect(w.x.get('gh-1')!.state).toBe('awaiting')
    await w.x.cardDecided('gh-1', 't-ops', true)
    expect(w.x.get('gh-1')!.state).toBe('done')
    expect(w.settings.sources.github).toBe(true)
    expect(w.settings.allowed.github).toEqual(['alice'])
    expect(w.settings.github).toEqual({ repos: ['acme/app'], intake: 'all' })
    expect(w.settings.allowed.workbench).toEqual(DEFAULT_SETTINGS.allowed.workbench)
  })

  it('changes only the keys it names; intake alone keeps the repositories', async () => {
    const w = world()
    await w.x.submit(change('gh-a', { enabled: true, repos: ['acme/app'] })); await w.x.agree('gh-a', 'test'); await w.x.cardDecided('gh-a', 't-ops', true)
    expect(w.settings.github).toEqual({ repos: ['acme/app'], intake: 'mention' })
    await w.x.submit(change('gh-b', { intake: 'all' })); await w.x.agree('gh-b', 'test'); await w.x.cardDecided('gh-b', 't-ops', true)
    expect(w.x.get('gh-b')!.state).toBe('done')
    expect(w.settings.github).toEqual({ repos: ['acme/app'], intake: 'all' })
    expect(w.settings.sources.github).toBe(true)
    expect(w.saves.at(-1)).toEqual({ github: { repos: ['acme/app'], intake: 'all' } })
    await w.x.submit(change('gh-c', { repos: [] })); await w.x.agree('gh-c', 'test'); await w.x.cardDecided('gh-c', 't-ops', true)
    expect(w.settings.github).toBeUndefined()
  })

  it('intake with no repository followed yet fails at the step and changes nothing', async () => {
    const w = world()
    await w.x.submit(change('gh-2', { intake: 'all' })); await w.x.agree('gh-2', 'test'); await w.x.cardDecided('gh-2', 't-ops', true)
    expect(w.x.get('gh-2')!.state).toBe('failed')
    expect(w.settings.github).toBeUndefined()
  })

  it('refuses a malformed op before recording it', async () => {
    const w = world()
    for (const [params, code] of [
      [{}, 'invalid'],
      [{ enabled: 'yes' }, 'invalid'],
      [{ allowed: ['nelson-mac-agents[bot]'] }, 'invalid'],
      [{ allowed: 'alice' }, 'invalid'],
      [{ repos: ['not a repo'] }, 'invalid'],
      [{ intake: 'some' }, 'invalid'],
      [{ enabled: true, token: 'x' }, 'not-allowed'],
    ] as const) {
      expect(await w.x.submit(change(`bad-${JSON.stringify(params).length}-${code}`, params)), JSON.stringify(params)).toMatchObject({ ok: false, code })
    }
    expect(w.x.list()).toHaveLength(0)
  })

  it('a later failing step undoes it back to what the team had', async () => {
    const w = world({ failAdd: M })
    const ops: StaffingChange['ops'] = [{ op: 'team.github.set', params: { team: 't-ops', enabled: true, allowed: ['alice'], repos: ['acme/app'] } }, { op: 'member.add', params: { team: 't-ops', session: M } }]
    await w.x.submit({ id: 'gh-3', source: 'owner-local', by: {}, ops }); await w.x.agree('gh-3', 'test'); await w.x.cardDecided('gh-3', 't-ops', true)
    const entry = w.x.get('gh-3')!
    expect(entry.state).toBe('failed')
    expect(entry.steps.map(s => s.state)).toEqual(['undone', 'failed'])
    expect(w.settings.sources.github).toBe(false)
    expect(w.settings.allowed.github).toEqual([])
    expect(w.settings.github).toBeUndefined()
  })

  it('never runs on its own: the market source also waits for confirmation', async () => {
    const w = world()
    expect(await w.x.submit(change('gh-4', { enabled: true }, 'market:market/0123456789abcdef'))).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    expect(w.saves).toEqual([])
  })

  it('the owner reads what it changes; the current GitHub settings stay out of what the builder sees', () => {
    const lines = blueprintDiff([{ op: 'team.github.set', params: { team: 't-ops', enabled: true, allowed: ['alice'], repos: ['acme/app'], intake: 'all' } }], () => ({ rules: [], dispatch: '' }))
    expect(lines[0]).toBe('1. 团队 t-ops 的 GitHub 来源改为：来源开；算作人的账号：alice；跟随仓库：acme/app；接收：全部 issue（未提到的不变；现在的设置请在团队页查看）')
  })

  it('an observer joins through member.add: its preset passes the member check', () => {
    const presetOf = (id: string): string | undefined => id === 'session-obs-0001' ? OBSERVER_PRESET : MEMBER_PRESET
    expect(presetRefusal(undefined, ['session-obs-0001'], presetOf)).toBeUndefined()
  })
})
