/**
 * superagent design v4, PR-B: the a2a team's Policy and SourceScope for the vendored engine.
 *
 * The gate follows upstream docs/002 for the two a2a Sources:
 * - `workbench`: a person — the owner, authenticated by the owner's control credential (the workbench, or the CLI's
 *   `a2a-net superagent request`) — always addressed (direct);
 * - `a2a`: an A2A message to the team's address. A2A callers are agents (a2a-watch D7: a CLI identity proves a key, not a
 *   person), so their Triggers are never human and enter only through the Source's bot list.
 * Strength (upstream docs/002):
 * - explicit: an allowed person addressing the agent, or an allowed person's follow-up on a Thread with tickets;
 * - inferred: an unlisted person's follow-up on such a Thread, or a message from a bot on the Source's bot list that
 *   addresses the agent — never an explicit request, never a stop (the engine refuses `stopNotExplicit`);
 * - not admitted: any other bot, every other message, and every inferred case while the accept mode is `off`.
 * The accept mode (upstream default `observe`): `observe` lets the router assess inferred candidates but records a positive
 * assessment as an ignore that says it would accept; `auto` accepts it on enabled rules it matched.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/policy
 */
import { createHash } from 'node:crypto'
import type { GateResult, Mandate, Policy, PolicyEffect, SourceScope, Thread, Ticket, Trigger } from '../upstream/dsh-superagent/src/core/index.ts'
import { scope as a2aScope } from '../a2a-watch.ts'

/** The Sources this host runs. */
export const SOURCES = ['workbench', 'a2a', 'github'] as const
export type SourceName = typeof SOURCES[number]

export type AcceptMode = 'off' | 'observe' | 'auto'

/** Which repositories' issues reach the team, and which issues count (design github-issues G1, G2). */
export interface GithubIntake { readonly repos: readonly string[]; readonly intake: 'mention' | 'all' }
export const GITHUB_REPOS_MAX = 10
/** A remote member: `ref` is `<zone>/<id8>@<fp8>`, `key` the member host's full public key, `url` its base URL. */
export interface RemoteMember { readonly ref: string; readonly key: string; readonly url: string }
/** A kind of proactive work the team may take on without being asked (upstream: Policy rules). */
export interface ProactiveRule { readonly name: string; readonly text: string; readonly enabled: boolean }

/** The owner's team settings (owner control route only). */
export interface TeamSettings {
  /**
   * Design v5: the canvas team (a canvas this host owns) that IS the team. The owner composes it in the planning view;
   * the router is one of its local sessions and every other member slot is the member pool. Absent until the owner binds one.
   */
  readonly canvas?: string
  /** The router (upstream's main Session): a local session of the bound canvas; absent until the owner names one. */
  readonly router?: string
  /**
   * The executor's fixed member pool: the bound canvas's local sessions other than the router, one worker slot each (no
   * session is ever opened for a ticket). Derived from the canvas on every read; never written by the owner or stored.
   */
  readonly members: readonly string[]
  /**
   * The bound canvas's members on other hosts: the owner-qualified session ref, the key the canvas pinned for it (from a
   * linked peer's signed card), and that host's base URL as this host knows it (empty while unknown). A report or turn end
   * is accepted only when signed by that key. Derived from the canvas on every read; never stored.
   */
  readonly remoteMembers: readonly RemoteMember[]
  /**
   * This host serving another team host: that host's base URL and pinned key, and the local sessions that work for it.
   * Only that key may assign them work. Written only by the `serve-team` control action.
   */
  readonly serves?: { readonly url: string; readonly key: string; readonly members: readonly string[]; /** Design v5: the team's canvas id, `<zone>/canvas/<name>@<fp8>`. */ readonly team?: string }
  /**
   * The repository each member works in (`owner/name`), by member (a local session id or a remote member's ref). A ticket
   * the router accepts for a repository goes only to that repository's members; a ticket without one, to any member.
   */
  readonly repos: Readonly<Record<string, string>>
  /** Who may originate work, per Source, in that Source's own identities (upstream: identities are never mapped across Sources). */
  readonly allowed: { readonly workbench: readonly string[]; readonly a2a: readonly string[]; /** GitHub logins whose comments on a followed pull request are a person's. */ readonly github: readonly string[] }
  /** Agents whose messages may become inferred candidates, per Source (only the A2A Source has bots). */
  readonly bots: { readonly a2a: readonly string[] }
  /** Whether inferred candidates are assessed and accepted (upstream accept mode). */
  readonly acceptMode: AcceptMode
  /** Proactive rules: an inferred candidate is accepted only on enabled rules its assessment matched. */
  readonly rules: readonly ProactiveRule[]
  /**
   * The members who may also open tickets (design D15): the pool's local sessions created under the observer preset. Each is
   * an ordinary member in every other way. What it files is an agent's request, never a person's. Derived on every read; never stored.
   */
  readonly observers: readonly string[]
  /** Each member's role and the rules of what it takes, by member (design D1). */
  readonly profiles: Readonly<Record<string, MemberProfile>>
  /** The command that prepares a ticket's directory before its member starts (design reliability R1–R4). */
  readonly prepare?: { readonly command: string; readonly timeoutMs: number }
  /** How many tickets may run at once; 0 is no cap beyond one per member (design reliability R5). */
  readonly maxConcurrent: number
  /** How the router chooses among members (design D3): free text the owner agreed. */
  readonly dispatch: string
  /** Sources that listen. The workbench is on by default; the A2A Source is wired in a later PR. */
  readonly sources: { readonly workbench: boolean; readonly a2a: boolean; readonly github?: boolean }
  /** GitHub issues as a source of requests (design github-issues G1, G2). */
  readonly github?: GithubIntake
  /** How long the router may take over a candidate before its Eval expires (upstream: re-queued twice, then unavailable). */
  readonly evalTimeoutMs: number
  /** Pause processing (upstream docs/003): Sources still record Triggers; Evals, dispatch and replies wait. */
  readonly paused: boolean
  /** Who reviews the team's pull requests: one A2A address the owner set and linked (design D5). Absent: nobody is asked. */
  readonly reviewer?: string
}

