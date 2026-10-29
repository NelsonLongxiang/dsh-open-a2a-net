import { describe, expect, it } from 'vitest'
import { FloodGuard, DEFAULT_RATE_PER_MINUTE } from '../../src/flood-guard.ts'
const part = (t: string, f = 'f', i = 1, n = 1) => '[JPFILE-PART v1] ' + JSON.stringify({ v: 1, transfer_id: t, file_id: f, part_i: i, part_n: n })

describe('gh91 guard boundaries', () => {
  it('uses a sliding minute; callers have independent budgets', () => {
    let now = 0; const g = new FloodGuard(() => now)
    for (let i = 0; i < DEFAULT_RATE_PER_MINUTE; i++) expect(g.check('a', 'request')).toBeUndefined()
    expect(g.check('a', 'request')).toBe('sender-rate-limited')
    expect(g.check('b', 'request')).toBeUndefined()
    now = 59999; expect(g.check('a', 'request')).toBe('sender-rate-limited')
    now = 60000; expect(g.check('a', 'request')).toBeUndefined()
  })
  it('retains the transfer cap across minute windows and file ids, even if part_n lies', () => {
    let now = 0; const g = new FloodGuard(() => now)
    for (let i = 0; i < 16; i++) expect(g.check('a', part('same-transfer', 'file-' + i))).toBeUndefined()
    now += 60001
    expect(g.check('a', part('same-transfer', 'next-file'))).toBe('file-parts-exceeded')
    expect(g.check('a', part('new-transfer'))).toBeUndefined()
  })
  it.each([0, -1, 1.5, '17', null])('rejects malformed declared part counts (%s)', n => {
    const g = new FloodGuard(() => 0)
    const message = '[JPFILE-PART v1] ' + JSON.stringify({ transfer_id: 't', file_id: 'f', part_i: 1, part_n: n })
    expect(g.check('a', message)).toBe('file-part-invalid')
  })
  it('rejects invalid/missing coordinates and protocol variants rather than failing open', () => {
    const g = new FloodGuard(() => 0)
    for (const message of ['[JPFILE-PART v1] null', '[JPFILE-PART v1] {}', '[JPFILE-PART v2] {}', part('t', 'f', -1), part('t', 'f', 2, 1)]) expect(g.check('a', message)).toBe('file-part-invalid')
  })
  it('bounds active sender/transfer state, refuses instead of evicting an active allowance', () => {
    let now = 0; const g = new FloodGuard(() => now)
    for (let i = 0; i < 1024; i++) expect(g.check('s-' + i, part('t-' + i))).toBeUndefined()
    expect(g.check('extra', 'request')).toBe('flood-state-full')
    now = 60001
    expect(g.check('extra', part('extra-transfer'))).toBe('flood-state-full')
    expect(g.check('s-0', part('t-0'))).toBe('file-part-duplicate')
    now = 24 * 60 * 60000
    expect(g.check('extra', part('extra-transfer'))).toBeUndefined()
  })
})
