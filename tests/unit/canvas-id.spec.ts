/** #282 S2: owner-qualified canvas ids — `<zone>/canvas/<name>@<fp8>`. */
import { describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { canvasOwnerFingerprint, qualifiedCanvasId, splitCanvasOwner } from '../../src/canvas-id.ts'
import { encodePublicKey } from '../../src/card.ts'

describe('canvas owner ids', () => {
  const key = encodePublicKey(generateKeyPairSync('ed25519').publicKey)
  it('fingerprints the SPKI DER bytes: 8 lowercase hex, stable, empty without a key', () => {
    const fp = canvasOwnerFingerprint(key)
    expect(fp).toMatch(/^[0-9a-f]{8}$/)
    expect(fp).toBe(createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 8))
    expect(canvasOwnerFingerprint(key)).toBe(fp)
    expect(canvasOwnerFingerprint(undefined)).toBe('')
    expect(canvasOwnerFingerprint('')).toBe('')
  })
  it('qualifies and splits round-trip; a bare id has no owner', () => {
    const id = qualifiedCanvasId('dsh/canvas/多平台部门', key)
    expect(splitCanvasOwner(id)).toEqual({ team: 'dsh/canvas/多平台部门', owner: canvasOwnerFingerprint(key) })
    expect(splitCanvasOwner('dsh/canvas/多平台部门')).toEqual({ team: 'dsh/canvas/多平台部门' })
    expect(qualifiedCanvasId('dsh/canvas/x', undefined)).toBe('dsh/canvas/x')
  })
  it('only an exact 8-lowercase-hex suffix on a canvas id is an owner', () => {
    for (const team of ['dsh/canvas/x@ABCDEF12', 'dsh/canvas/x@abc', 'dsh/canvas/x@abcdef123', 'dsh/abcdef12@abcdef12', 'dsh/canvas/@abcdef12', 'review-seat/e6733904011a44ed']) {
      expect(splitCanvasOwner(team)).toEqual({ team })
    }
    expect(splitCanvasOwner('dsh/canvas/a@b@abcdef12')).toEqual({ team: 'dsh/canvas/a@b', owner: 'abcdef12' })
  })
  it('a canvas name cannot end like an owner suffix (it would be unreachable by its bare id)', async () => {
    const { CanvasStore } = await import('../../src/canvas-store.ts')
    const store = new CanvasStore('')
    expect(store.create('x@abcdef12')).toBeUndefined()
    expect(store.create('x@abc')).toBe('x@abc')
    expect(store.create('ops')).toBe('ops')
  })
  it('an existing canvas whose name ends like a suffix still loads and is reachable by its full id (#286 review P3)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { CanvasStore } = await import('../../src/canvas-store.ts')
    const path = join(mkdtempSync(join(tmpdir(), 'canvas-legacy-')), 'canvas.json')
    writeFileSync(path, JSON.stringify({ teams: [{ name: 'x@abcdef12', members: ['session-0123456789abcdef'] }] }))
    const store = new CanvasStore(path)
    expect(store.list()).toContain('x@abcdef12')
    expect(splitCanvasOwner('dsh/canvas/x@abcdef12@0011aabb')).toEqual({ team: 'dsh/canvas/x@abcdef12', owner: '0011aabb' })
    expect(store.create('y@abcdef12')).toBeUndefined()
  })
})
