/**
 * Staffing changes, the core (docs/design/superagent-staffing-changes.md W1/W2 as split by docs/design/superagent-builder.md
 * TB6 step 1, "S1a"): the host's executor of staffing operations, its ledger, the per-operation policy, and the confirmation
 * cards. The source is a field (`owner-local`, or `market:<handle>` once S1b adds that entry); nothing here is an agent tool.
 *
 * - **Executor.** The host carries out each operation with its own authority, through the same checks the canvas and team
 *   routes run (a joined session, its preset, one role per session, the canvas member checks). Nothing is skipped because
 *   the source is local. It runs the operations in order; on a failure it undoes the completed ones in reverse, and an undo
 *   that fails leaves the entry `partial` with each step's state (and a P1 card on each existing team it touched).
 * - **Ledger.** `staffing.json`, idempotent by change id: the same id with the same body answers what is recorded; with a
 *   different body it is refused (`conflict`). One parent entry, its ordered steps.
 * - **Policy.** `auto | confirm | off` per operation and source. `owner-local` never runs on `auto` (builder TB/point 3):
 *   it needs the owner's agreement (the builder's D10 gate, or the owner's control route), and a change to a team that
 *   exists also needs that team's confirmation card. `off` refuses the change.
 * - **This version (S1a).** `team.create`, `member.add` (with an optional profile), `team.rules.set` (with a scope) and,
 *   since the owner ruling of 2026-11-18, `member.retire` (a local member leaves the team's canvas; not the router, not a
 *   member working on a ticket), and since #800 (owner 2026-11-22) `team.github.set` (the team's GitHub Source: on/off, whose
 *   comments are a person's, which repositories and issues). `team.retire` and `member.retemplate` are refused as `not-yet`: a template needs #626 S2. Only existing sessions are used (S39); a template is refused.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/staffing
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { GITHUB_REPOS_MAX, REPO_RE } from './policy.ts'

export const STAFFING_OPS = ['team.create', 'team.retire', 'member.add', 'member.retire', 'member.retemplate', 'team.rules.set', 'team.github.set', 'canvas.create', 'canvas.member.add', 'canvas.member.remove'] as const
export type StaffingOp = typeof STAFFING_OPS[number]
export type StaffingSource = 'owner-local' | `market:${string}`
export type PolicyMode = 'auto' | 'confirm' | 'off'

/** What this version carries out; the rest is refused as `not-yet`. */
const BUILT: ReadonlySet<StaffingOp> = new Set(['team.create', 'member.add', 'member.retire', 'team.rules.set', 'team.github.set', 'canvas.create', 'canvas.member.add', 'canvas.member.remove'])

/** #626 W2 defaults for the market; `owner-local` (a blueprint, agreed as a whole) is `confirm`, retiring is `off`. */
export const DEFAULT_POLICY: Readonly<Record<'owner-local' | 'market', Readonly<Record<StaffingOp, PolicyMode>>>> = {
  'owner-local': { 'team.create': 'confirm', 'team.retire': 'off', 'member.add': 'confirm', 'member.retire': 'confirm', 'member.retemplate': 'off', 'team.rules.set': 'confirm', 'team.github.set': 'confirm', 'canvas.create': 'confirm', 'canvas.member.add': 'confirm', 'canvas.member.remove': 'confirm' },
  market: { 'team.create': 'confirm', 'team.retire': 'confirm', 'member.add': 'auto', 'member.retire': 'auto', 'member.retemplate': 'confirm', 'team.rules.set': 'confirm', 'team.github.set': 'confirm', 'canvas.create': 'off', 'canvas.member.add': 'off', 'canvas.member.remove': 'off' },
}

/** The parameters each operation takes; any other key is refused (`not-allowed`, #626 W3: nothing outside these). */
const PARAMS: Readonly<Record<StaffingOp, readonly string[]>> = {
  'team.create': ['canvas', 'router'],
  'team.retire': ['team'],
  'member.add': ['team', 'session', 'profile'],
  'member.retire': ['team', 'seatId'],
  'member.retemplate': ['team', 'seatId', 'template'],
  'team.rules.set': ['team', 'scope', 'value'],
  'team.github.set': ['team', 'enabled', 'allowed', 'repos', 'intake'],
  'canvas.create': ['canvas'],
  'canvas.member.add': ['canvas', 'member', 'home'],
  'canvas.member.remove': ['canvas', 'member'],
}

export interface StaffingOpInput { readonly op: StaffingOp; readonly params: Readonly<Record<string, unknown>> }
export interface StaffingChange {
  readonly id: string
  readonly source: StaffingSource
  /** Recorded, never trusted (#626 W1): who asked. */
  readonly by: { readonly session?: string; readonly person?: string; readonly name?: string; readonly role?: string }
  readonly summary?: string
  readonly ops: readonly StaffingOpInput[]
}

