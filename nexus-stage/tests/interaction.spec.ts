import { describe, expect, it, vi } from 'vitest'
import {
  createStageKeyboardHandler,
  wireReducedRendering,
} from '../src/interaction.ts'
import { formatCensus } from '../src/topology.ts'

// Real production handler under test; the focus target is a spy element.
function makeHandler(opts: { pinned: () => string | undefined; ids: () => string[]; onPin: (id: string) => void; onEscape: () => void }) {
  const focusSpy = { focus: vi.fn() }
  const handler = createStageKeyboardHandler(
    {
      pinned: opts.pinned,
      ids: opts.ids,
      nextAfter: (current) => {
        const list = opts.ids()
        const idx = current === undefined ? -1 : list.indexOf(current)
        return list[(idx + 1) % list.length]
      },
      pin: opts.onPin,
      escape: opts.onEscape,
    },
    focusSpy,
  )
  return { handler, focusSpy }
}

describe('gate 1/4 — stage keyboard handler', () => {
  it('Enter/Tab cycles the pinned id with wrap-around', () => {
    let pinned: string | undefined = undefined
    const ids = ['node-a', 'node-b', 'node-c']
    const { handler, focusSpy } = makeHandler({
      pinned: () => pinned,
      ids: () => ids,
      onPin: (id) => { pinned = id },
      onEscape: () => {},
    })
    handler({ key: 'Tab', preventDefault: () => {} })
    expect(pinned).toBe('node-a')
    handler({ key: 'Enter', preventDefault: () => {} })
    expect(pinned).toBe('node-b')
    expect(focusSpy.focus).not.toHaveBeenCalled() // cycle keeps focus
  })

  it('Escape unpins AND returns focus to the stage surface (handler calls focus itself)', () => {
    let pinned: string | undefined = 'node-a'
    const onEscape = vi.fn(() => { pinned = undefined })
    const { handler, focusSpy } = makeHandler({
      pinned: () => pinned,
      ids: () => ['node-a'],
      onPin: () => {},
      onEscape,
    })
    handler({ key: 'Escape', preventDefault: () => {} })
    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(pinned).toBeUndefined()
    expect(focusSpy.focus).toHaveBeenCalledTimes(1) // handler performs the focus-return
  })
})

describe('gate 3 — reduced-motion wired rendering', () => {
  it('wired loop never auto-ticks; controls change and cycle drive renderOnce', () => {
    const changeListeners: Array<() => void> = []
    const controls = { addEventListener: (_t: 'change', l: () => void) => { changeListeners.push(l) } }
    let renders = 0
    const renderOnce = () => { renders += 1 }
    const loop = wireReducedRendering(controls, renderOnce)

    expect(loop.isTicking()).toBe(false)
    // controls change fires the wired renderOnce
    for (const l of changeListeners) l()
    expect(renders).toBe(1)
    // a settled cycle calls renderOnce again (cycle → renderOnce contract)
    loop.renderOnce()
    expect(renders).toBe(2)
    expect(loop.isTicking()).toBe(false)
  })
})

describe('gate 2 — aria census', () => {
  it('census formats joined sessions deterministically (five-count shape)', () => {
    const sessions = [{ live: true }, { live: true }, { live: false }]
    const teams = [{ name: 'ecom-ops' }, { name: 'god-system' }]
    const peers = [{}]
    const text = formatCensus(sessions, teams, peers)
    expect(text).toContain('3 个节点')
    expect(text).toContain('2 live / 1 cold')
    expect(text).toContain('2 个团队')
  })
})
