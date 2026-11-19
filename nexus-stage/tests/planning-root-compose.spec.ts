// @vitest-environment jsdom
/**
 * #650 组成 root 团队: the checks before any write (canCompose), the router picker's filter, the strict step order with
 * each step's effect read back (composeRoot), and the board path — ≥2 selected frames + G opens the compose dialog
 * (mouse and keyboard), a stopped chain writes its reason on the frame it concerns, a double submit writes once, and a
 * Shift press on a frame head never drags it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view.ts'
import { canCompose, composeRoot, routerCandidates, type ComposeIo, type StepName } from '../src/planning-root-compose.ts'
import type { PlanningTeam } from '../src/planning-types.ts'

const FP = 'a1b2c3d4'
const ref = (name: string): string => `dsh/canvas/${name}@${FP}`
const team = (name: string, extra: Partial<PlanningTeam> = {}): PlanningTeam => ({ name, team: `dsh/canvas/${name}`, id: ref(name), superagentTeam: true, members: [], ...extra })
const sessions = [
  { id: 's-router', label: 'Router', team: 'dsh/11111111', joined: true, live: true, preset: 'superagent-router' },
  { id: 's1', label: 'One', team: 'dsh/22222222', joined: true, live: true, preset: 'superagent-member' },
  { id: 's2', label: 'Two', team: 'dsh/33333333', joined: true, live: true, preset: 'superagent-member' },
]
const facts = (teams: PlanningTeam[], peerOrg?: PlanningInput['peerOrg']) => ({ teams, sessions, ...(peerOrg !== undefined ? { peerOrg } : {}) })

describe('canCompose: every reason comes before any write', () => {
  const teams = [team('A'), team('B'), team('Plain', { superagentTeam: undefined }), team('R', { root: true, children: [{ ref: ref('C'), label: 'C', slots: 2, open: 0, state: 'ready' }] }), team('C'), team('Ros', { kind: 'roster' }), team('NoRef', { id: undefined })]
  const reason = (selected: string[], peerOrg?: PlanningInput['peerOrg']) => { const out = canCompose(selected, facts(teams, peerOrg)); return out.ok ? 'ok' : `${out.frame ?? ''}|${out.reason}` }
  it('names the concrete problem and the frame', () => {
    expect(reason(['A'])).toContain('至少 2 个团队框')
    expect(reason(['A', 'Gone'])).toMatch(/^Gone\|.*已不在画布上/)
    expect(reason(['A', 'R'])).toMatch(/^R\|.*已是 root 团队/)
    expect(reason(['A', 'Plain'])).toMatch(/^Plain\|.*不是接单的 superagent 团队/)
    expect(reason(['A', 'Ros'])).toMatch(/^Ros\|.*不是接单的 superagent 团队/)
    expect(reason(['A', 'NoRef'])).toMatch(/^NoRef\|.*没有画布地址/)
    expect(reason(['A', 'C'])).toMatch(/^C\|.*已是 root「R」的子团队/)
    expect(reason(['A', 'B'])).toBe('ok')
  })
  it('reads a mirror frame from the peer org: unreachable and duplicate addresses are refused', () => {
    const peerOrg = [{ url: 'http://peer.test', org: [{ name: 'Far', team: 'zz/canvas/Far', id: `zz/canvas/Far@${FP}`, superagentTeam: true, members: [] }] }]
    expect(reason(['A', 'Far'], peerOrg)).toBe('ok')
    expect(reason(['A', 'Far'], [{ ...peerOrg[0]!, unreachable: true }])).toMatch(/^Far\|.*不可达/)
    const twin = [{ url: 'http://peer.test', org: [{ name: 'Twin', team: 'dsh/canvas/A', id: ref('A'), superagentTeam: true, members: [] }] }]
    expect(reason(['A', 'Twin'], twin)).toMatch(/^Twin\|.*同一个团队/)
  })
})

describe('routerCandidates: only what the team binding accepts', () => {
  it('a live joined local session on the router preset that sits in no canvas team', () => {
    const rows = [...sessions, { id: 's-cold', label: 'Cold', team: 'dsh/44444444', joined: true, live: false, preset: 'superagent-router' }, { id: 's-out', label: 'Out', team: 'dsh/55555555', joined: false, live: true, preset: 'superagent-router' }, { id: 's-seated', label: 'Seated', team: 'dsh/66666666', joined: true, live: true, preset: 'superagent-router' }, { id: 'peer-x', label: 'peer', team: '', joined: true }]
    expect(routerCandidates(rows, [team('A', { members: [{ id: 's-seated' }] })]).map(s => s.id)).toEqual(['s-router'])
  })
})

/** A scripted owner host: each call answers like the real routes, unless the test makes one step refuse, hang or lie. */
function fakeHost(fault?: { step: StepName; child?: number; mode: 'refuse' | 'hang' | 'garbage' | 'no-effect' }) {
  const calls: string[] = []
  const state = { teams: [] as string[], roots: [] as string[], members: [] as string[], children: [] as Array<{ ref: string }>, registered: [] as Array<{ id: string; canvas: string; router: string }> }
  let teamCalls = 0
  const io: ComposeIo = {
    call: vi.fn(async (path: string, body?: unknown) => {
      const b = (body ?? {}) as Record<string, any>
      const step: StepName | 'read' = path.endsWith('/superagent/teams') ? (body === undefined ? 'read' : 'register') : b.action === 'create' ? 'create' : b.action === 'set-root' ? 'set-root' : b.action === 'add-member' ? 'add-router' : 'add-team'
      calls.push(step === 'add-team' ? `add-team:${String(b.team)}` : step)
      if (step === 'add-team') teamCalls += 1
      const hit = fault !== undefined && fault.step === step && (step !== 'add-team' || (fault.child ?? 0) === teamCalls - 1)
      if (hit && fault.mode === 'hang') return await new Promise<never>(() => undefined)
      if (hit && fault.mode === 'garbage') return { status: 502, body: undefined }
      if (hit && fault.mode === 'refuse') return { status: 200, body: { ok: false, error: `${step} refused by host` } }
      const lie = hit && fault.mode === 'no-effect'
      switch (step) {
        case 'create': if (!lie) state.teams.push(b.name); return { status: 200, body: { ok: true, name: b.name, created: !lie, teams: state.teams } }
        case 'set-root': if (!lie) state.roots.push(b.name); return { status: 200, body: { ok: true, roots: state.roots, children: [] } }
        case 'add-router': if (!lie) state.members.push(b.id); return { status: 200, body: { ok: true, members: state.members, teams: state.teams } }
        case 'register': if (!lie) state.registered.push({ id: 'beef0001', canvas: b.canvas, router: b.router }); return { status: 200, body: { ok: true, id: 'beef0001' } }
        case 'read': return { status: 200, body: { teams: state.registered } }
        default: if (!lie) state.children.push({ ref: b.team }); return { status: 200, body: { ok: true, roots: state.roots, children: state.children } }
      }
    }),
  }
  return { io, calls, state }
}
const plan = { name: 'HQ', router: 's-router', children: [{ frame: 'A', ref: ref('A') }, { frame: 'B', ref: ref('B') }] }

