/**
 * LayoutStore unit tests: normalization/clamping, caps, whole-document
 * save semantics, reset, persistence round-trip, corrupt-file resilience.
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LayoutStore } from '../src/layout-store.ts'

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'a2a-layout-')), 'a2a', 'canvas-layout.json')
}

const DOC = {
  version: 1 as const,
  viewport: { x: 12, y: -3, scale: 1 },
  nodes: { 'session-aaa': { x: 1, y: 2 } },
  frames: { alpha: { x: 0, y: 0, w: 300, h: 200 } },
}

describe('LayoutStore', () => {
  it('round-trips a version-1 document through save/get', () => {
    const s = new LayoutStore(tmpFile())
    expect(s.get()).toBeNull()
    expect(s.save(DOC)).toBe(true)
    const got = s.get()!
    expect(got.nodes['session-aaa']).toEqual({ x: 1, y: 2 })
    expect(got.frames.alpha!.w).toBe(300)
    expect(got.viewport.scale).toBe(1)
  })

  it('rejects junk payloads and slash-named frames', () => {
    const s = new LayoutStore(tmpFile())
    expect(s.save({})).toBe(false)
    expect(s.save(null)).toBe(false)
    expect(s.save(DOC)).toBe(true)
    expect(s.save({ ...DOC, frames: { 'a/b': { x: 0, y: 0, w: 5, h: 5 } } })).toBe(true)
    expect(Object.keys(s.get()!.frames)).toEqual([])
  })

  it('clamps non-finite and out-of-range values', () => {
    const s = new LayoutStore(tmpFile())
    const messy = {
      version: 1 as const,
      viewport: { x: 0, y: 0, scale: 99 },
      nodes: { g1: { x: Number.NaN, y: 5 }, g2: { x: 9_999_999, y: -7.6 } },
    }
    expect(s.save(messy)).toBe(true)
    const got = s.get()!
    expect(got.viewport.scale).toBe(3)
    expect(got.nodes.g1).toBeUndefined()
    expect(got.nodes.g2).toEqual({ x: 1_000_000, y: -8 })
  })

  it('reset clears state and persists the empty document', () => {
    const p = tmpFile()
    const s = new LayoutStore(p)
    s.save(DOC)
    s.reset()
    expect(s.get()).toBeNull()
    expect(new LayoutStore(p).get()).toBeNull()
  })

  it('restores from disk and survives a corrupt snapshot', () => {
    const p = tmpFile()
    mkdirSync(join(p, '..'), { recursive: true })
    new LayoutStore(p).save(DOC)
    expect(new LayoutStore(p).get()!.frames.alpha).toBeDefined()
    writeFileSync(p, '{oops', 'utf8')
    expect(new LayoutStore(p).get()).toBeNull()
  })
})