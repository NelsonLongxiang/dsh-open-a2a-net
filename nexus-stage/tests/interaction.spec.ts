import { describe, expect, it, vi } from 'vitest'
import { createKeyboardHandler, createReducedMotionLoop } from '../src/interaction.ts'

const ids = ['node-a', 'node-b', 'node-c']

function makeSeam(initialPin?: string) {
  let pinned = initialPin
  let focusReturned = 0
  const seam = {
    pinned: () => pinned,
    nextAfter: (current: string | undefined) => {
      const idx = current === undefined ? -1 : ids.indexOf(current)
      return ids[(idx + 1) % ids.length]
    },
    pin: (id: string) => { pinned = id },
    escape: () => { pinned = undefined; focusReturned += 1 },
    focusTarget: () => ({ focus: () => { focusReturned += 1 } }),
  }
  return { seam, focusState: () => focusReturned }
}

describe('keyboard seam (gate 1/4)', () => {
  it('Tab/Enter cycles to the next id and pins it', () => {
    const { seam, focusState } = makeSeam()
    const handler = createKeyboardHandler(seam)
    handler({ key: 'Tab', preventDefault: () => {} })
    expect(seam.pinned()).toBe('node-a')
    handler({ key: 'Enter', preventDefault: () => {} })
    expect(seam.pinned()).toBe('node-b')
    expect(focusState()).toBe(0) // cycle does not touch focus-return
  })

  it('Escape unpins and returns focus to the stage surface', () => {
    const { seam, focusState } = makeSeam('node-a')
    const handler = createKeyboardHandler(seam)
    handler({ key: 'Escape', preventDefault: () => {} })
    expect(seam.pinned()).toBeUndefined()
    expect(focusState()).toBeGreaterThan(0)
  })

  it('Tab wraps around the id list (cyclic)', () => {
    const { seam } = makeSeam('node-c')
    const handler = createKeyboardHandler(seam)
    handler({ key: 'Tab', preventDefault: () => {} })
    expect(seam.pinned()).toBe('node-a')
  })
})

describe('reduced-motion loop (gate 3)', () => {
  it('reduced loop never auto-ticks; renderOnce only on external drive', () => {
    const loop = createReducedMotionLoop()
    expect(loop.isTicking()).toBe(false)
    loop.renderOnce()
    expect(loop.renderOnceCount()).toBe(1)
    // The defining reduced invariant: a render NEVER implies auto-ticking.
    expect(loop.isTicking()).toBe(false)
  })

  it('normal-motion loop auto-ticks (unrestricted path keeps per-frame drift)', () => {
    const { createNormalLoop } = require('../src/interaction.ts')
    const loop = createNormalLoop()
    expect(loop.isTicking()).toBe(true)
  })
})
