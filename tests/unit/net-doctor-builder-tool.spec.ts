// @vitest-environment node
/** #838 A: the builder's read-only network doctor tool — builder only, and it only reads. */
import { describe, expect, it, vi } from 'vitest'
import { registerBuilderTools } from '../../src/superagent/host/builder-tools.ts'
import { BUILDER_TOOLS, MEMBER_TOOLS, TEAM_TOOLS } from '../../src/superagent/host/role-tools.ts'

function boot(netDoctor?: (peer?: string) => Promise<Record<string, unknown>>) {
  const registered: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<Record<string, unknown>> }> = []
  const ctx = { tools: { register: (tool: never) => { registered.push(tool) } } }
  registerBuilderTools(ctx as never, id => id === 'builder-1', () => ({}) as never, { ...(netDoctor !== undefined ? { netDoctor } : {}), staffing: () => undefined, personMessage: () => undefined, teamRules: () => undefined })
  return registered.find(tool => tool.name === 'superagent_net_doctor')
}

describe('superagent_net_doctor', () => {
  it('is a builder tool and nobody else\'s', () => {
    expect(BUILDER_TOOLS).toContain('superagent_net_doctor')
    expect(MEMBER_TOOLS).not.toContain('superagent_net_doctor')
    expect(TEAM_TOOLS).not.toContain('superagent_net_doctor')
  })
  it('runs for the builder, passes the named peer through, and refuses any other session', async () => {
    const doctor = vi.fn(async (peer?: string) => ({ rows: [], peerCheck: peer }))
    const tool = boot(doctor)!
    expect(await tool.execute({ peer: 'http://p.example:1' }, { agent: { id: 'builder-1' } })).toEqual({ ok: true, rows: [], peerCheck: 'http://p.example:1' })
    expect(doctor).toHaveBeenCalledWith('http://p.example:1')
    expect(await tool.execute({}, { agent: { id: 'builder-1' } })).toMatchObject({ ok: true })
    expect(doctor).toHaveBeenLastCalledWith(undefined)
    expect(await tool.execute({}, { agent: { id: 'someone-else' } })).toMatchObject({ ok: false, code: 'not-builder' })
    expect(await tool.execute({}, {})).toMatchObject({ ok: false, code: 'not-builder' })
    expect(doctor).toHaveBeenCalledTimes(2)
  })
  it('is not registered when the host offers no doctor', () => {
    expect(boot()).toBeUndefined()
  })
})