describe('composeRoot: strict order, each effect read back, the first stop is final', () => {
  it('runs create(requireNew) → set-root → router → register (read back) → add-team per child', async () => {
    const host = fakeHost()
    const out = await composeRoot({ io: host.io }, plan)
    expect(out.ok).toBe(true)
    expect(host.calls).toEqual(['create', 'set-root', 'add-router', 'register', 'read', `add-team:${ref('A')}`, `add-team:${ref('B')}`])
    expect((host.io.call as any).mock.calls[0][1]).toEqual({ action: 'create', name: 'HQ', requireNew: true })
  })
  const steps: Array<[StepName, number | undefined, string]> = [['create', undefined, 'HQ'], ['set-root', undefined, 'HQ'], ['add-router', undefined, 'HQ'], ['register', undefined, 'HQ'], ['add-team', 0, 'A'], ['add-team', 1, 'B']]
  for (const mode of ['refuse', 'hang', 'garbage', 'no-effect'] as const) {
    for (const [step, child, frame] of steps) {
      it(`${step}${child !== undefined ? `#${String(child)}` : ''} ${mode}: later steps never run, the reason sits on ${frame}`, async () => {
        const host = fakeHost({ step, ...(child !== undefined ? { child } : {}), mode })
        const out = await composeRoot({ io: host.io, timeoutMs: 20 }, plan)
        expect(out.ok).toBe(false)
        if (out.ok) return
        expect(out.failed.step).toBe(step)
        expect(out.failed.frame).toBe(frame)
        expect(out.failed.kind).toBe(mode === 'refuse' ? 'refused' : 'unknown')
        expect(out.failed.reason).toMatch(mode === 'refuse' ? /refused by host/ : mode === 'hang' ? /没有回音/ : mode === 'garbage' ? /不是可读的 JSON/ : /回读看不到效果/)
        const order = ['create', 'set-root', 'add-router', 'register']
        const reached = step === 'add-team' ? 4 + (child ?? 0) : order.indexOf(step)
        expect(out.done).toHaveLength(reached)
        // Nothing after the stop, and nothing undone: no remove/unset call ever.
        const last = host.calls.at(-1)!
        expect(last.startsWith(step === 'register' && mode === 'no-effect' ? 'read' : step)).toBe(true)
        expect(host.calls.some(c => c.includes('remove'))).toBe(false)
      })
    }
  }
})

