import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('S3 batch 2: menu and chips wiring (source-level pins)', () => {
  const view = readFileSync(join(root, 'src/planning-view.ts'), 'utf8')
  const menus = readFileSync(join(root, 'src/planning-menus.ts'), 'utf8')

  it('planning-view stays under the M1 cap after the move-out', () => {
    expect(view.split('\n').length).toBeLessThanOrEqual(1507)
  })

  it('the frame menu offers 设为根团队 / 取消根团队 via set-root', () => {
    expect(menus).toContain("d.emit({ type: 'set-root', name: target.name, root: !root })")
    expect(menus).toContain('设为根团队')
    expect(menus).toContain('取消根团队')
  })

  it('a root frame renders child chips with a slots stepper bound to set-team-slots (1–16), reading the CURRENT slots each click (review F1)', () => {
    expect(view).toContain('buildChildChip(document, child')
    expect(view).toContain('chip.dataset.slots = String(child.slots)')
    expect(view).toContain('const s = slotsOf(); if (s > 1) emitAction({ type: \'set-team-slots\', name, team: child.ref, slots: s - 1 })')
    expect(view).toContain('const s = slotsOf(); if (s < 16) emitAction({ type: \'set-team-slots\', name, team: child.ref, slots: s + 1 })')
    expect(view).toContain('downEl.disabled = child.slots <= 1')
    expect(view).toContain('upEl.disabled = child.slots >= 16')
  })

  it('the drop dispatch moved out unchanged in behaviour (same 入队/reorder/leave emits)', () => {
    const drop = readFileSync(join(root, 'src/planning-drop.ts'), 'utf8')
    expect(drop).toContain("type: 'add-member'")
    expect(drop).toContain("type: 'reorder'")
    expect(drop).toContain("type: 'remove-member'")
    expect(drop).toContain('dragging out to blank is a position move')
  })
})
