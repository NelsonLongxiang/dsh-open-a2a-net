// @vitest-environment jsdom
// PR737 F1–F5 regressions adopted from 612d91ad exact-ad9e7ce probes; synthetic DOM only.
// Imports and actual selected option binding adapted; original reviewer artifact stays immutable.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkbench } from '../src/workbench'
import { renderDirectory } from '../src/wb-directory'
import { createPlanningView } from '../src/planning-view'
const owned: Array<() => void> = []
beforeEach(() => { vi.stubGlobal('fetch', () => { throw Error('Reviewer forbids network') }) })
afterEach(() => { owned.splice(0).reverse().forEach(fn => fn()); document.body.replaceChildren(); vi.unstubAllGlobals() })
const session = { id: 'session-candidate', label: 'candidate', name: 'Candidate', team: 'dsh/candidate', joined: true, live: true }
const team = { name: 'A', team: 'dsh/canvas/A', members: [] }
function mount(remote: any[] = [], canvasOp: any = vi.fn(async () => ({ ok: false, error: 'synthetic refusal' }))) {
 const v = createWorkbench({ now: () => 1700000000000, abandon: async () => true, copy() {}, canvasOp })
 document.body.appendChild(v.root)
 const state = { sessions: [session], remote, canvas: { teams: [team, { name: 'B', team: 'dsh/canvas/B', members: [] }] } }
 v.update(state)
 const select = (name: string) => Array.from(v.root.querySelectorAll<HTMLElement>('.wb-item-label')).find(row => row.textContent === name)!.click()
 select('A')
 return { v, state, canvasOp, select, form: () => v.root.querySelector<HTMLFormElement>('.wb-inspector .wb-member-add')! }
}
const submit = (form: HTMLFormElement) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function board() {
 const actions: any[] = []
 const v = createPlanningView({ onDirty() {}, onLampClick() {}, onCanvasAction: async a => { actions.push(a); return false }, viewSize: () => ({ w: 1000, h: 800 }) })
 document.body.appendChild(v.root); owned.push(() => v.destroy())
 const input = { sessions: [session], teams: [team], peerCount: 0 }
 v.reconcile(input)
 Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button')).find(b => b.textContent === '节点')!.click()
 return { v, input, actions }
}
describe('independent exact-head counterexamples', () => {
 it('R1 preserves both unqualified same-handle remote sources after the second poll', () => {
  const box = document.createElement('div'); document.body.appendChild(box)
  const state = { remote: [{ team: 'legacy/aaaaaaaa', name: 'Source A', via: 'http://peer-a.test' }, { team: 'legacy/aaaaaaaa', name: 'Source B', via: 'http://peer-b.test' }] }
  const context = { state, logs: [], titles: new Map(), search: '', filter: 'all' as const, now: 0, openChat() {}, selectCanvas() {} }
  renderDirectory(box, context); expect(box.querySelectorAll('.wb-item')).toHaveLength(2)
  renderDirectory(box, context)
  console.log('R1 observed', JSON.stringify(Array.from(box.querySelectorAll('.wb-item')).map(r => r.textContent)))
  expect(box.querySelectorAll('.wb-item')).toHaveLength(2)
 })
 it('R1b preserves bare process rows from two modern hosts on repeated polls', () => {
  const box = document.createElement('div'); document.body.appendChild(box)
  const context = { state: { remote: [{ team: 'dsh', name: 'Host A', via: 'http://peer-a.test' }, { team: 'dsh', name: 'Host B', via: 'http://peer-b.test' }] }, logs: [], titles: new Map(), search: '', filter: 'all' as const, now: 0, openChat() {}, selectCanvas() {} }
  renderDirectory(box, context); expect(box.querySelectorAll('.wb-item')).toHaveLength(2); renderDirectory(box, context)
  console.log('R1b observed', JSON.stringify(Array.from(box.querySelectorAll('.wb-item')).map(r => r.textContent)))
  expect(box.querySelectorAll('.wb-item')).toHaveLength(2)
 })
 it('R2 refuses a focused stale remote option after its source disappears', async () => {
  const remote = { team: 'legacy/aaaaaaaa', memberRef: 'legacy/aaaaaaaa@11111111', name: 'Remote A', via: 'http://peer-a.test' }
  const { v, state, form, canvasOp } = mount([remote]); const f = form(); const pick = f.querySelector<HTMLSelectElement>('select')!
  const chosen = Array.from(pick.options).find(option => option.dataset.member === remote.memberRef)!
  expect(chosen).toBeDefined(); expect(chosen.disabled).toBe(false); pick.value = chosen.value; expect(pick.selectedOptions[0]).toBe(chosen); pick.focus()
  v.update({ ...state, remote: [] }); expect(document.activeElement).toBe(pick)
  submit(f); await tick(); console.log('R2 observed', JSON.stringify(canvasOp.mock.calls))
  expect(canvasOp).not.toHaveBeenCalled()
 })
 it('R2b does not silently rebind a selected remote to another owner at the same endpoint', async () => {
  const remote = { team: 'legacy/aaaaaaaa', memberRef: 'legacy/aaaaaaaa@11111111', name: 'Original Owner', via: 'http://peer-a.test' }
  const { v, state, form, canvasOp } = mount([remote]); const f = form(); const pick = f.querySelector<HTMLSelectElement>('select')!
  const chosen = Array.from(pick.options).find(option => option.dataset.member === remote.memberRef)!
  expect(chosen).toBeDefined(); expect(chosen.disabled).toBe(false); pick.value = chosen.value; expect(pick.selectedOptions[0]).toBe(chosen); pick.focus()
  v.update({ ...state, remote: [{ ...remote, memberRef: 'legacy/aaaaaaaa@22222222', name: 'Different Owner' }] }); submit(f); await tick()
  console.log('R2b observed', JSON.stringify(canvasOp.mock.calls)); expect(canvasOp).not.toHaveBeenCalled()
 })
 it('R3 retains an in-flight guard when switching A to B and back to A', async () => {
  const finish: Array<(v: boolean) => void> = []
  const send = vi.fn(() => new Promise<boolean>(resolve => finish.push(resolve)))
  const { select, form } = mount([], send)
  try {
   form().querySelector<HTMLInputElement>('input')!.value = 'legacy/aaaaaaaa'; submit(form()); expect(send).toHaveBeenCalledTimes(1)
   select('B'); select('A'); form().querySelector<HTMLInputElement>('input')!.value = 'legacy/aaaaaaaa'; submit(form())
   console.log('R3 observed', JSON.stringify(send.mock.calls)); expect(send).toHaveBeenCalledTimes(1)
  } finally { finish.forEach(resolve => resolve(false)); await tick() }
 })
 it('R4 keeps an actively focused host selector connected when poll facts change', () => {
  const { v, input } = board(); const pick = v.root.querySelector<HTMLSelectElement>('.p-nodesel')!; pick.focus()
  v.reconcile({ ...input, sessions: [{ ...session, name: 'Candidate updated' }] })
  console.log('R4 observed', JSON.stringify({ connected: pick.isConnected, focused: document.activeElement === pick }))
  expect(pick.isConnected).toBe(true); expect(document.activeElement).toBe(pick)
 })
 it('R5 rechecks local source membership when the New Team dialog is confirmed', async () => {
  const { v, input, actions } = board()
  Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-nodelist button')).find(b => b.textContent === '入队▸')!.click()
  Array.from(v.root.querySelectorAll<HTMLButtonElement>('[aria-label=加入团队] button')).find(b => b.textContent === '新团队…')!.click()
  v.reconcile({ ...input, sessions: [{ ...session, joined: false }] })
  v.root.querySelector<HTMLInputElement>('.p-dialog-input')!.value = 'BrandNew'
  Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-dialog button')).find(b => b.textContent === '组建')!.click()
  await tick(); console.log('R5 observed', JSON.stringify(actions)); expect(actions).toEqual([])
 })
 it('C1 updates keyed row handlers and removes departed rows', () => {
  const box = document.createElement('div'); document.body.appendChild(box); const seen: any[] = []
  const context = { state: { sessions: [session] }, logs: [], titles: new Map(), search: '', filter: 'all' as const, now: 0, openChat: (v: any) => seen.push(v), selectCanvas() {} }
  renderDirectory(box, context); const original = box.querySelector<HTMLButtonElement>('.wb-item')!
  renderDirectory(box, { ...context, state: { sessions: [{ ...session, name: 'Latest', team: 'dsh/latest' }] } }); original.click()
  expect(seen).toHaveLength(1); expect(seen[0].title).toBe('Latest'); expect(seen[0].team).toBe('dsh/latest')
  renderDirectory(box, { ...context, state: { sessions: [] } }); expect(original.isConnected).toBe(false); expect(box.querySelectorAll('.wb-item')).toHaveLength(0)
 })
 it('C2 refuses a vanished target while preserving the focused form', async () => {
  const { v, state, form, canvasOp } = mount(); const f = form(); const pick = f.querySelector<HTMLSelectElement>('select')!
  pick.value = session.id; pick.focus(); v.update({ ...state, canvas: { teams: [] } }); submit(f); await tick()
  expect(canvasOp).not.toHaveBeenCalled(); expect(f.querySelector('[role=alert]')?.textContent).toContain('已不在当前目录')
 })
 it('C3 blocks repeated submits on the same mounted pending form', async () => {
  let finish!: (ok: boolean) => void; const send = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
  const { form } = mount([], send); const f = form(); f.querySelector<HTMLInputElement>('input')!.value = 'legacy/aaaaaaaa'
  submit(f); submit(f); expect(send).toHaveBeenCalledTimes(1); finish(false); await tick()
 })
})

