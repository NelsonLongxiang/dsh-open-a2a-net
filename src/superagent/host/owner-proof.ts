/**
 * superagent: what proves the owner on a rule change made through the team page (docs/design/superagent-router-owner-asks.md, D10).
 *
 * Team sessions have a shell on this machine, so a request from loopback proves nothing. The host's own GUI login does: the
 * browser holds a cookie only that login issues. The plugin cannot read how the host checks it, so it asks the host: the
 * cookie is presented to a host route that answers 401 without a login. A host with no such login proves nobody, and the
 * write is refused; a change agreed in conversation still works there.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/owner-proof
 */

const RULE_FIELDS = ['rules', 'dispatch', 'profiles', 'observers'] as const

/** Whether a settings write changes a rule, a role, the dispatch rules or who may open tickets. */
export function touchesRules(settings: unknown): boolean {
  return settings !== null && typeof settings === 'object' && RULE_FIELDS.some(field => field in (settings as object))
}

type Probe = (url: string, init: RequestInit) => Promise<{ status: number }>
const PROBE_PATH = '/api/session/a2a-owner-proof'

/**
 * Whether `cookie` is a live login on this host.
 * @param home - this host's own base URL.
 * @param cookie - the request's Cookie header.
 * @param probe - fetch, or a stub in tests.
 * @returns true only when the host refuses the probe without the cookie and accepts it with the cookie.
 */
export async function guiOwnerProven(home: string | undefined, cookie: string | undefined, probe: Probe = fetch): Promise<boolean> {
  if (home === undefined || cookie === undefined || cookie === '') return false
  const ask = async (headers: Record<string, string>): Promise<number> => (await probe(`${home}${PROBE_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ type: 'client-request', rpcId: 'a2a-owner-proof', method: 'session/a2a-owner-proof', payload: { args: {} } }),
  })).status
  if (await ask({}) !== 401) return false
  const status = await ask({ cookie })
  return status !== 401 && status < 500
}
