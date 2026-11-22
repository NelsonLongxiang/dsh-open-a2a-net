// @vitest-environment node
/** #808 P4: team.settings.set, the remaining team settings a blueprint may set (owner 2026-11-23). */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StaffingExecutor, type StaffingChange, type StaffingDeps, type StaffingTeam } from '../../src/superagent/host/staffing.ts'
import { DEFAULT_SETTINGS, parseSettings, type TeamSettings } from '../../src/superagent/host/policy.ts'
import { blueprintDiff } from '../../src/superagent/host/builder-tools.ts'

function world(failJoin = false) {
  let settings: TeamSettings = { ...DEFAULT_SETTINGS, canvas: 'ops', reviewer: 'dsh/12345678' }
  const team: StaffingTeam = {
    get settings() { return settings },
    saveSettings: raw => { const parsed = parseSettings(raw, settings); if (!parsed.ok) return parsed; settings = parsed.settings; return { ok: true } },
    memberOfSeat: () => undefined, proposeStaffingCard: () => 'card',
  }
  const deps: StaffingDeps = {
    path: join(mkdtempSync(join(tmpdir(), 'staffing-set-')), 'staffing.json'), now: () => new Date().toISOString(), logger: { info: () => {}, warn: () => {} },
    team: id => id === 't-ops' ? team : undefined, teamOfCanvas: c => c === 'ops' ? 't-ops' : undefined, canvasExists: n => n === 'ops',
    canvasCreate: () => ({ ok: true }), canvasRemove: () => true, canvasAddLocal: async () => ({ ok: true }), canvasRemoveLocal: () => true,
    teamAdd: () => ({ ok: false, error: 'x' }), teamUnbind: () => true,
    sessionJoin: () => failJoin ? { ok: false, error: 'no live local session' } : { ok: true }, sessionLeave: () => true, sessionJoined: () => false,
  }
  return { x: new StaffingExecutor(deps), settings: () => settings }
}
const sub = (w: ReturnType<typeof world>, id: string, ops: StaffingChange['ops'], source: StaffingChange['source'] = 'owner-local') => w.x.submit({ id, source, by: {}, ops })
const set = (params: Record<string, unknown>) => ({ op: 'team.settings.set' as const, params: { team: 't-ops', ...params } })

describe('#808 P4 team.settings.set', () => {
  it('waits for the owner and the team card, then saves through the team\'s own checks', async () => {
    const w = world()
    expect(await sub(w, 's1', [set({ maxConcurrent: 3, acceptMode: 'observe', blockedTools: ['mcp__market__publish'], sources: { a2a: false } })])).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    await w.x.agree('s1', 'test')
    expect(w.settings().maxConcurrent).toBe(DEFAULT_SETTINGS.maxConcurrent)
    await w.x.cardDecided('s1', 't-ops', true)
    expect(w.x.get('s1')!.state).toBe('done')
    expect(w.settings()).toMatchObject({ maxConcurrent: 3, acceptMode: 'observe', blockedTools: ['mcp__market__publish'], sources: { workbench: DEFAULT_SETTINGS.sources.workbench, a2a: false } })
  })

  it('a later failure writes every named key back, including a cleared one', async () => {
    const w = world(true)
    const before = w.settings()
    await sub(w, 's2', [set({ reviewer: null, paused: true, blockedTools: ['x_tool'], sources: { workbench: false } }), { op: 'session.join', params: { session: 'session-aaaaaaaa-0001' } }])
    await w.x.agree('s2', 'test'); await w.x.cardDecided('s2', 't-ops', true)
    expect(w.x.get('s2')!.steps.map(s => s.state)).toEqual(['undone', 'failed'])
    expect(w.settings()).toMatchObject({ reviewer: before.reviewer, paused: before.paused, sources: before.sources })
    expect(w.settings().blockedTools).toBeUndefined()
  })

  it('refuses what widens an agent, admission and credentials, the GitHub Source, bad values and the market', async () => {
    const w = world()
    for (const params of [{ prepare: 'echo hi' }, { extraTools: { router: ['bash'] } }, { mcp: [] }, { allowed: { a2a: ['x'] } }, { bots: { a2a: [] } }, { apiKey: 'k' }, { teamJoinAllowlist: [] }])
      expect(await sub(w, 'r-' + Object.keys(params)[0], [set(params)])).toMatchObject({ ok: false, code: 'not-allowed' })
    expect(await sub(w, 'r-gh', [set({ sources: { github: true } })])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r-bad', [set({ maxConcurrent: 999 })])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r-empty', [set({})])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r-mk', [set({ paused: true })], 'market:market/0123456789abcdef')).toMatchObject({ ok: false, code: 'off' })
    expect(w.x.list()).toHaveLength(0)
  })

  it('the owner reads each key and value', () => {
    expect(blueprintDiff([set({ maxConcurrent: 3, paused: true })], () => ({ rules: [], dispatch: '' }))[0]).toBe('1. 团队 t-ops 的设置改为：maxConcurrent = 3；paused = true')
  })
})
