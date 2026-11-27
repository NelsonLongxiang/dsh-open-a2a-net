/**
 * Browser-owner proof for superagent page operations (decision cards C5/C8, rules D10).
 *
 * A browser login is bound to its original authority. Replaying just its Cookie header to a loopback URL rejects valid
 * domain/forwarded-port logins. Let Host Connection admit the unchanged incoming request instead: it owns Host/Origin,
 * cookie lifetime and credential checks. Only its browser-owner Peer may perform these operations, never an API Peer.
 * Missing/older Connection services fail closed; no HTTP probe, API-key or unauthenticated-host fallback is used.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/owner-proof
 */
import type { IncomingMessage } from 'node:http'
import { OWNER_DELEGATE_HEADER, type OwnerDelegates } from './owner-delegate.ts'
import { ON_BEHALF_OF_HEADER, ownerRouteAction, readOnBehalfOf, scopeRefusal, type OnBehalfOf } from './owner-delegate-scope.ts'

// The host's owner-delegate book (owner-delegate.ts), set once at boot; none configured means no delegate is accepted.
let delegates: Pick<OwnerDelegates, 'check' | 'audit'> | undefined

/**
 * Install the host's owner-delegate book (the control API's "user" scope).
 * @param book - the book, or undefined to accept no delegate.
 */
export function configureOwnerDelegates(book: Pick<OwnerDelegates, 'check' | 'audit'> | undefined): void { delegates = book }

// observerCast (#764 review): letting the observer cast cards into sessions is the owner's call, not a shell's; so is
// observerCardDraft (#902 S2), letting it write its own cards for named members; castOff and observerTriggerRouter (#902 S4),
// which members it may not cast into and whether it may trigger the router.
// credentialAckMinutes (#823 review): how soon a credential-access card closes itself is the owner's call too; a session
// that touches credentials must not be able to shorten the card that watches it.
// autoApprove (#888 D5): letting the host take recommendations is the owner's call; a session must not turn it on or widen it.
const RULE_FIELDS = ['rules', 'dispatch', 'profiles', 'prepare', 'prompts', 'extraTools', 'approvers', 'blockedTools', 'mcp', 'observerCast', 'observerCardDraft', 'castOff', 'observerTriggerRouter', 'idleSweep', 'decisionPush', 'credentialAckMinutes', 'autoApprove', 'observerDecides'] as const

/** Whether a settings write changes a rule, a role, the dispatch rules, or the command that runs on this host (reliability R4). */
export function touchesRules(settings: unknown): boolean {
  if (settings === null || typeof settings !== 'object') return false
  const fields = settings as Record<string, unknown>
  // Who may file work from GitHub (design github-issues G7): the source, its repositories, and its allowed logins.
  const nested = (key: string): boolean => fields[key] !== null && typeof fields[key] === 'object' && 'github' in (fields[key] as object)
  return RULE_FIELDS.some(field => field in fields) || 'github' in fields || nested('allowed') || nested('sources')
}

/** The public Host Connection contract needed here, structurally typed for older optional host dependencies. */
export interface BrowserOwnerConnection {
  readonly browserPeer: { readonly id: string }
  admit(request: Pick<IncomingMessage, 'headers'>): { readonly peer: { readonly id: string } } | { readonly rejection: 401 | 403 }
}

/** What a deferred proof hands back: who was verified, and the one call that writes the audit line (false = could not be written). */
export interface DeferredOwnerProof {
  readonly ok: true
  /** The verified delegate; undefined when the owner is logged in at the browser (the line then reads id null, name browser-owner). */
  readonly delegate: { readonly id: string; readonly name: string } | undefined
  readonly onBehalfOf?: OnBehalfOf
  readonly commit: (extra: Readonly<Record<string, unknown>>) => boolean
}

export type BrowserOwnerProof = { readonly ok: true } | {
  readonly ok: false
  readonly status: 400 | 401 | 403 | 503
  readonly code: 'owner-proof' | 'owner-auth-unavailable' | 'owner-delegate' | 'owner-delegate-scope' | 'on-behalf-of'
  readonly error: string
}

const scopedControlRequests = new WeakSet<object>()

/** Return a scoped token's decision for an explicitly mapped control route, with no audit side effect. */
export function scopedOwnerControl(request: Pick<IncomingMessage, 'headers' | 'url' | 'method'>): boolean | undefined {
  const action = ownerRouteAction(request)
  const token = request.headers[OWNER_DELEGATE_HEADER]
  if (action === undefined || typeof token !== 'string') return undefined
  const found = delegates?.check(token)
  if (!found?.ok || found.scope === undefined) return undefined
  const allowed = found.scope.includes(action)
  if (allowed) scopedControlRequests.add(request)
  return allowed
}

