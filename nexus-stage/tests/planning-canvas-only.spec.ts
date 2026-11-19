// @vitest-environment jsdom
/** F7: retired roster creation must not be reachable from visible canvas-only keyboard controls. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPlanningView } from '../src/planning-view'
const clean: Array<() => void> = []
beforeEach(() => vi.stubGlobal('fetch', () => { throw Error('Synthetic canvas-only test forbids network') }))
afterEach(() => { clean.splice(0).reverse().forEach(fn => fn()); vi.unstubAllGlobals(); document.body.replaceChildren() })
const session = { id: 'session-review', label: 'Review', team: 'test/aaaaaaaa', joined: true, live: true }
function open() {
 const actions: unknown[] = []
 const v = createPlanningView({ onDirty() {}, onLampClick() {}, onCanvasAction: async action => { actions.push(action); return false }, viewSize: () => ({ w: 1000, h: 800 }) })
 document.body.append(v.root); clean.push(() => v.destroy())
 const input = { sessions: [session], teams: [], peerCount: 0 }; v.reconcile(input)
 Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-toolbar button')).find(b => b.textContent === '节点')!.click()
 Array.from(v.root.querySelectorAll<HTMLButtonElement>('.p-nodelist button')).find(b => b.textContent === '入队▸')!.click()
 Array.from(v.root.querySelectorAll<HTMLButtonElement>('[aria-label=加入团队] button')).find(b => b.textContent === '新团队…')!.click()
 const group = v.root.querySelector<HTMLElement>('.p-dialog-kind')!, radio = group.querySelector<HTMLButtonElement>('button[data-kind=canvas]')!, name = v.root.querySelector<HTMLInputElement>('.p-dialog-input')!
 expect(group.querySelectorAll('[role=radio]')).toHaveLength(1); expect(radio.getAttribute('aria-checked')).toBe('true'); expect(radio.tabIndex).toBe(0)
 return { v, input, actions, group, radio, name }
}
function key(el: HTMLElement, value: string, shiftKey = false) { const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }); el.dispatchEvent(event); return event }
function confirm(v: ReturnType<typeof open>, how: 'enter' | 'click') {
 v.name.value = 'OnlyCanvas'
 if (how === 'enter') key(v.name, 'Enter')
 else Array.from(v.v.root.querySelectorAll<HTMLButtonElement>('.p-dialog button')).find(b => b.textContent === '组建')!.click()
}
for (const direction of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
 it.each(['enter', 'click'] as const)('F7 '+direction+' keeps the sole canvas radio checked and confirms canvas by %s', async how => {
  const v = open(); v.radio.focus(); expect(document.activeElement).toBe(v.radio)
  expect(key(v.radio, direction).defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(v.radio); expect(v.radio.getAttribute('aria-checked')).toBe('true'); expect(v.radio.tabIndex).toBe(0)
  expect(v.group.querySelectorAll('[aria-checked=true]')).toHaveLength(1)
  expect(v.v.root.querySelector('.p-dialog-hint')?.textContent).toContain('canvas')
  expect(v.v.root.querySelector('.p-dialog-hint')?.textContent).not.toContain('roster')
  confirm(v, how); await Promise.resolve()
  expect(v.actions).toEqual([{ type: 'create-team', name: 'OnlyCanvas', ids: [session.id], created: true }])
 })
}
it.each(['enter', 'click'] as const)('default confirms canvas by %s without hidden state', async how => {
 const v = open(); confirm(v, how); await Promise.resolve()
 expect(v.actions).toEqual([{ type: 'create-team', name: 'OnlyCanvas', ids: [session.id], created: true }])
})
it.each([false, true])('Tab traversal (shift=%s) keeps focus inside the dialog and confirms canvas', async shift => {
 const v = open(); v.radio.focus()
 const focusables = Array.from(v.v.root.querySelectorAll<HTMLElement>('.p-dialog-panel input,.p-dialog-panel select,.p-dialog-panel button:not([tabindex="-1"])'))
 expect(focusables).toHaveLength(4)
 for (let n = 0; n < focusables.length * 2; n++) { expect(key(document.activeElement as HTMLElement, 'Tab', shift).defaultPrevented).toBe(true); expect(focusables).toContain(document.activeElement) }
 expect(document.activeElement).toBe(v.radio); expect(v.radio.getAttribute('aria-checked')).toBe('true')
 confirm(v, 'enter'); await Promise.resolve()
 expect(v.actions).toEqual([{ type: 'create-team', name: 'OnlyCanvas', ids: [session.id], created: true }])
})
it('arrows still preserve F5 final local-source recheck and the dialog draft', async () => {
 const v = open(); v.radio.focus(); key(v.radio, 'ArrowRight'); v.name.value = 'KeepDraft'
 v.v.reconcile({ ...v.input, sessions: [{ ...session, joined: false }] }); key(v.name, 'Enter'); await Promise.resolve()
 expect(v.actions).toEqual([]); expect(v.name.isConnected).toBe(true); expect(v.name.value).toBe('KeepDraft'); expect(v.v.root.querySelector('.p-dialog-err')?.textContent).toContain('重新选择')
 expect(v.radio.getAttribute('aria-checked')).toBe('true')
})
it('reserved roster names remain rejected without emitting retired create or add', async () => {
 const v = open(); v.name.value = 'roster:Retired'; key(v.name, 'Enter'); await Promise.resolve()
 expect(v.actions).toEqual([]); expect(v.name.isConnected).toBe(true); expect(v.v.root.querySelector('.p-dialog-err')?.textContent).not.toBe('')
})
