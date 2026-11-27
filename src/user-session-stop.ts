import { OWNER_REQUEST_ID, ownerLiveSeat, type UserRefusal, type UserSessionsDeps } from './user-sessions.ts'
import type { OnBehalfOf } from './superagent/host/owner-delegate-scope.ts'

function refusal(status: number, code: string, error: string): UserRefusal { return { ok: false, status, code, error } }

/** The host controller cancels only the active turn and uses keepInbox: true (host 2e39e704, SessionCommands.cancel). */
export function bindOwnerCancel(service: unknown): ((id: string) => unknown) | undefined {
  const controller = service as { cancel?: (request: { sessionId: string }) => unknown } | null | undefined
  if (typeof controller?.cancel !== 'function') return undefined
  const cancel = controller.cancel.bind(controller)
  return id => cancel({ sessionId: id })
}

/** Validate and audit before requesting cancellation. A repeated request id returns the original outcome. */
export function stopOwnerSession(
  deps: Pick<UserSessionsDeps, 'live' | 'joined' | 'archived' | 'agent' | 'idem'>,
  input: { id: unknown; requestId: unknown; delegateId: string | null; onBehalfOf?: OnBehalfOf },
  cancel: ((id: string) => unknown) | undefined,
  commit: (fields: Readonly<Record<string, unknown>>) => boolean,
): { readonly status: number; readonly response: Record<string, unknown> } {
  const reject = (status: number, code: string, error: string) => ({ status, response: { ...refusal(status, code, error) } })
  const target = ownerLiveSeat(deps, input.id)
  if (!target.ok) return { status: target.status, response: { ...target } }
  const { id } = target
  const { requestId } = input
  if (requestId !== undefined && (typeof requestId !== 'string' || !OWNER_REQUEST_ID.test(requestId))) return reject(400, 'request-id', 'request_id must be 1 to 64 of letters, digits, . _ : -')
  const key = JSON.stringify([id, input.delegateId, input.onBehalfOf?.id, input.onBehalfOf?.name])
  if (typeof requestId === 'string') {
    const before = deps.idem.lookup(requestId)
    if (before !== undefined) {
      if (before.key !== key) return reject(409, 'request-id-conflict', 'this request_id was used for a different stop')
      const { status, ...response } = before.response
      return { status: Number(status), response: { ...response, replayed: true } }
    }
  }
  let status: string | undefined
  try { status = (deps.agent(id) as { status?: string } | undefined)?.status } catch { /* An unavailable status is never treated as idle. */ }
  if (status !== 'idle' && status !== 'running') return reject(503, 'state-unavailable', 'the host cannot report the live session status')
  if (status === 'running' && cancel === undefined) return reject(501, 'no-cancel-api', 'the host does not expose per-session cancellation')
  const audit = { action: 'stop', target: id, ...(requestId === undefined ? {} : { request_id: requestId }) }
  if (!commit({ ...audit, phase: 'accepted' })) return reject(503, 'audit', 'the stop was not requested because its audit could not be written')
  const result = status === 'running' ? { ok: true, id, stopped: true } : { ok: true, id, stopped: false }
  const uncertain = reject(503, 'stop-unconfirmed', 'the host did not confirm the cancellation request')
  const remember = (status: number, body: Record<string, unknown>): void => {
    if (typeof requestId === 'string') deps.idem.register(requestId, key, { ...body, status })
  }
  if (status === 'running') {
    // Reserve before invoking the host. A throw can happen after the turn has been cancelled.
    remember(uncertain.status, uncertain.response)
    try {
      const receipt = cancel?.(id) as { accepted?: unknown } | null | undefined
      if (receipt?.accepted !== true) throw new Error('missing cancellation receipt')
    } catch {
      commit({ ...audit, phase: 'stop-unconfirmed' })
      return uncertain
    }
  }
  remember(200, result)
  return { status: 200, response: result }
}
