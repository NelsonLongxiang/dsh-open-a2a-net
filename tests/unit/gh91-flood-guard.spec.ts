import { describe, expect, it } from 'vitest'
import { FloodGuard, DEFAULT_RATE_PER_MINUTE, fileChannelAdvice } from '../../src/flood-guard.ts'
const part = (t: string, f = 'f', i = 1, n = 1) => '[JPFILE-PART v1] ' + JSON.stringify({ v: 1, transfer_id: t, file_id: f, part_i: i, part_n: n })

describe('gh91 guard boundaries', () => {
  it('advises the file channel for any legacy part only', () => {
    for (const message of [part('ok'), part('large', 'f', 1, 17), '[JPFILE-PART v1] broken']) {
      expect(fileChannelAdvice(message)).toMatchObject({ reason: 'use-file-channel', message: expect.stringContaining('a2a_file_send { paths, team }') })
      expect(fileChannelAdvice(message)?.message).toContain('a2a-net file send <path…> <team>')
    }
    expect(fileChannelAdvice('ordinary request')).toBeUndefined()
  })
  it('uses a sliding minute; callers have independent budgets', () => {
    let now = 0; const g = new FloodGuard(() => now)
    for (let i = 0; i < DEFAULT_RATE_PER_MINUTE; i++) expect(g.check('a', 'request')).toBeUndefined()
    expect(g.check('a', 'request')).toBe('sender-rate-limited')
    expect(g.check('b', 'request')).toBeUndefined()
    now = 59999; expect(g.check('a', 'request')).toBe('sender-rate-limited')
    now = 60000; expect(g.check('a', 'request')).toBeUndefined()
  })
  it('refuses every JPFILE-PART message, well-formed or not, and spends no sender quota on it', () => {
    const g = new FloodGuard(() => 0)
    for (const message of [part('t'), part('t', 'f', 1, 17), '[JPFILE-PART v1] broken', '[JPFILE-PART v2] {}', 'note before [JPFILE-PART v1] {}']) {
      expect(g.check('a', message)).toBe('file-channel-required')
    }
    for (let i = 0; i < DEFAULT_RATE_PER_MINUTE; i++) expect(g.check('a', 'request')).toBeUndefined()
  })
  it('bounds sender state, refuses instead of evicting an active budget', () => {
    let now = 0; const g = new FloodGuard(() => now)
    for (let i = 0; i < 1024; i++) expect(g.check('s-' + i, 'request')).toBeUndefined()
    expect(g.check('extra', 'request')).toBe('flood-state-full')
    expect(g.check('s-0', 'request')).toBeUndefined()
    now = 60001
    expect(g.check('extra', 'request')).toBeUndefined()
  })
})