export type StepState = 'pending' | 'done' | 'failed' | 'undone' | 'undo-failed' | 'skipped'
export type ChangeState = 'awaiting' | 'running' | 'done' | 'refused' | 'failed' | 'partial' | 'withdrawn'
export interface StaffingEntry {
  readonly id: string
  readonly source: StaffingSource
  readonly by: StaffingChange['by']
  readonly summary?: string
  readonly ops: readonly StaffingOpInput[]
  readonly hash: string
  readonly at: string
  state: ChangeState
  /** The owner's agreement (owner-local): when and how it was given. */
  agreed?: { readonly at: string; readonly via: string }
  /** One confirmation card per existing team the change touches: its card id and state. */
  cards: Record<string, { card?: string; state: 'open' | 'confirmed' | 'refused' }>
  steps: Array<{ op: StaffingOp; state: StepState; error?: string; result?: Record<string, string> }>
  /** BS2: each existing team's rule set this change touches, at its revision when it was recorded (`<team>|<scope>`). */
  bases?: Record<string, number>
  reason?: string
  finished?: string
}

/** A team the executor works on: the parts of a superagent team host it needs. */
export interface StaffingTeam {
  readonly settings: { readonly canvas?: string; readonly router?: string; readonly members: readonly string[]; readonly rules: ReadonlyArray<{ name: string; text: string; enabled: boolean }>; readonly dispatch: string; readonly profiles: Readonly<Record<string, unknown>>; readonly sources?: { readonly github?: boolean }; readonly allowed?: { readonly github?: readonly string[] }; readonly github?: { readonly repos: readonly string[]; readonly intake: 'mention' | 'all' } }
  saveSettings(raw: unknown, by: string): { ok: true } | { ok: false; error: string }
  /** The session a seat stands for now, or undefined. */
  memberOfSeat(seatId: string): string | undefined
  /** An open ticket a member owns now — running, parked, or named for it — or undefined (a member with one is not retired). */
  ticketOf?(session: string): string | undefined
  /** A confirmation card on this team for one change; its id. */
  proposeStaffingCard(changeId: string, question: string, reason: string, level: 'P0' | 'P1'): string | undefined
  /** BS2: a rule set's revision (`team`, `dispatch`, `member:<session>`), and one line in its history. */
  ruleRevision?(scope: string): number
  recordRuleChange?(scope: string, change: { by: string; reason: string }): void
}

export interface StaffingDeps {
  readonly path: string
  readonly now: () => string
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
  readonly team: (teamId: string) => StaffingTeam | undefined
  readonly teamOfCanvas: (canvas: string) => string | undefined
  /** The canvas route's create (its reserved-name check), and its remove. */
  readonly canvasCreate: (name: string) => { ok: true } | { ok: false; error: string }
  readonly canvasExists: (name: string) => boolean
  readonly canvasRemove: (name: string) => boolean
  /** The canvas route's add-member for a local session: joined, the member checks, the superagent team refusal. */
  readonly canvasAddLocal: (name: string, session: string) => Promise<{ ok: true } | { ok: false; error: string }>
  readonly canvasRemoveLocal: (name: string, session: string) => boolean
  /** The teams route's add: binds a canvas with its router as a team (preset and one-role checks); the team id. */
  readonly teamAdd: (canvas: string, router: string) => { ok: true; id: string } | { ok: false; error: string }
  /** Unbind a team the change created (its canvas and router cleared). */
  readonly teamUnbind: (teamId: string) => boolean
  /**
   * #808: a plain canvas's member write — the canvas route's own add-member checks (src/canvas-member-write.ts): a joined local
   * session, a zone-qualified remote session with its owner proof, or a CLI handle with its home pinned. Absent: canvas ops fail.
   */
  readonly canvasAddMember?: (name: string, member: string, home?: string) => Promise<{ ok: true; member: string } | { ok: false; error: string }>
  /** The canvas route's remove-member: a local session through its revoke, a remote ref unless suspended. */
  readonly canvasRemoveMember?: (name: string, member: string) => boolean
  /** The members a canvas has now. */
  readonly canvasMembers?: (name: string) => readonly string[]
  /** A CLI member's pinned home origin (#809 R3: restored when a removal is undone). */
  readonly canvasCliHome?: (member: string) => string | undefined
  /** The owner's policy overrides, by source kind and op. */
  readonly policy?: () => Partial<Record<'owner-local' | 'market', Partial<Record<StaffingOp, PolicyMode>>>>
}

const LEDGER_CAP = 500
const CHANGE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const SOURCE = /^(owner-local|market:[a-z0-9-]{1,32}\/[0-9a-f]{16})$/
const NAME = /^[^\s/]{1,64}$/
const SESSION = /^session-[0-9a-f-]{8,64}$/
const SCOPE = /^(team|dispatch|member:seat-[0-9a-f]{8})$/
const RULE_TEXT_MAX = 4_000

type Refusal = { ok: false; code: 'not-allowed' | 'not-yet' | 'off' | 'conflict' | 'invalid' | 'unknown-team'; error: string }

