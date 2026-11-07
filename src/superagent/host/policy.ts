/**
 * superagent design v4, PR-B: the a2a team's Policy and SourceScope for the vendored engine.
 *
 * The gate follows upstream docs/002 for the two a2a Sources:
 * - `workbench`: the owner writing in the a2a workbench (owner-only control route), always addressed (direct);
 * - `a2a`: an A2A message to the team (wired in a later PR; its senders are A2A handles on the allowed list).
 * An allowed sender who addresses the agent makes an explicit request; a person's follow-up on a Thread with tickets is
 * explicit from an allowed sender and inferred otherwise; nothing from a bot is admitted. The accept mode stays `off`
 * (explicit requests only; upstream's own default for a new deployment is `observe`, deferred here), so nothing inferred
 * becomes a candidate.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/policy
 */
import { createHash } from 'node:crypto'
import type { GateResult, Mandate, Policy, SourceScope, Thread, Ticket, Trigger } from '../upstream/dsh-superagent/src/core/index.ts'

/** The Sources this host runs. */
export const SOURCES = ['workbench', 'a2a'] as const
export type SourceName = typeof SOURCES[number]

/** The owner's team settings (owner control route only). */
export interface TeamSettings {
  /** The router (upstream's main Session): a local session id; absent until the owner names one. */
  readonly router?: string
  /** Who may originate work, per Source, in that Source's own identities (upstream: identities are never mapped across Sources). */
  readonly allowed: { readonly workbench: readonly string[]; readonly a2a: readonly string[] }
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
  allowed: { workbench: [WORKBENCH_OWNER], a2a: [] },
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
  return { ok: true, settings: { ...(router !== undefined ? { router } : {}), allowed: { workbench, a2a }, sources: { workbench: wb, a2a: a }, evalTimeoutMs, paused } }
}

/**
 * The Policy version covers what decides authorization: the allowed lists and the accept mode (upstream: rules, accept mode
 * and the Source parts). Source switches, the router and timing are configuration, not Policy.
 */
export function policyVersion(settings: TeamSettings): string {
  const canonical = JSON.stringify({ mode: 'off', allowed: { workbench: [...settings.allowed.workbench].sort(), a2a: [...settings.allowed.a2a].sort() } })
  return `a2a1:${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`
}

const allowedOn = (settings: TeamSettings, source: string, actor: string): boolean =>
  (source === 'workbench' || source === 'a2a') && settings.allowed[source].includes(actor)

export function teamPolicy(settings: TeamSettings): Policy {
  return {
    version: policyVersion(settings),
    paused: settings.paused,
    evalTimeoutMs: settings.evalTimeoutMs,
    gate(trigger: Trigger, thread: Thread, _tickets: Ticket[]): GateResult {
      if (!trigger.human) return { admissible: false, reason: 'notHuman' }
      const allowed = allowedOn(settings, trigger.source, trigger.actor.id)
      if (allowed && trigger.addressed !== undefined) return { admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: trigger.addressed, sender: trigger.actor.id } }
      if (thread.subscriptions.length > 0 && allowed) return { admissible: true, strength: 'explicit', basis: { via: 'followup', sender: trigger.actor.id } }
      // Accept mode off: an unlisted follow-up or an unaddressed message would be inferred, which `off` does not admit.
      return { admissible: false, reason: allowed ? 'notAddressed' : 'notListed' }
    },
    revalidate(mandate: Mandate): boolean {
      if (mandate.basis.via === 'followup' && mandate.basis.sender === undefined) return true
      return mandate.basis.sender !== undefined && allowedOn(settings, mandate.actor.source, mandate.basis.sender)
    },
    admitsInferred: () => false,
  }
}

/** Which Sources listen: a Trigger of a Source that is off is stored as filtered. */
export function teamScope(settings: () => TeamSettings): SourceScope {
  return {
    scope: ({ source }) => (source === 'workbench' || source === 'a2a') && settings().sources[source]
      ? { listened: true, observed: false }
      : { listened: false, reason: 'sourceOff' },
  }
}