/** A member's role and what it takes. */
export interface MemberProfile { readonly role?: string; readonly rules: readonly ProactiveRule[] }
export const ROLE_MAX = 200, DISPATCH_MAX = 4_000, PREPARE_MAX = 4_000

/** A canvas team name as the canvas store takes it: 1–40 characters, no `/`, not all digits, no surrounding space. */
export const validCanvasName = (name: unknown): name is string =>
  typeof name === 'string' && name !== '' && name.length <= 40 && name.trim() === name && !name.includes('/') && !/^\d+$/.test(name) && !/@[0-9a-f]{8}$/.test(name)

/** A repository as GitHub names it: `owner/name`. */
export const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/

/** The workbench actor id: the owner, the only person the workbench control route serves. */
export const WORKBENCH_OWNER = 'owner'
/** The actor of a request sent with the owner's credential from the terminal: an ordinary message, not a person (owner 2026-11-08). */
export const WORKBENCH_CLI = 'cli'
/** How many requests an observer may have open at once: it acts on its own judgement, and a loop must not fill the team's queue. */
export const OBSERVER_OPEN_MAX = 5
const OBSERVER_ACTOR = 'observer:'
/** The workbench actor of a request an observer filed: the session is in the id, so a removed observer's tickets can be told. */
export const observerActor = (session: string): string => `${OBSERVER_ACTOR}${session}`
/** The observer a workbench actor id names, if it names one. */
export const observerOfActor = (actor: string): string | undefined => actor.startsWith(OBSERVER_ACTOR) ? actor.slice(OBSERVER_ACTOR.length) : undefined

export const DEFAULT_SETTINGS: TeamSettings = {
  members: [],
  remoteMembers: [],
  repos: {},
  allowed: { workbench: [WORKBENCH_OWNER], a2a: [], github: [] },
  bots: { a2a: [] },
  acceptMode: 'observe',
  rules: [],
  observers: [],
  maxConcurrent: 0,
  profiles: {},
  dispatch: '',
  sources: { workbench: true, a2a: false, github: false },
  evalTimeoutMs: 10 * 60_000,
  paused: false,
}

