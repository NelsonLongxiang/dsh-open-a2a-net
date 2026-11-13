/**
 * docs/design/superagent-team-mcp.md M2 (2026-11-13, the owner: 「直接 tool 不行吗？」): each tool of a team's MCP server that
 * the owner allowed is a tool of its own, `team__<server>__<tool>`, with the server's own description and parameters. A member
 * calls it like any tool; the host calls the server with the token it holds in memory, for the member's running ticket.
 *
 * Tools are registered once per name on this host, whichever teams have that server; a call is resolved to the caller's own
 * team, so a session of another team, or of no team, is refused at the call.
 *
 * Names never collide (#690 review F2): a raw tool name that is not already a clean tool name (punctuation, or longer than
 * fits) gets a short hash of itself, and when two teams' servers offer the same name with different descriptions or
 * parameters, each gets a hash of its own descriptor. A registered tool is bound to that exact descriptor: a call runs only
 * when the caller's own team offers it, and runs that team's raw tool name.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/team-mcp-tools
 */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { McpError, type McpToolInfo } from './team-mcp.ts'
import type { SuperagentHost } from './index.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

const NAME_MAX = 64
const hash8 = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 8)
const withSuffix = (name: string, suffix: string): string => `${name.slice(0, NAME_MAX - suffix.length - 1)}_${suffix}`

/**
 * The tool name a team MCP tool is offered under: letters, digits, _ and -, at most 64. A raw name that had to be changed to
 * fit carries a hash of the raw name, so `write.file` and `write_file` are two tools.
 */
export function teamToolName(server: string, tool: string): string {
  const plain = `team__${server}__${tool}`
  if (/^[A-Za-z0-9_-]+$/.test(plain) && plain.length <= NAME_MAX) return plain
  return withSuffix(`team__${server}__${tool.replace(/[^A-Za-z0-9_-]/g, '_')}`, hash8(tool))
}

/** A tool's descriptor as a server offered it: its server, raw name, description and parameters. */
export function mcpToolFingerprint(server: string, tool: McpToolInfo): string {
  return createHash('sha256').update(JSON.stringify([server, tool.name, tool.description ?? null, tool.inputSchema ?? null])).digest('hex').slice(0, 16)
}

type Spec = Record<string, unknown>

/** One JSON-schema property as a tool parameter: scalars keep their type, description and enum; the rest is plain JSON. */
function valueSpec(raw: unknown): Spec {
  const node = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const description = typeof node.description === 'string' ? { description: node.description.slice(0, 500) } : {}
  const type = node.type
  if (type === 'string' || type === 'number' || type === 'integer' || type === 'boolean') {
    const values = Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every(v => typeof v === (type === 'integer' ? 'number' : type)) ? { enum: node.enum } : {}
    return { type, ...description, ...values }
  }
  if (type === 'array') return { type: 'array', ...description, items: valueSpec(node.items) }
  return { type: 'json', ...description }
}

/** A server's input schema (JSON Schema, an object) as the tool's parameters. */
export function mcpParameters(inputSchema: unknown): Spec {
  const schema = inputSchema !== null && typeof inputSchema === 'object' ? inputSchema as { properties?: unknown; required?: unknown } : {}
  const props = schema.properties !== null && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties as Record<string, unknown> : {}
  const required = Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : []
  return Object.fromEntries(Object.entries(props).slice(0, 64).map(([key, value]) => [key, { ...valueSpec(value), ...(required.includes(key) ? { required: true } : {}) }]))
}

const said = (title: string, value: Record<string, unknown>) => {
  const { ok, ...rest } = value
  return [{ type: 'text' as const, text: `${title}${ok === true ? ': ok' : ' refused:'} ${typeof rest.result === 'string' ? rest.result : JSON.stringify(rest)}` }]
}

/** The host's team MCP tools: registered and withdrawn as the teams' allowed tools change. */
export class TeamMcpTools {
  private readonly registered = new Map<string, { server: string; tool: string; fingerprint: string; dispose: () => void }>()

  constructor(private readonly ctx: Context, private readonly teamOf: (sessionId: string) => SuperagentHost | undefined, private readonly teams: () => readonly SuperagentHost[], private readonly logger: { warn(format: string, ...args: unknown[]): void }) {}

