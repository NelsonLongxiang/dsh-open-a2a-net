/**
 * NodeStore (node-identity N1): names final and never reused, no rename,
 * two append-only version namespaces with max+1 numbering, full snapshots,
 * CAS on every layer write, quotas, persistence and corrupt-file resilience.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MUTABLE_SECTIONS, NodeStore, promptSha, QUOTA } from '../../src/node-store.ts'

const root = (): string => join(mkdtempSync(join(tmpdir(), 'a2a-nodes-')), 'a2a')
const meta = (expectedSha: string, reason = 'test'): { expectedSha: string; reason: string; by: string; via: string } => ({ expectedSha, reason, by: 'human:t', via: 'host-face' })

describe('NodeStore — names', () => {
  it('creates a node with a valid name and defaults the label to the name', () => {
    const s = new NodeStore('')
    const r = s.create({ name: 'review-1', role: ['review'], teams: ['dsh/canvas/core'] }, 'human:owner')
    expect(r.ok).toBe(true)
    expect(s.get('review-1')).toMatchObject({ label: 'review-1', role: ['review'], teams: ['dsh/canvas/core'], created_by: 'human:owner' })
  })

  it.each(['R1', '1abc', 'a', 'a_b', 'a'.repeat(33), 'dsh/review'])('rejects the name %s', (name) => {
    expect(new NodeStore('').create({ name }, 'human:o')).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('refuses a duplicate, and never reuses an archived name', () => {
    const s = new NodeStore('')
    s.create({ name: 'dev-1' }, 'human:o')
    expect(s.create({ name: 'dev-1' }, 'human:o')).toMatchObject({ ok: false, code: 'conflict' })
    expect(s.archive('dev-1').ok).toBe(true)
    expect(s.get('dev-1')).toBeUndefined()
    expect(s.create({ name: 'dev-1' }, 'human:o')).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('has no rename: update with a different name is refused, label changes are fine', () => {
    const s = new NodeStore('')
    s.create({ name: 'ops-1' }, 'human:o')
    expect(s.update('ops-1', { name: 'ops-2' })).toMatchObject({ ok: false, code: 'bad-request' })
    expect(s.update('ops-1', { label: '运维席' })).toMatchObject({ ok: true, value: { name: 'ops-1', label: '运维席' } })
  })

  it('validates role, teams and carrier', () => {
    const s = new NodeStore('')
    expect(s.create({ name: 'x-1', role: ['god'] }, 'h')).toMatchObject({ ok: false, code: 'bad-request' })
    expect(s.create({ name: 'x-1', teams: ['dsh/66abc2cf'] }, 'h')).toMatchObject({ ok: false, code: 'bad-request' })
    expect(s.create({ name: 'x-1', carrier: { cwd: 3 } }, 'h')).toMatchObject({ ok: false, code: 'bad-request' })
    expect(s.create({ name: 'x-1', teams: ['dsh/canvas/采购 组'], carrier: { cwd: '/w', agentPreset: 'p' } }, 'h')).toMatchObject({ ok: true, value: { carrier: { cwd: '/w', agentPreset: 'p', model: '' } } })
  })
})

describe('NodeStore — prompt versions', () => {
  it('first write expects the empty sha; a stale sha is refused (CAS)', () => {
    const s = new NodeStore('')
    s.create({ name: 'n-1' }, 'h')
    expect(s.writeLayer('n-1', 'core', { core: 'x' }, meta('deadbeef'))).toMatchObject({ ok: false, code: 'conflict' })
    const v1 = s.writeLayer('n-1', 'core', { core: '身份：评审席' }, meta(''))
    expect(v1).toMatchObject({ ok: true, value: { layer: 'core', version: 1, parent_version: 0 } })
    if (!v1.ok) return
    expect(v1.value.sha256).toBe(promptSha(1, { core: '身份：评审席' }))
    // A second writer still holding '' loses.
    expect(s.writeLayer('n-1', 'core', { core: 'other' }, meta(''))).toMatchObject({ ok: false, code: 'conflict' })
    expect(s.writeLayer('n-1', 'core', { core: 'v2' }, meta(v1.value.sha256))).toMatchObject({ ok: true, value: { version: 2, parent_version: 1 } })
  })

  it('mutable writes are patches frozen as full snapshots', () => {
    const s = new NodeStore('')
    s.create({ name: 'n-1' }, 'h')
    const a = s.writeLayer('n-1', 'mutable', { 当前状态: 'A' }, meta(''))
    if (!a.ok) throw new Error(a.error)
    expect(Object.keys(a.value.sections)).toEqual([...MUTABLE_SECTIONS])
    const b = s.writeLayer('n-1', 'mutable', { 已知陷阱: 'B' }, meta(a.value.sha256))
    if (!b.ok) throw new Error(b.error)
    expect(b.value.sections).toMatchObject({ 当前状态: 'A', 已知陷阱: 'B', 执行要点: '', 当前重点: '' })
    expect(b.value.changed).toEqual(['已知陷阱'])
    expect(s.writeLayer('n-1', 'mutable', { 名字: 'x' }, meta(b.value.sha256))).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('enforces the §8-9 quotas', () => {
    const s = new NodeStore('')
    s.create({ name: 'n-1' }, 'h')
    expect(s.writeLayer('n-1', 'core', { core: 'x'.repeat(QUOTA.core + 1) }, meta(''))).toMatchObject({ ok: false, code: 'quota' })
    expect(s.writeLayer('n-1', 'mutable', { 当前状态: 'x'.repeat(QUOTA.mutableSection + 1) }, meta(''))).toMatchObject({ ok: false, code: 'quota' })
    const full = Object.fromEntries(MUTABLE_SECTIONS.map(k => [k, 'x'.repeat(QUOTA.mutableSection)]))
    expect(s.writeLayer('n-1', 'mutable', full, meta(''))).toMatchObject({ ok: false, code: 'quota' })
  })

  it('requires a reason', () => {
    const s = new NodeStore('')
    s.create({ name: 'n-1' }, 'h')
    expect(s.writeLayer('n-1', 'core', { core: 'x' }, meta('', ' '))).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('rollback freezes a NEW version (max+1) and a later write never collides', () => {
    const s = new NodeStore('')
    s.create({ name: 'n-1' }, 'h')
    const v1 = s.writeLayer('n-1', 'mutable', { 当前状态: 'one' }, meta(''))
    if (!v1.ok) throw new Error(v1.error)
    const v2 = s.writeLayer('n-1', 'mutable', { 当前状态: 'two' }, meta(v1.value.sha256))
    if (!v2.ok) throw new Error(v2.error)
    const back = s.rollback('n-1', 'mutable', 1, { expectedSha: v2.value.sha256, reason: 'two was worse', by: 'human:o' })
    expect(back).toMatchObject({ ok: true, value: { version: 3, rollback_of: 1, parent_version: 2, sections: { 当前状态: 'one' } } })
    if (!back.ok) return
    const v4 = s.writeLayer('n-1', 'mutable', { 当前状态: 'four' }, meta(back.value.sha256))
    expect(v4).toMatchObject({ ok: true, value: { version: 4 } })
    expect(s.versions('n-1', 'mutable')).toEqual([1, 2, 3, 4])
    // The two namespaces number independently.
    expect(s.writeLayer('n-1', 'core', { core: 'c' }, meta(''))).toMatchObject({ ok: true, value: { version: 1 } })
  })
})

describe('NodeStore — disk', () => {
  it('round-trips the roster and versions, and numbers from the files on disk', () => {
    const dir = root()
    const a = new NodeStore(dir)
    a.create({ name: 'n-1', label: '甲' }, 'h')
    const v1 = a.writeLayer('n-1', 'mutable', { 当前状态: 'one' }, meta(''))
    if (!v1.ok) throw new Error(v1.error)
    // A stray higher version on disk (e.g. a write whose roster update was lost) is never overwritten.
    writeFileSync(join(dir, 'nodes', 'n-1', 'mutable-v5.json'), '{"stray":true}')
    const b = new NodeStore(dir)
    expect(b.get('n-1')).toMatchObject({ label: '甲', prompt: { mutable_version: 1 } })
    const next = b.writeLayer('n-1', 'mutable', { 当前状态: 'two' }, meta(v1.value.sha256))
    expect(next).toMatchObject({ ok: true, value: { version: 6 } })
    expect(JSON.parse(readFileSync(join(dir, 'nodes', 'n-1', 'mutable-v5.json'), 'utf8'))).toEqual({ stray: true })
    expect(b.version('n-1', 'mutable', 1)?.sections['当前状态']).toBe('one')
  })

  it('survives a corrupt roster without throwing', () => {
    const dir = root()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'nodes.json'), '{not json')
    const s = new NodeStore(dir)
    expect(s.list()).toEqual([])
    expect(s.create({ name: 'n-1' }, 'h').ok).toBe(true)
    expect(existsSync(join(dir, 'nodes.json'))).toBe(true)
  })

  it('keeps archived versions on disk and the name retired across restarts', () => {
    const dir = root()
    const a = new NodeStore(dir)
    a.create({ name: 'n-1' }, 'h')
    a.writeLayer('n-1', 'core', { core: 'c' }, meta(''))
    a.archive('n-1')
    const b = new NodeStore(dir)
    expect(b.create({ name: 'n-1' }, 'h')).toMatchObject({ ok: false, code: 'conflict' })
    expect(existsSync(join(dir, 'nodes', 'n-1', 'core-v1.json'))).toBe(true)
  })
})
