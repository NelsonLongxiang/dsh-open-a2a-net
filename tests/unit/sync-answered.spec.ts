import { describe, expect, it } from 'vitest'
import { SyncAnswered, SYNC_ANSWERED_CAP, SYNC_ANSWERED_TTL_MS } from '../../src/faces/wire.ts'

describe('#298 SyncAnswered', () => {
  it('marks once, only for the handle that was answered, and forgets after the TTL', () => {
    let now = 1_000
    const answered = new SyncAnswered(() => now)
    answered.note('t1', 'cli/aaaa')
    expect(answered.take('t1', 'cli/bbbb')).toBe(false)
    expect(answered.take('t1', 'cli/aaaa')).toBe(true)
    expect(answered.take('t1', 'cli/aaaa')).toBe(false)
    answered.note('t2', 'cli/aaaa')
    now += SYNC_ANSWERED_TTL_MS
    expect(answered.take('t2', 'cli/aaaa')).toBe(false)
  })
  it('keeps at most the cap, dropping the oldest', () => {
    const answered = new SyncAnswered(() => 0)
    for (let i = 0; i <= SYNC_ANSWERED_CAP; i++) answered.note('t' + i, 'cli/aaaa')
    expect(answered.take('t0', 'cli/aaaa')).toBe(false)
    expect(answered.take('t1', 'cli/aaaa')).toBe(true)
    expect(answered.take('t' + SYNC_ANSWERED_CAP, 'cli/aaaa')).toBe(true)
  })
})
