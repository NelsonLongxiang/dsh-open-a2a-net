/**
 * docs/design/superagent-named-dispatch.md: a request that names a seat (`for`), and rework the market returns (`rework`).
 * The request's first line `[A2A dispatch] {json}` is believed only from a signed caller whose pinned card declares the
 * capability (`directedSeats`, `reworkReturns`). Seats are stable ids per member slot; a named seat that cannot take the
 * ticket holds it, and the requester is asked 「等」 or 「换人」. Persisted beside the executor's state.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/named-dispatch
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import type { Engine, Ticket, Trigger } from '../upstream/dsh-superagent/src/core/index.ts'
import { key } from '../source-types.ts'

export const DISPATCH_PREFIX = '[A2A dispatch] '
export const NAMED_CAPABILITY = 'directedSeats'
export const REWORK_CAPABILITY = 'reworkReturns'
/** The answers a seat-held ticket's question offers. */
export const WAIT = '等'
export const SWAP = '换人'
/** How long a seat that left keeps its id (a dispatch naming it then gets the question, not an unknown name). */
export const SEAT_LEFT_KEEP_MS = 30 * 86_400_000
const ID_MAX = 128

export interface DispatchLine { readonly for?: string; readonly rework?: { readonly of: string } }

/**
 * The network's own header on a delivered request — `[A2A direct] (task …) <verdict> from "…" (routed to …) sent:` and a
 * blank line — written by the receiving host above the caller's message. The dispatch line is the message's first line.
 */
const DIRECT_HEADER = /^\[A2A direct\][^\n]* sent:\n\n/

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

/**
 * The option a requester's answer picks, read from the answer itself: under the network's header, a JSON envelope's
 * `answer.text` (the market's workbench event) or `text`, else the message's first line. 「换人」 is checked first; a
 * name or another field that merely contains 「等」 elsewhere in the envelope is not read.
 */
