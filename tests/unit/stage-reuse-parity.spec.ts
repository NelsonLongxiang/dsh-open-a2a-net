// @vitest-environment node
/**
 * #775 review: the DSH right bar and the A2A workbench reuse a staged file for a retried decision for the same time. The
 * workbench is a separate bundle that imports nothing from src/, so each keeps its own copy; this keeps them equal and
 * under the file channel's 24 hours.
 */
import { describe, expect, it } from 'vitest'
import { STAGE_REUSE_MS as rightBar } from '../../src/client/TeamDecisionsTab.tsx'
import { STAGE_REUSE_MS as workbench } from '../../nexus-stage/src/wb-decisions.ts'

describe('staged-file reuse window', () => {
  it('is the same in the right bar and the workbench, and shorter than the file channel keeps a grant', () => {
    expect(workbench).toBe(rightBar)
    expect(rightBar).toBeLessThan(24 * 60 * 60_000)
  })
})
