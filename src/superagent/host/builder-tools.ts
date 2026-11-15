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
import { randomBytes } from 'node:crypto'
import { RULE_TEMPLATES } from './rule-templates.ts'
import type { StaffingChange, StaffingEntry, StaffingExecutor } from './staffing.ts'

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

/** What a blueprint changes, in lines the owner reads before agreeing (TB3: the diff). */
export function blueprintDiff(ops: StaffingChange['ops'], current: (team: string) => { canvas?: string; rules: ReadonlyArray<{ name: string; text: string }>; dispatch: string } | undefined): string[] {
  const rules = (value: unknown): string => Array.isArray(value) ? value.map(r => `「${String((r as { name?: unknown }).name)}」${String((r as { text?: unknown }).text)}`).join('；') : String(value)
  return ops.map((input, index) => {
    const p = input.params as Record<string, unknown>
    const n = `${String(index + 1)}.`
    if (input.op === 'team.create') return `${n} 新建团队，画布 ${String(p.canvas)}，总工会话 ${String(p.router)}`
    if (input.op === 'member.add') return `${n} 团队 ${String(p.team)} 加成员 ${String(p.session)}${p.profile !== undefined ? `，档案：${JSON.stringify(p.profile)}` : ''}`
    if (input.op === 'team.rules.set') {
      const now = current(String(p.team))
      const before = now === undefined ? '（新团队）' : p.scope === 'team' ? rules(now.rules) || '（空）' : p.scope === 'dispatch' ? now.dispatch || '（空）' : '（该席位当前规则）'
      return `${n} 团队 ${String(p.team)} 的 ${String(p.scope)} 规则\n   现在：${before}\n   改为：${p.scope === 'dispatch' ? String(p.value) : rules(p.value)}`
    }
    return `${n} ${input.op} ${JSON.stringify(p)}`
  })
}

/** What the blueprint tools need from the host: the executor, the owner's last typed message in a session, a team's rules. */
export interface BlueprintDeps {
  readonly staffing: () => StaffingExecutor | undefined
  readonly personMessage: (sessionId: string) => { id: string; atMs: number; text: string } | undefined
  readonly teamRules: (team: string) => { canvas?: string; rules: ReadonlyArray<{ name: string; text: string }>; dispatch: string } | undefined
}

const entryView = (entry: StaffingEntry): Record<string, JsonValue> => JSON.parse(JSON.stringify({ id: entry.id, state: entry.state, cards: entry.cards, steps: entry.steps, ...(entry.reason !== undefined ? { reason: entry.reason } : {}) })) as Record<string, JsonValue>