export function answerChoice(delivered: string): typeof WAIT | typeof SWAP | undefined {
  const body = delivered.replace(DIRECT_HEADER, '').trim()
  let said: string | undefined
  try {
    const value = JSON.parse(body) as { answer?: { text?: unknown }; text?: unknown }
    said = typeof value?.answer?.text === 'string' ? value.answer.text : typeof value?.text === 'string' ? value.text : undefined
  } catch { said = body.split('\n').find(line => line.trim() !== '') }
  const option = (said ?? '').trim().replace(/^[「『"'“]+/, '')
  if (option.startsWith(SWAP)) return SWAP
  if (option.startsWith(WAIT)) return WAIT
  return undefined
}

interface SeatRow { member: string; left?: string }
interface Hold { wanted: string; why: string; asked?: string; answered?: 'wait'; choosing?: true }
/** `reworks`: a rework ticket's original title (the first request's), so a return of a return is titled after that one. */
interface Stored { seats: Record<string, SeatRow>; named: Record<string, string>; holds: Record<string, Hold>; reworks?: Record<string, string> }
/** How many rework tickets' original titles are kept. */
const REWORKS_CAP = 500
const REWORK_TITLE = '打回重做'

export interface NamedDeps {
  readonly path: string
  readonly engine: Pick<Engine, 'report' | 'reply' | 'assignmentStarted' | 'retryTicket' | 'decide'>
  readonly ticket: (id: string) => Ticket | undefined
  readonly tickets: () => readonly Ticket[]
  readonly trigger: (id: string) => Trigger | undefined
  readonly pool: () => readonly string[]
  /** The team's router: it has a seat too (the roster names it), but a dispatch never makes it the worker. */
  readonly router?: () => string | undefined
  /** Whether a member can take work now: a local session that is loaded, or a member on another host. */
  readonly loaded: (member: string) => boolean
  readonly resolveMember: (value: string) => string | undefined
  readonly memberName: (member: string) => string
  /** Whether an A2A caller's pinned, verified card declares a capability. */
  readonly declares: (caller: string, capability: string) => boolean
  readonly setMember: (ticketId: string, member: string) => void
  readonly clearMember: (ticketId: string) => void
  readonly lastMemberOf: (ticketId: string) => string | undefined
  readonly fileQuestion: (ticketId: string, question: string) => void
  readonly profiled: () => boolean
  readonly tellRouter: (text: string) => void
  readonly now: () => string
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
}

export class NamedDispatch {
  private data: Stored = { seats: {}, named: {}, holds: {} }

  constructor(private readonly d: NamedDeps) {
    try {
      if (existsSync(d.path)) {
        const raw = JSON.parse(readFileSync(d.path, 'utf8')) as Partial<Stored>
        this.data = { seats: raw.seats ?? {}, named: raw.named ?? {}, holds: raw.holds ?? {}, ...(raw.reworks !== undefined ? { reworks: raw.reworks } : {}) }
      }
    } catch { this.data = { seats: {}, named: {}, holds: {} } }
  }

  private save(): void {
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.data), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  // ── Seats ──

  /** Every member in the pool has a seat; a seat whose member left is marked, and forgotten after SEAT_LEFT_KEEP_MS. */
  syncSeats(): void {
    const router = this.d.router?.()
    const pool = new Set([...this.d.pool(), ...(router !== undefined && router !== '' ? [router] : [])])
    const now = this.d.now()
    let changed = false
    const held = new Set<string>()
    for (const [id, row] of Object.entries(this.data.seats)) {
      if (pool.has(row.member)) {
        held.add(row.member)
        if (row.left !== undefined) { this.data.seats[id] = { member: row.member }; changed = true }
      } else if (row.left === undefined) { this.data.seats[id] = { ...row, left: now }; changed = true }
      else if (Date.parse(now) - Date.parse(row.left) > SEAT_LEFT_KEEP_MS) { Reflect.deleteProperty(this.data.seats, id); changed = true }
    }
    for (const member of pool) {
      if (held.has(member)) continue
      this.data.seats[`seat-${randomBytes(4).toString('hex')}`] = { member }
      changed = true
    }
    if (changed) this.save()
  }

  /** A member's seat id. */
  seatIdOf(member: string): string | undefined {
    return Object.entries(this.data.seats).find(([, row]) => row.member === member && row.left === undefined)?.[0]
  }

  /** The owner moves a seat to another member of the team (a replaced session keeps the seat). */
  moveSeat(from: string, to: string): { ok: true; seatId: string } | { ok: false; error: string } {
    const seatId = this.data.seats[from] !== undefined ? from : Object.entries(this.data.seats).find(([, row]) => row.member === from)?.[0]
    if (seatId === undefined) return { ok: false, error: `no seat ${from}` }
    const target = this.d.resolveMember(to)
    if (target === undefined) return { ok: false, error: `${to} is not a member of this team` }
    for (const [id, row] of Object.entries(this.data.seats)) if (row.member === target && id !== seatId) Reflect.deleteProperty(this.data.seats, id)
    this.data.seats[seatId] = { member: target }
    this.save()
    return { ok: true, seatId }
  }

  /** What a `for` names: a seat id first, then a handle or name. `member` is undefined when it is not on the team now. */
  private resolve(wanted: string): { member?: string; label: string } {
    const row = this.data.seats[wanted]
    // A seat names a worker only while its session is in the pool: the router's seat, or a seat that left, is not one.
    if (row !== undefined) return row.left === undefined && this.d.pool().includes(row.member) ? { member: row.member, label: wanted } : { label: wanted }
    const member = this.d.resolveMember(wanted)
    return member !== undefined ? { member, label: this.d.memberName(member) } : { label: wanted }
  }

  // ── Believed dispatch lines ──

  /** The trigger's dispatch line, when its caller is believed for `capability`. */
  believed(trigger: Trigger | undefined, capability: string): DispatchLine | undefined {
    if (trigger === undefined || trigger.source !== 'a2a' || trigger.human) return undefined
    if ((trigger.meta as { proof?: unknown } | undefined)?.proof !== 'origin-claim') return undefined
    const parsed = parseDispatch(trigger.text)
    if (parsed === undefined || !this.d.declares(trigger.actor.id, capability)) return undefined
    return parsed.line
  }

  /** The seat a candidate's request names (the first believed one), for the router's accept. */
  namedIn(triggerIds: readonly string[]): string | undefined {
    for (const id of triggerIds) {
      const wanted = this.believed(this.d.trigger(id), NAMED_CAPABILITY)?.for
      if (wanted !== undefined) return wanted
    }
    return undefined
  }

  /** The line the router reads on a candidate that names a seat. */
  cardLines(triggerIds: readonly string[]): string[] {
    const wanted = this.namedIn(triggerIds)
    if (wanted === undefined) return []
    return [`This request names a seat (named dispatch): ${this.resolve(wanted).label}. You decide only whether the team takes it. If you accept it, the host gives it to that seat — do not name a member, and do not pick another one.`]
  }

  /** Whether a ticket came from a named dispatch. */
  isNamed(ticketId: string): boolean { return this.data.named[ticketId] !== undefined }
  /** A named ticket's seat, for its parts (ruling c). */
  namedOf(ticketId: string): string | undefined { return this.data.named[ticketId] }

  // ── Accept and hold ──

  /** A ticket accepted from a named dispatch: named for the seat when it can take work, else held with a question. */
  accepted(ticketId: string, wanted: string): void {
    this.data.named[ticketId] = wanted
    const seat = this.resolve(wanted)
    if (seat.member !== undefined && this.d.loaded(seat.member)) {
      this.save()
      this.d.setMember(ticketId, seat.member)
      return
    }
    this.hold(ticketId, wanted, seat.member === undefined ? '不在这个团队' : '现在不在线')
  }

  /** Whether a ticket is held from members waiting on its named seat. */
  held(ticketId: string): boolean { return this.data.holds[ticketId] !== undefined }

  private hold(ticketId: string, wanted: string, why: string): void {
    this.data.holds[ticketId] = { wanted, why }
    this.save()
    this.d.logger.info('superagent: ticket %s held for its named seat %s (%s)', ticketId, wanted, why)
    this.ask(ticketId)
  }

  /** The question back to the requester: marks the held ticket's assignment started and reports blocked on it. */
  private ask(ticketId: string): void {
    const hold = this.data.holds[ticketId]
    const ticket = this.d.ticket(ticketId)
    if (hold === undefined || ticket === undefined || ticket.ended !== undefined || hold.asked !== undefined || hold.answered !== undefined || hold.choosing) return
    const question = `指名的成员 ${this.resolve(hold.wanted).label} ${hold.why}，接不了这张单。${WAIT}这个成员，还是${SWAP}（不指名重派）？`
    try {
      const latest = ticket.assignments.at(-1)
      if (latest !== undefined && latest.state === 'pending') this.d.engine.assignmentStarted(ticketId, latest.id)
      this.d.engine.report(ticketId, { state: 'blocked', summary: question, question })
      this.d.fileQuestion(ticketId, question)
      this.d.engine.reply({ purpose: 'attention', ticketId, question, text: question })
      this.data.holds[ticketId] = { ...hold, asked: this.d.now() }
      this.save()
    } catch (error) { this.d.logger.warn('superagent: question for held ticket %s not asked yet: %s', ticketId, String(error)) }
  }

  /** The requester's answer, attached to a held ticket by the light path: 「换人」 drops the naming, 「等」 keeps waiting. */
  answered(ticketId: string, text: string): void {
    const hold = this.data.holds[ticketId]
    if (hold === undefined || hold.asked === undefined || hold.choosing) return
    const choice = answerChoice(text)
    if (choice === undefined) return
    const swap = choice === SWAP, wait = choice === WAIT
    this.clearQuestion(ticketId, swap ? '请求方选择换人' : '请求方选择等指名的成员')
    if (wait) { this.data.holds[ticketId] = { ...hold, answered: 'wait' }; this.save(); return }
    Reflect.deleteProperty(this.data.named, ticketId)
    this.d.clearMember(ticketId)
    if (this.d.profiled()) {
      this.data.holds[ticketId] = { ...hold, choosing: true }
      this.save()
      const ticket = this.d.ticket(ticketId)
      this.d.tellRouter(`[superagent] ticket ${ticketId}${ticket !== undefined ? ` «${ticket.title}»` : ''}: the seat the request named cannot take it, and the requester chose another member. Choose one with superagent_assign (ticket_id, member).`)
      return
    }
    Reflect.deleteProperty(this.data.holds, ticketId)
    this.save()
    this.retry(ticketId)
  }

  /** The router named a member for a ticket waiting for its choice: the hold ends. */
  assigned(ticketId: string): void {
    if (this.data.holds[ticketId] === undefined) return
    Reflect.deleteProperty(this.data.holds, ticketId)
    this.save()
  }

  private clearQuestion(ticketId: string, summary: string): void {
    const ticket = this.d.ticket(ticketId)
    if (ticket?.attention === undefined || ticket.ended !== undefined) return
    try { this.d.engine.report(ticketId, { state: 'blocked', summary, question: null }) } catch (error) { this.d.logger.warn('superagent: question on %s not cleared: %s', ticketId, String(error)) }
  }

  private retry(ticketId: string): void {
    try { this.d.engine.retryTicket(ticketId) } catch (error) { this.d.logger.warn('superagent: held ticket %s not restarted: %s', ticketId, String(error)) }
  }

  /** Named tickets whose seat left the team: held with the question (the router is not asked to choose). */
  seatsLeft(orphaned: readonly string[]): string[] {
    const rest: string[] = []
    for (const ticketId of orphaned) {
      const wanted = this.data.named[ticketId]
      if (wanted === undefined) { rest.push(ticketId); continue }
      this.d.clearMember(ticketId)
      if (this.data.holds[ticketId] === undefined) { this.data.holds[ticketId] = { wanted, why: '已不在这个团队' }; this.save() }
    }
    return rest
  }

  /** One pass: a held ticket whose seat can take work again goes to it; a question not asked yet is asked. */
  tick(): void {
    // The first pass runs while the plugin is still starting, before the canvas can be read: nothing is lost by trying again
    // on a later pass, and a throw here would fail the plugin's start (as #617 did for the seat role).
    try { this.syncSeats() } catch (error) { this.d.logger.warn('superagent: seats not synced yet: %s', String(error)); return }
    for (const [ticketId, hold] of Object.entries(this.data.holds)) {
      const ticket = this.d.ticket(ticketId)
      if (ticket === undefined || ticket.ended !== undefined) { Reflect.deleteProperty(this.data.holds, ticketId); this.save(); continue }
      if (hold.choosing) continue
      const seat = this.resolve(hold.wanted)
      if (seat.member !== undefined && this.d.loaded(seat.member)) {
        Reflect.deleteProperty(this.data.holds, ticketId)
        this.save()
        this.clearQuestion(ticketId, `指名的成员 ${seat.label} 可以接了`)
        this.d.setMember(ticketId, seat.member)
        this.retry(ticketId)
        this.d.logger.info('superagent: held ticket %s goes to its named seat %s', ticketId, seat.label)
        continue
      }
      if (hold.asked === undefined && hold.answered === undefined) this.ask(ticketId)
    }
    for (const ticketId of Object.keys(this.data.named)) {
      const ticket = this.d.ticket(ticketId)
      if (ticket === undefined || ticket.ended !== undefined) { Reflect.deleteProperty(this.data.named, ticketId); this.save() }
    }
  }

  // ── Rework returns ──

  /**
   * A believed rework return, accepted at once as a new ticket (N5). Returns whether the host took it: then the router is
   * not asked, and the light path does not attach it anywhere.
   */
  rework(triggerId: string): boolean {
    const trigger = this.d.trigger(triggerId)
    const line = this.believed(trigger, REWORK_CAPABILITY)
    if (trigger === undefined || line?.rework === undefined) return false
    const of = line.rework.of
    // A mailbox row's trigger id is key('a2a', caller, task id) (a2a-watch translate): the returned request, from this caller.
    const originId = key('a2a', trigger.actor.id, of)
    const returned = this.d.tickets().filter(t => t.origin.triggerIds.includes(originId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    const body = parseDispatch(trigger.text)?.body ?? ''
    // `of` is the delivery that was returned — after a rework, the rework ticket. The title names the first request, not a
    // chain: the original title a host rework recorded, else the returned ticket's title without any 打回重做： prefix.
    const root = returned === undefined ? undefined : this.data.reworks?.[returned.id] ?? returned.title.replace(new RegExp(`^(${REWORK_TITLE}：)+`), '')
    const title = (root !== undefined && root !== '' ? `${REWORK_TITLE}：${root}` : REWORK_TITLE).slice(0, 200)
    const rules = returned?.mandate.basis.rules ?? []
    let ticketId: string | undefined
    try {
      const decision = this.d.engine.decide(triggerId, { kind: 'accept', title, scope: body !== '' ? body : title, reason: `rework return of task ${of} (reworkReturns)`, ...(rules.length > 0 ? { rules: [...rules] } : {}) } as never)
      ticketId = decision.ticketId
    } catch (error) { this.d.logger.warn('superagent: rework return %s not taken in: %s', triggerId, String(error)); return false }
    if (ticketId === undefined) return false
    this.d.logger.info('superagent: rework return of %s accepted as ticket %s', of, ticketId)
    if (root !== undefined && root !== '') {
      this.data.reworks = Object.fromEntries([...Object.entries(this.data.reworks ?? {}), [ticketId, root]].slice(-REWORKS_CAP))
      this.save()
    }
    const wanted = this.believed(trigger, NAMED_CAPABILITY)?.for
    if (wanted !== undefined) { this.accepted(ticketId, wanted); return true }
    const last = returned !== undefined ? this.d.lastMemberOf(returned.id) : undefined
    if (last !== undefined && this.d.pool().includes(last)) this.d.setMember(ticketId, last)
    return true
  }
}
