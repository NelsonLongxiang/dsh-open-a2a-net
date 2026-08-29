/**
 * The stage boot deep-link: `?mode=plan` selects the 2D planning canvas,
 * everything else — absent, scene, wrong case, or a typo — keeps the 3D
 * observation landing so a stale or misspelled link can never strand a
 * viewer in a mode the host may not serve.
 */
import { describe, expect, it } from 'vitest'
import { requestedBootMode } from '../nexus-stage/src/stage-mode.ts'

describe('requestedBootMode', () => {
  it('selects planning for the exact ?mode=plan value', () => {
    expect(requestedBootMode('?mode=plan')).toBe('plan')
  })

  it('keeps observation for absence, alternates, and typos', () => {
    expect(requestedBootMode('')).toBe('scene')
    expect(requestedBootMode('?mode=scene')).toBe('scene')
    expect(requestedBootMode('?mode=PLAN')).toBe('scene')
    expect(requestedBootMode('?mode=planx')).toBe('scene')
    expect(requestedBootMode('?foo=bar')).toBe('scene')
  })
})