const sourceKind = (source: StaffingSource): 'owner-local' | 'market' => source === 'owner-local' ? 'owner-local' : 'market'
const hashOf = (change: StaffingChange): string => createHash('sha256').update(JSON.stringify({ source: change.source, by: change.by, summary: change.summary ?? '', ops: change.ops })).digest('hex')

/** A rule list as a rule set takes it: 1–40 rules of { name, text, enabled? }. */
function parseRuleList(value: unknown): Array<{ name: string; text: string; enabled: boolean }> | string {
  if (!Array.isArray(value) || value.length > 40) return 'a rule list is 0–40 rules of { name, text, enabled? }'
  const out: Array<{ name: string; text: string; enabled: boolean }> = []
  for (const rule of value) {
    const r = rule as { name?: unknown; text?: unknown; enabled?: unknown } | null
    if (r === null || typeof r !== 'object' || typeof r.name !== 'string' || !/^[a-z0-9-]{1,40}$/.test(r.name) || typeof r.text !== 'string' || r.text.trim() === '' || r.text.length > RULE_TEXT_MAX) return 'each rule is { name: a-z0-9-, text (1–4000 characters), enabled? }'
    if (out.some(o => o.name === r.name)) return `rule ${r.name} appears twice`
    out.push({ name: r.name, text: r.text, enabled: r.enabled !== false })
  }
  return out
}

/** A member profile in a blueprint (builder TB3): role, intake rules, repository. */
function parseProfile(value: unknown): { role?: string; rules?: Array<{ name: string; text: string; enabled: boolean }>; repo?: string } | string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'profile is { role?, rules?, repo? }'
  const p = value as Record<string, unknown>
  if (Object.keys(p).some(key => !['role', 'rules', 'repo'].includes(key))) return 'profile takes only role, rules and repo'
  if (p.role !== undefined && (typeof p.role !== 'string' || p.role.length > 200)) return 'profile.role is text of at most 200 characters'
  if (p.repo !== undefined && (typeof p.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(p.repo))) return 'profile.repo is owner/name'
  const rules = p.rules === undefined ? undefined : parseRuleList(p.rules)
  if (typeof rules === 'string') return `profile.rules: ${rules}`
  return { ...(typeof p.role === 'string' ? { role: p.role } : {}), ...(rules !== undefined ? { rules } : {}), ...(typeof p.repo === 'string' ? { repo: p.repo } : {}) }
}

/** A GitHub login whose comments count as a person's: a person, not a `[bot]` account (allowed lists people). */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

/**
 * `team.github.set` (#800): what the team's GitHub Source is — on or off, whose comments are a person's, which repositories'
 * issues reach it and which of them count. Each key is optional; at least one is given. The host's settings save checks it again.
 */
function githubSetRefusal(p: Readonly<Record<string, unknown>>): string | undefined {
  if (!['enabled', 'allowed', 'repos', 'intake'].some(key => key in p)) return 'team.github.set needs enabled, allowed, repos or intake'
  if ('enabled' in p && typeof p.enabled !== 'boolean') return 'enabled is true or false'
  if ('allowed' in p && (!Array.isArray(p.allowed) || p.allowed.length > 20 || p.allowed.some(x => typeof x !== 'string' || !GITHUB_LOGIN.test(x)))) return 'allowed lists at most 20 GitHub logins of people (no [bot] accounts)'
  if ('repos' in p && (!Array.isArray(p.repos) || p.repos.length > GITHUB_REPOS_MAX || p.repos.some(x => typeof x !== 'string' || !REPO_RE.test(x)))) return `repos lists at most ${String(GITHUB_REPOS_MAX)} repositories as owner/name`
  if ('intake' in p && p.intake !== 'mention' && p.intake !== 'all') return 'intake is mention or all'
  return undefined
}

/** A member a plain canvas takes (#808): a local session id, a zone-qualified remote session, or a CLI handle such as superagent-team/<16 hex>. The host checks it again. */
const CANVAS_MEMBER = /^(session-[0-9a-f-]{8,64}|[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9._@-]{1,96})$/

function canvasOpRefusal(op: StaffingOp, p: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof p.canvas !== 'string' || !NAME.test(p.canvas)) return 'canvas is a canvas name'
  if (op === 'canvas.create') return undefined
  if (typeof p.member !== 'string' || !CANVAS_MEMBER.test(p.member)) return 'member is a local session id, a zone-qualified remote session, or a CLI handle'
  if ('home' in p && (op !== 'canvas.member.add' || typeof p.home !== 'string' || p.home.length > 200)) return 'home is the CLI member\'s home origin'
  return undefined
}

export class StaffingExecutor {
  private entries: StaffingEntry[] = []

  constructor(private readonly d: StaffingDeps) {
    try { if (existsSync(d.path)) this.entries = (JSON.parse(readFileSync(d.path, 'utf8')) as { entries?: StaffingEntry[] }).entries ?? [] } catch { this.entries = [] }
    // A change that was running when the host stopped did not finish: record it so, never run it twice.
    for (const entry of this.entries) if (entry.state === 'running') { entry.state = 'partial'; entry.reason = 'the host stopped while it ran'; entry.finished = d.now() }
  }

