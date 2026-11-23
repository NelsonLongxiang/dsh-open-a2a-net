// @vitest-environment node
/** #808 P4: team.settings.set, the team's A2A settings a blueprint may set (owner 2026-11-23: "all the parameters" means the A2A ones). */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, StaffingExecutor, type StaffingChange, type StaffingDeps, type StaffingTeam } from '../../src/superagent/host/staffing.ts'
import { DEFAULT_SETTINGS, parseSettings, type TeamSettings } from '../../src/superagent/host/policy.ts'
import { blueprintDiff } from '../../src/superagent/host/builder-tools.ts'

function world(failJoin = false, reviewer: string | null = 'dsh/12345678', policy?: StaffingDeps['policy']) {
  let settings: TeamSettings = { ...DEFAULT_SETTINGS, canvas: 'ops', ...(reviewer !== null ? { reviewer } : {}) }
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
    ...(policy !== undefined ? { policy } : {}),
  }
  return { x: new StaffingExecutor(deps), settings: () => settings }
}
const sub = (w: ReturnType<typeof world>, id: string, ops: StaffingChange['ops'], source: StaffingChange['source'] = 'owner-local') => w.x.submit({ id, source, by: {}, ops })
const set = (params: Record<string, unknown>) => ({ op: 'team.settings.set' as const, params: { team: 't-ops', ...params } })

describe('#808 P4 team.settings.set (A2A settings only)', () => {
  it('waits for the owner and the team card, then saves through the team\'s own checks', async () => {
    const w = world()
    expect(await sub(w, 's1', [set({ sources: { a2a: false }, progressOff: true, decisionPush: true, reviewer: 'dsh/87654321' })])).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    await w.x.agree('s1', 'test')
    expect(w.settings().reviewer).toBe('dsh/12345678')
    await w.x.cardDecided('s1', 't-ops', true)
    expect(w.x.get('s1')!.state).toBe('done')
    expect(w.settings()).toMatchObject({ sources: { workbench: DEFAULT_SETTINGS.sources.workbench, a2a: false }, progressOff: true, decisionPush: true, reviewer: 'dsh/87654321' })
  })

  it('a later failure writes every named key back, including a cleared reviewer', async () => {
    const w = world(true)
    const before = w.settings()
    await sub(w, 's2', [set({ reviewer: null, decisionPush: true, sources: { a2a: !before.sources.a2a } }), { op: 'session.join', params: { session: 'session-aaaaaaaa-0001' } }])
    await w.x.agree('s2', 'test'); await w.x.cardDecided('s2', 't-ops', true)
    expect(w.x.get('s2')!.steps.map(s => s.state)).toEqual(['undone', 'failed'])
    expect(w.settings()).toMatchObject({ reviewer: before.reviewer, sources: before.sources })
    expect(w.settings().decisionPush).toBe(before.decisionPush)
  })

  it('#827 review M12: a reviewer the team never had is unset again after the undo', async () => {
    const w = world(true, null)
    expect(w.settings().reviewer).toBeUndefined()
    await sub(w, 's3', [set({ reviewer: 'dsh/87654321' }), { op: 'session.join', params: { session: 'session-aaaaaaaa-0001' } }])
    await w.x.agree('s3', 'test'); await w.x.cardDecided('s3', 't-ops', true)
    expect(w.x.get('s3')!.steps.map(s => s.state)).toEqual(['undone', 'failed'])
    expect(w.settings().reviewer).toBeUndefined()
    expect('reviewer' in w.settings()).toBe(false)
  })

  it('#829 review M10b: what the executor does on owner-local: waits for the owner, even when the policy says auto', async () => {
    for (const w of [world(), world(false, 'dsh/12345678', () => ({ 'owner-local': { ...DEFAULT_POLICY['owner-local'], 'team.settings.set': 'auto' } }) as never)]) {
      expect(await sub(w, 'a1', [set({ decisionPush: true })])).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
      // The team's card alone does not run it: the owner's own agreement is still missing.
      await w.x.cardDecided('a1', 't-ops', true)
      expect(w.x.get('a1')!.state).toBe('awaiting')
      expect(w.settings().decisionPush).toBe(DEFAULT_SETTINGS.decisionPush)
      await w.x.agree('a1', 'test')
      expect(w.x.get('a1')!.state).toBe('done')
      expect(w.settings().decisionPush).toBe(true)
    }
  })

  it('#831 review: owner-local team.retire and member.retemplate are refused as off, not as not-yet', async () => {
    const w = world()
    for (const op of ['team.retire', 'member.retemplate'] as const) {
      expect(DEFAULT_POLICY['owner-local'][op]).toBe('off')
      expect(await sub(w, 'off-' + op, [{ op, params: {} } as never])).toMatchObject({ ok: false, code: 'off' })
    }
    expect(w.x.list()).toHaveLength(0)
  })

  it('#827 review M10: owner-local asks the owner, the market never runs it', () => {
    expect(DEFAULT_POLICY['owner-local']['team.settings.set']).toBe('confirm')
    expect(DEFAULT_POLICY.market['team.settings.set']).toBe('off')
  })

  it('refuses every setting that is not an A2A one, admission, credentials, the other Sources, bad values and the market', async () => {
    const w = world()
    for (const params of [{ acceptMode: 'auto' }, { models: null }, { prompts: null }, { maxConcurrent: 3 }, { evalTimeoutMs: 60_000 }, { paused: true }, { observerCast: true }, { idleSweep: true }, { repos: {} }, { blockedTools: ['x_tool'] }, { credentialAckMinutes: 5 }, { prepare: 'echo hi' }, { extraTools: { router: ['bash'] } }, { mcp: [] }, { allowed: { a2a: ['x'] } }, { bots: { a2a: [] } }, { apiKey: 'k' }, { teamJoinAllowlist: [] }, { approvers: ['session-aaaaaaaa-0001'] }, { router: 'session-aaaaaaaa-0001' }, { canvas: 'other' }])
      expect(await sub(w, 'r-' + Object.keys(params)[0], [set(params)])).toMatchObject({ ok: false, code: 'not-allowed' })
    expect(await sub(w, 'r-wb', [set({ sources: { workbench: false } })])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r-gh', [set({ sources: { github: true } })])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r-bad', [set({ reviewer: 'not an address' })])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r-empty', [set({})])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r-mk', [set({ decisionPush: true })], 'market:market/0123456789abcdef')).toMatchObject({ ok: false, code: 'off' })
    expect(w.x.list()).toHaveLength(0)
  })

  it('the owner reads each key and value', () => {
    expect(blueprintDiff([set({ decisionPush: true, reviewer: 'dsh/87654321' })], () => ({ rules: [], dispatch: '' }))[0]).toBe('1. 团队 t-ops 的设置改为：decisionPush = true；reviewer = "dsh/87654321"')
  })
})
