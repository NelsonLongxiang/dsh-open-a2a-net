/**
 * `@nelsonlongxiang/dsh-open-a2a-net/sdk/wire` — the credential-free wire SDK for an A2A requester (the workbench
 * market first, docs/design/superagent-root-team.md §R9): the request and receipt formats a requester sends and reads,
 * with no network, no fs and no host credentials. Everything here is the same implementation the host itself uses
 * (src/dispatch.ts, src/receipt.ts) plus small pure helpers over the documented task-id forms; the owner-side parts
 * never live in this export.
 * @module @nelsonlongxiang/dsh-open-a2a-net/sdk/wire
 */
import { ID_MAX, DISPATCH_PREFIX, type DispatchLine } from '../dispatch.ts'
import type { ReceiptOutcomeV2 } from '../receipt.ts'

// The dispatch line, receipts: one implementation, two import paths.
export { parseDispatch, DISPATCH_PREFIX, ID_MAX } from '../dispatch.ts'
export type { DispatchLine } from '../dispatch.ts'
export { parseReceipt, formatReceipt, taskIdRefusal, RECEIPT_PATTERN, RECEIPT_OUTCOMES, RECEIPT_DISPOSITIONS, PROGRESS_STATES, TICKET_STATES, SEAT_ROLES, SEAT_ID_PATTERN, RECEIPT_FIELD_LIMITS } from '../receipt.ts'
export type { ParsedReceipt, ReceiptEnvelopeV2Fields, ReceiptOutcomeV2, ReceiptDisposition, ProgressState, ReceiptProgress, ReceiptTicket, ReceiptBy, ReceiptArtifact, ReceiptQuestion } from '../receipt.ts'

/**
 * Build a request whose first line is the dispatch line: `[A2A dispatch] {json}` then the request's text. Refuses an
 * empty line (neither `for` nor `rework`), a `for` over `ID_MAX` characters, or a `rework.of` over it — the same
 * bounds `parseDispatch` reads — by returning undefined: a refused line is plain text, not an error.
 */
export function formatDispatch(line: { for?: string; rework?: { of: string } }, text: string): string | undefined {
  const named = typeof line.for === 'string' && line.for.trim() !== '' && line.for.trim().length <= ID_MAX ? line.for.trim() : undefined
  const of = typeof line.rework?.of === 'string' && line.rework.of.trim() !== '' && line.rework.of.trim().length <= ID_MAX ? line.rework.of.trim() : undefined
  if (named === undefined && of === undefined) return undefined
  const head = { ...(named !== undefined ? { for: named } : {}), ...(of !== undefined ? { rework: { of } } : {}) }
  const body = text.replace(/\r\n/g, '\n').replace(/^\n+/, '')
  return `${DISPATCH_PREFIX}${JSON.stringify(head)}\n${body}`
}

/** A seat on a roster line, as the requester reads it (the same shape the host sends, superagent-market-progress-roster.md P3). */
export interface RosterSeat { readonly seat: string; readonly seatId?: string; readonly name?: string; readonly team?: string; readonly role: 'router' | 'member' | 'observer'; readonly online: boolean; readonly active: number; readonly queued: number; readonly lastActiveAt?: string }

/** A parsed `[A2A roster]` line: the head's host fp8, and the JSON body's host, at and seats. */
export interface ParsedRoster { readonly host: string; readonly at: string; readonly seats: readonly RosterSeat[] }

const ROSTER_HEAD = /^\[A2A roster\] ([0-9a-f]{8}) (\S+)$/

/**
 * Parse a roster the host sent: `[A2A roster] <fp8> <at>` then one JSON line with `{host, at, seats}`. Returns undefined
 * for any other text, a body that is not that JSON, or a body whose `host` does not start with the head's fp8 — the
 * head and the body must name the same host, or the line is not trusted.
 */