/** A rule list, normalized, or the first problem with it. */
function parseRules(value: unknown, where: string): readonly ProactiveRule[] | string {
  if (!Array.isArray(value) || value.length > 32) return `${where} must be a list of at most 32 rules`
  const seen = new Set<string>()
  const parsedRules: ProactiveRule[] = []
  for (const rule of value as unknown[]) {
    const x = (rule ?? {}) as Record<string, unknown>
    if (typeof x.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(x.name) || seen.has(x.name)) return 'each rule needs a unique name of lowercase letters, digits and dashes'
    if (typeof x.text !== 'string' || x.text.trim() === '' || x.text.length > 2_000) return `rule ${x.name} needs a text of at most 2000 characters`
    if (x.enabled !== undefined && typeof x.enabled !== 'boolean') return `rule ${x.name}: enabled must be true or false`
    seen.add(x.name)
    parsedRules.push({ name: x.name, text: x.text.trim(), enabled: x.enabled !== false })
  }
  return parsedRules
}

/** Validate an owner's settings write; returns the normalized settings or the first problem. */
export function parseSettings(raw: unknown, current: TeamSettings): { ok: true; settings: TeamSettings } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'settings must be an object' }
  const r = raw as Record<string, unknown>
  const list = (value: unknown, name: string): readonly string[] | string => {
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || v.trim() === '' || /\s/.test(v))) return `${name} must be a list of identities`
    return [...new Set(value as string[])]
  }
  let canvas = current.canvas
  if ('canvas' in r) {
    if (r.canvas === null || r.canvas === '') canvas = undefined
    else if (validCanvasName(r.canvas)) canvas = r.canvas
    else return { ok: false, error: 'canvas must be the name of a canvas team on this host, or null to unbind' }
  }
  let router = current.router
  if ('router' in r) {
    if (r.router === null || r.router === '') router = undefined
    else if (typeof r.router === 'string' && !/\s/.test(r.router)) router = r.router
    else return { ok: false, error: 'router must be a session id, or null to clear' }
  }
  const allowedRaw = (r.allowed ?? {}) as Record<string, unknown>
  const workbench = 'workbench' in allowedRaw ? list(allowedRaw.workbench, 'allowed.workbench') : current.allowed.workbench
  const a2a = 'a2a' in allowedRaw ? list(allowedRaw.a2a, 'allowed.a2a') : current.allowed.a2a
  if (typeof workbench === 'string') return { ok: false, error: workbench }
  if (typeof a2a === 'string') return { ok: false, error: a2a }
  const github = 'github' in allowedRaw ? list(allowedRaw.github, 'allowed.github') : current.allowed.github
  if (typeof github === 'string') return { ok: false, error: github }
  const sourcesRaw = (r.sources ?? {}) as Record<string, unknown>
  const flag = (name: SourceName): boolean | string => !(name in sourcesRaw) ? current.sources[name] ?? false : typeof sourcesRaw[name] === 'boolean' ? sourcesRaw[name] as boolean : `sources.${name} must be true or false`
  const wb = flag('workbench'), a = flag('a2a'), gh = flag('github')
  if (typeof wb === 'string') return { ok: false, error: wb }
  if (typeof a === 'string') return { ok: false, error: a }
  if (typeof gh === 'string') return { ok: false, error: gh }
  // Design github-issues G1, G2: the repositories whose issues reach the team, and which issues count.
  let githubIntake = current.github
  if ('github' in r) {
    if (r.github === null) githubIntake = undefined
    else {
      const g = (r.github ?? {}) as Record<string, unknown>
      const repos = Array.isArray(g.repos) ? [...new Set(g.repos.map(x => String(x).trim()).filter(x => x !== ''))] : undefined
      if (repos === undefined || repos.length > GITHUB_REPOS_MAX || repos.some(x => !REPO_RE.test(x))) return { ok: false, error: `github.repos must list at most ${String(GITHUB_REPOS_MAX)} repositories as owner/name` }
      const intake = g.intake === undefined ? 'mention' : g.intake
      if (intake !== 'mention' && intake !== 'all') return { ok: false, error: 'github.intake must be mention or all' }
      githubIntake = { repos, intake }
    }
  }
  const evalTimeoutMs = 'evalTimeoutMs' in r ? r.evalTimeoutMs : current.evalTimeoutMs
  if (typeof evalTimeoutMs !== 'number' || !Number.isSafeInteger(evalTimeoutMs) || evalTimeoutMs < 30_000 || evalTimeoutMs > 24 * 3_600_000) return { ok: false, error: 'evalTimeoutMs must be 30000–86400000' }
  let reviewer = current.reviewer
  if ('reviewer' in r) {
    if (r.reviewer === null || r.reviewer === '') reviewer = undefined
    else if (typeof r.reviewer === 'string' && /^[^\s/@]+(\/[^\s/@]+){1,2}(@[0-9a-f]{8})?$/.test(r.reviewer)) reviewer = r.reviewer
    else return { ok: false, error: 'reviewer must be an A2A address, or null to clear' }
  }
  const paused = 'paused' in r ? r.paused : current.paused
  let prepare = current.prepare
  if ('prepare' in r) {
    if (r.prepare === null || r.prepare === '') prepare = undefined
    else {
      const p = (r.prepare ?? {}) as Record<string, unknown>
      const command = typeof p.command === 'string' ? p.command.trim() : ''
      // A write names minutes; the stored settings keep milliseconds.
      const minutes = p.timeoutMinutes !== undefined ? p.timeoutMinutes : typeof p.timeoutMs === 'number' ? p.timeoutMs / 60_000 : 10
      if (command === '' || command.length > PREPARE_MAX) return { ok: false, error: `prepare.command is required, at most ${String(PREPARE_MAX)} characters` }
      if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 30) return { ok: false, error: 'prepare.timeoutMinutes must be 1–30' }
      prepare = { command, timeoutMs: minutes * 60_000 }
    }
  }
  const maxConcurrent = 'maxConcurrent' in r ? r.maxConcurrent : current.maxConcurrent ?? 0
  if (typeof maxConcurrent !== 'number' || !Number.isInteger(maxConcurrent) || maxConcurrent < 0 || maxConcurrent > 64) return { ok: false, error: 'maxConcurrent must be an integer 0–64' }
  if (typeof paused !== 'boolean') return { ok: false, error: 'paused must be true or false' }
  const botsRaw = (r.bots ?? {}) as Record<string, unknown>
  if (Object.keys(botsRaw).some(name => name !== 'a2a')) return { ok: false, error: 'only the a2a Source has a bot list' }
  const bots = 'a2a' in botsRaw ? list(botsRaw.a2a, 'bots.a2a') : current.bots.a2a
  if (typeof bots === 'string') return { ok: false, error: bots }
  const acceptMode = 'acceptMode' in r ? r.acceptMode : current.acceptMode
  if (acceptMode !== 'off' && acceptMode !== 'observe' && acceptMode !== 'auto') return { ok: false, error: 'acceptMode must be off, observe or auto' }
  let rules = current.rules
  if ('rules' in r) {
    const parsed = parseRules(r.rules, 'rules')
    if (typeof parsed === 'string') return { ok: false, error: parsed }
    rules = parsed
  }
  if ('members' in r || 'remoteMembers' in r) return { ok: false, error: 'the team is a canvas team: add or remove members on the canvas (planning view 建队), then bind it here with canvas and router' }
  if ('serves' in r) return { ok: false, error: 'serving a team is set by its own action (serve-team), which pins the peer key' }
  // The pool is the bound canvas's, which the host derives; a settings write never names members.
  const members = current.members
  // A member's repository: named explicitly here, or kept from the current settings while it is still a member.
  const memberIds = new Set([...members, ...current.remoteMembers.map(m => m.ref)])
  let repos: Record<string, string>
  if ('repos' in r) {
    if (r.repos === null || typeof r.repos !== 'object' || Array.isArray(r.repos)) return { ok: false, error: 'repos maps a member to its repository (owner/name)' }
    repos = {}
    for (const [member, repo] of Object.entries(r.repos as Record<string, unknown>)) {
      if (!memberIds.has(member)) return { ok: false, error: `repos: ${member} is not a member` }
      if (typeof repo !== 'string' || !REPO_RE.test(repo)) return { ok: false, error: `repos: ${member} needs a repository as owner/name` }
      repos[member] = repo
    }
  } else repos = Object.fromEntries(Object.entries(current.repos ?? {}).filter(([member]) => memberIds.has(member)))
  // A member's profile: as repos, named explicitly here or kept while it is still a member.
  let profiles: Record<string, MemberProfile>
  if ('profiles' in r) {
    if (r.profiles === null || typeof r.profiles !== 'object' || Array.isArray(r.profiles)) return { ok: false, error: 'profiles maps a member to its role and rules' }
    profiles = {}
    for (const [member, value] of Object.entries(r.profiles as Record<string, unknown>)) {
      if (!memberIds.has(member)) return { ok: false, error: `profiles: ${member} is not a member` }
      const x = (value ?? {}) as Record<string, unknown>
      const role = x.role === undefined || x.role === null ? '' : x.role
      if (typeof role !== 'string' || role.length > ROLE_MAX) return { ok: false, error: `profiles: ${member} needs a role of at most ${String(ROLE_MAX)} characters` }
      const memberRules = parseRules(x.rules ?? [], `profiles: ${member} rules`)
      if (typeof memberRules === 'string') return { ok: false, error: memberRules }
      if (role.trim() === '' && memberRules.length === 0) continue
      profiles[member] = { ...(role.trim() !== '' ? { role: role.trim() } : {}), rules: memberRules }
    }
  } else profiles = Object.fromEntries(Object.entries(current.profiles ?? {}).filter(([member]) => memberIds.has(member)))
  if ('observers' in r) return { ok: false, error: 'an observer is a session created under the superagent-observer preset: add one to the canvas team' }
  const observers = current.observers ?? []
  const dispatch = 'dispatch' in r ? r.dispatch : current.dispatch ?? ''
  if (typeof dispatch !== 'string' || dispatch.length > DISPATCH_MAX) return { ok: false, error: `dispatch must be text of at most ${String(DISPATCH_MAX)} characters` }
  return { ok: true, settings: { ...(canvas !== undefined ? { canvas } : {}), ...(router !== undefined ? { router } : {}), ...(reviewer !== undefined ? { reviewer } : {}), members, remoteMembers: current.remoteMembers, ...(current.serves !== undefined ? { serves: current.serves } : {}), repos, allowed: { workbench, a2a, github }, bots: { a2a: bots }, acceptMode, rules, observers, profiles, dispatch: dispatch.trim(), maxConcurrent, ...(prepare !== undefined ? { prepare } : {}), sources: { workbench: wb, a2a: a, github: gh }, ...(githubIntake !== undefined ? { github: githubIntake } : {}), evalTimeoutMs, paused } }
}