// ── the board ──
const boardInput: PlanningInput = {
  sessions,
  teams: [team('A', { members: [{ id: 's1' }] }), team('B', { members: [{ id: 's2' }] })],
  peerCount: 0,
}
const views: ReturnType<typeof createPlanningView>[] = []
afterEach(() => { for (const view of views.splice(0)) view.destroy(); document.body.replaceChildren() })
function board(io: ComposeIo) {
  const onDirty = vi.fn(), onCanvasAction = vi.fn(async () => true)
  const view = createPlanningView({ onDirty, onLampClick: vi.fn(), onCanvasAction, viewSize: () => ({ w: 1000, h: 700 }), compose: io })
  views.push(view); document.body.append(view.root); view.reconcile(boardInput)
  const head = (name: string) => view.root.querySelector<HTMLElement>(`.p-frame-head[data-frame="${name}"]`)!
  const frame = (name: string) => head(name).closest<HTMLElement>('.p-frame')!
  const press = (el: HTMLElement, shiftKey = false) => { for (const type of ['pointerdown', 'pointerup']) el.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, shiftKey, clientX: 20, clientY: 20 })) }
  const key = (el: HTMLElement, value: string, shiftKey = false) => el.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, shiftKey }))
  const dialog = () => view.root.querySelector<HTMLElement>('.p-root-compose')
  const fill = (name: string) => {
    const d = dialog()!
    d.querySelector<HTMLInputElement>('input')!.value = name
    d.querySelector<HTMLSelectElement>('select')!.value = 's-router'
    return Array.from(d.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent === '组成')!
  }
  return { view, head, frame, press, key, dialog, fill, onDirty, onCanvasAction }
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

