// @vitest-environment jsdom
/**
 * Production feedback 2026-11-14: the 协作提示 chip — tolerant parsing of /state scopeHints, the sentence and the
 * one-click actions per hint (add to each local canvas that holds a joined local side; join an unjoined local first).
 */
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { createScopeHintsChip, describeScopeHint, parseScopeHints } from '../src/scope-hints-chip'

const hint = {
  peer: 'http://peer-b.test:13080', peerCanvas: 'dsh/canvas/生产服务组', remote: 'dsh/e91be1aa', memberRef: 'dsh/e91be1aa@4b196d25', name: '服务器运维',
  local: [{ id: 'session-446ce672', handle: 'dsh/446ce672', joined: true, canvases: ['基础设施组'] }, { id: 'session-11112222', handle: 'dsh/11112222', joined: false, canvases: [] }],
}

describe('scope hints chip', () => {
  it('parses well-formed hints and drops malformed ones (older host: none)', () => {
    expect(parseScopeHints(undefined)).toEqual([])
    expect(parseScopeHints([null, { peer: 'x' }, { ...hint, local: [] }, hint])).toEqual([hint])
  })

  it('offers the key-pinned add per local canvas and a join for an unjoined local', () => {
    const { text, actions } = describeScopeHint(hint)
    expect(text).toContain('服务器运维（dsh/e91be1aa）')
    expect(text).toContain('「生产服务组」')
    expect(text).toContain('peer-b.test:13080')
    expect(actions).toEqual([
      { kind: 'add', canvas: '基础设施组', ref: 'dsh/e91be1aa@4b196d25', label: '加入本机「基础设施组」' },
      { kind: 'join', id: 'session-11112222', label: '先让 dsh/11112222 入网' },
    ])
  })

  it('falls back to the bare handle when the card gave no key-pinned ref, and offers nothing without a local canvas', () => {
    const bare = { ...hint, memberRef: undefined, local: [{ id: 'session-446ce672', handle: 'dsh/446ce672', joined: true, canvases: [] }] }
    expect(describeScopeHint(bare).actions).toEqual([])
    const withCanvas = { ...bare, local: [{ ...bare.local[0]!, canvases: ['基础设施组'] }] }
    expect(describeScopeHint(withCanvas).actions[0]).toMatchObject({ kind: 'add', ref: 'dsh/e91be1aa' })
  })

  it('renders a hidden chip until there are hints; a click opens the menu and a button runs the owner write', async () => {
    const addMember = vi.fn(async () => true), joinNetwork = vi.fn(async () => true), notice = vi.fn()
    const root = document.createElement('div'); root.id = 'dsh-plan'; document.body.appendChild(root)
    const chip = createScopeHintsChip({ addMember, joinNetwork, notice })
    root.appendChild(chip.el)
    chip.update([])
    expect(chip.el.hidden).toBe(true)
    chip.update([hint])
    expect(chip.el.hidden).toBe(false)
    expect(chip.el.textContent).toBe('协作提示(1)')
    chip.el.click()
    const buttons = [...root.querySelectorAll('.p-hintmenu [role=menuitem]')] as HTMLButtonElement[]
    expect(buttons.map(b => b.textContent)).toEqual(['加入本机「基础设施组」', '先让 dsh/11112222 入网'])
    buttons[0]!.click()
    await vi.waitFor(() => expect(notice).toHaveBeenCalledWith('info', expect.stringContaining('已提交')))
    expect(addMember).toHaveBeenCalledWith('基础设施组', 'dsh/e91be1aa@4b196d25')
    expect(root.querySelector('.p-hintmenu')).toBeNull()
    root.remove()
  })
})