const QUALIFIED_REF = /^[^/\s@]+\/[0-9a-f]{8}@[0-9a-f]{8}$/
const validUrl = (url: unknown): url is string => { try { const u = new URL(String(url)); return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === String(url) } catch { return false } }
const validKey = (key: unknown): key is string => typeof key === 'string' && /^[A-Za-z0-9+/]{40,}={0,2}$/.test(key)
/** One pinned remote member, or undefined when malformed. */
export function parseRemoteMember(raw: unknown): RemoteMember | undefined {
  const r = (raw ?? {}) as Record<string, unknown>
  return typeof r.ref === 'string' && QUALIFIED_REF.test(r.ref) && validKey(r.key) && validUrl(r.url) ? { ref: r.ref, key: r.key, url: r.url } : undefined
}

/**
 * Settings as stored: the owner fields plus the served team only the host's own action writes. The pool is never stored
 * (design v5: it is the bound canvas's); a v4 file's members and remote members are dropped on load, and its repositories
 * are kept for the members the canvas still has.
 */
export function parseStoredSettings(raw: unknown): { ok: true; settings: TeamSettings } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'settings must be an object' }
  const { members: _members, remoteMembers: _remote, observers: _observers, serves, repos, profiles, ...rest } = raw as Record<string, unknown>
  // Repositories are checked against the pool when the owner writes them; here only their shape, for whoever they name.
  const named = repos !== null && typeof repos === 'object' && !Array.isArray(repos) ? Object.keys(repos) : []
  const profiled = profiles !== null && typeof profiles === 'object' && !Array.isArray(profiles) ? Object.keys(profiles) : []
  const parsed = parseSettings({ ...rest, ...(repos === undefined ? {} : { repos }), ...(profiles === undefined ? {} : { profiles }) }, { ...DEFAULT_SETTINGS, members: [...named, ...profiled] })
  if (!parsed.ok) return parsed
  let served: TeamSettings['serves']
  if (serves !== undefined) {
    const sv = (serves ?? {}) as Record<string, unknown>
    if (!validUrl(sv.url) || !validKey(sv.key) || !Array.isArray(sv.members) || sv.members.some(m => typeof m !== 'string' || m === '')) return { ok: false, error: 'the stored served team is malformed' }
    served = { url: sv.url, key: sv.key, members: sv.members as string[], ...(typeof sv.team === 'string' && /^[^/\s]+\/canvas\/[^/\s]+@[0-9a-f]{8}$/.test(sv.team) ? { team: sv.team } : {}) }
  }
  return { ok: true, settings: { ...parsed.settings, members: [], remoteMembers: [], observers: [], ...(served !== undefined ? { serves: served } : {}) } }
}

