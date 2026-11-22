// @vitest-environment node
/** #808 P3: the team builder's blueprint sets a team's outbound approvers, joins a local session, sets seat names. */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StaffingExecutor, type StaffingChange, type StaffingDeps, type StaffingTeam } from '../../src/superagent/host/staffing.ts'
import { DEFAULT_SETTINGS, parseSettings, type TeamSettings } from '../../src/superagent/host/policy.ts'
import { blueprintDiff } from '../../src/superagent/host/builder-tools.ts'

const A = 'session-aaaaaaaa-0001', B = 'session-bbbbbbbb-0002'
function world(options: { failJoin?: string; joined?: string[] } = {}) {
  let settings: TeamSettings = { ...DEFAULT_SETTINGS, canvas: 'ops' }
  const joined = new Set(options.joined ?? [])
  let names: Record<string, string> = { [B]: '旧名' }
  const team: StaffingTeam = {
    get settings() { return settings },
    saveSettings: raw => { const parsed = parseSettings(raw, settings); if (!parsed.ok) return parsed; settings = parsed.settings; return { ok: true } },
    memberOfSeat: () => undefined, proposeStaffingCard: () => 'card',
  }
  const deps: StaffingDeps = {
    path: join(mkdtempSync(join(tmpdir(), 'staffing-p3-')), 'staffing.json'), now: () => new Date().toISOString(), logger: { info: () => {}, warn: () => {} },
    team: id => id === 't-ops' ? team : undefined, teamOfCanvas: c => c === 'ops' ? 't-ops' : undefined, canvasExists: n => n === 'ops',
    canvasCreate: () => ({ ok: true }), canvasRemove: () => true, canvasAddLocal: async () => ({ ok: true }), canvasRemoveLocal: () => true,
    teamAdd: () => ({ ok: false, error: 'x' }), teamUnbind: () => true,
    sessionJoin: id => { if (id === options.failJoin) return { ok: false, error: 'no live local session' }; joined.add(id); return { ok: true } },
    sessionLeave: id => joined.delete(id), sessionJoined: id => joined.has(id),
    seatNamesRead: () => names, seatNamesWrite: next => { names = { ...next }; return { ok: true } },
  }
  return { x: new StaffingExecutor(deps), settings: () => settings, joined, names: () => names }
}
const sub = (w: ReturnType<typeof world>, id: string, ops: StaffingChange['ops'], source: StaffingChange['source'] = 'owner-local') => w.x.submit({ id, source, by: {}, ops })

describe('#808 P3', () => {
  it('approvers: wait for the owner and the team card, then saved through the team\'s own checks', async () => {
    const w = world()
    expect(await sub(w, 'a1', [{ op: 'team.approvers.set', params: { team: 't-ops', approvers: [A] } }])).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    await w.x.agree('a1', 'test')
    expect(w.settings().approvers).toBeUndefined()
    await w.x.cardDecided('a1', 't-ops', true)
    expect(w.x.get('a1')!.state).toBe('done')
    expect(w.settings().approvers).toEqual([A])
  })

  it('a later failure undoes approvers, a join and a seat name', async () => {
    const w = world({ failJoin: B })
    await sub(w, 'u1', [{ op: 'team.approvers.set', params: { team: 't-ops', approvers: [A] } }, { op: 'session.join', params: { session: A } }, { op: 'session.seatName.set', params: { session: B, name: '新名' } }, { op: 'session.join', params: { session: B } }])
    await w.x.agree('u1', 'test'); await w.x.cardDecided('u1', 't-ops', true)
    expect(w.x.get('u1')!.steps.map(s => s.state)).toEqual(['undone', 'undone', 'undone', 'failed'])
    expect(w.settings().approvers).toBeUndefined()
    expect(w.joined.has(A)).toBe(false)
    expect(w.names()).toEqual({ [B]: '旧名' })
  })

  it('a session already joined is left joined by an undo; a cleared seat name goes away', async () => {
    const w = world({ joined: [A] })
    await sub(w, 'j1', [{ op: 'session.join', params: { session: A } }, { op: 'session.seatName.set', params: { session: B, name: '' } }])
    await w.x.agree('j1', 'test')
    expect(w.x.get('j1')!.state).toBe('done')
    expect(w.joined.has(A)).toBe(true)
    expect(w.names()).toEqual({})
  })

  it('#820 M3: an undo keeps a session that was joined before the blueprint and leaves only the one it joined', async () => {
    const C = 'session-cccccccc-0003'
    const w = world({ joined: [A], failJoin: B })
    await sub(w, 'm3', [{ op: 'session.join', params: { session: A } }, { op: 'session.join', params: { session: C } }, { op: 'session.join', params: { session: B } }])
    await w.x.agree('m3', 'test')
    expect(w.x.get('m3')!.steps.map(s => s.state)).toEqual(['done', 'undone', 'failed'])
    expect(w.joined.has(A)).toBe(true)
    expect(w.joined.has(C)).toBe(false)
  })

  it('refuses address-shaped seat names, non-session approvers, and the market', async () => {
    const w = world()
    expect(await sub(w, 'r1', [{ op: 'session.seatName.set', params: { session: A, name: 'dsh/12345678' } }])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r2', [{ op: 'team.approvers.set', params: { team: 't-ops', approvers: ['dsh/12345678'] } }])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r3', [{ op: 'session.join', params: { session: A } }], 'market:market/0123456789abcdef')).toMatchObject({ ok: false, code: 'off' })
    expect(await sub(w, 'r4', [{ op: 'team.approvers.set', params: { team: 't-ops', approvers: [A] } }], 'market:market/0123456789abcdef')).toMatchObject({ ok: false, code: 'off' })
  })

  it('the owner reads that approvers act for them on outbound cards', () => {
    const lines = blueprintDiff([{ op: 'team.approvers.set', params: { team: 't-ops', approvers: [A] } }, { op: 'session.join', params: { session: A } }], () => ({ rules: [], dispatch: '' }))
    expect(lines[0]).toContain('出站审批权交给：' + A)
    expect(lines[0]).toContain('不能批自己提的')
    expect(lines[1]).toBe('2. 让本机会话 ' + A + ' 入网')
  })
})
