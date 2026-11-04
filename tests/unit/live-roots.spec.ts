/** #291: live top-level agents across harness generations (roots() removed in 0.2.2-rc). */
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { delegationDepthOf, isTopLevelAgent, liveRootAgents } from '../../src/live-roots.ts'

interface Depth { runtime?: number, header?: number }

function makeAgent (id: string, depth?: Depth): Agent {
  const carrier: Record<string, unknown> = { id: SessionId(id) }
  if (depth?.runtime !== undefined) carrier.options = { subagentDepth: depth.runtime }
  if (depth?.header !== undefined) carrier.session = { header: { delegationDepth: depth.header } }
  return carrier as unknown as Agent
}

describe('delegationDepthOf (mirror of dsh-subagent/depth, never throwing)', () => {
  it('absence is top-level depth zero', () => {
    expect(delegationDepthOf(makeAgent('a'))).toBe(0)
    expect(isTopLevelAgent(makeAgent('a'))).toBe(true)
  })
  it('reads both carriers and takes the max, as the harness does', () => {
    expect(delegationDepthOf(makeAgent('a', { runtime: 1 }))).toBe(1)
    expect(delegationDepthOf(makeAgent('b', { header: 2 }))).toBe(2)
    expect(delegationDepthOf(makeAgent('c', { runtime: 1, header: 3 }))).toBe(3)
    expect(isTopLevelAgent(makeAgent('d', { runtime: 1 }))).toBe(false)
  })
  it('invalid values read as absent instead of throwing (a throwing listener vetoes session publication)', () => {
    const bad = [-1, -0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'x', null] as unknown[]
    for (const value of bad) {
      const carrier = { options: { subagentDepth: value } } as unknown as Agent
      expect(() => delegationDepthOf(carrier)).not.toThrow()
      expect(isTopLevelAgent(carrier)).toBe(true)
    }
    // a valid header still counts when the runtime value is invalid
    const mixed = { options: { subagentDepth: 'x' }, session: { header: { delegationDepth: 2 } } } as unknown as Agent
    expect(delegationDepthOf(mixed)).toBe(2)
  })
})

describe('liveRootAgents across registry generations', () => {
  const top = makeAgent('top-0000000000000000')
  const child = makeAgent('child-000000000000000', { runtime: 1 })
  const resumedChild = makeAgent('resumed-00000000000', { header: 2 })

  it('a roots() registry (hosts up to 0.2.1) keeps its exact semantics and order', () => {
    const registry = { roots: () => [top, child] }
    expect(liveRootAgents(registry as never)).toEqual([top, child])
  })

  it('a list()-only registry (0.2.2-rc) filters to delegation-depth zero', () => {
    const registry = { list: () => [top, child, resumedChild] }
    expect(liveRootAgents(registry as never)).toEqual([top])
  })

  it('undefined, neither-method, and throwing surfaces degrade to [] without throwing', () => {
    expect(liveRootAgents(undefined)).toEqual([])
    expect(liveRootAgents(null)).toEqual([])
    expect(liveRootAgents({} as never)).toEqual([])
    expect(liveRootAgents({ roots: () => { throw new Error('disposed') } } as never)).toEqual([])
    expect(liveRootAgents({ list: () => { throw new Error('disposed') } } as never)).toEqual([])
  })
})