/**
 * The Policy version covers what decides authorization (upstream: the rules, the accept mode and each Source's part —
 * its allowed list and bot list). Source switches, the router and timing are configuration, not Policy.
 */
export function policyVersion(settings: TeamSettings): string {
  const canonical = JSON.stringify({
    mode: settings.acceptMode,
    allowed: { workbench: [...settings.allowed.workbench].sort(), a2a: [...settings.allowed.a2a].sort(), ...((settings.allowed.github?.length ?? 0) > 0 ? { github: [...settings.allowed.github].sort() } : {}) },
    bots: { a2a: [...settings.bots.a2a].sort() },
    rules: [...settings.rules].sort((a, b) => (a.name < b.name ? -1 : 1)).map(rule => [rule.name, rule.text, rule.enabled]),
  })
  return `a2a1:${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`
}

const allowedOn = (settings: TeamSettings, source: string, actor: string): boolean =>
  (source === 'workbench' || source === 'a2a' || source === 'github') && settings.allowed[source]?.includes(actor) === true
const botOn = (settings: TeamSettings, source: string, actor: string): boolean => (source === 'a2a' && settings.bots.a2a.includes(actor)) || (source === 'workbench' && actor === WORKBENCH_CLI)
const observerOn = (settings: TeamSettings, source: string, actor: string): boolean => {
  const session = source === 'workbench' ? observerOfActor(actor) : undefined
  // Pool membership, not the preset: a preset is known only while its session is loaded, and only the host builds this actor,
  // after checking the preset (requestForObserver). A session that left the team loses what it filed from here on.
  return session !== undefined && settings.members.includes(session)
}
/**
 * What a settings change means to each open ticket, in upstream's PolicyEffect terms (the engine records it as the
 * ticket's `policy-changed` input and delivers it to its worker): a rule the ticket was accepted on that changed or no
 * longer applies, proactive work no longer accepted, or a requester no longer allowed to start work. Tickets nothing
 * happened to are left out. (Before this, the host told open tickets nothing — router acceptance follow-up.)
 * @param before - the settings in force when the tickets were accepted.
 * @param after - the settings just saved.
 * @param open - the team's open tickets.
 * @returns the effect per ticket id.
 */
