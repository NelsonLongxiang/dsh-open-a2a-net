import { describe, expect, it } from 'vitest'
import { updateCensus } from '../src/census.ts'

function canvas(): HTMLCanvasElement {
  const el = document.createElement('canvas')
  document.body.appendChild(el)
  return el
}

describe('gate 2 — updateCensus DOM aria (production function)', () => {
  it('writes formatted census to aria-label and updates on state change', () => {
    const cv = canvas()
    updateCensus(cv, [{ live: true }, { live: true }], [{ name: 'ecom-ops' }], [])
    const first = cv.getAttribute('aria-label')!
    expect(first).toContain('2 个节点')
    expect(first).toContain('2 live / 0 cold')

    // second state: membership shrinks and a team is added — aria follows
    updateCensus(cv, [{ live: true }], [{ name: 'ecom-ops' }, { name: 'god-system' }], [{}])
    const second = cv.getAttribute('aria-label')!
    expect(second).toContain('1 个节点')
    expect(second).not.toBe(first)
  })
})
