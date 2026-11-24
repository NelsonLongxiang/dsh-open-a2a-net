// @vitest-environment node
/** session.title.set: the team builder's blueprint sets the title the workbench's session list shows, through the host's session-title service. */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, StaffingExecutor, type StaffingChange, type StaffingDeps } from '../../src/superagent/host/staffing.ts'
import { blueprintDiff } from '../../src/superagent/host/builder-tools.ts'
import { createStaffing } from '../../src/superagent/host/staffing-wiring.ts'

const A = 'session-aaaaaaaa-0001', B = 'session-bbbbbbbb-0002', GONE = 'session-dddddddd-0004'
const MARKET = 'market:market/0123456789abcdef' as const
function world(options: { titles?: Record<string, string>; failJoin?: string; withTitles?: boolean; available?: boolean; storedAs?: (title: string) => string; resetUnpins?: boolean; renameIgnoresLive?: boolean } = {}) {
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
      sessionTitleRename: (id: string, title: string) => { if (!live.has(id) && options.renameIgnoresLive !== true) return { ok: false as const, error: 'not live' }; const stored = options.storedAs?.(title) ?? title; renames.push([id, stored]); titles = { ...titles, [id]: stored }; return { ok: true as const, title: stored } },
      sessionTitleReset: async (id: string) => { resets.push(id); if (options.resetUnpins === false) return false; const next = { ...titles }; delete next[id]; titles = next; return true },
      ...(options.available !== undefined ? { sessionTitleAvailable: () => options.available! } : {}),
    }),
  }
  return { x: new StaffingExecutor(deps), titles: () => titles, renames, resets, kill: (id: string) => { live.delete(id) } }
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

  it('#880 review M11: the session is gone between submit and the owner\'s agreement: nothing is renamed', async () => {
    const w = world({ titles: { [A]: '旧' }, renameIgnoresLive: true })
    expect(await sub(w, 'g1', [set(A, '新标题')])).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    w.kill(A)
    await w.x.agree('g1', 'test')
    expect(w.x.get('g1')!.steps.map(s => s.state)).toEqual(['failed'])
    expect(w.renames).toEqual([])
  })

  it('#880 review M12: the host wiring passes the title service through, including whether it is mounted', async () => {
    const titles = { [A]: '旧' } as Record<string, string>
    let mounted = true
    const sessionTitles = { read: (id: string) => id === A ? { live: true, title: titles[id] } : { live: false }, rename: (id: string, title: string) => { titles[id] = title; return { ok: true as const, title } }, reset: () => true, available: () => mounted }
    const x = createStaffing({ path: join(mkdtempSync(join(tmpdir(), 'staffing-title-wire-')), 'staffing.json'), sessionTitles, logger: { info: () => {}, warn: () => {} } } as never)
    expect(await x.submit({ id: 'w1', source: 'owner-local', by: {}, ops: [set(A, '新')] })).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    mounted = false
    expect(await x.submit({ id: 'w2', source: 'owner-local', by: {}, ops: [set(A, '新')] })).toMatchObject({ ok: false, code: 'not-yet' })
  })

  it('#880 review M13: an undo that does not bring the exact earlier title back is undo-failed', async () => {
    const w = world({ titles: { [A]: '被截断的旧…' }, failJoin: B, storedAs: t => t === '被截断的旧…' ? '被截断的旧' : t })
    await sub(w, 'g3', [set(A, '新标题'), { op: 'session.join', params: { session: B } }])
    await w.x.agree('g3', 'test')
    expect(w.x.get('g3')!.steps.map(s => s.state)).toEqual(['undo-failed', 'failed'])
  })

  it('#880 review: no mounted session-title service is refused at submit, not left to fail at the owner\'s agreement', async () => {
    const w = world({ available: false })
    expect(await sub(w, 'g4', [set(A, '新')])).toMatchObject({ ok: false, code: 'not-yet' })
    expect(w.renames).toEqual([])
  })

  it('#880 review: a title the session list would show differently is refused with the shown form; one the host shortens is put back', async () => {
    const w = world({ titles: { [A]: '旧' } })
    const refused = await sub(w, 'g5', [set(A, '新  标题')])
    expect(refused).toMatchObject({ ok: false, code: 'invalid' })
    expect(JSON.stringify(refused)).toContain('«新 标题»')
    const short = world({ titles: { [A]: '旧' }, storedAs: t => t.length > 10 ? t.slice(0, 10) : t })
    await sub(short, 'g6', [set(A, '一二三四五六七八九十十一')])
    await short.x.agree('g6', 'test')
    const step = short.x.get('g6')!.steps[0]!
    expect(step.state).toBe('failed')
    expect(JSON.stringify(step)).toContain('一二三四五六七八九十')
    expect(short.titles()[A]).toBe('旧')
  })

  it('#880 review: with no earlier title, an undo the host cannot unpin (an empty session) is undo-failed, not reported done', async () => {
    const w = world({ failJoin: B, resetUnpins: false })
    await sub(w, 'g7', [set(A, '新标题'), { op: 'session.join', params: { session: B } }])
    await w.x.agree('g7', 'test')
    expect(w.x.get('g7')!.steps.map(s => s.state)).toEqual(['undo-failed', 'failed'])
  })

  it('the owner reads that it is the session list title and that it stays fixed', () => {
    const lines = blueprintDiff([set(A, 'ygl-trees 评估')], () => ({ rules: [], dispatch: '' }))
    expect(lines[0]).toContain('标题改为「ygl-trees 评估」')
    expect(lines[0]).toContain('不再自动生成')
  })
})
