import { describe, expect, it } from 'vitest'
import { buildChildChip, childChipTitle, childStateText, dropRefusal, inFlightLine } from '../src/planning-root.ts'
import { chipDroppedOutside, dragPreviewText, dropAllowed } from '../src/planning-root-drop.ts'
import type { RootChildRow } from '../src/world.ts'

const child = (over: Partial<RootChildRow> = {}): RootChildRow => ({ ref: 'dsh/canvas/docs@a1b2c3d4', label: '子团队 docs（z@a1b2c3d4）', slots: 3, open: 0, state: 'ready', ...over })

describe('planning-root: chips, badges, edges', () => {
  it('state words, chip title, in-flight line', () => {
    expect(childStateText('ready')).toBe('已就绪')
    expect(childStateText('pending-registration')).toBe('待子团队登记')
    expect(childStateText('unreachable')).toBe('不可达')
    expect(childStateText('full')).toBe('满载')
    expect(childChipTitle(child({ open: 2, slots: 3 }))).toBe('子团队 docs（z@a1b2c3d4） 2/3 已就绪')
    expect(inFlightLine('root', child({ open: 1 }))).toBe('root → 子团队 docs（z@a1b2c3d4）（在办 1）')
  })
  it('builds a chip button with the title as its aria label, textContent only', () => {
    const chip = buildChildChip(document, child(), () => {}, () => {})
    expect(chip.tagName).toBe('BUTTON')
    expect(chip.getAttribute('aria-label')).toBe('子团队 docs（z@a1b2c3d4） 0/3 已就绪')
    expect(chip.textContent).not.toMatch(/</)
  })
})

describe('planning-root: drop refusals in words', () => {
  const root = { name: 'root', root: true as const, children: [child()] }
  it('refuses a root, an existing child, a non-superagent team; allows a fresh superagent team', () => {
    expect(dropRefusal(root, { name: 'other', root: true, superagent: true })).toEqual({ ok: false, reason: '它已是 root 团队（root 只有一层）' })
    expect(dropRefusal(root, { name: 'docs', ref: 'dsh/canvas/docs@a1b2c3d4', superagent: true })).toEqual({ ok: false, reason: '它已是这个 root 的子团队' })
    expect(dropRefusal(root, { name: 'plain', ref: 'dsh/canvas/plain@a1b2c3d4' })).toEqual({ ok: false, reason: '它不是 superagent 团队' })
    expect(dropRefusal(root, { name: 'fresh', ref: 'dsh/canvas/fresh@a1b2c3d4', superagent: true })).toEqual({ ok: true, preview: '加入为子团队' })
  })
  it('the drag preview shows the refusal; a refused drop never proceeds', () => {
    expect(dragPreviewText(root, { name: 'plain', ref: 'dsh/canvas/plain@a1b2c3d4' })).toBe('不能加入：它不是 superagent 团队')
    expect(dropAllowed(root, { name: 'plain', ref: 'dsh/canvas/plain@a1b2c3d4' })).toBe(false)
    expect(dragPreviewText(root, { name: 'fresh', ref: 'dsh/canvas/fresh@a1b2c3d4', superagent: true })).toBe('松开加入为子团队：fresh')
  })
})

describe('planning-root-drop: remove with a confirm, refusal shown on the frame', () => {
  it('a declined confirm removes nothing; a refused removal lands on the frame in words', async () => {
    const errors: Array<[string, string]> = []
    let removed = 0
    const d = {
      addTeam: async () => ({ ok: true }),
      confirmRemove: async () => false,
      removeTeam: async () => { removed += 1; return { ok: false, error: 'a root cannot be its own child' } },
      frameError: (root: string, text: string) => { errors.push([root, text]) },
    }
    await chipDroppedOutside('root', 'dsh/canvas/docs@a1b2c3d4', d)
    expect(removed).toBe(0)
    expect(errors).toEqual([])
    const d2 = { ...d, confirmRemove: async () => true }
    await chipDroppedOutside('root', 'dsh/canvas/docs@a1b2c3d4', d2)
    expect(removed).toBe(1)
    expect(errors).toEqual([['root', 'a root cannot be its own child']])
  })
})
