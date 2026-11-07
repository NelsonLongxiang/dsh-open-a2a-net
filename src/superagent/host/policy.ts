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
import type { GateResult, Mandate, Policy, SourceScope, Thread, Ticket, Trigger } from '../upstream/dsh-superagent/src/core/index.ts'
import { scope as a2aScope } from '../a2a-watch.ts'

/** The Sources this host runs. */
export const SOURCES = ['workbench', 'a2a'] as const
export type SourceName = typeof SOURCES[number]

export type AcceptMode = 'off' | 'observe' | 'auto'
/** A remote member: `ref` is `<zone>/<id8>@<fp8>`, `key` the member host's full public key, `url` its base URL. */
export interface RemoteMember { readonly ref: string; readonly key: string; readonly url: string }
/** A kind of proactive work the team may take on without being asked (upstream: Policy rules). */
export interface ProactiveRule { readonly name: string; readonly text: string; readonly enabled: boolean }

/** The owner's team settings (owner control route only). */
export interface TeamSettings {
  /** The router (upstream's main Session): a local session id; absent until the owner names one. */
  readonly router?: string
  /** The executor's fixed member pool: local session ids, one worker slot each (no session is ever opened for a ticket). */
  readonly members: readonly string[]
  /**
   * Members on other hosts (other nodes, or other DSH instances on this machine): the owner-qualified session ref, the
   * member host's full key as the owner pinned it (from a linked peer's signed card), and that host's base URL. A report
   * or turn end is accepted only when signed by that key. Written only by the `add-remote-member` control action.
   */
  readonly remoteMembers: readonly RemoteMember[]
  /**
   * This host serving another team host: that host's base URL and pinned key, and the local sessions that work for it.
   * Only that key may assign them work. Written only by the `serve-team` control action.
   */
  readonly serves?: { readonly url: string; readonly key: string; readonly members: readonly string[] }
  /** Who may originate work, per Source, in that Source's own identities (upstream: identities are never mapped across Sources). */
  readonly allowed: { readonly workbench: readonly string[]; readonly a2a: readonly string[] }
  /** Agents whose messages may become inferred candidates, per Source (only the A2A Source has bots). */
  readonly bots: { readonly a2a: readonly string[] }
  /** Whether inferred candidates are assessed and accepted (upstream accept mode). */
  readonly acceptMode: AcceptMode
  /** Proactive rules: an inferred candidate is accepted only on enabled rules its assessment matched. */
  readonly rules: readonly ProactiveRule[]
  /** Sources that listen. The workbench is on by default; the A2A Source is wired in a later PR. */
  readonly sources: { readonly workbench: boolean; readonly a2a: boolean }
  /** How long the router may take over a candidate before its Eval expires (upstream: re-queued twice, then unavailable). */
  readonly evalTimeoutMs: number
  /** Pause processing (upstream docs/003): Sources still record Triggers; Evals, dispatch and replies wait. */
  readonly paused: boolean
}

/** The workbench actor id: the owner, the only person the workbench control route serves. */
export const WORKBENCH_OWNER = 'owner'

export const DEFAULT_SETTINGS: TeamSettings = {
  members: [],
  remoteMembers: [],
  allowed: { workbench: [WORKBENCH_OWNER], a2a: [] },
  bots: { a2a: [] },
  acceptMode: 'observe',
  rules: [],
  sources: { workbench: true, a2a: false },
  evalTimeoutMs: 10 * 60_000,
  paused: false,
}