  /** Register what any team now offers; withdraw what none does. */
  refresh(): void {
    // Every distinct descriptor any team offers, by its base name.
    const byName = new Map<string, Map<string, { server: string; tool: McpToolInfo }>>()
    for (const team of this.teams()) for (const server of team.mcp.status()) for (const tool of team.mcp.offered(server.name)) {
      const base = teamToolName(server.name, tool.name)
      const same = byName.get(base) ?? new Map<string, { server: string; tool: McpToolInfo }>()
      same.set(mcpToolFingerprint(server.name, tool), { server: server.name, tool })
      byName.set(base, same)
    }
    const wanted = new Map<string, { server: string; tool: McpToolInfo; fingerprint: string }>()
    for (const [base, same] of byName) {
      // One descriptor: its base name. Teams disagreeing on what this tool is: each descriptor is a tool of its own.
      for (const [fingerprint, entry] of same) wanted.set(same.size === 1 ? base : withSuffix(base, fingerprint.slice(0, 8)), { ...entry, fingerprint })
    }
    for (const [name, entry] of [...this.registered]) {
      const want = wanted.get(name)
      if (want !== undefined && want.fingerprint === entry.fingerprint) continue
      try { entry.dispose() } catch { /* already gone */ }
      this.registered.delete(name)
    }
    for (const [name, { server, tool, fingerprint }] of wanted) {
      if (this.registered.has(name)) continue
      try {
        const dispose = this.ctx.tools.register(this.define(name, server, tool, fingerprint))
        this.registered.set(name, { server, tool: tool.name, fingerprint, dispose })
      } catch (error) { this.logger.warn('superagent: team MCP tool %s not registered: %s', name, String(error)) }
    }
  }

  /** The names registered now (for tests and the team page). */
  names(): readonly string[] { return [...this.registered.keys()] }

  private define(name: string, server: string, tool: McpToolInfo, fingerprint: string) {
    return defineTool({
      name,
      description: `Team MCP server ${server}, tool ${tool.name} — called by the host with the team's token (you never need a token), for the ticket you are working on. ${tool.description ?? ''}`.slice(0, 1_200),
      parameters: mcpParameters(tool.inputSchema) as never,
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: Record<string, unknown>) => said(`${server}/${tool.name}`, value) },
      presentCall: () => ({ card: 'generic', title: `team MCP: ${server}/${tool.name}`, kind: 'other', rawInput: {} }),
      execute: async (args: unknown, exec: { agent?: { id: unknown } }): Promise<Record<string, JsonValue>> => {
        const me = exec.agent === undefined ? undefined : String(exec.agent.id)
        const h = me === undefined ? undefined : this.teamOf(me)
        if (h === undefined || me === undefined) return { ok: false, code: 'not-team', error: 'team MCP tools serve only a superagent team\'s members' }
        // An observer is a member in every other way (design D15): roleOf answers member for both.
        if (h.roleOf(me) !== 'member') return { ok: false, code: 'not-member', error: 'team MCP tools serve only the team\'s members (the router gets none in this version)' }
        if (h.settings.serves?.members.includes(me) === true) return { ok: false, code: 'remote-member', error: 'a member serving another team host cannot call that team\'s MCP servers yet' }
        const ticketId = h.executor.bindingOf(me)?.ticketId
        if (ticketId === undefined) return { ok: false, code: 'no-ticket', error: 'you have no running ticket: a member calls the team\'s MCP servers only for the ticket it works on' }
        // F2: the caller's own team must offer this exact tool (same server, raw name, description, parameters).
        const own = h.mcp.offered(server).find(t => mcpToolFingerprint(server, t) === fingerprint)
        if (own === undefined) return { ok: false, code: 'not-offered', error: `your team's ${server} server does not offer this tool as registered; its tool list may have changed` }
        // F1: the credential is the calling member's own seat, for the ticket bound to it now — never the seat another
        // member is named for, nor the one a ticket's receipts show.
        const named = h.executor.memberOfTicket(ticketId)?.member
        if (named !== undefined && named !== me) return { ok: false, code: 'not-your-ticket', error: 'the ticket you run is now named for another member: the team MCP is not called for it' }
        const seat = h.mcpSeatOf(me)
        const toolArgs = args !== null && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}
        try {
          const out = await h.mcp.callTool(server, own.name, toolArgs, { by: me, ticketId, ...(seat !== undefined ? { seat } : {}) })
          return { ok: true, isError: out.isError, size: out.size, ...(out.clipped ? { clipped: true } : {}), result: out.text }
        } catch (error) {
          return error instanceof McpError ? { ok: false, code: error.code, error: error.message } : { ok: false, code: 'server', error: String(error instanceof Error ? error.message : error).slice(0, 300) }
        }
      },
    } as never)
  }
}
