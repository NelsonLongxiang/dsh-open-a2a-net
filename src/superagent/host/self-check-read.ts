/**
 * T5-B: the two reads between this plugin and dsh-prompt-templates' wrap-up self-check, kept apart from the wiring so
 * they can be tested on their own (#765 review M6, M7).
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/self-check-read
 */

export type SelfCheckRead = ReadonlyArray<{ kind: string; conclusion: string | null; deadline: string | null; at: string }>

/** One session's self-check log from the prompt-templates service; undefined when the service is absent or its check is off. */
export function readSelfChecks(svc: unknown, sessionId: string): SelfCheckRead | undefined {
  const s = svc as { selfChecks?: (id: string) => unknown; selfCheckEnabled?: () => boolean } | undefined
  if (typeof s?.selfChecks !== 'function' || typeof s.selfCheckEnabled !== 'function' || s.selfCheckEnabled() !== true) return undefined
  return s.selfChecks(sessionId) as SelfCheckRead
}

/**
 * Whether any team on this host holds an open ticket for the session (undefined when the host runs no superagent team).
 * Any plugin on the same host can ask, about any session, across this host's teams; the answer is a yes or no, never the
 * ticket.
 */
export function holdsOpenTicket(teams: ReadonlyArray<{ executor: { bindingOf: (member: string) => unknown } }> | undefined, sessionId: string): boolean | undefined {
  return teams === undefined ? undefined : teams.some(team => team.executor.bindingOf(String(sessionId)) !== undefined)
}