/** Validate an owner's settings write; returns the normalized settings or the first problem. */
export function parseSettings(raw: unknown, current: TeamSettings): { ok: true; settings: TeamSettings } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'settings must be an object' }
  const r = raw as Record<string, unknown>
  const list = (value: unknown, name: string): readonly string[] | string => {
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || v.trim() === '' || /\s/.test(v))) return `${name} must be a list of identities`
    return [...new Set(value as string[])]
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
  const sourcesRaw = (r.sources ?? {}) as Record<string, unknown>
  const flag = (name: SourceName): boolean | string => !(name in sourcesRaw) ? current.sources[name] : typeof sourcesRaw[name] === 'boolean' ? sourcesRaw[name] as boolean : `sources.${name} must be true or false`
  const wb = flag('workbench'), a = flag('a2a')
  if (typeof wb === 'string') return { ok: false, error: wb }
  if (typeof a === 'string') return { ok: false, error: a }
  const evalTimeoutMs = 'evalTimeoutMs' in r ? r.evalTimeoutMs : current.evalTimeoutMs
  if (typeof evalTimeoutMs !== 'number' || !Number.isSafeInteger(evalTimeoutMs) || evalTimeoutMs < 30_000 || evalTimeoutMs > 24 * 3_600_000) return { ok: false, error: 'evalTimeoutMs must be 30000–86400000' }
  const paused = 'paused' in r ? r.paused : current.paused
  if (typeof paused !== 'boolean') return { ok: false, error: 'paused must be true or false' }
  const botsRaw = (r.bots ?? {}) as Record<string, unknown>
  if (Object.keys(botsRaw).some(name => name !== 'a2a')) return { ok: false, error: 'only the a2a Source has a bot list' }
  const bots = 'a2a' in botsRaw ? list(botsRaw.a2a, 'bots.a2a') : current.bots.a2a
  if (typeof bots === 'string') return { ok: false, error: bots }
  const acceptMode = 'acceptMode' in r ? r.acceptMode : current.acceptMode
  if (acceptMode !== 'off' && acceptMode !== 'observe' && acceptMode !== 'auto') return { ok: false, error: 'acceptMode must be off, observe or auto' }
  let rules = current.rules
  if ('rules' in r) {
    if (!Array.isArray(r.rules) || r.rules.length > 32) return { ok: false, error: 'rules must be a list of at most 32 rules' }
    const seen = new Set<string>()
    const parsedRules: ProactiveRule[] = []
    for (const rule of r.rules as unknown[]) {
      const x = (rule ?? {}) as Record<string, unknown>
      if (typeof x.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(x.name) || seen.has(x.name)) return { ok: false, error: 'each rule needs a unique name of lowercase letters, digits and dashes' }
      if (typeof x.text !== 'string' || x.text.trim() === '' || x.text.length > 2_000) return { ok: false, error: `rule ${x.name} needs a text of at most 2000 characters` }
      if (x.enabled !== undefined && typeof x.enabled !== 'boolean') return { ok: false, error: `rule ${x.name}: enabled must be true or false` }
      seen.add(x.name)
      parsedRules.push({ name: x.name, text: x.text.trim(), enabled: x.enabled !== false })
    }
    rules = parsedRules
  }
  if ('remoteMembers' in r || 'serves' in r) return { ok: false, error: 'remote members and serving a team are set by their own actions (add-remote-member, serve-team), which pin the peer key' }
  const members = 'members' in r ? list(r.members, 'members') : current.members
  if (typeof members === 'string') return { ok: false, error: members }
  if (members.length > 32) return { ok: false, error: 'at most 32 members' }
  if (router !== undefined && members.includes(router)) return { ok: false, error: 'the router is not a member: it routes, members work' }
  return { ok: true, settings: { ...(router !== undefined ? { router } : {}), members, remoteMembers: current.remoteMembers, ...(current.serves !== undefined ? { serves: current.serves } : {}), allowed: { workbench, a2a }, bots: { a2a: bots }, acceptMode, rules, sources: { workbench: wb, a2a: a }, evalTimeoutMs, paused } }
}

const QUALIFIED_REF = /^[^/\s@]+\/[0-9a-f]{8}@[0-9a-f]{8}$/
const validUrl = (url: unknown): url is string => { try { const u = new URL(String(url)); return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === String(url) } catch { return false } }
const validKey = (key: unknown): key is string => typeof key === 'string' && /^[A-Za-z0-9+/]{40,}={0,2}$/.test(key)
/** One pinned remote member, or undefined when malformed. */
export function parseRemoteMember(raw: unknown): RemoteMember | undefined {
  const r = (raw ?? {}) as Record<string, unknown>
  return typeof r.ref === 'string' && QUALIFIED_REF.test(r.ref) && validKey(r.key) && validUrl(r.url) ? { ref: r.ref, key: r.key, url: r.url } : undefined
}

/** Settings as stored: the owner fields plus the pinned peers only the host's own actions write. */
export function parseStoredSettings(raw: unknown): { ok: true; settings: TeamSettings } | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'settings must be an object' }
  const { remoteMembers, serves, ...rest } = raw as Record<string, unknown>
  const parsed = parseSettings(rest, DEFAULT_SETTINGS)
  if (!parsed.ok) return parsed
  const remote = Array.isArray(remoteMembers) ? remoteMembers.map(parseRemoteMember) : []
  if (remote.some(r => r === undefined)) return { ok: false, error: 'a stored remote member is malformed' }
  let served: TeamSettings['serves']
  if (serves !== undefined) {
    const sv = (serves ?? {}) as Record<string, unknown>
    if (!validUrl(sv.url) || !validKey(sv.key) || !Array.isArray(sv.members) || sv.members.some(m => typeof m !== 'string' || m === '')) return { ok: false, error: 'the stored served team is malformed' }
    served = { url: sv.url, key: sv.key, members: sv.members as string[] }
  }
  return { ok: true, settings: { ...parsed.settings, remoteMembers: remote as RemoteMember[], ...(served !== undefined ? { serves: served } : {}) } }
}

/**
 * The Policy version covers what decides authorization (upstream: the rules, the accept mode and each Source's part —
 * its allowed list and bot list). Source switches, the router and timing are configuration, not Policy.
 */
export function policyVersion(settings: TeamSettings): string {
  const canonical = JSON.stringify({
    mode: settings.acceptMode,
    allowed: { workbench: [...settings.allowed.workbench].sort(), a2a: [...settings.allowed.a2a].sort() },
    bots: { a2a: [...settings.bots.a2a].sort() },
    rules: [...settings.rules].sort((a, b) => (a.name < b.name ? -1 : 1)).map(rule => [rule.name, rule.text, rule.enabled]),
  })
  return `a2a1:${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`
}

const allowedOn = (settings: TeamSettings, source: string, actor: string): boolean =>
  (source === 'workbench' || source === 'a2a') && settings.allowed[source].includes(actor)
const botOn = (settings: TeamSettings, source: string, actor: string): boolean => source === 'a2a' && settings.bots.a2a.includes(actor)
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
      if ((source !== 'workbench' && source !== 'a2a') || !settings().sources[source]) return { listened: false, reason: 'sourceOff' }
      // The A2A Source's own trust filter (a2a-watch): a host-verified proof and an operator link, no loop, no receipt.
      return source === 'a2a' ? a2aScope({ meta }) : { listened: true, observed: false }
    },
  }
}
