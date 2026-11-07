/**
 * superagent v4 acceptance finding: on a real host a member's work tools (bash, read…) come from its agent preset, an
 * ANCESTOR scope, which the tool registry's global view does not show. Restricting to the role's tools as the global view
 * sees them hid every work tool. The restriction must read the agent's own scope. Real ToolRuntime and real scopes here.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import { RoleTools, scopeKeyOf, type RoleAgent } from '../../src/superagent/host/role-tools.ts'

const tool = (name: string) => defineTool({ name, description: name, parameters: {}, output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: name }] }, execute: async () => ({ ok: true }) })

async function host() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  // Global tools: what the a2a plugin registers.
  for (const name of ['a2a_ticket_report', 'a2a_file_fetch', 'a2a_route', 'superagent_route']) ctx.tools.register(tool(name))
  // The agent preset: its own scope, contributing the work tools and a session tool.
  const presetKey = {}
  const preset = createScope(ctx, presetKey)
  const presetTools = preset.ctx.get('tools') as Context['tools']
  for (const name of ['bash', 'read', 'edit', 'subagent']) presetTools.register(tool(name))
  // The session agent, under the preset (the agent object is its own scope key, as in DSH).
  const agent = { id: 'session-m1' } as { id: string; ctx?: Context }
  const scope = createScope(ctx, agent, { parent: presetKey })
  // The agent's context: its scope (the key rides the prototype chain) with the tool registry bound to it, as DSH injects it.
  agent.ctx = Object.create(scope.ctx, { tools: { value: scope.ctx.get('tools') } }) as Context
  return { ctx, agent: agent as unknown as RoleAgent & { ctx: Context }, key: agent as object }
}

describe('role tool visibility reads the agent\'s own scope', () => {
  it('finds the scope key on the agent context', async () => {
    const { agent, key } = await host()
    expect(scopeKeyOf(agent.ctx)).toBe(key)
    expect(scopeKeyOf({})).toBeUndefined()
  })

  it('a member keeps its preset\'s work tools and loses the rest; the global view alone would have hidden them', async () => {
    const { ctx, agent, key } = await host()
    // The trap: the global view sees no preset tool.
    expect(ctx.tools.get('bash')).toBeUndefined()
    expect(ctx.tools.get('bash', key)).toBeDefined()
    const roles = new RoleTools({ roleOf: id => (id === 'session-m1' ? 'member' : undefined), agentOf: () => undefined, logger: { warn: () => {} } })
    roles.sync(agent)
    const visible = (name: string): boolean => ctx.tools.get(name, key) !== undefined
    expect(['bash', 'read', 'edit', 'a2a_ticket_report', 'a2a_file_fetch'].filter(visible)).toEqual(['bash', 'read', 'edit', 'a2a_ticket_report', 'a2a_file_fetch'])
    expect(['subagent', 'a2a_route', 'superagent_route'].filter(visible)).toEqual([])
  })

  it('the router sees only its superagent tools', async () => {
    const { ctx, agent, key } = await host()
    const roles = new RoleTools({ roleOf: () => 'router', agentOf: () => undefined, logger: { warn: () => {} } })
    roles.sync(agent)
    expect(['bash', 'read', 'a2a_route', 'a2a_ticket_report', 'superagent_route'].filter(name => ctx.tools.get(name, key) !== undefined)).toEqual(['superagent_route'])
  })

  it('without a scope key nothing is hidden (the guard still refuses), and it says so', async () => {
    const warned: string[] = []
    const roles = new RoleTools({ roleOf: () => 'member', agentOf: () => undefined, logger: { warn: (f, ...a) => { warned.push([f, ...a].join(' ')) } } })
    let restricted = false
    roles.sync({ id: 'x', ctx: { tools: { get: () => ({}), restrict: () => { restricted = true; return () => {} } } } })
    expect(restricted).toBe(false)
    expect(warned.join()).toContain('guarded, not hidden')
  })
})
