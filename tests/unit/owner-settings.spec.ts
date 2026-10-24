/**
 * Owner-settings unit tests (gh#34): the conservative patch-layer editor —
 * appends when absent, rewrites exactly the three keys, keeps foreign
 * lines verbatim, flags restart when announce changes.
 */
import { describe, expect, it } from 'vitest'
import { applyOwnerSettings } from '../../src/owner-settings.ts'

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
