import { validOwnerScope, type OnBehalfOf, type OwnerAction } from '../superagent/host/owner-delegate-scope.ts'
import type { UserSessionRow } from '../user-sessions.ts'
import type { TranscriptPage } from '../session-transcript.ts'

export type { OnBehalfOf, OwnerAction }
export interface UserFailure { readonly ok: false; readonly status: number; readonly code: string; readonly error: string }
export type UserResult<T> = ({ readonly ok: true } & T) | UserFailure
const verified = Symbol('verified user delegate')
export interface ScopedUserDelegate {
  readonly [verified]: true
  readonly token: string
  readonly scope: readonly OwnerAction[]
}

type Plain = Record<string, unknown>
function object(raw: unknown): Plain | undefined { return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Plain : undefined }
function fail(status: number, code: string, error: string): UserFailure { return { ok: false, status, code, error } }

/** Check the exact requested action array, including order and length, on a pairing start or credential response. */
export function checkUserScopeEcho(requested: readonly OwnerAction[], echoed: unknown): UserResult<Record<never, never>> {
  return validOwnerScope(requested) && validOwnerScope(echoed) && requested.length === echoed.length && requested.every((action, index) => echoed[index] === action)
    ? { ok: true } : fail(400, 'scope-not-confirmed', 'the node did not echo the exact requested owner scope')
}

/** Accept a scoped issuance or approved pairing response only after verifying its echoed scope. */
export function acceptScopedUserDelegate(requested: readonly OwnerAction[], response: unknown): UserResult<{ delegate: ScopedUserDelegate }> {
  const fields = object(response)
  if (fields === undefined || (fields.ok !== true && fields.state !== 'approved') || typeof fields.token !== 'string' || fields.token === '') {
    return fail(400, 'delegate-not-issued', 'the node did not return an issued owner delegate')
  }
  const echoed = fields.state === 'approved' ? fields.scope : object(fields.delegate)?.scope
  const scope = checkUserScopeEcho(requested, echoed)
  if (!scope.ok) return scope
  return { ok: true, delegate: Object.freeze({ [verified]: true as const, token: fields.token, scope: Object.freeze([...requested]) }) }
}

interface UserTarget { baseUrl: string; onBehalfOf?: OnBehalfOf; fetch?: typeof globalThis.fetch }
export type UserClientOptions = UserTarget & ({ controlKey: string; delegate: string } | { controlKey?: never; delegate: ScopedUserDelegate })
export interface PageOptions { before?: number; limit?: number; chars?: number }
export interface PromptOptions { mode: 'steer' | 'queue'; text: string; requestId?: string }
export interface StopOptions { requestId?: string }
export interface DecisionOptions { id: string; teamId?: string; how: string; option?: string; note?: string }
export type UserPromptResult = { id: string; mode: 'steer' | 'queue'; delivered: 'steered' | 'queued'; request_id?: string; replayed?: true }
export type UserStopResult = { id: string; stopped: boolean; replayed?: true }

/** Create a request-only client. Credentials stay in memory and response content is returned directly to the caller. */
export function createUserClient(options: UserClientOptions) {
  let base: URL | undefined
  try {
    const parsed = new URL(options.baseUrl)
    if (['http:', 'https:'].includes(parsed.protocol) && parsed.username === '' && parsed.password === '' && parsed.search === '' && parsed.hash === '') base = parsed
  } catch { /* Invalid configuration is returned as a structured failure. */ }
  const { delegate, controlKey } = options
  const selected = typeof delegate === 'string'
    ? (typeof controlKey === 'string' && controlKey !== '' && delegate !== '' ? delegate : undefined)
    : delegate?.[verified] === true ? delegate.token : undefined
  const request = options.fetch ?? globalThis.fetch
  const attribution = options.onBehalfOf === undefined ? undefined : { id: options.onBehalfOf.id, name: options.onBehalfOf.name }

  async function send<T>(method: 'GET' | 'POST', path: string, query?: Readonly<Record<string, string>>, body?: object): Promise<UserResult<T>> {
    if (base === undefined) return fail(400, 'base-url', 'set a valid HTTP or HTTPS node URL')
    if (selected === undefined) return fail(400, 'scope-not-confirmed', 'use an echo-verified scoped delegate or the legacy control key and delegate')
    const url = new URL(base.href)
    url.pathname = url.pathname.replace(/\/+$/, '') + '/__dsh_a2a/' + path
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    try {
      const headers: Record<string, string> = { 'x-dsh-owner-delegate': selected }
      if (typeof delegate === 'string' && controlKey !== undefined) headers['x-api-key'] = controlKey
      if (attribution !== undefined) headers['x-dsh-on-behalf-of'] = JSON.stringify(attribution).replace(/[^\x20-\x7e]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
      if (body !== undefined) headers['content-type'] = 'application/json'
      const reply = await request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', redirect: 'error' })
      let fields: Plain | undefined
      try { fields = object(await reply.json()) } catch { /* The control gate may return a non-JSON refusal. */ }
      if (!reply.ok || fields?.ok === false) {
        return fail(reply.status, typeof fields?.code === 'string' ? fields.code : 'node-refused', typeof fields?.error === 'string' ? fields.error : 'the node refused the request')
      }
      if (fields === undefined) return fail(reply.status, 'node-response', 'the node returned an invalid user response')
      return { ...fields, ok: true } as UserResult<T>
    } catch { return fail(0, 'node-unavailable', 'the node request did not complete') }
  }

  return {
    sessions: ({ team }: { team?: string } = {}) => send<{ sessions: readonly UserSessionRow[]; count: number; truncated: boolean }>('GET', 'user/sessions', team === undefined ? undefined : { team }),
    read: (id: string, page: PageOptions = {}) => {
      const query: Record<string, string> = { id }
      if (page.before !== undefined) query.before = String(page.before)
      if (page.limit !== undefined) query.limit = String(page.limit)
      if (page.chars !== undefined) query.chars = String(page.chars)
      return send<TranscriptPage & { id: string }>('GET', 'user/session', query)
    },
    prompt: (id: string, { mode, text, requestId }: PromptOptions) => send<UserPromptResult>('POST', 'user/session/prompt', undefined, { id, mode, text, request_id: requestId }),
    stop: (id: string, { requestId }: StopOptions = {}) => send<UserStopResult>('POST', 'user/session/stop', undefined, { id, request_id: requestId }),
    team: (teamId?: string) => send<Record<string, unknown>>('GET', 'superagent', teamId === undefined ? undefined : { teamId }),
    teams: () => send<{ teams: readonly Record<string, unknown>[] }>('GET', 'superagent/teams'),
    decisions: () => send<{ decisions: readonly Record<string, unknown>[] }>('GET', 'superagent/decisions'),
    decide: (decision: DecisionOptions) => { const { id, teamId, how, option, note } = decision; return send<Record<string, unknown>>('POST', 'superagent/decisions', undefined, { id, teamId, how, option, note }) },
  }
}
