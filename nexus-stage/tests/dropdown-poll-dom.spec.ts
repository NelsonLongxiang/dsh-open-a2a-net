// @vitest-environment jsdom
/** #802 (owner report 2026-11-22): an open dropdown closed after a moment, because the 3-second poll rebuilt what held it. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkbench, type WorkbenchDeps, type StateBody } from '../src/workbench'

afterEach(() => { document.body.replaceChildren() })
const sessions = [{ id: 'session-11111111-aaaa', label: 'dev', name: '开发席', team: 'dsh/11111111', joined: true, live: true }]
const state: StateBody = { sessions, canvas: { teams: [{ name: '基础设施组', team: 'dsh/canvas/infra', members: [] }] } }
function bench(extra: Partial<WorkbenchDeps> = {}) {
  const v = createWorkbench({ now: () => 1700000000000, abandon: async () => true, copy() {}, canvasOp: vi.fn(async () => true), ...extra })
  document.body.appendChild(v.root)
  v.update(state)
  return v
}
/** Every node removed from under `root` while `fn` runs. */
function removals(root: Element, fn: () => void): Node[] {
  const out: Node[] = []
  const observer = new MutationObserver(rows => { for (const r of rows) out.push(...Array.from(r.removedNodes)) })
  observer.observe(root, { subtree: true, childList: true })
  fn(); for (const r of observer.takeRecords()) out.push(...Array.from(r.removedNodes)); observer.disconnect()
  return out
}

describe('#802: a poll does not close a dropdown the person has open', () => {
  it('the owner panel seat select keeps focus and stays mounted across polls; closing the panel still rebuilds', async () => {
    const v = bench({ ownerSettingsRead: async () => ({ ok: true, seatNames: {}, teamJoinAllowlist: [], teamScopeInfo: true, announce: true }), ownerSettingsWrite: async () => ({ ok: true }) })
    ;(v.root.querySelector('.wb-owner-btn') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(v.root.querySelector('[aria-label="选择命名的本机会话"]')).not.toBeNull())
    const select = v.root.querySelector<HTMLSelectElement>('[aria-label="选择命名的本机会话"]')!
    select.focus()
    const body = v.root.querySelector('.wb-inspector-body')!
    const removed = removals(body, () => { v.update({ ...state }); v.update({ ...state }) })
    expect(removed.some(n => n.contains(select))).toBe(false)
    expect(document.activeElement).toBe(select)
    ;(v.root.querySelector('[aria-label="关闭主人设置"]') as HTMLButtonElement).click()
    expect(select.isConnected).toBe(false)
  })

  it('a typed seat name keeps its input focused across a poll', async () => {
    const v = bench({ ownerSettingsRead: async () => ({ ok: true, seatNames: {}, teamJoinAllowlist: [], teamScopeInfo: true, announce: true }), ownerSettingsWrite: async () => ({ ok: true }) })
    ;(v.root.querySelector('.wb-owner-btn') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(v.root.querySelector('[aria-label="人工席位名"]')).not.toBeNull())
    const input = v.root.querySelector<HTMLInputElement>('[aria-label="人工席位名"]')!
    input.focus(); input.value = '开发'
    v.update({ ...state })
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('开发')
  })

  it('the dispatch target select is not rebuilt by an unchanged poll, nor while it is in use; it catches up after', () => {
    const v = bench()
    const target = v.root.querySelector<HTMLSelectElement>('.wb-draft select')!
    expect(Array.from(target.options).map(o => o.value)).toContain('dsh/canvas/infra')
    expect(removals(target, () => v.update({ ...state }))).toEqual([])
    const more: StateBody = { ...state, canvas: { teams: [...state.canvas!.teams, { name: '新组', team: 'dsh/canvas/new', members: [] }] } }
    target.focus()
    expect(removals(target, () => v.update(more))).toEqual([])
    expect(Array.from(target.options).map(o => o.value)).not.toContain('dsh/canvas/new')
    target.blur()
    v.update(more)
    expect(Array.from(target.options).map(o => o.value)).toContain('dsh/canvas/new')
  })
})