  private save(): void {
    if (this.entries.length > LEDGER_CAP) this.entries = this.entries.slice(-LEDGER_CAP)
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify({ entries: this.entries }), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  list(): readonly StaffingEntry[] { return this.entries }
  get(id: string): StaffingEntry | undefined { return this.entries.find(e => e.id === id) }

  private mode(source: StaffingSource, op: StaffingOp): PolicyMode {
    const kind = sourceKind(source)
    const set = this.d.policy?.()[kind]?.[op] ?? DEFAULT_POLICY[kind][op]
    // owner-local never runs on auto: a blueprint is agreed as a whole (builder point 3).
    return kind === 'owner-local' && set === 'auto' ? 'confirm' : set
  }

  /** Check a change's shape, policy and boundaries; the teams that exist which it touches. */
  private check(change: StaffingChange): { ok: true; existing: string[] } | Refusal {
    if (!CHANGE_ID.test(String(change.id))) return { ok: false, code: 'invalid', error: 'id is 1–80 of letters, digits and . _ : -' }
    if (!SOURCE.test(String(change.source))) return { ok: false, code: 'invalid', error: 'source is owner-local or market:<handle>' }
    if (!Array.isArray(change.ops) || change.ops.length === 0 || change.ops.length > 32) return { ok: false, code: 'invalid', error: 'ops is 1–32 operations' }
    // #809 R1: teams and plain canvases this change creates are kept apart, so a canvas op never reaches a team's canvas
    // and a plain canvas is never taken for a team (teamRef).
    const created = new Set<string>()
    const createdCanvases = new Set<string>()
    const existing = new Set<string>()
    for (const [index, input] of change.ops.entries()) {
      const where = `ops[${String(index)}]`
      if (!(STAFFING_OPS as readonly string[]).includes(String(input?.op))) return { ok: false, code: 'invalid', error: `${where}.op is one of ${STAFFING_OPS.join(', ')}` }
      const params = input.params !== null && typeof input.params === 'object' && !Array.isArray(input.params) ? input.params : undefined
      if (params === undefined) return { ok: false, code: 'invalid', error: `${where}.params is an object` }
      const op = input.op as StaffingOp
      const extra = Object.keys(params).filter(key => !PARAMS[op].includes(key))
      if (extra.length > 0) return { ok: false, code: 'not-allowed', error: `${where} (${op}) takes no ${extra.join(', ')}: only ${PARAMS[op].join(', ')} (#626 W3)` }
      if (this.mode(change.source, input.op) === 'off') return { ok: false, code: 'off', error: `${input.op} is off for ${sourceKind(change.source)} changes` }
      // Owner ruling 2026-11-18 gave retiring to the team builder (owner-local) only; the market's `auto` default for it stays unused.
      if (input.op === 'member.retire' && change.source !== 'owner-local') return { ok: false, code: 'not-yet', error: 'member.retire comes only from the team builder\'s blueprint (owner-local) in this version' }
      if (!BUILT.has(input.op)) return { ok: false, code: 'not-yet', error: `${input.op} is not carried out in this version (retiring a whole team is not in a blueprint; templates need #626 S2)` }
      const teamRef = (): string | Refusal => {
        const team = params.team
        if (typeof team !== 'string' || team === '') return { ok: false, code: 'invalid', error: `${where}.team is a team id, or a canvas this change creates` }
        if (created.has(team)) return team
        const id = this.d.team(team) !== undefined ? team : undefined
        if (id === undefined) return { ok: false, code: 'unknown-team', error: `${where}.team ${team}: no such team here (an existing team is named by its id; a new one by the canvas an earlier team.create makes)` }
        existing.add(id)
        return id
      }
      if (input.op === 'team.create') {
        if (typeof params.canvas !== 'string' || !NAME.test(params.canvas)) return { ok: false, code: 'invalid', error: `${where}.canvas is a canvas name` }
        if (typeof params.router !== 'string' || !SESSION.test(params.router)) return { ok: false, code: 'invalid', error: `${where}.router is an existing session (a template is not taken: S39)` }
        if (created.has(params.canvas) || createdCanvases.has(params.canvas) || this.d.canvasExists(params.canvas)) return { ok: false, code: 'invalid', error: `${where}: canvas ${params.canvas} exists already` }
        created.add(params.canvas)
      } else if (input.op === 'member.add') {
        const team = teamRef(); if (typeof team !== 'string') return team
        if (typeof params.session !== 'string' || !SESSION.test(params.session)) return { ok: false, code: 'invalid', error: `${where}.session is an existing session (a template is not taken: S39)` }
        if (params.profile !== undefined) { const profile = parseProfile(params.profile); if (typeof profile === 'string') return { ok: false, code: 'invalid', error: `${where}.${profile}` } }
      } else if (input.op === 'member.retire') {
        const team = teamRef(); if (typeof team !== 'string') return team
        if (created.has(team)) return { ok: false, code: 'invalid', error: `${where}: a team this change creates has no member to retire yet` }
        if (typeof params.seatId !== 'string' || params.seatId === '') return { ok: false, code: 'invalid', error: `${where}.seatId is the seat of a member on the team now` }
      } else if (input.op === 'canvas.create' || input.op === 'canvas.member.add' || input.op === 'canvas.member.remove') {
        const bad = canvasOpRefusal(input.op, params)
        if (bad !== undefined) return { ok: false, code: 'invalid', error: `${where}.${bad}` }
        const canvas = params.canvas as string
        // #808: a superagent team's canvas changes only through member.add / member.retire (the team's own checks and card).
        if (this.d.teamOfCanvas(canvas) !== undefined || created.has(canvas)) return { ok: false, code: 'invalid', error: `${where}: canvas ${canvas} is a superagent team's canvas: use member.add or member.retire` }
        if (input.op === 'canvas.create') {
          if (created.has(canvas) || createdCanvases.has(canvas) || this.d.canvasExists(canvas)) return { ok: false, code: 'invalid', error: `${where}: canvas ${canvas} exists already` }
          createdCanvases.add(canvas)
        } else if (!createdCanvases.has(canvas) && !this.d.canvasExists(canvas)) return { ok: false, code: 'invalid', error: `${where}: no canvas ${canvas}: create it first (canvas.create)` }
      } else if (input.op === 'team.github.set') {
        const team = teamRef(); if (typeof team !== 'string') return team
        const bad = githubSetRefusal(params)
        if (bad !== undefined) return { ok: false, code: 'invalid', error: `${where}.${bad}` }
      } else if (input.op === 'team.rules.set') {
        const team = teamRef(); if (typeof team !== 'string') return team
        if (typeof params.scope !== 'string' || !SCOPE.test(params.scope)) return { ok: false, code: 'invalid', error: `${where}.scope is team, dispatch or member:<seatId>` }
        if (params.scope === 'dispatch') { if (typeof params.value !== 'string' || params.value.length > RULE_TEXT_MAX) return { ok: false, code: 'invalid', error: `${where}.value is the dispatch text (at most 4000 characters)` } }
        else { const rules = parseRuleList(params.value); if (typeof rules === 'string') return { ok: false, code: 'invalid', error: `${where}.value: ${rules}` } }
        if (params.scope.startsWith('member:') && created.has(team)) return { ok: false, code: 'invalid', error: `${where}: a member of a new team gets its rules in member.add's profile` }
      }
    }
    return { ok: true, existing: [...existing] }
  }

  /**
   * Record a change. Same id and body: the recorded entry. A change whose ops are all `auto` runs at once; otherwise it waits
   * for the owner's agreement (`owner-local`) and one confirmation card per existing team it touches.
   */
  async submit(change: StaffingChange): Promise<{ ok: true; entry: StaffingEntry; duplicate?: true } | Refusal> {
    const hash = hashOf(change)
    const known = this.get(change.id)
    if (known !== undefined) return known.hash === hash ? { ok: true, entry: known, duplicate: true } : { ok: false, code: 'conflict', error: `change ${change.id} was recorded with a different body` }
    const checked = this.check(change)
    if (!checked.ok) return checked
    const allAuto = change.ops.every(input => this.mode(change.source, input.op) === 'auto')
    const entry: StaffingEntry = { id: change.id, source: change.source, by: change.by, ...(change.summary !== undefined ? { summary: change.summary.slice(0, 500) } : {}), ops: change.ops, hash, at: this.d.now(), state: 'awaiting', cards: {}, steps: change.ops.map(input => ({ op: input.op, state: 'pending' as const })) }
    // BS2: the revisions the change was drafted against; it is refused at run time if one moved (read again, propose afresh).
    const bases: Record<string, number> = {}
    for (const input of change.ops) {
      if (input.op !== 'team.rules.set' || !checked.existing.includes(input.params.team as string)) continue
      const team = this.d.team(input.params.team as string)
      const scope = this.scopeKey(team, input.params.scope as string)
      if (team?.ruleRevision !== undefined && scope !== undefined) bases[`${input.params.team as string}|${scope}`] = team.ruleRevision(scope)
    }
    if (Object.keys(bases).length > 0) entry.bases = bases
    this.entries.push(entry)
    if (!allAuto) {
      for (const teamId of checked.existing) {
        const ops = change.ops.filter(input => input.params.team === teamId)
        const card = this.d.team(teamId)?.proposeStaffingCard(change.id, `编制变更 ${change.id}：${ops.length} 项改动到本团队（${ops.map(o => o.op).join('、')}），来源 ${change.source}${change.by.name !== undefined ? `（${change.by.name}）` : ''}`, `${change.summary ?? ''}\n${ops.map(o => `- ${o.op} ${JSON.stringify(o.params).slice(0, 400)}`).join('\n')}`.trim(), 'P1')
        entry.cards[teamId] = { ...(card !== undefined ? { card } : {}), state: 'open' }
      }
    }
    this.save()
    this.d.logger.info('superagent: staffing change %s recorded (%s, %d ops)', change.id, change.source, change.ops.length)
    if (allAuto || this.ready(entry)) await this.run(entry)
    return { ok: true, entry }
  }

  /** The owner agreed to an `owner-local` change (the builder's D10 gate, or the owner's control route). */
  async agree(id: string, via: string): Promise<{ ok: true; entry: StaffingEntry } | { ok: false; code: string; error: string }> {
    const entry = this.get(id)
    if (entry === undefined) return { ok: false, code: 'unknown', error: `no staffing change ${id}` }
    if (entry.state !== 'awaiting') return { ok: false, code: 'not-awaiting', error: `change ${id} is ${entry.state}` }
    entry.agreed = { at: this.d.now(), via }
    this.save()
    if (this.ready(entry)) await this.run(entry)
    return { ok: true, entry }
  }

  /** A team's confirmation card was decided. */
  async cardDecided(id: string, teamId: string, confirmed: boolean): Promise<void> {
    const entry = this.get(id)
    const card = entry?.cards[teamId]
    if (entry === undefined || card === undefined || entry.state !== 'awaiting' || card.state !== 'open') return
    card.state = confirmed ? 'confirmed' : 'refused'
    if (!confirmed) { entry.state = 'refused'; entry.reason = `team ${teamId} refused it on its card`; entry.finished = this.d.now() }
    this.save()
    if (confirmed && this.ready(entry)) await this.run(entry)
  }

  private ready(entry: StaffingEntry): boolean {
    if (entry.state !== 'awaiting') return false
    // Every existing team it touches has confirmed on its card.
    if (Object.values(entry.cards).some(card => card.state !== 'confirmed')) return false
    // owner-local: the owner agreed (a blueprint is agreed as a whole). The market's entry (S1b) decides its own gate; here a
    // market change runs only when all its ops are auto or its teams' cards stand for the confirmation.
    if (sourceKind(entry.source) === 'owner-local') return entry.agreed !== undefined
    return entry.ops.every(input => this.mode(entry.source, input.op) === 'auto') || Object.keys(entry.cards).length > 0
  }

  /** The rule-changes scope a staffing scope stands for on a team (`member:<seatId>` → `member:<session>`). */
  private scopeKey(team: StaffingTeam | undefined, scope: string): string | undefined {
    if (scope === 'team' || scope === 'dispatch') return scope
    const member = team?.memberOfSeat(scope.slice('member:'.length))
    return member === undefined ? undefined : `member:${member}`
  }

  /** Withdraw a change still awaiting, by whoever recorded it (`by.session`). */
  withdraw(id: string, session: string): { ok: true } | { ok: false; code: string; error: string } {
    const entry = this.get(id)
    if (entry === undefined) return { ok: false, code: 'unknown', error: `no staffing change ${id}` }
    if (entry.by.session !== session) return { ok: false, code: 'not-yours', error: `change ${id} was not drafted in this session` }
    if (entry.state !== 'awaiting') return { ok: false, code: 'not-awaiting', error: `change ${id} is ${entry.state}` }
    entry.state = 'withdrawn'
    entry.finished = this.d.now()
    this.save()
    return { ok: true }
  }

  /** Carry the change out in order; on a failure, undo the completed steps in reverse. */
  private async run(entry: StaffingEntry): Promise<void> {
    // A rule set that moved since the change was drafted: nothing runs (BS2, as superagent_rules_apply's stale check).
    for (const [key, base] of Object.entries(entry.bases ?? {})) {
      const [teamId, scope] = key.split('|') as [string, string]
      const now = this.d.team(teamId)?.ruleRevision?.(scope)
      if (now !== undefined && now !== base) {
        entry.state = 'failed'
        entry.reason = `team ${teamId}'s ${scope} rules changed after the change was drafted (revision ${String(base)} → ${String(now)}): read again and propose afresh`
        entry.finished = this.d.now()
        for (const step of entry.steps) step.state = 'skipped'
        this.save()
        return
      }
    }
    entry.state = 'running'
    this.save()
    const created = new Map<string, string>()
    const undo: Array<{ index: number; fn: () => boolean | Promise<boolean> }> = []
    const resolve = (team: unknown): string | undefined => typeof team === 'string' ? created.get(team) ?? team : undefined
    for (const [index, input] of entry.ops.entries()) {
      const step = entry.steps[index]!
      try {
        const out = await this.step(input, resolve, created, fn => undo.push({ index, fn }), entry)
        if (!out.ok) throw new Error(out.error)
        step.state = 'done'
        if (out.result !== undefined) step.result = out.result
      } catch (error) {
        step.state = 'failed'
        step.error = String(error instanceof Error ? error.message : error).slice(0, 300)
        for (const later of entry.steps.slice(index + 1)) later.state = 'skipped'
        let clean = true
        for (const { index: done, fn } of undo.reverse()) {
          let ok = false
          try { ok = await fn() } catch { ok = false }
          entry.steps[done]!.state = ok ? 'undone' : 'undo-failed'
          clean &&= ok
        }
        entry.state = clean ? 'failed' : 'partial'
        entry.reason = `${input.op} failed: ${step.error}`
        entry.finished = this.d.now()
        this.save()
        this.d.logger.warn('superagent: staffing change %s %s at step %d: %s', entry.id, entry.state, index, step.error)
        if (!clean) for (const teamId of Object.keys(entry.cards)) this.d.team(teamId)?.proposeStaffingCard(entry.id, `编制变更 ${entry.id} 只做了一部分（撤销没有全部成功）`, entry.steps.map((s, i) => `${String(i + 1)}. ${s.op}: ${s.state}${s.error !== undefined ? `（${s.error}）` : ''}`).join('\n'), 'P1')
        return
      }
    }
    entry.state = 'done'
    entry.finished = this.d.now()
    this.save()
    this.d.logger.info('superagent: staffing change %s done', entry.id)
  }

  private async step(input: StaffingOpInput, resolve: (team: unknown) => string | undefined, created: Map<string, string>, onUndo: (fn: () => boolean | Promise<boolean>) => void, entry: StaffingEntry): Promise<{ ok: true; result?: Record<string, string> } | { ok: false; error: string }> {
    const p = input.params
    const by = 'staffing'
    // TB4: each rule set the change writes gets one line in its history; an undo gets one too.
    const drafted = entry.by.session !== undefined ? `由组队顾问蓝图 ${entry.id} 起草` : `编制变更 ${entry.id}（${entry.source}）`
    const note = `${drafted}，主人确认于 ${entry.agreed?.at ?? this.d.now()}`
    const history = (team: StaffingTeam, scope: string, reason: string): void => { try { team.recordRuleChange?.(scope, { by: entry.by.session !== undefined ? 'builder' : 'staffing', reason }) } catch { /* the history is a record, not the change */ } }
    if (input.op === 'team.create') {
      const canvas = p.canvas as string, router = p.router as string
      const made = this.d.canvasCreate(canvas)
      if (!made.ok) return made
      onUndo(() => this.d.canvasRemove(canvas))
      const joined = await this.d.canvasAddLocal(canvas, router)
      if (!joined.ok) return joined
      onUndo(() => this.d.canvasRemoveLocal(canvas, router))
      const bound = this.d.teamAdd(canvas, router)
      if (!bound.ok) return bound
      onUndo(() => this.d.teamUnbind(bound.id))
      created.set(canvas, bound.id)
      return { ok: true, result: { teamId: bound.id, canvas } }
    }
    // #808: plain canvas ops. The owner's agreement in the builder session is the operator's own act (owner ruling
    // 2026-11-22); the member it writes is the explicit canvas record admission reads, traced to this entry in the ledger.
    // #809 R1: checked again at run time: a canvas bound to a superagent team since submit (or by an earlier step) is refused.
    if ((input.op === 'canvas.create' || input.op === 'canvas.member.add' || input.op === 'canvas.member.remove') && (this.d.teamOfCanvas(p.canvas as string) !== undefined || created.has(p.canvas as string))) {
      return { ok: false, error: `canvas ${String(p.canvas)} is a superagent team's canvas: use member.add or member.retire` }
    }
    if (input.op === 'canvas.create') {
      const canvas = p.canvas as string
      const made = this.d.canvasCreate(canvas)
      if (!made.ok) return made
      onUndo(() => this.d.canvasRemove(canvas))
      return { ok: true, result: { canvas, by: `builder-blueprint ${entry.id}` } }
    }
    if (input.op === 'canvas.member.add' || input.op === 'canvas.member.remove') {
      const canvas = p.canvas as string, member = p.member as string
      if (this.d.canvasAddMember === undefined || this.d.canvasRemoveMember === undefined) return { ok: false, error: 'this host does not carry canvas member writes' }
      // #809 R2: the members before the write; the host may store a normalized ref (an owner-qualified remote member), so
      // "was it there" is decided on the ref the host wrote, never on the input.
      const before = new Set(this.d.canvasMembers?.(canvas) ?? [])
      if (input.op === 'canvas.member.add') {
        const added = await this.d.canvasAddMember(canvas, member, typeof p.home === 'string' ? p.home : undefined)
        if (!added.ok) return added
        if (!before.has(added.member)) onUndo(() => this.d.canvasRemoveMember!(canvas, added.member))
        return { ok: true, result: { canvas, member: added.member, by: `builder-blueprint ${entry.id}` } }
      }
      if (!before.has(member)) return { ok: false, error: `${member} is not on canvas ${canvas}` }
      // #809 R3: removing a CLI member from its last canvas forgets its pinned home; an undo puts the same home back.
      const home = this.d.canvasCliHome?.(member)
      if (!this.d.canvasRemoveMember(canvas, member)) return { ok: false, error: `${member} could not be taken off canvas ${canvas}` }
      onUndo(async () => (await this.d.canvasAddMember!(canvas, member, home)).ok)
      return { ok: true, result: { canvas, member, by: `builder-blueprint ${entry.id}` } }
    }
    const teamId = resolve(p.team)
    const team = teamId === undefined ? undefined : this.d.team(teamId)
    if (teamId === undefined || team === undefined) return { ok: false, error: `no team ${String(p.team)}` }
    const canvas = team.settings.canvas
    if (canvas === undefined) return { ok: false, error: `team ${teamId} is bound to no canvas` }
    if (input.op === 'member.add') {
      const session = p.session as string
      const before = team.settings.profiles
      const joined = await this.d.canvasAddLocal(canvas, session)
      if (!joined.ok) return joined
      onUndo(() => this.d.canvasRemoveLocal(canvas, session))
      if (p.profile !== undefined) {
        const profile = parseProfile(p.profile)
        if (typeof profile === 'string') return { ok: false, error: profile }
        const saved = team.saveSettings({ profiles: { ...before, [session]: profile } }, by)
        if (!saved.ok) return saved
        history(team, `member:${session}`, note)
        onUndo(() => { const ok = team.saveSettings({ profiles: before }, by).ok; if (ok) history(team, `member:${session}`, `${drafted}失败，已撤回`); return ok })
      }
      return { ok: true, result: { teamId, session } }
    }
    if (input.op === 'member.retire') {
      // Owner ruling 2026-11-18: the team builder may take a member off a team. Only a local member, never the router, and
      // never one working on a ticket (its work would be cut off): the owner stops or finishes that ticket first.
      const seatId = p.seatId as string
      const session = team.memberOfSeat(seatId)
      if (session === undefined) return { ok: false, error: `seat ${seatId} is not on team ${teamId} now` }
      if (session === team.settings.router) return { ok: false, error: `seat ${seatId} is the team's router: a team keeps its router (bind another one first)` }
      if (session.includes('/')) return { ok: false, error: `seat ${seatId} is a member on another host: remove it on the canvas` }
      const ticket = team.ticketOf?.(session)
      if (ticket !== undefined) return { ok: false, error: `seat ${seatId} is working on ticket ${ticket}: stop or finish it first` }
      if (!this.d.canvasRemoveLocal(canvas, session)) return { ok: false, error: `seat ${seatId} could not be taken off canvas ${canvas}` }
      onUndo(async () => (await this.d.canvasAddLocal(canvas, session)).ok)
      return { ok: true, result: { teamId, seatId, session } }
    }
    if (input.op === 'team.github.set') {
      const s = team.settings
      const before = { enabled: s.sources?.github ?? false, allowed: s.allowed?.github ?? [], github: s.github }
      const raw: Record<string, unknown> = {}
      if ('enabled' in p) raw.sources = { github: p.enabled }
      if ('allowed' in p) raw.allowed = { github: p.allowed }
      if ('repos' in p || 'intake' in p) {
        const repos = 'repos' in p ? p.repos as string[] : before.github?.repos
        if (repos === undefined) return { ok: false, error: `team ${teamId} follows no repository yet: give repos with intake` }
        raw.github = repos.length === 0 ? null : { repos, intake: 'intake' in p ? p.intake : before.github?.intake ?? 'mention' }
      }
      const saved = team.saveSettings(raw, by)
      if (!saved.ok) return saved
      onUndo(() => team.saveSettings({ sources: { github: before.enabled }, allowed: { github: before.allowed }, github: before.github ?? null }, by).ok)
      return { ok: true, result: { teamId, github: 'set' } }
    }
    // team.rules.set
    const scope = p.scope as string
    if (scope === 'team') {
      const before = team.settings.rules
      const saved = team.saveSettings({ rules: parseRuleList(p.value) }, by)
      if (!saved.ok) return saved
      history(team, 'team', note)
      onUndo(() => { const ok = team.saveSettings({ rules: before }, by).ok; if (ok) history(team, 'team', `${drafted}失败，已恢复到之前的内容`); return ok })
    } else if (scope === 'dispatch') {
      const before = team.settings.dispatch
      const saved = team.saveSettings({ dispatch: p.value as string }, by)
      if (!saved.ok) return saved
      history(team, 'dispatch', note)
      onUndo(() => { const ok = team.saveSettings({ dispatch: before }, by).ok; if (ok) history(team, 'dispatch', `${drafted}失败，已恢复到之前的内容`); return ok })
    } else {
      const seatId = scope.slice('member:'.length)
      const member = team.memberOfSeat(seatId)
      if (member === undefined) return { ok: false, error: `seat ${seatId} is not on team ${teamId} now` }
      const before = team.settings.profiles
      const current = (before[member] ?? {}) as Record<string, unknown>
      const saved = team.saveSettings({ profiles: { ...before, [member]: { ...current, rules: parseRuleList(p.value) } } }, by)
      if (!saved.ok) return saved
      history(team, `member:${member}`, note)
      onUndo(() => { const ok = team.saveSettings({ profiles: before }, by).ok; if (ok) history(team, `member:${member}`, `${drafted}失败，已恢复到之前的内容`); return ok })
    }
    return { ok: true, result: { teamId, scope } }
  }
}