/** Register the builder's tools; `isBuilder` says whether the calling session is a team builder. */
export function registerBuilderTools(ctx: Context, isBuilder: (sessionId: string) => boolean, inventory: () => InventoryInput, blueprints?: BlueprintDeps): void {
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
  if (blueprints === undefined) return
  const me = (exec: { agent?: { id: unknown } }): string | undefined => exec.agent !== undefined && isBuilder(String(exec.agent.id)) ? String(exec.agent.id) : undefined
  const noExecutor = { ok: false, code: 'no-staffing', error: 'this host has no staffing executor' }
  ctx.tools.register(defineTool({
    name: 'superagent_blueprint_propose',
    description: 'Team builder only: record a blueprint — one batch of staffing changes — as pending. Nothing changes yet. ops: team.create {canvas, router}, member.add {team, session, profile?: {role, rules[], repo}}, team.rules.set {team, scope: team | dispatch | member:<seatId>, value}. A new team is named by its canvas; an existing team by its id from superagent_org_read. Only existing sessions. Show the owner the returned diff and wait for their own reply; then call superagent_blueprint_apply.',
    parameters: {
      summary: { type: 'string', required: true, description: 'What the blueprint does, in the owner\'s language.' },
      ops: { type: 'array', required: true, items: { type: 'object', additionalProperties: true }, description: 'The operations, in order: { op, params }.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: Record<string, unknown>) => said('blueprint', value) },
    presentCall: () => ({ card: 'generic', title: 'blueprint (propose)', kind: 'other', rawInput: {} }),
    execute: async (args: { summary?: string; ops?: unknown }, exec: { agent?: { id: unknown } }): Promise<Record<string, JsonValue>> => {
      const session = me(exec); if (session === undefined) return refused
      const staffing = blueprints.staffing(); if (staffing === undefined) return noExecutor
      const ops = (Array.isArray(args.ops) ? args.ops : []) as StaffingChange['ops']
      const change: StaffingChange = { id: `bp-${randomBytes(4).toString('hex')}`, source: 'owner-local', by: { session, name: '组队顾问' }, summary: String(args.summary ?? '').slice(0, 500), ops }
      const out = await staffing.submit(change)
      if (!out.ok) return { ok: false, code: out.code, error: out.error }
      const cards = Object.keys(out.entry.cards)
      return { ok: true, ...entryView(out.entry), diff: blueprintDiff(ops, blueprints.teamRules).join('\n'),
        next: cards.length > 0 ? `改动涉及已有团队 ${cards.join('、')}：主人同意后，还要在这些团队的页面上确认卡片。` : '主人在本会话里亲口同意后，调用 superagent_blueprint_apply。' }
    },
  } as never))
  ctx.tools.register(defineTool({
    name: 'superagent_blueprint_apply',
    description: 'Team builder only: let the host carry out your own pending blueprint, only after the owner\'s own typed message in this session agreed to it (a relayed or agent message never counts). A blueprint that changes an existing team also waits for that team\'s card.',
    parameters: { id: { type: 'string', required: true, description: 'The blueprint id from superagent_blueprint_propose.' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: Record<string, unknown>) => said('blueprint', value) },
    presentCall: () => ({ card: 'generic', title: 'blueprint (apply)', kind: 'other', rawInput: {} }),
    execute: async (args: { id?: string }, exec: { agent?: { id: unknown } }): Promise<Record<string, JsonValue>> => {
      const session = me(exec); if (session === undefined) return refused
      const staffing = blueprints.staffing(); if (staffing === undefined) return noExecutor
      const entry = staffing.get(String(args.id ?? ''))
      if (entry === undefined || entry.by.session !== session) return { ok: false, code: 'no-blueprint', error: 'there is no blueprint of yours with that id' }
      if (entry.state !== 'awaiting') return { ok: false, code: 'not-awaiting', error: `blueprint ${entry.id} is ${entry.state}`, ...entryView(entry) }
      // D10: the owner's own typed message, newer than the proposal; a relayed or agent message never counts.
      const person = blueprints.personMessage(session)
      if (person === undefined) return { ok: false, code: 'not-the-owner', error: 'this applies only in a turn answering the owner\'s own message' }
      if (person.atMs <= Date.parse(entry.at)) return { ok: false, code: 'not-yet', error: 'the owner has not replied since this blueprint: show it to them and wait' }
      const out = await staffing.agree(entry.id, `owner message ${person.id} in builder session ${session}`)
      if (!out.ok) return { ok: false, code: out.code, error: out.error }
      const waiting = Object.entries(out.entry.cards).filter(([, card]) => card.state === 'open').map(([team]) => team)
      return { ok: true, ...entryView(out.entry), ...(out.entry.state === 'awaiting' && waiting.length > 0 ? { next: `已提交到团队 ${waiting.join('、')}，等主人在团队页确认卡片。` } : {}) }
    },
  } as never))
  ctx.tools.register(defineTool({
    name: 'superagent_blueprint_withdraw',
    description: 'Team builder only: withdraw your own blueprint that is still pending.',
    parameters: { id: { type: 'string', required: true, description: 'The blueprint id.' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args: unknown, value: Record<string, unknown>) => said('blueprint', value) },
    presentCall: () => ({ card: 'generic', title: 'blueprint (withdraw)', kind: 'other', rawInput: {} }),
    execute: async (args: { id?: string }, exec: { agent?: { id: unknown } }): Promise<Record<string, JsonValue>> => {
      const session = me(exec); if (session === undefined) return refused
      const staffing = blueprints.staffing(); if (staffing === undefined) return noExecutor
      const out = staffing.withdraw(String(args.id ?? ''), session)
      return out.ok ? { ok: true, id: String(args.id) } : { ok: false, code: out.code, error: out.error }
    },
  } as never))
}
