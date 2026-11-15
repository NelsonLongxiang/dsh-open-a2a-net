/**
 * The dispatch line a requester puts on a request's first line to name a seat or return a rework
 * (docs/design/superagent-named-dispatch.md). A pure leaf module — the host's named-dispatch keeps the
 * behaviour, the wire SDK re-exports the same parser — so there is exactly one implementation.
 * @module @nelsonlongxiang/dsh-open-a2a-net/dispatch
 */
export const DISPATCH_PREFIX = '[A2A dispatch] '
/** How long a dispatch line's `for` or `rework.of` may be; a longer one is not a dispatch. */
export const ID_MAX = 128

export interface DispatchLine { readonly for?: string; readonly rework?: { readonly of: string } }

/**
 * The network's own header on a delivered request — `[A2A direct] (task …) <verdict> from "…" (routed to …) sent:` and a
 * blank line — written by the receiving host above the caller's message. The dispatch line is the message's first line.
 */
export const DIRECT_HEADER = /^\[A2A direct\][^\n]* sent:\n\n/

/** The request's dispatch line, if its message's first line is one; `body` is the message without it. */
export function parseDispatch(delivered: string): { line: DispatchLine; body: string } | undefined {
  const text = delivered.replace(DIRECT_HEADER, '')
  if (!text.startsWith(DISPATCH_PREFIX)) return undefined
  const newline = text.indexOf('\n')
  const head = (newline === -1 ? text : text.slice(0, newline)).slice(DISPATCH_PREFIX.length).trim()
  let raw: unknown
  try { raw = JSON.parse(head) } catch { return undefined }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const value = raw as { for?: unknown; rework?: unknown }
  const named = typeof value.for === 'string' && value.for.trim() !== '' && value.for.length <= ID_MAX ? value.for.trim() : undefined
  const of = typeof value.rework === 'object' && value.rework !== null && typeof (value.rework as { of?: unknown }).of === 'string' ? (value.rework as { of: string }).of.trim() : undefined
  const rework = of !== undefined && of !== '' && of.length <= ID_MAX ? { of } : undefined
  if (named === undefined && rework === undefined) return undefined
  return { line: { ...(named !== undefined ? { for: named } : {}), ...(rework !== undefined ? { rework } : {}) }, body: newline === -1 ? '' : text.slice(newline + 1).trim() }
}
