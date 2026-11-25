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

// The host's owner-delegate book (owner-delegate.ts), set once at boot; none configured means no delegate is accepted.
let delegates: Pick<OwnerDelegates, 'check' | 'audit'> | undefined

/**
 * Install the host's owner-delegate book (the control API's "user" scope).
 * @param book - the book, or undefined to accept no delegate.
 */
export function configureOwnerDelegates(book: Pick<OwnerDelegates, 'check' | 'audit'> | undefined): void { delegates = book }

// observerCast (#764 review): letting the observer cast cards into sessions is the owner's call, not a shell's.
// credentialAckMinutes (#823 review): how soon a credential-access card closes itself is the owner's call too; a session
// that touches credentials must not be able to shorten the card that watches it.
// autoApprove (#888 D5): letting the host take recommendations is the owner's call; a session must not turn it on or widen it.
const RULE_FIELDS = ['rules', 'dispatch', 'profiles', 'prepare', 'prompts', 'extraTools', 'approvers', 'blockedTools', 'mcp', 'observerCast', 'idleSweep', 'decisionPush', 'credentialAckMinutes', 'autoApprove'] as const

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

export type BrowserOwnerProof = { readonly ok: true } | {
  readonly ok: false
  readonly status: 401 | 403 | 503
  readonly code: 'owner-proof' | 'owner-auth-unavailable' | 'owner-delegate'
  readonly error: string
}

const unavailable = (): BrowserOwnerProof => ({ ok: false, status: 503, code: 'owner-auth-unavailable', error: '当前 DSH 的浏览器主人鉴权服务不可用，未执行操作；请升级或恢复宿主鉴权服务后重试。' })

/**
 * Verify the original request as the Host's authenticated browser owner. Never rebuild its authority, trust proxy headers
 * independently, copy credentials to another request, or accept an API operator merely because it is authenticated.
 */
export function browserOwnerProof(connection: unknown, request: Pick<IncomingMessage, 'headers'> & Partial<Pick<IncomingMessage, 'method' | 'url'>>, options: { readonly delegate?: boolean } = {}): BrowserOwnerProof {
  // The owner's delegate (the control API's user scope) stands in for the browser owner on these operations. It never
  // opens the control route by itself: the callers here already sit behind the control key. An unknown, revoked or
  // expired token refuses outright instead of falling back to the browser login it was meant to replace.
  const presented = request.headers[OWNER_DELEGATE_HEADER]
  if (options.delegate !== false && presented !== undefined) {
    const token = Array.isArray(presented) ? '' : presented
    const found = delegates?.check(token)
    if (found === undefined || !found.ok) return { ok: false, status: 403, code: 'owner-delegate', error: `属主代理凭证无效（${found === undefined ? 'unconfigured' : found.reason}），未执行操作。` }
    if (delegates?.audit(found, { method: request.method, url: request.url }) !== true) return { ok: false, status: 503, code: 'owner-delegate', error: '属主代理的审计记录写不进去，未执行操作。' }
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
    return { ok: true }
  } catch {
    // A disposed/unavailable provider must not authorize the write, and its error may contain sensitive request details.
    return unavailable()
  }
}
