// @vitest-environment node
/** #953 P1: a canvas team's display label: the name stays the address; the label is display only. */
import { mkdtempSync } from '../temp-dirs.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CanvasStore } from '../../src/canvas-store.ts'
import { parseDisplayLabel } from '../../src/owner-settings.ts'
import { generateKeyPairSync } from 'node:crypto'
import { signCard, verifyCard } from '../../src/card.ts'

const file = (): string => join(mkdtempSync(join(tmpdir(), 'a2a-canvas-label-')), 'a2a', 'canvas.json')

describe('parseDisplayLabel', () => {
  it('trims and accepts plain text up to 64 code points, CJK and emoji included', () => {
    expect(parseDisplayLabel('  采集队 ')).toBe('采集队')
    expect(parseDisplayLabel('x'.repeat(64))).toBe('x'.repeat(64))
    expect(parseDisplayLabel('😀'.repeat(64))).toBe('😀'.repeat(64))
  })
  it.each([['empty', ''], ['blank', '   '], ['65 characters', 'x'.repeat(65)], ['65 emoji', '😀'.repeat(65)], ['a newline', 'a\nb'], ['a trailing newline', 'ok\n'], ['a control', 'a\u0007b'],
    ['a direction override', 'a\u202eb'], ['an invisible-only text', '\u200b\u200b'], ['an address shape', 'dsh/66abc2cf'], ['a canvas address', 'dsh/canvas/x'], ['not a string', 7], ['null', null]])('refuses %s', (_n, value) => {
    expect(parseDisplayLabel(value)).toBeUndefined()
  })
})

describe('CanvasStore labels', () => {
  it('sets, reads, replaces and clears a label without touching the name or the members', () => {
    const store = new CanvasStore(file())
    store.create('alpha'); store.create('beta')
    expect(store.setLabel('alpha', ' 采集队 ')).toEqual({ ok: true })
    expect(store.labelOf('alpha')).toBe('采集队'); expect(store.labelOf('beta')).toBeUndefined()
    expect(store.list()).toEqual(['alpha', 'beta']); expect(store.hasTeam('alpha')).toBe(true)
    expect(store.setLabel('alpha', '新名')).toEqual({ ok: true }); expect(store.labelOf('alpha')).toBe('新名')
    for (const clear of [undefined, null, '']) { store.setLabel('alpha', '又一个'); expect(store.setLabel('alpha', clear)).toEqual({ ok: true }); expect(store.labelOf('alpha')).toBeUndefined() }
    expect(store.setLabel('alpha', undefined)).toEqual({ ok: true })
  })
  it('refuses an unknown team and a bad label with a code and keeps the old label', () => {
    const store = new CanvasStore(file()); store.create('alpha'); store.setLabel('alpha', '好')
    expect(store.setLabel('ghost', 'x')).toMatchObject({ ok: false, code: 'no-team' })
    for (const bad of ['dsh/66abc2cf', 'a\nb', 'x'.repeat(65), 7]) expect(store.setLabel('alpha', bad)).toMatchObject({ ok: false, code: 'label' })
    expect(store.labelOf('alpha')).toBe('好')
  })
  it('survives a restart, is dropped with its team, and is not resurrected by a same-named new team', () => {
    const path = file()
    const a = new CanvasStore(path); a.create('alpha'); a.create('beta'); a.setLabel('alpha', '采集队'); a.setLabel('beta', '乙')
    const b = new CanvasStore(path)
    expect(b.labelOf('alpha')).toBe('采集队'); expect(b.labelOf('beta')).toBe('乙')
    expect(b.remove('alpha')).toBe(true); expect(b.labelOf('alpha')).toBeUndefined()
    expect(new CanvasStore(path).labelOf('alpha')).toBeUndefined()
    b.create('alpha'); expect(b.labelOf('alpha')).toBeUndefined()
  })
  it('a snapshot label that fails the rules, or names no team, is ignored on load', () => {
    const path = file(); const a = new CanvasStore(path); a.create('alpha'); a.setLabel('alpha', '好')
    const snapshot = JSON.parse(readFileSync(path, 'utf8')); snapshot.labels = { alpha: 'dsh/66abc2cf', ghost: '有', beta: 5 }
    writeFileSync(path, JSON.stringify(snapshot))
    const b = new CanvasStore(path); expect(b.labelOf('alpha')).toBeUndefined(); expect(b.labelOf('ghost')).toBeUndefined()
  })
  it('a snapshot with no labels field (an older file) loads and writes without one', () => {
    const path = file(); const a = new CanvasStore(path); a.create('alpha')
    expect(JSON.parse(readFileSync(path, 'utf8')).labels).toBeUndefined()
    expect(new CanvasStore(path).labelOf('alpha')).toBeUndefined()
  })
  it('a write that cannot be persisted throws and leaves the old label', () => {
    const path = file(); const store = new CanvasStore(path); store.create('alpha'); store.setLabel('alpha', '旧')
    const locked = new CanvasStore(path)
    mkdirSync(path + '.lock')
    expect(() => locked.setLabel('alpha', '新')).toThrow()
    expect(locked.labelOf('alpha')).toBe('旧')
  })
})

describe('the card listing', () => {
  const key = generateKeyPairSync('ed25519').privateKey
  const verified = (org: unknown[]) => {
    const card = { ...signCard({ name: 'n', session: 's', team: 'dsh', capabilities: { route: true }, expiresAt: Date.now() + 3_600_000 }, key), canvasOrg: org }
    const out = verifyCard(card, Date.now())
    if (!out.ok) throw new Error('card refused: ' + String(out.reason))
    return (out.card as { canvasOrg?: Array<{ name: string; label?: string }> }).canvasOrg ?? []
  }
  it('a canvas row keeps a valid label beside its unchanged name and drops an invalid one', () => {
    const rows = verified([{ name: 'alpha', team: 'dsh/canvas/alpha', members: [], label: '采集队' }, { name: 'beta', team: 'dsh/canvas/beta', members: [], label: 'dsh/66abc2cf' }, { name: 'gamma', team: 'dsh/canvas/gamma', members: [], label: 5 }, { name: 'delta', team: 'dsh/canvas/delta', members: [] }])
    expect(rows.map(r => [r.name, r.label])).toEqual([['alpha', '采集队'], ['beta', undefined], ['gamma', undefined], ['delta', undefined]])
  })
})
