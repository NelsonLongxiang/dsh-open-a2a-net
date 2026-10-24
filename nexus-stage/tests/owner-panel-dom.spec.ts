// @vitest-environment jsdom
/**
 * gh#34 owner three-key panel: the header gear opens the inspector with the
 * three unlock knobs; the precision note is part of the contract (closing
 * teamScopeInfo NEVER unlocks communication admission).
 */
import { describe, expect, it, vi } from 'vitest'
import { createWorkbench, type StateBody } from '../src/workbench.ts'

const NOW = 72_400

function bench(owner?: { read: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> }) {
  const read = owner?.read ?? vi.fn(async () => ({ ok: true, teamJoinAllowlist: ['dsh/review-gate'], teamScopeInfo: true, announce: false, announceRestartPending: false }))
  const write = owner?.write ?? vi.fn(async () => ({ ok: true }))
  const v = createWorkbench({
    now: () => NOW,
    abandon: vi.fn(async () => true),
    copy: vi.fn(),
    canvasOp: vi.fn(async () => true),
    ownerSettingsRead: read,
    ownerSettingsWrite: write,
  })
  document.body.appendChild(v.root)
  return { v, read, write }
}

const state: StateBody = { version: '0.6.26' }

describe('gh#34 owner three-key panel', () => {
  it('the gear opens the panel with the three controls and the precision note', async () => {
    const { v, read } = bench()
    v.update(state)
    const gear = v.root.querySelector<HTMLElement>('[data-testid="wb-owner-btn"]')!
    gear.click()
    await vi.waitFor(() => expect(read).toHaveBeenCalled())
    await vi.waitFor(() => {
      const panel = v.root.querySelector('.wb-inspector')
      expect(panel?.classList.contains('is-open')).toBe(true)
      expect(panel?.textContent).toContain('入网白名单')
      expect(panel?.textContent).toContain('dsh/review-gate')
      expect(panel?.textContent).toContain('目录可见性')
      expect(panel?.textContent).toContain('节点发布')
      // ② Precision note: closing teamScopeInfo does NOT unlock admission.
      expect(panel?.textContent).toContain('不会解锁任何通信准入')
    })
  })

  it('adding an exact team name posts the full list; removing posts the filtered list', async () => {
    const write = vi.fn(async () => ({ ok: true }))
    // Stateful read: reflects the last written list so the re-render after
    // each write sees the updated panel state (the real host does this).
    let current: string[] = ['dsh/review-gate']
    const read = vi.fn(async () => ({ ok: true, teamJoinAllowlist: current, teamScopeInfo: true, announce: false }))
    write.mockImplementation(async (changes: { teamJoinAllowlist?: string[] }) => {
      if (changes.teamJoinAllowlist !== undefined) current = [...changes.teamJoinAllowlist]
      return { ok: true }
    })
    const { v } = bench({ read, write })
    v.update(state)
    v.root.querySelector<HTMLElement>('[data-testid="wb-owner-btn"]')!.click()
    await vi.waitFor(() => expect(v.root.querySelector('.wb-inspector')?.textContent).toContain('dsh/review-gate'))
    const input = v.root.querySelector<HTMLInputElement>('.wb-member-manual')!
    input.value = 'dsh/new-team'
    const addBtn = [...v.root.querySelectorAll<HTMLButtonElement>('.wb-member-submit')].find(b => b.textContent === '加入')!
    addBtn.click()
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith({ teamJoinAllowlist: ['dsh/review-gate', 'dsh/new-team'] }))
    await vi.waitFor(() => expect(v.root.querySelector('.wb-inspector')?.textContent).toContain('dsh/new-team'))
    const del = [...v.root.querySelectorAll<HTMLButtonElement>('.wb-member-remove')][0]!
    del.click()
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith({ teamJoinAllowlist: ['dsh/new-team'] }))
  })

  it('announce OFF shows the restart note; a write is posted on toggle', async () => {
    const write = vi.fn(async () => ({ ok: true }))
    const { v } = bench({ read: vi.fn(async () => ({ ok: true, teamJoinAllowlist: [], teamScopeInfo: true, announce: false, announceRestartPending: true })), write })
    v.update(state)
    v.root.querySelector<HTMLElement>('[data-testid="wb-owner-btn"]')!.click()
    await vi.waitFor(() => expect(v.root.querySelector('.wb-inspector')?.textContent).toContain('重启宿主后生效'))
    const anBtn = [...v.root.querySelectorAll<HTMLButtonElement>('.wb-member-submit')].find(b => b.textContent?.includes('本节点不发布'))!
    anBtn.click()
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith({ announce: true }))
  })

  it('an absent owner face (old host) degrades with a note, no controls', async () => {
    const v = createWorkbench({ now: () => NOW, abandon: vi.fn(async () => true), copy: vi.fn(), canvasOp: vi.fn(async () => true) })
    document.body.appendChild(v.root)
    v.update(state)
    v.root.querySelector<HTMLElement>('[data-testid="wb-owner-btn"]')!.click()
    await vi.waitFor(() => expect(v.root.querySelector('.wb-inspector')?.textContent).toContain('未提供主人设置面'))
  })
})
