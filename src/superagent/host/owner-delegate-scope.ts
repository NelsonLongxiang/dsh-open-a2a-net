import type { IncomingMessage } from 'node:http'

const ACTIONS = ['session.list', 'session.read', 'session.prompt', 'session.stop', 'team.read', 'decision.decide'] as const
export type OwnerAction = typeof ACTIONS[number]

const routes = new Map<string, OwnerAction>([
  ['GET /__dsh_a2a/user/sessions', 'session.list'],
  ['GET /__dsh_a2a/user/session', 'session.read'],
  ['POST /__dsh_a2a/user/session/prompt', 'session.prompt'],
  ['POST /__dsh_a2a/user/session/stop', 'session.stop'],
  ['GET /__dsh_a2a/superagent', 'team.read'],
  ['GET /__dsh_a2a/superagent/teams', 'team.read'],
  ['GET /__dsh_a2a/superagent/decisions', 'team.read'],
  ['POST /__dsh_a2a/superagent/decisions', 'decision.decide'],
])

/** Omission retains legacy authority. An invalid present scope must fail closed. */
export function validOwnerScope(value: unknown): value is readonly OwnerAction[] {
  return Array.isArray(value) && value.every(action => ACTIONS.some(allowed => allowed === action))
}

/** Match the literal HTTP method and path. A query cannot change the action. */
export function ownerRouteAction(req: Partial<Pick<IncomingMessage, 'method' | 'url'>>): OwnerAction | undefined {
  return routes.get(req.method + ' ' + req.url?.split('?')[0])
}

export const scopeRefusal = { ok: false, status: 403, code: 'owner-delegate-scope', error: '此操作不在属主委托的动作范围内。' } as const
export const ON_BEHALF_OF_HEADER = 'x-dsh-on-behalf-of'
export interface OnBehalfOf { readonly id: string; readonly name: string }

/** Decode a delegate's declared attribution. This value has no authorization effect. */
export function readOnBehalfOf(raw: string | string[] | undefined): OnBehalfOf | undefined | null {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') return null
  try {
    const value = JSON.parse(raw) as Partial<OnBehalfOf> | null
    if (typeof value?.id !== 'string' || typeof value.name !== 'string' || [...value.id].length > 64 || [...value.name].length > 32) return null
    const scrub = (text: string) => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\[\]]/gu, '').trim()
    const id = scrub(value.id)
    const name = scrub(value.name)
    return id !== '' && name !== '' ? { id, name } : null
  } catch { return null }
}
