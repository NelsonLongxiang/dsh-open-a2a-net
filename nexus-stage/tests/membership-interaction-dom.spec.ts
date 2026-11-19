// @vitest-environment jsdom
/** .157 feedback: the production poll must not erase an in-progress membership gesture. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlanningView, type PlanningInput } from '../src/planning-view'
import { createWorkbench, type WorkbenchDeps, type StateBody } from '../src/workbench'
import { SESSION_DRAG_TYPE } from '../src/session-drag'

const cleanup: Array<() => void> = []
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); document.body.replaceChildren() })
const node = { id: 'session-new', label: 'member', name: '产品开发与运营', team: 'dsh/new', joined: true, live: true }
const input: PlanningInput = { sessions: [node], teams: [{ name: '综合部门组', team: 'dsh/canvas/group', members: [] }], peerCount: 0 }
function board() {
  const actions: unknown[] = []
  const v = createPlanningView({ onDirty() {}, onLampClick() {}, onCanvasAction: async a => { actions.push(a); return true }, viewSize: () => ({ w: 1000, h: 800 }) })
  document.body.appendChild(v.root); cleanup.push(() => v.destroy()); v.reconcile(input)
  const trigger = [...v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button')].find(b => b.textContent === '节点')!
  trigger.click()
  return { v, actions }
}
function transfer() {
  const data: Record<string, string> = {}
  return { types: Object.keys(data), setData: (k: string, v: string) => { data[k] = v }, getData: (k: string) => data[k] ?? '', effectAllowed: 'all', dropEffect: 'none' }
}
function drag(type: string, dataTransfer = transfer()) {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer })
}
function workbench(overrides: Partial<WorkbenchDeps> = {}) {
  const canvasOp = vi.fn(async () => false)
  const v = createWorkbench({ now: () => 1700000000000, abandon: async () => true, copy() {}, canvasOp, ...overrides })
  document.body.appendChild(v.root)
  const members = Array.from({ length: 12 }, (_, n) => ({ id: 'old-' + n, joined: true, live: true }))
  const state: StateBody = { sessions: [node], canvas: { teams: [{ name: '综合部门组', team: 'dsh/canvas/group', members }] } }
  v.update(state)
  const label = [...v.root.querySelectorAll<HTMLElement>('.wb-item-label')].find(b => b.textContent === '综合部门组')!
  label.click()
  return { v, state, canvasOp, form: v.root.querySelector<HTMLFormElement>('.wb-inspector .wb-member-add')! }
}

describe('membership interaction survives the production refresh seams', () => {
  it('puts toolbar and live status in the same responsive HUD instead of overlapping absolute controls', () => {
    const { v } = board()
    const hud = v.root.querySelector('.p-hud')!
    expect(hud.querySelector('.p-toolbar')).not.toBeNull()
    expect(hud.querySelector('.p-status')).not.toBeNull()
    expect(hud.children).toHaveLength(2)
  })

  it('keeps the drawer entry button stable before the join submenu opens on unchanged polls', () => {
    const { v } = board()
    const panel = v.root.querySelector('.p-nodelist')!
    const button = [...panel.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '入队▸')!
    v.reconcile({ ...input }); v.reconcile({ ...input })
    expect(button.isConnected).toBe(true)
    expect([...panel.querySelectorAll('button')].find(b => b.textContent === '入队▸')).toBe(button)
  })

  it('an open 入队 menu and its selected button survive multiple polls and still dispatch once', async () => {
    const { v, actions } = board()
    const join = [...v.root.querySelectorAll<HTMLButtonElement>('.p-nodelist button')].find(b => b.textContent === '入队▸')!
    join.click()
    const menu = v.root.querySelector<HTMLElement>('[aria-label="加入团队"]')!
    const choice = [...menu.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '综合部门组')!
    choice.focus()
    v.reconcile({ ...input, sessions: [{ ...node, name: '产品开发与运营（更新）' }] }); v.reconcile(input)
    expect(menu.isConnected).toBe(true)
    expect(v.root.querySelector('[aria-label="加入团队"]')).toBe(menu)
    expect(document.activeElement).toBe(choice)
    choice.click()
    await vi.waitFor(() => expect(actions).toEqual([{ type: 'add-member', team: '综合部门组', ids: [node.id] }]))
  })

  it.each(['target removed', 'source left'])('does not add a stale open-menu choice when %s', reason => {
    const { v, actions } = board()
    ;[...v.root.querySelectorAll<HTMLButtonElement>('.p-nodelist button')].find(b => b.textContent === '入队▸')!.click()
    const choice = [...v.root.querySelectorAll<HTMLButtonElement>('[aria-label="加入团队"] button')].find(b => b.textContent === '综合部门组')!
    v.reconcile(reason === 'target removed' ? { ...input, teams: [] } : { ...input, sessions: [{ ...node, joined: false }] })
    choice.click()
    expect(actions).toEqual([])
  })

  it('the toolbar local joined row carries the same private drag contract and survives a poll mid-drag', () => {
    const { v } = board()
    const row = [...v.root.querySelectorAll<HTMLElement>('.p-noderow')].find(r => r.textContent?.includes(node.name))!
    expect(row.draggable).toBe(true)
    const start = drag('dragstart'); row.dispatchEvent(start)
    expect((start as unknown as DragEvent).dataTransfer!.getData(SESSION_DRAG_TYPE)).toBe(node.id)
    v.reconcile({ ...input, sessions: [{ ...node, name: '更新后的席位' }] })
    expect(row.isConnected).toBe(true)
    row.dispatchEvent(drag('dragend'))
  })

  it('directory drag source stays connected through state and asynchronous log polls, then catches up', async () => {
    let finish!: (value: { ok: boolean; sessions: never[] }) => void
    const { v, state } = workbench({ sessionLogList: () => new Promise(resolve => { finish = resolve }) })
    const source = [...v.root.querySelectorAll<HTMLElement>('.wb-item')].find(r => r.title.startsWith(node.id))!
    source.dispatchEvent(drag('dragstart'))
    v.update({ ...state, sessions: [{ ...node, name: '目录新名称' }] })
    finish({ ok: true, sessions: [] }); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(source.isConnected).toBe(true)
    source.dispatchEvent(drag('dragend')); await Promise.resolve()
    expect(v.root.querySelector('.wb-dir-group')?.textContent).toContain('目录新名称')
  })

  it('keeps directory buttons and their label DOM connected across normal state and log polls', () => {
    const { v, state } = workbench()
    const local = [...v.root.querySelectorAll<HTMLButtonElement>('.wb-item')].find(row => row.title.startsWith(node.id))!
    const label = local.querySelector('.wb-item-label')!
    const team = [...v.root.querySelectorAll<HTMLButtonElement>('.wb-item')].find(row => row.title === 'dsh/canvas/group')!
    local.focus()
    v.update({ ...state, sessions: [{ ...node, name: '最新名称' }] })
    expect(local.isConnected).toBe(true)
    expect(label.isConnected).toBe(true)
    expect(label.textContent).toBe('最新名称')
    expect(team.isConnected).toBe(true)
    expect(document.activeElement).toBe(local)
  })

  it('does not let the board steal pointerdown from native drawer drag rows', () => {
    const { v } = board()
    const row = [...v.root.querySelectorAll<HTMLElement>('.p-noderow')].find(row => row.textContent?.includes(node.name))!
    const event = Object.assign(new Event('pointerdown', { bubbles: true, cancelable: true }), { button: 0, clientX: 80, clientY: 120, pointerId: 71 })
    row.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('places add-member controls before a long member list', () => {
    const { v, form } = workbench()
    const first = v.root.querySelector('.wb-inspector .wb-member-row')!
    expect(form.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the form, select and focus connected across a poll rather than detach/remount', () => {
    const { v, state, form } = workbench()
    const pick = form.querySelector<HTMLSelectElement>('select')!
    pick.value = node.id; pick.focus()
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver(rows => mutations.push(...rows))
    observer.observe(form, { subtree: true, childList: true })
    v.update({ ...state }); mutations.push(...observer.takeRecords()); observer.disconnect()
    expect(form.isConnected).toBe(true)
    expect(document.activeElement).toBe(pick)
    expect(pick.value).toBe(node.id)
    expect(mutations.some(m => m.target === pick && m.removedNodes.length > 0)).toBe(false)
  })

  it('does not remount the form between native focusout and the submit click', async () => {
    const { v, form } = workbench()
    const pick = form.querySelector<HTMLSelectElement>('select')!
    pick.value = node.id; pick.focus()
    const body = v.root.querySelector('.wb-inspector-body')!
    const card = form.closest('.wb-card')!
    const changes: MutationRecord[] = []
    const observer = new MutationObserver(rows => changes.push(...rows))
    observer.observe(body, { childList: true, subtree: true })
    pick.blur()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    changes.push(...observer.takeRecords()); observer.disconnect()
    expect(changes.some(change => Array.from(change.removedNodes).some(removed => removed === form || removed === card))).toBe(false)
    expect(form.isConnected).toBe(true)
    expect(pick.value).toBe(node.id)
  })

  it('shows failure in the form across polls, keeps the draft, and does not duplicate an in-flight request', async () => {
    let resolve!: (ok: boolean) => void
    const send = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
    const { v, state, form } = workbench({ canvasOp: send })
    const manual = form.querySelector<HTMLInputElement>('input')!
    manual.value = 'peer/needed'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(send).toHaveBeenCalledTimes(1)
    v.update(state)
    expect(form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true)
    resolve(false)
    await vi.waitFor(() => expect(form.querySelector('[role=alert]')?.textContent).toContain('失败'))
    v.update(state)
    expect(v.root.querySelector('.wb-inspector [role=alert]')?.textContent).toContain('失败')
    expect(manual.value).toBe('peer/needed')
    expect(form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false)
  })

  it('keeps a backend denial verbatim as text and re-enables retry', async () => {
    const send = vi.fn(async () => ({ ok: false, error: '<b>来源未确认</b>' }))
    const { form } = workbench({ canvasOp: send as unknown as WorkbenchDeps['canvasOp'] })
    form.querySelector<HTMLSelectElement>('select')!.value = node.id
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(form.querySelector('[role=alert]')?.textContent).toContain('<b>来源未确认</b>'))
    expect(form.querySelector('b')).toBeNull()
    expect(form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false)
  })
})
