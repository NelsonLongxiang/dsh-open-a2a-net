// @vitest-environment node
/**
 * #808 P1: the team builder's blueprint creates plain canvases and adds or removes their members, local or remote, after the
 * owner's agreement (owner ruling 2026-11-22: the owner's own agreement in the builder session is the operator's act). The
 * member write is the canvas route's own (src/canvas-member-write.ts); admission keeps reading only that explicit record.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { StaffingExecutor, type StaffingChange, type StaffingDeps } from '../../src/superagent/host/staffing.ts'
import { addCanvasMember, type CanvasMemberWriteDeps } from '../../src/canvas-member-write.ts'
import { blueprintDiff } from '../../src/superagent/host/builder-tools.ts'

const LOCAL = 'session-22222222-bbbb', CLI = 'superagent-team/d6bf8b860fee4867', REMOTE = 'dsh/446ce672'

function world(options: { failMember?: string } = {}) {
  const canvases = new Map<string, string[]>([['ops-team', []]])
  const calls: string[] = []
  const deps: StaffingDeps = {
    path: join(mkdtempSync(join(tmpdir(), 'staffing-canvas-')), 'staffing.json'),
    now: () => new Date().toISOString(),
    logger: { info: () => {}, warn: () => {} },
    team: () => undefined,
    teamOfCanvas: canvas => canvas === 'ops-team' ? 't-ops' : undefined,
    canvasExists: name => canvases.has(name),
    canvasCreate: name => { calls.push('canvas+:' + name); canvases.set(name, []); return { ok: true } },
    canvasRemove: name => { calls.push('canvas-:' + name); return canvases.delete(name) },
    canvasAddLocal: async () => ({ ok: true }),
    canvasRemoveLocal: () => true,
    teamAdd: () => ({ ok: false, error: 'not here' }),
    teamUnbind: () => true,
    canvasAddMember: async (name, member) => {
      calls.push('member+:' + name + ':' + member)
      if (member === options.failMember) return { ok: false, error: 'no owner proof' }
      canvases.get(name)?.push(member); return { ok: true, member }
    },
    canvasRemoveMember: (name, member) => { calls.push('member-:' + name + ':' + member); const list = canvases.get(name) ?? []; const i = list.indexOf(member); if (i < 0) return false; list.splice(i, 1); return true },
    canvasMembers: name => canvases.get(name) ?? [],
  }
  return { x: new StaffingExecutor(deps), canvases, calls }
}

const link = (id = 'bp-link', source: StaffingChange['source'] = 'owner-local'): StaffingChange => ({
  id, source, by: { session: 'session-builder-0000' }, summary: '与 13080 开发席建联',
  ops: [
    { op: 'canvas.create', params: { canvas: 'link-13080' } },
    { op: 'canvas.member.add', params: { canvas: 'link-13080', member: LOCAL } },
    { op: 'canvas.member.add', params: { canvas: 'link-13080', member: CLI } },
    { op: 'canvas.member.add', params: { canvas: 'link-13080', member: REMOTE } },
  ],
})

describe('#808 plain canvas ops in a blueprint', () => {
  it('waits for the owner, then creates the canvas and adds local, CLI and remote members, each traced to the blueprint', async () => {
    const w = world()
    expect(await w.x.submit(link())).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    expect(w.calls).toEqual([])
    expect(await w.x.agree('bp-link', 'test')).toMatchObject({ ok: true, entry: { state: 'done' } })
    expect(w.canvases.get('link-13080')).toEqual([LOCAL, CLI, REMOTE])
    expect(w.x.get('bp-link')!.steps.map(s => s.result?.by)).toEqual(Array(4).fill('builder-blueprint bp-link'))
  })

  it('never comes from the market: canvas ops are off for that source', async () => {
    const w = world()
    expect(await w.x.submit(link('m-1', 'market:market/0123456789abcdef'))).toMatchObject({ ok: false, code: 'off' })
    expect(w.calls).toEqual([])
  })

  it('refuses a superagent team canvas, a missing canvas, an existing one and a malformed member', async () => {
    const w = world()
    const one = (id: string, op: string, params: Record<string, unknown>) => w.x.submit({ id, source: 'owner-local', by: {}, ops: [{ op: op as never, params }] })
    expect(await one('a', 'canvas.member.add', { canvas: 'ops-team', member: LOCAL })).toMatchObject({ ok: false, code: 'invalid' })
    expect(await one('b', 'canvas.member.add', { canvas: 'nowhere', member: LOCAL })).toMatchObject({ ok: false, code: 'invalid' })
    w.canvases.set('there', [])
    expect(await one('c', 'canvas.create', { canvas: 'there' })).toMatchObject({ ok: false, code: 'invalid' })
    expect(await one('d', 'canvas.member.add', { canvas: 'there', member: 'not a member' })).toMatchObject({ ok: false, code: 'invalid' })
    expect(await one('e', 'canvas.member.add', { canvas: 'there', member: LOCAL, token: 'x' })).toMatchObject({ ok: false, code: 'not-allowed' })
    expect(w.x.list()).toHaveLength(0)
  })

  it('a member the host refuses stops the blueprint and undoes the rest in reverse', async () => {
    const w = world({ failMember: REMOTE })
    await w.x.submit(link('bp-2')); await w.x.agree('bp-2', 'test')
    const entry = w.x.get('bp-2')!
    expect(entry.state).toBe('failed')
    expect(entry.steps.map(s => s.state)).toEqual(['undone', 'undone', 'undone', 'failed'])
    expect(w.canvases.has('link-13080')).toBe(false)
    expect(w.calls.slice(-3)).toEqual(['member-:link-13080:' + CLI, 'member-:link-13080:' + LOCAL, 'canvas-:link-13080'])
  })

  it('removes a member that is there, and refuses one that is not', async () => {
    const w = world(); w.canvases.set('there', [CLI])
    await w.x.submit({ id: 'r-1', source: 'owner-local', by: {}, ops: [{ op: 'canvas.member.remove', params: { canvas: 'there', member: CLI } }] }); await w.x.agree('r-1', 'test')
    expect(w.x.get('r-1')!.state).toBe('done'); expect(w.canvases.get('there')).toEqual([])
    await w.x.submit({ id: 'r-2', source: 'owner-local', by: {}, ops: [{ op: 'canvas.member.remove', params: { canvas: 'there', member: CLI } }] }); await w.x.agree('r-2', 'test')
    expect(w.x.get('r-2')!.state).toBe('failed')
  })

  it('the owner reads that a remote member opens a cross-host door', () => {
    const lines = blueprintDiff(link().ops, () => undefined)
    expect(lines[0]).toBe('1. 新建普通画布 link-13080')
    expect(lines[2]).toContain('远端：此后它可经这个画布跨主机进门')
    expect(lines[1]).not.toContain('远端')
  })
})

describe('#808 the shared canvas member write keeps the route gate', () => {
  function deps(overrides: Partial<CanvasMemberWriteDeps> = {}) {
    const addMember = vi.fn(() => true)
    const d: CanvasMemberWriteDeps = {
      canvasStore: { hasTeam: () => true, create: () => 'c', addMember, rawMembersOf: () => [], membersOf: () => [], cliHomeOf: () => undefined } as never,
      canvasNameReserved: () => false, localMember: id => id === LOCAL,
      memberForWrite: async ref => ({ ok: true, member: ref }), cliHomeForAdd: async () => ({ ok: true }), ...overrides,
    }
    return { d, addMember }
  }
  it('writes nothing when the owner proof fails, the team canvas refuses, or the local session is not joined', async () => {
    for (const over of [{ memberForWrite: async () => ({ ok: false as const, error: 'no proof' }) }, { teamCanvasRefusal: () => 'superagent canvas' }]) {
      const { d, addMember } = deps(over)
      expect((await addCanvasMember(d, 'c', REMOTE)).ok).toBe(false)
      expect(addMember).not.toHaveBeenCalled()
    }
    const { d, addMember } = deps()
    expect(await addCanvasMember(d, 'c', 'session-99999999-zzzz')).toMatchObject({ ok: false })
    expect(addMember).not.toHaveBeenCalled()
  })
  it('passes the owner key from the proof to the store', async () => {
    const { d, addMember } = deps({ memberForWrite: async ref => ({ ok: true, member: ref, ownerKey: 'k1' }) })
    expect(await addCanvasMember(d, 'c', REMOTE)).toEqual({ ok: true, member: REMOTE })
    expect(addMember).toHaveBeenCalledWith('c', REMOTE, undefined, { replaceHome: false, ownerKey: 'k1' })
  })
})
