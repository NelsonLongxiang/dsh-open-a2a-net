/**
 * Token drift lock. The semantic layer `S` was born from an incident where
 * it was documented in the tokens docblock but never exported, so every seat
 * attempt threw behind cycle()'s empty catch (PR #25). This spec pins the
 * layer's existence AND its numeric values to the primitives it claims to
 * derive from, so neither half can drift again.
 */
import { describe, expect, it } from 'vitest'
import { C, S } from '../nexus-stage/src/tokens.ts'

/** `#rrggbb` -> the numeric form three's materials consume. */
const hex = (css: string): number => parseInt(css.slice(1), 16)

describe('nexus semantic tokens', () => {
  it('pins S.nodeLive to C.liveGreen', () => {
    expect(S.nodeLive).toBe(hex(C.liveGreen))
  })

  it('pins S.nodeCold to C.coldGrey', () => {
    expect(S.nodeCold).toBe(hex(C.coldGrey))
  })
})
