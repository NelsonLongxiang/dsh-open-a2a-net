/**
 * docs/design/superagent-builder.md TB2 (BS1): the team builder's read-only tools — the instance's organisation as an
 * inventory, and the built-in rule templates. Nothing here writes.
 *
 * The inventory is built field by field from what a builder needs to advise (teams, their router and members by seat,
 * presets, roles and intake rules with their revisions, root teams and their children, the sessions on no team, the
 * staffing ledger). It never carries anything in #626 W3's list: credentials, MCP servers, tool grants and blocks, bots,
 * the A2A allow-list, GitHub settings, file paths or system users — it copies only named fields, never a settings object.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/builder-tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { RULE_TEMPLATES } from './rule-templates.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** One team as the host knows it; the inventory picks the fields it may show. */
export interface InventoryTeam {
  readonly ref: string
  readonly settings: {
    readonly canvas?: string
    readonly router?: string
    readonly members: readonly string[]
    readonly observers: readonly string[]
    readonly rules: ReadonlyArray<{ readonly name: string; readonly text: string; readonly enabled: boolean }>
    readonly dispatch: string
    readonly profiles: Readonly<Record<string, { readonly role?: string; readonly rules?: ReadonlyArray<{ readonly name: string; readonly text: string; readonly enabled?: boolean }> }>>
    readonly repos: Readonly<Record<string, string>>
    readonly acceptMode: string
  }
  readonly revisions: Readonly<Record<string, number>>
  readonly seatOf: (session: string) => string | undefined
  readonly children: ReadonlyArray<{ readonly ref: string; readonly slots: number }>
}

export interface InventoryInput {
  readonly teams: readonly InventoryTeam[]
  /** Joined local sessions (the builder picks members among those on no team). */
  readonly sessions: readonly string[]
  readonly nameOf: (session: string) => string
  readonly presetOf: (session: string) => string | undefined
  readonly staffing: ReadonlyArray<{ readonly id: string; readonly state: string; readonly source: string; readonly summary?: string; readonly at: string; readonly ops: ReadonlyArray<{ readonly op: string }> }>
}

const rulesOf = (rules: ReadonlyArray<{ name: string; text: string; enabled?: boolean }> | undefined): JsonValue => (rules ?? []).map(r => ({ name: r.name, text: r.text, enabled: r.enabled !== false }))

/** The builder's inventory (TB2): named fields only, nothing from W3. */
export function orgInventory(input: InventoryInput): { [key: string]: JsonValue } {
  const placed = new Set<string>()
  const teams = input.teams.filter(t => t.settings.canvas !== undefined).map(t => {
    const s = t.settings
    const member = (session: string): JsonValue => {
      placed.add(session)
      const profile = s.profiles[session]
      const seat = t.seatOf(session)
      return {
        ...(seat !== undefined ? { seatId: seat } : {}), session, name: input.nameOf(session), preset: input.presetOf(session) ?? null,
        kind: s.observers.includes(session) ? 'observer' : 'member',
        ...(typeof profile?.role === 'string' ? { role: profile.role } : {}),
        rules: rulesOf(profile?.rules), revision: t.revisions[`member:${session}`] ?? 0,
        ...(typeof s.repos[session] === 'string' ? { repo: s.repos[session]! } : {}),
      }
    }
    if (s.router !== undefined) placed.add(s.router)
    return {
      team: t.ref, canvas: s.canvas!,
      router: s.router === undefined ? null : { session: s.router, name: input.nameOf(s.router), preset: input.presetOf(s.router) ?? null },
      members: s.members.map(member),
      rules: { team: rulesOf(s.rules), teamRevision: t.revisions.team ?? 0, dispatch: s.dispatch, dispatchRevision: t.revisions.dispatch ?? 0 },
      acceptMode: s.acceptMode,
      ...(t.children.length > 0 ? { root: { children: t.children.map(c => ({ ref: c.ref, slots: c.slots })) } } : {}),
    } satisfies JsonValue
  })
  const candidates = input.sessions.filter(id => !placed.has(id)).map(id => ({ session: id, name: input.nameOf(id), preset: input.presetOf(id) ?? null }))
  const staffing = input.staffing.slice(-20).map(e => ({ id: e.id, state: e.state, source: e.source, at: e.at, ...(e.summary !== undefined ? { summary: e.summary } : {}), ops: e.ops.map(o => o.op) }))
  return { teams, candidates, staffing, note: 'Teams by id (primary for the primary team); members by seatId. Credentials, MCP servers, tool grants, bots, allow-lists, GitHub settings and file paths are never shown.' }
}

/** Register the builder's two read tools; `isBuilder` says whether the calling session is a team builder. */
export function registerBuilderTools(ctx: Context, isBuilder: (sessionId: string) => boolean, inventory: () => InventoryInput): void {
  const refused = { ok: false, code: 'not-builder', error: 'the team builder\'s tools serve only a session under the superagent-builder preset that holds no team role' }
  const said = (title: string, value: Record<string, unknown>) => [{ type: 'text' as const, text: `${title}: ${JSON.stringify(value)}` }]
  const caller = (exec: { agent?: { id: unknown } }): boolean => exec.agent !== undefined && isBuilder(String(exec.agent.id))
  ctx.tools.register(defineTool({
    name: 'superagent_org_read',
    description: 'Team builder only: a read-only inventory of this instance — teams with their canvas, router and members (by seatId), each member\'s preset, role, intake rules and repository, the team and dispatch rules with their revisions, root teams and their children, the local sessions on no team (candidates) and the staffing ledger. It never shows credentials, MCP servers, tool grants, bots, allow-lists, GitHub settings or file paths.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: Record<string, unknown>) => said('organisation', value) },
    presentCall: () => ({ card: 'generic', title: 'organisation (read)', kind: 'other', rawInput: {} }),
    execute: async (_args: unknown, exec: { agent?: { id: unknown } }): Promise<Record<string, JsonValue>> => caller(exec) ? { ok: true, ...orgInventory(inventory()) } : refused,
  } as never))
  ctx.tools.register(defineTool({
    name: 'superagent_rule_templates',
    description: 'Team builder only: the built-in rule templates to start a draft from — the router\'s intake rules (team), dispatch, and a member\'s intake rules (member). Text only; <…> marks what to fill in with the owner. Each says which running team it comes from.',
    parameters: { scope: { type: 'string', description: 'team, dispatch or member; empty for all.' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: Record<string, unknown>) => said('rule templates', value) },
    presentCall: () => ({ card: 'generic', title: 'rule templates', kind: 'other', rawInput: {} }),
    execute: async (args: { scope?: string }, exec: { agent?: { id: unknown } }): Promise<Record<string, JsonValue>> => {
      if (!caller(exec)) return refused
      const scope = typeof args.scope === 'string' && args.scope !== '' ? args.scope : undefined
      return { ok: true, templates: JSON.parse(JSON.stringify(RULE_TEMPLATES.filter(t => scope === undefined || t.scope === scope))) as JsonValue }
    },
  } as never))
}
