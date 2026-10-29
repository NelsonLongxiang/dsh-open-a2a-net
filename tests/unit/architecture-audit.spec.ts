import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// JS-only documentation audit shares no application state.
// @ts-expect-error audit CLI is an intentionally untyped JS script
import { auditArchitecture } from '../../scripts/verify-architecture.mjs'
const xml = readFileSync(resolve('docs/arch/a2a-architecture.drawio'), 'utf8')
const manifest = JSON.parse(readFileSync(resolve('docs/arch/a2a-architecture.anchors.json'), 'utf8'))
const source = (file: string) => readFileSync(resolve(file), 'utf8')
const run = (x = xml, m = manifest, s = source) => auditArchitecture(x, m, s)

describe('architecture full-anchor audit', () => {
  it('covers every long/short numeric reference with exact current source and digest', () => {
    const result = run()
    expect(result.errors).toEqual([])
    expect(result.anchorCount).toBe(50)
    expect(result.sourceFiles).toBe(16)
  })
  it('detects changed anchor line, not a nearby semantic match', () => {
    expect(run(xml.replace('src/index.ts:4094', 'src/index.ts:4095')).ok).toBe(false)
  })
  it('does not overlook short :NN anchors', () => {
    const result = run(xml.replace('src/index.ts:4094', ':4094'))
    expect(result.errors.some((s: string) => s.includes('unscoped numeric'))).toBe(true)
  })
  it('detects out-of-range endpoints and requires both range witnesses', () => {
    const m = structuredClone(manifest)
    const item = m.anchors.find((a: {ref: string}) => a.ref === 'src/index.ts:4094')
    item.ref += '-99999'; item.endExpect = 'no such line'
    expect(run(xml.replace('src/index.ts:4094','src/index.ts:4094-99999'),m).errors.some((s: string) => s.includes('range end mismatch'))).toBe(true)
  })
  it('detects any drift inside an anchored source file', () => {
    expect(run(xml,manifest,(f: string) => source(f) + '\n// injected drift').ok).toBe(false)
  })
  it('detects a manifest target witness mismatch even with the same source digest', () => {
    const m = structuredClone(manifest); m.anchors[0].expect = 'wrong'
    expect(run(xml,m).ok).toBe(false)
  })
  it('refuses malformed XML and double-hyphen content', () => {
    expect(run('<mxfile>').ok).toBe(false)
    expect(run(xml.replace('模型工具面', 'model--tools')).ok).toBe(false)
  })
  it('detects nonblack ink, broken edges, outside-page shapes and stale source pin', () => {
    for (const x of [xml.replace('fontColor=#000000','fontColor=#999999'),xml.replace('target="b1"','target="missing"'),xml.replace('pageWidth="2300"','pageWidth="200"'),xml.replace('SOURCE 5736a4a','SOURCE 0000000')]) expect(run(x).ok).toBe(false)
  })
  it('refuses an empty inventory and a missing diagram page', () => {
    expect(run(xml, { ...manifest, sources: {}, anchors: [] }).ok).toBe(false)
    expect(run(xml.replace(/<diagram name="A2A 收发通道全景"[\s\S]*?<\/diagram>/, '')).ok).toBe(false)
  })
  it('does not certify an absent source or a removed manifest anchor', () => {
    expect(run(xml,manifest,() => { throw new Error('gone') }).ok).toBe(false)
    const m = structuredClone(manifest); m.anchors.pop()
    expect(run(xml,m).ok).toBe(false)
  })
})