export function policyEffects(before: TeamSettings, after: TeamSettings, open: readonly Pick<Ticket, 'id' | 'mandate'>[]): Map<string, PolicyEffect> {
  const effects = new Map<string, PolicyEffect>()
  for (const ticket of open) {
    const mandate = ticket.mandate
    if (mandate === undefined) continue
    const effect: { rules?: NonNullable<PolicyEffect['rules']>; proactive?: false; requesterAllowed?: false; requester?: PolicyEffect['requester'] } = {}
    const rules: NonNullable<PolicyEffect['rules']> = []
    for (const name of mandate.basis.rules ?? []) {
      const was = before.rules.find(rule => rule.name === name)
      const now = after.rules.find(rule => rule.name === name)
      if (was?.enabled === true && now?.enabled !== true) rules.push({ id: name, name, change: 'disabled' })
      else if (was !== undefined && now?.enabled === true && now.text !== was.text) rules.push({ id: name, name, change: 'changed', instruction: now.text })
    }
    if (rules.length > 0) effect.rules = rules
    if (mandate.strength === 'inferred' && before.acceptMode === 'auto' && after.acceptMode !== 'auto') effect.proactive = false
    const { source, id } = mandate.actor
    const allowedBefore = allowedOn(before, source, id) || botOn(before, source, id) || observerOn(before, source, id)
    if (allowedBefore && !allowedOn(after, source, id) && !botOn(after, source, id) && !observerOn(after, source, id)) { effect.requesterAllowed = false; effect.requester = mandate.actor }
    if (Object.keys(effect).length > 0) effects.set(ticket.id, effect)
  }
  return effects
}