/** Scoped reads and reads with delegated attribution require and audit owner proof. */
export function needsTeamDelegateProof(request: IncomingMessage): boolean {
  return scopedControlRequests.has(request) || scopedOwnerControl(request) !== undefined
    || (request.headers[OWNER_DELEGATE_HEADER] !== undefined && request.headers[ON_BEHALF_OF_HEADER] !== undefined)
}

const unavailable = (): BrowserOwnerProof => ({ ok: false, status: 503, code: 'owner-auth-unavailable', error: '当前 DSH 的浏览器主人鉴权服务不可用，未执行操作；请升级或恢复宿主鉴权服务后重试。' })

/**
 * Verify the original request as the Host's authenticated browser owner. Never rebuild its authority, trust proxy headers
 * independently, copy credentials to another request, or accept an API operator merely because it is authenticated.
 */
export function browserOwnerProof(connection: unknown, request: Pick<IncomingMessage, 'headers'> & Partial<Pick<IncomingMessage, 'method' | 'url'>>, options: { readonly delegate?: boolean; readonly deferAudit: true }): DeferredOwnerProof | Extract<BrowserOwnerProof, { ok: false }>
export function browserOwnerProof(connection: unknown, request: Pick<IncomingMessage, 'headers'> & Partial<Pick<IncomingMessage, 'method' | 'url'>>, options?: { readonly delegate?: boolean }): BrowserOwnerProof
export function browserOwnerProof(connection: unknown, request: Pick<IncomingMessage, 'headers'> & Partial<Pick<IncomingMessage, 'method' | 'url'>>, options: { readonly delegate?: boolean; readonly deferAudit?: boolean } = {}): BrowserOwnerProof | DeferredOwnerProof {
  const deferred = (who: { readonly id: string | null; readonly name: string }, delegate: DeferredOwnerProof['delegate'], onBehalfOf?: OnBehalfOf): DeferredOwnerProof =>
    ({ ok: true, delegate, ...(onBehalfOf === undefined ? {} : { onBehalfOf }), commit: extra => delegates?.audit(who, { method: request.method, url: request.url }, { ...extra, ...(onBehalfOf === undefined ? {} : { onBehalfOf }) }) === true })
  // Only a scoped delegate opens an explicitly mapped control route. An unknown, revoked or
  // expired token refuses outright instead of falling back to the browser login it was meant to replace.
  const presented = request.headers[OWNER_DELEGATE_HEADER]
  if (options.delegate !== false && presented !== undefined) {
    const token = Array.isArray(presented) ? '' : presented
    const found = delegates?.check(token)
    if (found === undefined || !found.ok) return { ok: false, status: 403, code: 'owner-delegate', error: `属主代理凭证无效（${found === undefined ? 'unconfigured' : found.reason}），未执行操作。` }
    // A deferred proof writes nothing yet: the route validates first and commits the line only for what it accepted (#951).
    const action = ownerRouteAction(request)
    if (found.scope !== undefined && (action === undefined || !found.scope.includes(action))) return scopeRefusal
    const onBehalfOf = readOnBehalfOf(request.headers[ON_BEHALF_OF_HEADER])
    if (onBehalfOf === null) return { ok: false, status: 400, code: 'on-behalf-of', error: '代办人请求头必须包含有效的 id 和 name。' }
    if (options.deferAudit === true) return deferred(found, { id: found.id, name: found.name }, onBehalfOf)
    if (delegates?.audit(found, { method: request.method, url: request.url }, onBehalfOf === undefined ? undefined : { onBehalfOf }) !== true) return { ok: false, status: 503, code: 'owner-delegate', error: '属主代理的审计记录写不进去，未执行操作。' }
    return { ok: true }
  }
  try {
    if (connection === null || typeof connection !== 'object') return unavailable()
    const host = connection as BrowserOwnerConnection
    if (typeof host.admit !== 'function' || typeof host.browserPeer?.id !== 'string' || host.browserPeer.id === '') return unavailable()
    const admission = host.admit(request)
    if (admission === null || typeof admission !== 'object') return unavailable()
    if ('rejection' in admission) {
      if (admission.rejection !== 401 && admission.rejection !== 403) return unavailable()
      return { ok: false, status: admission.rejection, code: 'owner-proof', error: admission.rejection === 401
        ? '此请求没有有效的 DSH 浏览器登录，请在当前访问地址重新登录后重试。'
        : '此请求未通过 DSH 的 Host/Origin 来源校验，未执行操作。' }
    }
    if (typeof admission.peer?.id !== 'string' || admission.peer.id === '') return unavailable()
    if (admission.peer.id !== host.browserPeer.id) return { ok: false, status: 403, code: 'owner-proof', error: '此操作只允许已登录的 DSH 浏览器主人；API 凭据不能代替浏览器主人确认。' }
    return options.deferAudit === true ? deferred({ id: null, name: 'browser-owner' }, undefined) : { ok: true }
  } catch {
    // A disposed/unavailable provider must not authorize the write, and its error may contain sensitive request details.
    return unavailable()
  }
}
