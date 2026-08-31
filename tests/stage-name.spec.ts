/**
 * Stage node display-name fallback: title first, then the routable team
 * label, then the host fallback label — the middle step keeps untitled cold
 * sessions readable on the canvas instead of drowning it in dsh-host-* noise.
 */
import { describe, expect, it } from 'vitest'
import { displayName } from '../nexus-stage/src/stage-name.ts'

describe('displayName (stage node title fallback)', () => {
  it('prefers the session title, then the team label, then the host label', () => {
    expect(displayName({ name: '系统运维', team: 'dsh/78a64d74', label: 'dsh-host-9c53bf95-78a64d74' })).toBe('系统运维')
    expect(displayName({ team: 'dsh/78a64d74', label: 'dsh-host-9c53bf95-78a64d74' })).toBe('dsh/78a64d74')
    expect(displayName({ label: 'dsh-host-9c53bf95-78a64d74' })).toBe('dsh-host-9c53bf95-78a64d74')
  })

  it('answers empty for a shapeless node', () => {
    expect(displayName({})).toBe('')
  })
})
