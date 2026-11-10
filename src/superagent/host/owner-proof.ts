/**
 * superagent: what proves the owner on a rule change made through the team page (docs/design/superagent-router-owner-asks.md, D10).
 *
 * Team sessions have a shell on this machine, so a request from loopback proves nothing. The host's own GUI login does: the
 * browser holds a cookie only that login issues. The plugin cannot read how the host checks it, so it asks the host: the
 * cookie is presented to a host route that answers 401 without a login. A host with no such login proves nobody, and the
 * write is refused; a change agreed in conversation still works there.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/owner-proof
 */

const RULE_FIELDS = ['rules', 'dispatch', 'profiles', 'prepare', 'prompts'] as const

/** Whether a settings write changes a rule, a role, the dispatch rules, or the command that runs on this host (reliability R4). */
export function touchesRules(settings: unknown): boolean {
  if (settings === null || typeof settings !== 'object') return false
  const fields = settings as Record<string, unknown>
  // Who may file work from GitHub (design github-issues G7): the source, its repositories, and its allowed logins.
  const nested = (key: string): boolean => fields[key] !== null && typeof fields[key] === 'object' && 'github' in (fields[key] as object)
  return RULE_FIELDS.some(field => field in fields) || 'github' in fields || nested('allowed') || nested('sources')
}

type Probe = (url: string, init: RequestInit) => Promise<{ status: number }>

/**
 * Whether a request may act as the owner on what today's control route already lets through: a live login when the host has
 * one. On a host with no login there is nothing to prove against, and the control route stands (decision cards C5).
 * @param home - this host's own base URL.
 * @param cookie - the request's Cookie header.
 * @param probe - fetch, or a stub in tests.
 * @returns whether to go on.
 */
export async function ownerOrNoLogin(home: string | undefined, cookie: string | undefined, probe: Probe = fetch): Promise<boolean> {
  if (home === undefined) return false
  if ((await probe(`${home}${PROBE_PATH}`, probeInit({}))).status !== 401) return true
  return cookie !== undefined && cookie !== '' && await guiOwnerProven(home, cookie, probe)
}
const PROBE_PATH = '/api/session/a2a-owner-proof'
const probeInit = (headers: Record<string, string>): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ type: 'client-request', rpcId: 'a2a-owner-proof', method: 'session/a2a-owner-proof', payload: { args: {} } }) })

/**
 * Whether `cookie` is a live login on this host.
 * @param home - this host's own base URL.
 * @param cookie - the request's Cookie header.
 * @param probe - fetch, or a stub in tests.
 * @returns true only when the host refuses the probe without the cookie and accepts it with the cookie.
 */
export async function guiOwnerProven(home: string | undefined, cookie: string | undefined, probe: Probe = fetch): Promise<boolean> {
  if (home === undefined || cookie === undefined || cookie === '') return false
  const ask = async (headers: Record<string, string>): Promise<number> => (await probe(`${home}${PROBE_PATH}`, probeInit(headers))).status
  if (await ask({}) !== 401) return false
  const status = await ask({ cookie })
  return status !== 401 && status < 500
}
