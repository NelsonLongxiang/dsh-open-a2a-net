/**
 * scripts/reanchor-architecture.mjs: anchors shift through a diff only when the shifted line still
 * equals the witness; anything else is reported for a human, never moved by guesswork. The audit
 * (verify-architecture) is untouched — this is the operator's explicit step that makes it pass.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mapLine, parseHunks, reanchor } from '../../scripts/reanchor-architecture.mjs'

const sha = (t: string): string => createHash('sha256').update(t).digest('hex')
const F = 'src/demo.ts'

describe('parseHunks / mapLine', () => {
  it('reads -U0 headers, with a missing length meaning 1', () => {
    expect(parseHunks('@@ -3,0 +4,2 @@\n+a\n+b\n@@ -10 +12 @@\n-x\n+y\n')).toEqual([
      { oldStart: 3, oldLen: 0, newLen: 2 },
      { oldStart: 10, oldLen: 1, newLen: 1 },
    ])
  })
  it('shifts lines after an insertion or deletion, leaves earlier lines alone', () => {
    const ins = [{ oldStart: 3, oldLen: 0, newLen: 2 }] // two lines inserted after old line 3
    expect(mapLine(ins, 3)).toBe(3)
    expect(mapLine(ins, 4)).toBe(6)
    const del = [{ oldStart: 5, oldLen: 2, newLen: 0 }] // old lines 5-6 deleted
    expect(mapLine(del, 4)).toBe(4)
    expect(mapLine(del, 7)).toBe(5)
  })
})

describe('reanchor', () => {
  const oldText = ['a', 'b', '  const target = 1', 'd', '  return target', 'f'].join('\n')
  const manifest = {
    sources: { [F]: sha(oldText), 'src/other.ts': 'unchanged' },
    anchors: [
      { page: 'p', cell: 'c1', ref: `${F}:3`, expect: 'const target = 1' },
      { page: 'p', cell: 'c2', ref: `${F}:3-5`, expect: 'const target = 1', endExpect: 'return target' },
      { page: 'p', cell: 'c3', ref: 'src/other.ts:9', expect: 'x' },
    ],
  }
  const xml = `<v value="see ${F}:3 and ${F}:3-5 and ${F}:30 and src/other.ts:9"/>`

  it('moves anchors whose shifted line still matches, rewrites the diagram once, and refreshes the digest', () => {
    const newText = ['// added', 'a', 'b', '  const target = 1', 'd', '  return target', 'f'].join('\n')
    const out = reanchor(manifest, xml, new Map([[F, { hunks: [{ oldStart: 0, oldLen: 0, newLen: 1 }], text: newText }]]))
    expect(out.misses).toEqual([])
    expect(out.manifest.anchors.map((a: { ref: string }) => a.ref)).toEqual([`${F}:4`, `${F}:4-6`, 'src/other.ts:9'])
    expect(out.xml).toBe(`<v value="see ${F}:4 and ${F}:4-6 and ${F}:30 and src/other.ts:9"/>`)
    expect(out.manifest.sources[F]).toBe(sha(newText))
    expect(out.manifest.sources['src/other.ts']).toBe('unchanged')
    expect(out.moved).toHaveLength(2)
  })

  it('an anchor whose witness changed is reported with candidates, never moved', () => {
    // Line 3 edited in place; the witness text now lives on line 6.
    const newText = ['a', 'b', '  const target = 2', 'd', '  return target', '  const target = 1'].join('\n')
    const out = reanchor(manifest, xml, new Map([[F, { hunks: [{ oldStart: 3, oldLen: 1, newLen: 1 }], text: newText }]]))
    expect(out.misses.map((m: { ref: string; candidates: number[] }) => [m.ref, m.candidates])).toEqual([[`${F}:3`, [6]], [`${F}:3-5`, [6]]])
    expect(out.manifest.anchors[0].ref).toBe(`${F}:3`)
    expect(out.xml).toBe(xml)
  })

  it('a range whose end witness no longer matches is a miss even when the start matches', () => {
    const newText = ['a', 'b', '  const target = 1', 'd', '  return other', 'f'].join('\n')
    const out = reanchor(manifest, xml, new Map([[F, { hunks: [{ oldStart: 5, oldLen: 1, newLen: 1 }], text: newText }]]))
    expect(out.misses.map((m: { ref: string }) => m.ref)).toEqual([`${F}:3-5`])
    expect(out.manifest.anchors[0].ref).toBe(`${F}:3`)
  })

  it('a reference to a file path that merely ends like another is not rewritten', () => {
    const lookalike = `<v value="x/${F}:3"/>`
    const newText = ['// added', 'a', 'b', '  const target = 1', 'd', '  return target', 'f'].join('\n')
    const out = reanchor({ ...manifest, anchors: [manifest.anchors[0]] }, `${xml}${lookalike}`, new Map([[F, { hunks: [{ oldStart: 0, oldLen: 0, newLen: 1 }], text: newText }]]))
    expect(out.xml.endsWith(`<v value="x/${F}:4"/>`)).toBe(false)
  })
})
