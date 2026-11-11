// @vitest-environment node
/** The plugin's a2a-network skill reaches the host's skill registry once that registry exists. */
import { describe, expect, it, vi } from 'vitest'
import { registerA2aNetworkSkill } from '../../src/skill-registration.ts'

function host() {
  const registered: Array<Record<string, unknown>> = []
  const disposed: string[] = []
  let ready: ((scope: unknown) => void) | undefined
  const scope = {
    skills: { register: (skill: Record<string, unknown>) => { registered.push(skill); return () => { disposed.push(String(skill.name)) } } },
    effect: (run: () => () => void) => { run() },
  }
  const inject = vi.fn((services: string[], run: (s: typeof scope) => void) => { expect(services).toEqual(['skills']); ready = () => { run(scope) } })
  return { ctx: { inject } as never, registered, disposed, start: () => { ready?.(undefined) } }
}

describe('the a2a-network skill', () => {
  it('waits for the skill registry, then registers the packaged skill', () => {
    const h = host()
    registerA2aNetworkSkill(h.ctx)
    expect(h.registered).toHaveLength(0)
    h.start()
    expect(h.registered).toHaveLength(1)
    const [skill] = h.registered
    expect(skill).toMatchObject({ name: 'a2a-network', invocation: { modelInvocable: true, userInvocable: true } })
    expect(String(skill!.description).length).toBeGreaterThan(0)
    expect(String(skill!.content)).toContain('a2a_route')
  })
  it('leaves the provider to the registry, which owns the loader for a runtime skill', () => {
    const h = host()
    registerA2aNetworkSkill(h.ctx)
    h.start()
    expect(h.registered[0]).not.toHaveProperty('provider')
    // DSH's load check requires a string source and does not default it (#580).
    expect(h.registered[0]).toHaveProperty('source', 'bundled')
  })
  it('does nothing on a host whose context cannot wait for services', () => {
    expect(() => { registerA2aNetworkSkill({} as never) }).not.toThrow()
  })
})
