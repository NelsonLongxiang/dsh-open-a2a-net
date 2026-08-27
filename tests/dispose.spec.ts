/**
 * Edge-disposal tests: the rebuild path must release every geometry-bearing
 * child (the leak class behind unbounded GPU buffer growth on polling
 * pages), count what it released, and tolerate geometry-less children.
 */
import { vi } from 'vitest'
import { describe, expect, it } from 'vitest'
import { disposeGeometries } from '../nexus-stage/src/dispose.ts'

describe('disposeGeometries', () => {
  it('releases every geometry-bearing child and counts them', () => {
    const a = { dispose: vi.fn() }
    const b = { dispose: vi.fn() }
    const lines = [{ geometry: a }, { geometry: b }, {}]
    expect(disposeGeometries(lines)).toBe(2)
    expect(a.dispose).toHaveBeenCalledTimes(1)
    expect(b.dispose).toHaveBeenCalledTimes(1)
  })

  it('tolerates an empty rebuild', () => {
    expect(disposeGeometries([])).toBe(0)
  })
})