describe('F1–F5 required-fix boundaries and positive controls', () => {
 it('F1 keeps two sources through reordering, URL normalization, handler refresh, and one-sided removal', () => {
  const box = document.createElement('div'); document.body.appendChild(box)
  const a = { team: 'dsh', name: 'Host A', via: 'http://peer-a.test:80/' }
  const b = { team: 'dsh', name: 'Host B', via: 'http://peer-b.test' }
  const seen: any[] = []
  const context = { state: { remote: [a, b] }, logs: [], titles: new Map(), search: '', filter: 'all' as const, now: 0, openChat: (value: any) => seen.push(value), selectCanvas() {} }
  renderDirectory(box, context)
  const [rowA, rowB] = Array.from(box.querySelectorAll<HTMLButtonElement>('.wb-item'))
  for (let n = 0; n < 3; n++) renderDirectory(box, { ...context, state: { remote: [b, { ...a, name: 'A latest', via: 'http://peer-a.test' }] } })
  expect(Array.from(box.querySelectorAll('.wb-item'))).toEqual([rowB, rowA])
  rowA!.click(); rowB!.click()
  expect(seen.map(v => v.row.via)).toEqual(['http://peer-a.test', 'http://peer-b.test'])
  expect(seen[0].title).toBe('A latest')
  renderDirectory(box, { ...context, state: { remote: [b] } })
  expect(rowA!.isConnected).toBe(false); expect(rowB!.isConnected).toBe(true)
  expect(box.querySelectorAll('.wb-item')).toHaveLength(1)
 })
 it('F1 explicitly keeps duplicate identity rows visible instead of silently coalescing them', () => {
  const box = document.createElement('div'); document.body.appendChild(box)
  const remote = { team: 'dsh/aaaaaaaa', memberRef: 'dsh/aaaaaaaa@11111111', via: 'http://peer-a.test' }
  const context = { state: { remote: [{ ...remote, name: 'Copy A' }, { ...remote, name: 'Copy B' }] }, logs: [], titles: new Map(), search: '', filter: 'all' as const, now: 0, openChat() {}, selectCanvas() {} }
  renderDirectory(box, context); renderDirectory(box, context)
  expect(box.querySelectorAll('.wb-item')).toHaveLength(2)
  expect(Array.from(box.querySelectorAll('.wb-item')).every(row => row.textContent?.includes('目录身份重复'))).toBe(true)
 })
 it('F2 sends the selected qualified member and exact current linked endpoint on unchanged provenance', async () => {
  const remote = { team: 'dsh/aaaaaaaa', memberRef: 'dsh/aaaaaaaa@11111111', via: 'http://peer-a.test:80/', name: 'Verified source' }
  const { v, state, form, canvasOp } = mount([remote]); const f = form(), pick = f.querySelector<HTMLSelectElement>('select')!
  const chosen = Array.from(pick.options).find(o => o.dataset.member === remote.memberRef)!
  expect(chosen.disabled).toBe(false); pick.value = chosen.value; expect(pick.selectedOptions[0]).toBe(chosen); pick.focus()
  v.update({ ...state, remote: [{ ...remote, via: 'http://peer-a.test', name: 'Same owner latest name' }] })
  submit(f)
  await vi.waitFor(() => expect(canvasOp).toHaveBeenCalledWith('add-member', 'A', remote.memberRef, undefined, 'http://peer-a.test'))
  expect(canvasOp).toHaveBeenCalledTimes(1)
 })
 it.each(['endpoint', 'unreachable', 'duplicate'])('F2 refuses an actual focused selection after source %s changes', async reason => {
  const remote = { team: 'dsh/aaaaaaaa', memberRef: 'dsh/aaaaaaaa@11111111', via: 'http://peer-a.test', name: 'Selected owner' }
  const { v, state, form, canvasOp } = mount([remote]); const f = form(), pick = f.querySelector<HTMLSelectElement>('select')!
  const chosen = Array.from(pick.options).find(o => o.dataset.member === remote.memberRef)!
  expect(chosen.disabled).toBe(false); pick.value = chosen.value; expect(pick.selectedOptions[0]).toBe(chosen); pick.focus()
  const changed = reason === 'endpoint' ? [{ ...remote, via: 'http://peer-b.test' }] : reason === 'unreachable' ? [{ ...remote, unreachable: true }] : [remote, { ...remote }]
  v.update({ ...state, remote: changed }); submit(f); await tick()
  expect(canvasOp).not.toHaveBeenCalled()
  expect(f.querySelector('[role=alert]')?.textContent).toContain('请重新选择')
  expect(pick.value).toBe(chosen.value)
 })
 it('F2 disables an ambiguous or unprovable remote choice without disabling valid local/manual paths', () => {
  const remote = { team: 'dsh/aaaaaaaa', memberRef: 'dsh/aaaaaaaa@11111111', via: 'http://peer-a.test' }
  const { form } = mount([remote, { ...remote }, { ...remote, team: 'dsh/bbbbbbbb', memberRef: 'dsh/bbbbbbbb@22222222', via: undefined }])
  const pick = form().querySelector<HTMLSelectElement>('select')!
  expect(Array.from(pick.options).filter(o => o.dataset.remoteSource !== undefined).every(o => o.disabled)).toBe(true)
  expect(Array.from(pick.options).find(o => o.value === session.id)?.disabled).toBe(false)
  expect(form().querySelector<HTMLInputElement>('input')!.disabled).toBe(false)
 })
 it('F3 settles only the original team, restores the current A form, and permits retry after failure', async () => {
  const finishes: Array<(value: boolean) => void> = []
  const send = vi.fn(() => new Promise<boolean>(resolve => finishes.push(resolve)))
  const { select, form } = mount([], send)
  const firstA = form(); firstA.querySelector<HTMLInputElement>('input')!.value = 'peer/aaaaaaaa'; submit(firstA)
  select('B'); select('A')
  const nextA = form(); expect(nextA).not.toBe(firstA)
  expect(nextA.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
  submit(nextA); expect(send).toHaveBeenCalledTimes(1)
  finishes.shift()!(false)
  await vi.waitFor(() => expect(nextA.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false))
  expect(nextA.querySelector('[role=alert]')?.textContent).toContain('添加失败')
  select('B'); expect(form().textContent).not.toContain('添加失败')
  select('A'); expect(form().querySelector('[role=alert]')?.textContent).toContain('添加失败')
  form().querySelector<HTMLInputElement>('input')!.value = 'peer/aaaaaaaa'; submit(form())
  expect(send).toHaveBeenCalledTimes(2)
  finishes.shift()!(false); await tick()
 })
 it('F3 keeps A pending while B has its own request and settles them independently', async () => {
  const finish = new Map<string, (value: boolean) => void>()
  const send = vi.fn((_action: string, name: string) => new Promise<boolean>(resolve => finish.set(name, resolve)))
  const { select, form } = mount([], send)
  form().querySelector<HTMLInputElement>('input')!.value = 'peer/aaaaaaaa'; submit(form())
  select('B'); form().querySelector<HTMLInputElement>('input')!.value = 'peer/bbbbbbbb'; submit(form())
  expect(send).toHaveBeenCalledTimes(2)
  finish.get('A')!(false); await tick()
  expect(form().textContent).not.toContain('添加失败')
  expect(form().querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
  finish.get('B')!(true)
  await vi.waitFor(() => expect(form().querySelector<HTMLButtonElement>('button')!.disabled).toBe(false))
  expect(form().querySelector('[role=status]')?.textContent).toContain('已确认')
  select('A'); expect(form().querySelector('[role=alert]')?.textContent).toContain('添加失败')
 })
 it('F4 preserves the selector and existing host options while hosts are added, selected and removed', () => {
  const { v, input } = board()
  const a = { team: 'dsh/aaaaaaaa', memberRef: 'dsh/aaaaaaaa@11111111', via: 'http://peer-a.test', origin: 'Host A' }
  const b = { team: 'dsh/bbbbbbbb', memberRef: 'dsh/bbbbbbbb@22222222', via: 'http://peer-b.test', origin: 'Host B' }
  v.reconcile({ ...input, remoteTeams: [a] })
  const pick = v.root.querySelector<HTMLSelectElement>('.p-nodesel')!, option = Array.from(pick.options).find(o => o.value === 'peer-a.test')!
  expect(option).toBeDefined(); pick.focus(); pick.value = option.value; pick.dispatchEvent(new Event('change', { bubbles: true }))
  v.reconcile({ ...input, remoteTeams: [a, b], sessions: [{ ...session, name: 'Changed' }] })
  expect(v.root.querySelector('.p-nodesel')).toBe(pick); expect(document.activeElement).toBe(pick)
  expect(Array.from(pick.options).find(o => o.value === option.value)).toBe(option)
  expect(pick.value).toBe('peer-a.test'); expect(Array.from(pick.options).some(o => o.value === 'peer-b.test')).toBe(true)
  v.reconcile({ ...input, remoteTeams: [b] })
  expect(document.activeElement).toBe(pick); expect(pick.value).toBe(''); expect(option.isConnected).toBe(false)
  pick.value = 'peer-b.test'; pick.dispatchEvent(new Event('change', { bubbles: true }))
  expect(pick.value).toBe('peer-b.test'); expect(v.root.querySelector('.p-nodelist-body')!.textContent).toContain('dsh/bbbbbbbb')
 })
 it.each(['left', 'removed'])('F5 keeps the name and dialog, with zero actions when the original local source is %s', async reason => {
  const { v, input, actions } = board()
  Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-nodelist button')).find(b => b.textContent === '入队▸')!.click()
  Array.from(v.root.querySelectorAll<HTMLButtonElement>('[aria-label=加入团队] button')).find(b => b.textContent === '新团队…')!.click()
  const field = v.root.querySelector<HTMLInputElement>('.p-dialog-input')!; field.value = 'KeepThisName'
  v.reconcile({ ...input, sessions: reason === 'left' ? [{ ...session, joined: false }] : [] })
  Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-dialog button')).find(b => b.textContent === '组建')!.click()
  await tick(); expect(actions).toEqual([]); expect(field.isConnected).toBe(true); expect(field.value).toBe('KeepThisName')
  expect(v.root.querySelector('.p-dialog-error')?.textContent ?? v.root.querySelector('.p-dialog')?.textContent).toContain('重新选择')
 })
})