export function parseRoster(text: string): ParsedRoster | undefined {
  const newline = text.indexOf('\n')
  if (!text.startsWith('[A2A roster] ') || newline === -1) return undefined
  const head = ROSTER_HEAD.exec(text.slice(0, newline))
  if (head === null) return undefined
  let raw: unknown
  try { raw = JSON.parse(text.slice(newline + 1)) } catch { return undefined }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const value = raw as { host?: unknown; at?: unknown; seats?: unknown }
  const fp8 = head[1] ?? ''
  const host = typeof value.host === 'string' ? value.host : undefined
  const at = typeof value.at === 'string' ? value.at : undefined
  if (host === undefined || at === undefined || !Array.isArray(value.seats)) return undefined
  if (!host.startsWith(fp8)) return undefined
  const seats: RosterSeat[] = []
  for (const seat of value.seats) {
    if (typeof seat !== 'object' || seat === null) return undefined
    const row = seat as Record<string, unknown>
    if (typeof row.seat !== 'string' || typeof row.online !== 'boolean' || typeof row.active !== 'number' || typeof row.queued !== 'number') return undefined
    if (row.role !== 'router' && row.role !== 'member' && row.role !== 'observer') return undefined
    const seatId = typeof row.seatId === 'string' ? row.seatId : undefined
    const name = typeof row.name === 'string' && row.name !== '' ? row.name : undefined
    const team = typeof row.team === 'string' && row.team !== '' ? row.team : undefined
    const lastActiveAt = typeof row.lastActiveAt === 'string' ? row.lastActiveAt : undefined
    seats.push({
      seat: row.seat,
      ...(seatId !== undefined ? { seatId } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(team !== undefined ? { team } : {}),
      role: row.role,
      online: row.online, active: row.active, queued: row.queued,
      ...(lastActiveAt !== undefined ? { lastActiveAt } : {}),
    })
  }
  return { host, at, seats }
}

/** The task-id forms a receipt or report rides (receipt-envelope-fields.md, superagent-market-progress-roster.md). */
export type TaskKind =
  | { kind: 'ack'; task: string }
  | { kind: 'progress'; task: string; n: number }
  | { kind: 'attention'; task: string; questionId: string }
  | { kind: 'receipt'; task: string }
  | { kind: 'roster'; host: string }
  | { kind: 'other' }

/** Classify a task id by its documented form: which receipt it is, of which task, which question or step. */
export function taskKind(taskId: string): TaskKind {
  const parts = taskId.split('-')
  const [first, second, third] = parts
  if (first === 'ack' && parts.length === 2 && second !== undefined && second !== '') return { kind: 'ack', task: second }
  if (first === 'receipt' && parts.length === 2 && second !== undefined && second !== '') return { kind: 'receipt', task: second }
  if (first === 'progress' && parts.length === 3 && second !== undefined && second !== '' && third !== undefined && /^\d+$/.test(third)) return { kind: 'progress', task: second, n: Number(third) }
  if (first === 'attention' && parts.length === 3 && second !== undefined && second !== '' && third !== undefined && third !== '') return { kind: 'attention', task: second, questionId: third }
  if (first === 'roster' && parts.length === 3 && second !== undefined && /^[0-9a-f]{8}$/.test(second) && third !== undefined && /^\d+$/.test(third)) return { kind: 'roster', host: second }
  return { kind: 'other' }
}

/** The task id a request's formal result receipt rides (receipt-<task>): the id the answerer echoes back. */
export function receiptTaskId(task: string): string { return `receipt-${task}` }

/**
 * Whether a task id's receipt holds the caller's row open instead of settling it (task-ledger-rows: an `acknowledged`
 * receipt, or an `attention` one carrying a question, marks the row and restarts its clock; the result on
 * `receipt-<task>` settles it). A progress step holds too. Roster ids are not the caller's task at all.
 */
export function holdsRow(taskId: string): boolean {
  const kind = taskKind(taskId)
  return kind.kind === 'ack' || kind.kind === 'attention' || kind.kind === 'progress'
}

/** The capabilities a host or a team may declare on its card; the wire side only reads them (superagent-root-team.md §R9). */
export const CAPABILITIES = {
  progressReceipts: 'progressReceipts',
  teamRoster: 'teamRoster',
  directedSeats: 'directedSeats',
  reworkReturns: 'reworkReturns',
} as const
export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]

/** Whether a pinned card declares a capability: true only when the card's `capabilities[name]` is exactly true — a string "true" is not a declaration. */
export function declares(card: unknown, name: string): boolean {
  if (typeof card !== 'object' || card === null) return false
  const capabilities = (card as { capabilities?: unknown }).capabilities
  if (typeof capabilities !== 'object' || capabilities === null) return false
  return (capabilities as Record<string, unknown>)[name] === true
}
