/**
 * #291: live top-level agents across harness generations.
 *
 * Hosts up to 0.2.1 expose `AgentRegistry.roots()` — "all live top-level
 * agents (created without an owning agent context)". 0.2.2-rc removed it:
 * live lineage moved to the subagent tree and the registry keeps only
 * `list()` (all live agents). Top-level is then the delegation-depth
 * predicate of `@deepseek-ai/dsh-subagent/depth` `delegationDepthOf` —
 * depth 0 is top-level, absence is top-level. That package is not a
 * plugin-provided dependency, so its read is mirrored here.
 *
 * Nothing in this module throws. The `agent/created` listener runs at
 * session publication and a throwing listener vetoes the publication — the
 * 2026-11-05 session-resume incident (history sessions vanished from the
 * list until refresh). An unreadable or throwing registry surface degrades
 * to an empty join surface, never to a broken session list. Unlike the
 * harness' own `delegationDepthOf`, invalid depth values read as absent
 * instead of throwing, for the same reason.
 */
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'

/** Registry surface across host generations (the public type keeps whichever face the host has). */
interface RegistrySurface {
  roots?: () => readonly Agent[]
  list?: () => readonly Agent[]
}

/** Where delegation depth lives at runtime (the public Agent type keeps only `id`). */
interface DepthCarrier {
  options?: { subagentDepth?: unknown }
  session?: { header?: { delegationDepth?: unknown } }
}

function safeDepth (value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
    ? value
    : undefined
}

/**
 * Delegation depth of a live agent: 0 = top-level. Mirrors the harness'
 * authoritative max(persisted session header, runtime options); invalid
 * values read as absent (never throwing) — see the module comment.
 */
export function delegationDepthOf (agent: Agent): number {
  const carrier = agent as unknown as DepthCarrier
  return Math.max(safeDepth(carrier.options?.subagentDepth) ?? 0, safeDepth(carrier.session?.header?.delegationDepth) ?? 0)
}

/** Whether a live agent is top-level (not inside any subagent tree). */
export function isTopLevelAgent (agent: Agent): boolean {
  return delegationDepthOf(agent) === 0
}

/**
 * Live top-level agents on this host: `roots()` where the host still has
 * it (exact pre-0.2.2 semantics, so old hosts change nothing), else
 * `list()` filtered by delegation depth. A missing registry, a surface
 * with neither method, or a throwing method all degrade to `[]`.
 */
export function liveRootAgents (registry: AgentRegistry | undefined | null): Agent[] {
  if (registry === undefined || registry === null) return []
  const surface = registry as unknown as RegistrySurface
  try {
    if (typeof surface.roots === 'function') return [...surface.roots()]
    if (typeof surface.list === 'function') return surface.list().filter(isTopLevelAgent)
  } catch {
    return []
  }
  return []
}
