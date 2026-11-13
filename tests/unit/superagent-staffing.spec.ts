// @vitest-environment node
/**
 * Staffing changes, the core (S1a; docs/design/superagent-builder.md TB3/TB4/TB6, docs/design/superagent-staffing-changes.md
 * W1/W2): the ledger, the policy, the owner's agreement and the teams' cards, the executor and its undo.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StaffingExecutor, type StaffingChange, type StaffingDeps, type StaffingTeam } from '../../src/superagent/host/staffing.ts'

const R = 'session-11111111-aaaa', M = 'session-22222222-bbbb', M2 = 'session-33333333-cccc'

function world(options: { failAdd?: string; failUndo?: boolean } = {}) {
  const calls: string[] = []
  const canvases = new Map<string, string[]>()
  const teams = new Map<string, { canvas?: string; router?: string; rules: Array<{ name: string; text: string; enabled: boolean }>; dispatch: string; profiles: Record<string, unknown>; seats: Record<string, string>; cards: Array<{ change: string; question: string; level: string }> }>()
  teams.set('t-old', { canvas: 'old', router: 'session-99999999-zzzz', rules: [], dispatch: 'before', profiles: {}, seats: { 'seat-0000abcd': M2 }, cards: [] })
  canvases.set('old', ['session-99999999-zzzz', M2])
  let next = 0
  const adapt = (id: string): StaffingTeam | undefined => {
    const t = teams.get(id)
    if (t === undefined) return undefined
    return {
      get settings() { return { ...(t.canvas !== undefined ? { canvas: t.canvas } : {}), ...(t.router !== undefined ? { router: t.router } : {}), members: [], rules: t.rules, dispatch: t.dispatch, profiles: t.profiles } },
      saveSettings: (raw) => { const r = raw as Record<string, unknown>; calls.push(`save:${id}:${Object.keys(r).join(',')}`); if ('rules' in r) t.rules = r.rules as never; if ('dispatch' in r) t.dispatch = r.dispatch as string; if ('profiles' in r) t.profiles = r.profiles as never; return { ok: true } },
      memberOfSeat: seat => t.seats[seat],
      proposeStaffingCard: (change, question, _reason, level) => { t.cards.push({ change, question, level }); return `card-${String(t.cards.length)}` },
    }
  }
  const deps: StaffingDeps = {
    path: join(mkdtempSync(join(tmpdir(), 'staffing-')), 'staffing.json'),
    now: () => new Date().toISOString(),
    logger: { info: () => {}, warn: () => {} },
    team: adapt,
    teamOfCanvas: canvas => [...teams].find(([, t]) => t.canvas === canvas)?.[0],
    canvasExists: name => canvases.has(name),
    canvasCreate: name => { calls.push(`canvas+:${name}`); canvases.set(name, []); return { ok: true } },
    canvasRemove: name => { calls.push(`canvas-:${name}`); if (options.failUndo === true) return false; return canvases.delete(name) },
    canvasAddLocal: async (name, session) => { calls.push(`member+:${name}:${session}`); if (session === options.failAdd) return { ok: false, error: 'wrong preset' }; canvases.get(name)?.push(session); return { ok: true } },
    canvasRemoveLocal: (name, session) => { calls.push(`member-:${name}:${session}`); canvases.set(name, (canvases.get(name) ?? []).filter(s => s !== session)); return true },
    teamAdd: (canvas, router) => { const id = `t-${String(++next)}`; calls.push(`team+:${canvas}`); teams.set(id, { canvas, router, rules: [], dispatch: '', profiles: {}, seats: {}, cards: [] }); return { ok: true, id } },
    teamUnbind: id => { calls.push(`team-:${id}`); const t = teams.get(id); if (t !== undefined) { delete t.canvas; delete t.router } return true },
  }
  return { deps, calls, teams, canvases, x: new StaffingExecutor(deps) }
}

const blueprint = (id = 'bp-1'): StaffingChange => ({
  id, source: 'owner-local', by: { session: 'session-builder-0000' }, summary: '新建 docs 团队',
  ops: [
    { op: 'team.create', params: { canvas: 'docs', router: R } },
    { op: 'member.add', params: { team: 'docs', session: M, profile: { role: '写文档', rules: [{ name: 'docs-only', text: '只接文档类工作' }], repo: 'acme/docs' } } },
    { op: 'team.rules.set', params: { team: 'docs', scope: 'team', value: [{ name: 'take-docs', text: '接文档请求' }] } },
    { op: 'team.rules.set', params: { team: 'docs', scope: 'dispatch', value: '按仓库派单' } },
  ],
})

describe('a blueprint for a new team (owner-local)', () => {
  it('waits for the owner, then builds the team in order', async () => {
    const w = world()
    const out = await w.x.submit(blueprint())
    expect(out).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    expect(w.calls).toEqual([])
    const agreed = await w.x.agree('bp-1', 'test')
    expect(agreed).toMatchObject({ ok: true, entry: { state: 'done' } })
    expect(w.calls.slice(0, 4)).toEqual(['canvas+:docs', `member+:docs:${R}`, 'team+:docs', `member+:docs:${M}`])
    const team = w.teams.get('t-1')!
    expect(team.profiles[M]).toEqual({ role: '写文档', rules: [{ name: 'docs-only', text: '只接文档类工作', enabled: true }], repo: 'acme/docs' })
    expect(team.rules).toEqual([{ name: 'take-docs', text: '接文档请求', enabled: true }])
    expect(team.dispatch).toBe('按仓库派单')
    expect(w.x.get('bp-1')!.steps.map(s => s.state)).toEqual(['done', 'done', 'done', 'done'])
    expect(w.x.get('bp-1')!.steps[0]!.result).toEqual({ teamId: 't-1', canvas: 'docs' })
  })

  it('is idempotent by id: the same body answers the record, another body is a conflict', async () => {
    const w = world()
    await w.x.submit(blueprint())
    expect(await w.x.submit(blueprint())).toMatchObject({ ok: true, duplicate: true })
    expect(await w.x.submit({ ...blueprint(), summary: 'other' })).toMatchObject({ ok: false, code: 'conflict' })
    expect(new StaffingExecutor(w.deps).get('bp-1')).toMatchObject({ state: 'awaiting' })
  })
})

describe('what a change may not carry', () => {
  it('refuses W3 fields, retiring, templates and an unknown team', async () => {
    const w = world()
    expect(await w.x.submit({ id: 'a', source: 'owner-local', by: {}, ops: [{ op: 'member.add', params: { team: 't-old', session: M, tools: ['bash'] } }] })).toMatchObject({ ok: false, code: 'not-allowed' })
    expect(await w.x.submit({ id: 'b', source: 'owner-local', by: {}, ops: [{ op: 'member.retire', params: { team: 't-old', seatId: 'seat-0000abcd' } }] })).toMatchObject({ ok: false, code: 'off' })
    expect(await w.x.submit({ id: 'c', source: 'market:market/0123456789abcdef', by: {}, ops: [{ op: 'member.retire', params: { team: 't-old', seatId: 'seat-0000abcd' } }] })).toMatchObject({ ok: false, code: 'not-yet' })
    expect(await w.x.submit({ id: 'd', source: 'owner-local', by: {}, ops: [{ op: 'member.add', params: { team: 't-old', session: 'template:writer' } }] })).toMatchObject({ ok: false, code: 'invalid' })
    expect(await w.x.submit({ id: 'e', source: 'owner-local', by: {}, ops: [{ op: 'member.add', params: { team: 't-none', session: M } }] })).toMatchObject({ ok: false, code: 'unknown-team' })
    expect(await w.x.submit({ id: 'f', source: 'owner-local', by: {}, ops: [{ op: 'team.create', params: { canvas: 'old', router: R } }] })).toMatchObject({ ok: false, code: 'invalid' })
    expect(w.x.list()).toHaveLength(0)
  })
})

describe('a change to a team that exists', () => {
  it('needs the owner and that team\'s card; a member scope resolves its seat', async () => {
    const w = world()
    await w.x.submit({ id: 'old-1', source: 'owner-local', by: {}, ops: [{ op: 'team.rules.set', params: { team: 't-old', scope: 'member:seat-0000abcd', value: [{ name: 'r1', text: 'x' }] } }] })
    expect(w.teams.get('t-old')!.cards).toHaveLength(1)
    await w.x.agree('old-1', 'test')
    expect(w.x.get('old-1')!.state).toBe('awaiting')
    await w.x.cardDecided('old-1', 't-old', true)
    expect(w.x.get('old-1')!.state).toBe('done')
    expect(w.teams.get('t-old')!.profiles[M2]).toEqual({ rules: [{ name: 'r1', text: 'x', enabled: true }] })
  })

  it('a refused card refuses the change', async () => {
    const w = world()
    await w.x.submit({ id: 'old-2', source: 'owner-local', by: {}, ops: [{ op: 'team.rules.set', params: { team: 't-old', scope: 'dispatch', value: 'new' } }] })
    await w.x.cardDecided('old-2', 't-old', false)
    await w.x.agree('old-2', 'test')
    expect(w.x.get('old-2')!.state).toBe('refused')
    expect(w.teams.get('t-old')!.dispatch).toBe('before')
  })
})

describe('a failure undoes what was done, in reverse', () => {
  it('stops at the failing step and takes the new team down', async () => {
    const w = world({ failAdd: M })
    await w.x.submit(blueprint('bp-2'))
    await w.x.agree('bp-2', 'test')
    const entry = w.x.get('bp-2')!
    expect(entry.state).toBe('failed')
    expect(entry.steps.map(s => s.state)).toEqual(['undone', 'failed', 'skipped', 'skipped'])
    expect(w.calls.slice(-3)).toEqual(['team-:t-1', `member-:docs:${R}`, 'canvas-:docs'])
    expect(w.canvases.has('docs')).toBe(false)
  })

  it('an undo that fails leaves the change partial, with a P1 card on each existing team', async () => {
    const w = world({ failAdd: M, failUndo: true })
    await w.x.submit({ id: 'bp-3', source: 'owner-local', by: {}, ops: [
      { op: 'team.rules.set', params: { team: 't-old', scope: 'dispatch', value: 'new' } },
      { op: 'team.create', params: { canvas: 'docs', router: R } },
      { op: 'member.add', params: { team: 'docs', session: M } },
    ] })
    await w.x.agree('bp-3', 'test')
    await w.x.cardDecided('bp-3', 't-old', true)
    expect(w.x.get('bp-3')!.state).toBe('partial')
    expect(w.teams.get('t-old')!.dispatch).toBe('before')
    expect(w.teams.get('t-old')!.cards.at(-1)).toMatchObject({ change: 'bp-3', level: 'P1' })
  })

  it('a change that was running when the host stopped is never run again', async () => {
    const w = world()
    await w.x.submit(blueprint('bp-4'))
    const { writeFileSync, readFileSync } = await import('node:fs')
    const stored = JSON.parse(readFileSync(w.deps.path, 'utf8')) as { entries: Array<{ state: string }> }
    stored.entries[0]!.state = 'running'
    writeFileSync(w.deps.path, JSON.stringify(stored))
    const again = new StaffingExecutor(w.deps)
    expect(again.get('bp-4')!.state).toBe('partial')
    expect(await again.agree('bp-4', 'test')).toMatchObject({ ok: false, code: 'not-awaiting' })
  })
})

describe('the team\'s confirmation card', () => {
  it('a decided staffing card reaches the executor, confirmed or not', async () => {
    const { SuperagentHost, STAFFING_CONFIRM } = await import('../../src/superagent/host/index.ts')
    const decided: Array<[string, boolean]> = []
    const h = new SuperagentHost({ home: mkdtempSync(join(tmpdir(), 'sa-staffing-')), logger: { info: () => {}, warn: () => {} }, interval: () => () => {}, deliverToSession: () => true,
      staffingDecided: (id: string, _team: unknown, ok: boolean) => { decided.push([id, ok]) } } as never)
    const card = h.proposeStaffingCard('bp-9', '编制变更 bp-9', '- team.rules.set', 'P1')!
    expect(h.decide(card, 'choose', STAFFING_CONFIRM)).toMatchObject({ ok: true, confirmed: true })
    expect(decided).toEqual([['bp-9', true]])
    await h.stop()
  })
})
