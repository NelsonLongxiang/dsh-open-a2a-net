// @vitest-environment node
/** session.title.set: the team builder's blueprint sets the title the workbench's session list shows, through the host's session-title service. */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, StaffingExecutor, type StaffingChange, type StaffingDeps } from '../../src/superagent/host/staffing.ts'
import { blueprintDiff } from '../../src/superagent/host/builder-tools.ts'

const A = 'session-aaaaaaaa-0001', B = 'session-bbbbbbbb-0002', GONE = 'session-dddddddd-0004'
const MARKET = 'market:market/0123456789abcdef' as const
function world(options: { titles?: Record<string, string>; failJoin?: string; withTitles?: boolean } = {}) {
  const live = new Set([A, B])
  let titles: Record<string, string> = { ...(options.titles ?? {}) }
  const renames: Array<[string, string]> = [], resets: string[] = []
  const deps: StaffingDeps = {
    path: join(mkdtempSync(join(tmpdir(), 'staffing-title-')), 'staffing.json'), now: () => new Date().toISOString(), logger: { info: () => {}, warn: () => {} },
    team: () => undefined, teamOfCanvas: () => undefined, canvasExists: () => false,
    canvasCreate: () => ({ ok: true }), canvasRemove: () => true, canvasAddLocal: async () => ({ ok: true }), canvasRemoveLocal: () => true,
    teamAdd: () => ({ ok: false, error: 'x' }), teamUnbind: () => true,
    sessionJoin: id => id === options.failJoin ? { ok: false, error: 'no live local session' } : { ok: true }, sessionLeave: () => true, sessionJoined: () => false,
    ...(options.withTitles === false ? {} : {
      sessionTitleRead: (id: string) => live.has(id) ? (titles[id] !== undefined ? { live: true, title: titles[id] } : { live: true }) : { live: false },
      sessionTitleRename: (id: string, title: string) => { if (!live.has(id)) return { ok: false as const, error: 'not live' }; renames.push([id, title]); titles = { ...titles, [id]: title }; return { ok: true as const, title } },
      sessionTitleReset: (id: string) => { resets.push(id); const next = { ...titles }; delete next[id]; titles = next; return true },
    }),
  }
  return { x: new StaffingExecutor(deps), titles: () => titles, renames, resets }
}
const sub = (w: ReturnType<typeof world>, id: string, ops: StaffingChange['ops'], source: StaffingChange['source'] = 'owner-local') => w.x.submit({ id, source, by: {}, ops })
const set = (session: string, title: unknown) => ({ op: 'session.title.set' as const, params: { session, title } })

describe('session.title.set', () => {
  it('waits for the owner; only the owner\'s agreement renames, through the host\'s title service', async () => {
    const w = world({ titles: { [A]: '被截断的旧…' } })
    expect(await sub(w, 't1', [set(A, '  ygl-trees 评估 ')])).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    expect(w.titles()[A]).toBe('被截断的旧…')
    expect(w.renames).toEqual([])
    await w.x.agree('t1', 'test')
    expect(w.x.get('t1')!.state).toBe('done')
    expect(w.renames).toEqual([[A, 'ygl-trees 评估']])
    expect(w.titles()[A]).toBe('ygl-trees 评估')
  })

  it('the market never runs it, and the default policy says so', async () => {
    expect(DEFAULT_POLICY['owner-local']['session.title.set']).toBe('confirm')
    expect(DEFAULT_POLICY.market['session.title.set']).toBe('off')
    const w = world({ titles: { [A]: '旧' } })
    expect(await sub(w, 'm1', [set(A, '新')], MARKET)).toMatchObject({ ok: false, code: 'off' })
    expect(w.renames).toEqual([])
  })

  it('refuses address shapes, over-long, blank or control titles, a session that is not live, and a host without titles', async () => {
    const w = world()
    for (const [id, title] of [['r1', 'dsh/12345678'], ['r2', 'x'.repeat(65)], ['r3', '   '], ['r4', ''], ['r5', 'a\u0007b'], ['r6', 42]] as const) {
      expect(await sub(w, id, [set(A, title)]), String(title)).toMatchObject({ ok: false, code: 'invalid' })
    }
    expect(await sub(w, 'r7', [set(GONE, '新')])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r8', [set('dsh/12345678', '新')])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(world({ withTitles: false }), 'r9', [set(A, '新')])).toMatchObject({ ok: false, code: 'not-yet' })
    expect(w.renames).toEqual([])
  })

  it('a later failure puts the exact earlier title back', async () => {
    const w = world({ titles: { [A]: '被截断的旧…' }, failJoin: B })
    await sub(w, 'u1', [set(A, '新标题'), { op: 'session.join', params: { session: B } }])
    await w.x.agree('u1', 'test')
    expect(w.x.get('u1')!.steps.map(s => s.state)).toEqual(['undone', 'failed'])
    expect(w.titles()[A]).toBe('被截断的旧…')
    expect(w.renames.at(-1)).toEqual([A, '被截断的旧…'])
    expect(w.resets).toEqual([])
  })

  it('with no earlier title, the undo brings the automatic title back instead of pinning one', async () => {
    const w = world({ failJoin: B })
    await sub(w, 'u2', [set(A, '新标题'), { op: 'session.join', params: { session: B } }])
    await w.x.agree('u2', 'test')
    expect(w.x.get('u2')!.steps.map(s => s.state)).toEqual(['undone', 'failed'])
    expect(w.resets).toEqual([A])
    expect(w.titles()[A]).toBeUndefined()
  })

  it('the owner reads that it is the session list title and that it stays fixed', () => {
    const lines = blueprintDiff([set(A, 'ygl-trees 评估')], () => ({ rules: [], dispatch: '' }))
    expect(lines[0]).toContain('标题改为「ygl-trees 评估」')
    expect(lines[0]).toContain('不再自动生成')
  })
})