/** Whether an inferred candidate may be accepted on these matched rules: `auto`, at least one, every one enabled. */
const admits = (settings: TeamSettings, rules: readonly string[]): boolean => settings.acceptMode === 'auto' && rules.length > 0
  && rules.every(name => settings.rules.some(rule => rule.name === name && rule.enabled))

export function teamPolicy(settings: TeamSettings): Policy {
  return {
    version: policyVersion(settings),
    paused: settings.paused,
    evalTimeoutMs: settings.evalTimeoutMs,
    gate(trigger: Trigger, thread: Thread, _tickets: Ticket[]): GateResult {
      const mode = settings.acceptMode
      if (!trigger.human) {
        // An observer files a request of its own (design D15): the owner created it for this, so no accept mode or rule holds it back.
        if (observerOn(settings, trigger.source, trigger.actor.id)) return { admissible: true, strength: 'explicit', basis: { via: 'listed', addressed: 'direct', sender: trigger.actor.id, authority: 'observer' } }
        // A bot on the Source's list that addresses the agent may make an inferred candidate; nothing else of a bot.
        if (!botOn(settings, trigger.source, trigger.actor.id)) return { admissible: false, reason: 'botNotListed' }
        if (trigger.addressed === undefined) return { admissible: false, reason: 'notAddressed' }
        if (mode === 'off') return { admissible: false, reason: 'acceptOff' }
        return { admissible: true, strength: 'inferred', basis: { via: 'bot', addressed: trigger.addressed, sender: trigger.actor.id, observation: { mode } } }
      }
      const allowed = allowedOn(settings, trigger.source, trigger.actor.id)
      if (allowed && trigger.addressed !== undefined) return { admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: trigger.addressed, sender: trigger.actor.id } }
      if (thread.subscriptions.length > 0) {
        if (allowed) return { admissible: true, strength: 'explicit', basis: { via: 'followup', sender: trigger.actor.id } }
        // An unlisted person's follow-up is inferred, which the accept mode `off` does not admit.
        if (mode !== 'off') return { admissible: true, strength: 'inferred', basis: { via: 'followup' } }
        return { admissible: false, reason: 'acceptOff' }
      }
      return { admissible: false, reason: allowed ? 'notAddressed' : 'notListed' }
    },
    revalidate(mandate: Mandate): boolean {
      const basis = mandate.basis
      // Upstream docs/002 "Revalidation before resume".
      if (basis.via === 'listed' && basis.authority === 'observer') return basis.sender !== undefined && observerOn(settings, mandate.actor.source, basis.sender)
      if (basis.via === 'bot') return basis.sender !== undefined && botOn(settings, mandate.actor.source, basis.sender) && admits(settings, basis.rules ?? [])
      if (mandate.strength === 'inferred') return admits(settings, basis.rules ?? [])
      if (basis.via === 'followup' && basis.sender === undefined) return true
      return basis.sender !== undefined && allowedOn(settings, mandate.actor.source, basis.sender)
    },
    admitsInferred: rules => admits(settings, rules),
  }
}

/** Which Sources listen: a Trigger of a Source that is off is stored as filtered. */
export function teamScope(settings: () => TeamSettings): SourceScope {
  return {
    scope: ({ source, meta }) => {
      // GitHub is not a Source of new work: its Triggers exist only for pull requests a ticket already follows.
      // Issues are a source of new work only while the owner has it on (design github-issues G1); pull request follow-ups always.
      if (source === 'github') return meta?.issue === true && settings().sources.github !== true ? { listened: false, reason: 'sourceOff' } : { listened: true, observed: false }
      if ((source !== 'workbench' && source !== 'a2a') || !settings().sources[source]) return { listened: false, reason: 'sourceOff' }
      // The A2A Source's own trust filter (a2a-watch): a host-verified proof and an operator link, no loop, no receipt.
      return source === 'a2a' ? a2aScope({ meta }) : { listened: true, observed: false }
    },
  }
}
