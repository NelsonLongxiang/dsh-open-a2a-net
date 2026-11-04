/**
 * Owner-settings unit tests (gh#34): the conservative patch-layer editor —
 * appends when absent, rewrites exactly the three keys, keeps foreign
 * lines verbatim, flags restart when announce changes.
 */
import { describe, expect, it, vi } from 'vitest'
import { applyOwnerSettings, parseSeatNames, loadSeatNames } from '../../src/owner-settings.ts'
import { Config } from '../../src/index.ts'

const EXISTING = `# top comment
- id: session-persistence-jsonl
  disabled: false
- id: a2a
  config:
    announce: true
    wakeJoinedOnBoot: true
    peers: [ 'http://192.168.3.157:13080' ]
`

describe('applyOwnerSettings', () => {
  it.each(['a\u0085b', 'a\u200bb', 'a\u202eb', 'a\u2028b', 'a\u2029b', '\u200b', '\u0301', '\u3000'])('refuses invisible/control-only or format-bearing labels %j', name => {
    expect(parseSeatNames({ 'session-0123456789abcdef': name })).toBeUndefined()
  })
  it.each(['dsh/66abc2cf', 'dsh/canvas/基础建设项目组', 'review-seat/e6733904011a44ed', ' zone/x '])('refuses address-shaped labels %j (they would pass for another session)', name => {
    expect(parseSeatNames({ 'session-0123456789abcdef': name })).toBeUndefined()
  })
  it.each(['开发席', '前端/设计', 'dev seat / review', 'A2A 评审席'])('keeps ordinary labels with a slash or spaces %j', name => {
    expect(parseSeatNames({ 'session-0123456789abcdef': name })).toEqual({ 'session-0123456789abcdef': name })
  })
  it('requires visible content and retains only valid boot entries while warning without echoing values', () => {
    const warn = vi.fn()
    const names = { 'session-0123456789abcdef': '开发席', 'session-1111222233334444': 'hidden\u200bname', 'session-5555666677778888': 'e\u0301' }
    expect(Config({ seatNames: { 'session-1111222233334444': 123 } } as never).seatNames).toEqual({ 'session-1111222233334444': 123 })
    expect(loadSeatNames(names, warn)).toEqual({ 'session-0123456789abcdef': '开发席', 'session-5555666677778888': 'e\u0301' })
    expect(warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('hidden')
  })
  it('rewrites the three keys inside the existing a2a config block, foreign lines verbatim', () => {
    const { yaml, restartNeeded } = applyOwnerSettings(EXISTING, {
      teamJoinAllowlist: ['dsh/review-gate', "dsh/owner's-team"],
      teamScopeInfo: false,
    })
    expect(yaml).toContain("teamJoinAllowlist: ['dsh/review-gate', 'dsh/owner''s-team']")
    expect(yaml).toContain('teamScopeInfo: false')
    expect(yaml).toContain('wakeJoinedOnBoot: true')
    expect(yaml).toContain("peers: [ 'http://192.168.3.157:13080' ]")
    expect(yaml).toContain('- id: session-persistence-jsonl')
    expect(restartNeeded).toBe(false)
  })

  it('persists session label maps as quoted flow YAML and replaces block-form old maps without touching other keys', () => {
    const patch = '- id: a2a\n  config:\n    seatNames:\n      session-0123456789abcdef: old\n      session-1111222233334444: stale\n    announce: true\n'
    const names = { 'session-0123456789abcdef': '开发席 \"quoted\" : # name' }
    const first = applyOwnerSettings(patch, { seatNames: names })
    expect(first.yaml).toContain('seatNames: ' + JSON.stringify(names))
    expect(first.yaml).not.toContain('stale')
    expect(first.yaml).toContain('announce: true')
    expect(first.restartNeeded).toBe(false)
    const cleared = applyOwnerSettings(first.yaml, { seatNames: {} }).yaml
    expect(cleared).toContain('seatNames: {}')
    expect(cleared).not.toContain('开发席')
  })

  it('announce changes flag a restart', () => {
    const { restartNeeded } = applyOwnerSettings(EXISTING, { announce: false })
    expect(restartNeeded).toBe(true)
  })

  it('appends a canonical entry when the patch has no a2a block', () => {
    const { yaml } = applyOwnerSettings('# empty patch\n[]\n', { announce: true, teamScopeInfo: true })
    expect(yaml).toContain('- id: a2a')
    expect(yaml).toContain('  config:')
    expect(yaml).toContain('announce: true')
    expect(yaml).toContain('teamScopeInfo: true')
  })

  it('empty allowlist writes the empty literal (deny-all, the S3 floor)', () => {
    const { yaml } = applyOwnerSettings(EXISTING, { teamJoinAllowlist: [] })
    expect(yaml).toContain('teamJoinAllowlist: []')
  })

  it('a quoted-id entry form is found too', () => {
    const quoted = "- id: 'a2a'\n  config:\n    announce: false\n"
    const { yaml } = applyOwnerSettings(quoted, { announce: true })
    expect(yaml).toContain('announce: true')
    expect(yaml).not.toContain('announce: false')
  })
})