describe('the board: two selected frames + G compose a root', () => {
  it('Shift-click two frames, G opens 组成 root 团队 (not the session team dialog), and it writes in order', async () => {
    const host = fakeHost()
    const b = board(host.io)
    b.press(b.head('A')); b.press(b.head('B'), true)
    b.key(b.view.root, 'g')
    expect(b.dialog()?.querySelector('.p-dialog-title')?.textContent).toBe('组成 root 团队（2 个子团队）')
    expect(Array.from(b.dialog()!.querySelectorAll('li')).map(li => li.textContent)).toEqual(['A', 'B'])
    expect(b.view.root.querySelectorAll('.p-dialog').length).toBe(1)
    expect(Array.from(b.dialog()!.querySelectorAll('option')).map(o => o.value)).toEqual(['', 's-router'])
    b.fill('HQ').click()
    await vi.waitFor(() => expect(b.dialog()).toBeNull())
    expect(host.calls).toEqual(['create', 'set-root', 'add-router', 'register', 'read', `add-team:${ref('A')}`, `add-team:${ref('B')}`])
    expect(b.onCanvasAction).not.toHaveBeenCalled()
  })
  it('keyboard path: Shift+Space on two frame heads, then G; Escape before any write closes with nothing sent', () => {
    const host = fakeHost()
    const b = board(host.io)
    b.head('A').focus(); b.key(b.head('A'), ' ', true)
    b.head('B').focus(); b.key(b.head('B'), ' ', true)
    b.key(b.head('B'), 'G')
    expect(b.dialog()).not.toBeNull()
    expect(document.activeElement).toBe(b.dialog()!.querySelector('input'))
    b.key(b.dialog()!.querySelector('input')!, 'Escape')
    expect(b.dialog()).toBeNull()
    expect(host.calls).toEqual([])
  })
  it('one selected frame keeps the old session-team path', () => {
    const b = board(fakeHost().io)
    b.press(b.head('A'))
    b.key(b.view.root, 'g')
    expect(b.dialog()).toBeNull()
  })
  it('a refused add-team stops the chain and writes the reason on that child frame; the dialog keeps the confirmed steps', async () => {
    const host = fakeHost({ step: 'add-team', child: 1, mode: 'refuse' })
    const b = board(host.io)
    b.press(b.head('A')); b.press(b.head('B'), true)
    b.key(b.view.root, 'g')
    b.fill('HQ').click()
    await vi.waitFor(() => expect(b.frame('B').querySelector('.p-root-compose-err')).not.toBeNull())
    expect(b.frame('B').querySelector('.p-root-compose-err .msg')?.textContent).toContain('add-team refused by host')
    expect(b.frame('A').querySelector('.p-root-compose-err')).toBeNull()
    expect(b.dialog()?.querySelector('.p-dialog-err')?.textContent).toContain('已完成的 5 步保留不动')
    expect(Array.from(b.dialog()!.querySelectorAll('.p-root-compose-progress li')).map(li => li.textContent)).toHaveLength(6)
    expect(host.calls.filter(c => c.startsWith('add-team'))).toHaveLength(2)
  })
  it('a selected frame that cannot be a child: the reason before any write, on the dialog and on that frame', () => {
    const host = fakeHost()
    const b = board(host.io)
    b.view.reconcile({ ...boardInput, teams: [team('A', { members: [{ id: 's1' }] }), team('B', { members: [{ id: 's2' }], superagentTeam: undefined })] })
    b.press(b.head('A')); b.press(b.head('B'), true)
    b.key(b.view.root, 'g')
    expect(b.dialog()?.querySelector('.p-dialog-err')?.textContent).toContain('「B」不是接单的 superagent 团队')
    expect(b.frame('B').querySelector('.p-root-compose-err .msg')?.textContent).toContain('不是接单的 superagent 团队')
    expect(Array.from(b.dialog()!.querySelectorAll<HTMLButtonElement>('button')).find(x => x.textContent === '组成')!.disabled).toBe(true)
    expect(host.calls).toEqual([])
  })
  it('a double submit writes once', async () => {
    let release: () => void = () => undefined
    const host = fakeHost()
    const slow: ComposeIo = { call: async (path, body) => { if ((body as any)?.action === 'create') await new Promise<void>(r => { release = r }); return await host.io.call(path, body) } }
    const b = board(slow)
    b.press(b.head('A')); b.press(b.head('B'), true)
    b.key(b.view.root, 'g')
    const ok = b.fill('HQ')
    ok.click(); ok.click()
    b.key(b.dialog()!.querySelector('input')!, 'Enter')
    b.key(b.view.root, 'g')
    await settle(); release()
    await vi.waitFor(() => expect(b.dialog()).toBeNull())
    expect(host.calls.filter(c => c === 'create')).toHaveLength(1)
  })
  it('a Shift press on a selected frame head deselects it and never drags it (no layout write)', () => {
    const b = board(fakeHost().io)
    b.press(b.head('A')); b.press(b.head('B'), true)
    const before = b.view.snapshotDoc()
    const head = b.head('B')
    head.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, shiftKey: true, clientX: 20, clientY: 20 }))
    head.dispatchEvent(new MouseEvent('pointermove', { button: 0, bubbles: true, shiftKey: true, clientX: 220, clientY: 220 }))
    head.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true, shiftKey: true, clientX: 220, clientY: 220 }))
    expect(b.frame('B').classList.contains('selected')).toBe(false)
    expect(b.view.snapshotDoc()).toEqual(before)
    expect(b.onDirty).not.toHaveBeenCalled()
  })
  it('the frame menu offers 加入 root「R」 for a superagent frame and confirms the child from the reply', async () => {
    const host = fakeHost()
    const b = board(host.io)
    b.view.reconcile({ ...boardInput, teams: [...boardInput.teams, team('R', { root: true, children: [] })] })
    b.head('A').focus(); b.key(b.head('A'), 'Enter')
    const item = Array.from(b.view.root.querySelectorAll<HTMLButtonElement>('.p-menu [role=menuitem]')).find(x => x.textContent === '加入 root「R」')
    expect(item?.disabled).toBe(false)
    item!.click()
    await vi.waitFor(() => expect(host.calls).toEqual([`add-team:${ref('A')}`]))
  })
})
