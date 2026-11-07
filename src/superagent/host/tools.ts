/**
 * superagent design v4, PR-B: the router's host tools (upstream's orchestrator_route / _read / _reply /
 * _ticket_request_status, under a2a names).
 *
 * Only the session the owner named router may call them: the check is in every tool, so another session that sees the
 * tools still cannot decide, read the team's records or reply. Every decision goes through the engine, which re-checks it
 * (an inadmissible Trigger cannot be accepted, an accept is idempotent by trigger id, a follow-up a ticket's worker still
 * decides can only be stopped). The router never sends free text to anyone: replies are engine replies to the Thread.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { UserError, type Outcome, type ReplyRequest } from '../upstream/dsh-superagent/src/core/index.ts'
import type { SuperagentHost } from './index.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

const notRouter = { ok: false, code: 'not-router', error: 'superagent tools serve only the team router session the owner named; this session is not it' } as const

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue
const failure = (error: unknown): Record<string, JsonValue> => error instanceof UserError
  ? { ok: false, code: error.code, error: error.message }
  : { ok: false, code: 'error', error: error instanceof Error ? error.message : String(error) }

interface RouteItem {
  trigger_id?: unknown; kind?: unknown; title?: unknown; scope?: unknown; reason?: unknown; acknowledgement?: unknown
  ticket_id?: unknown; name?: unknown; note?: unknown; rules?: unknown
}
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

/** One routing item, decided on its own: a refused item never stops the others (upstream docs/002). */
export function routeItem(host: SuperagentHost, item: RouteItem): Record<string, JsonValue> {
  const triggerId = str(item.trigger_id)
  const kind = str(item.kind)
  if (triggerId === undefined) return { ok: false, code: 'missing', error: 'trigger_id is required' }
  try {
    if (kind === 'attach') {
      const ticketId = str(item.ticket_id)
      if (ticketId === undefined) return { ok: false, trigger_id: triggerId, code: 'missing', error: 'attach needs ticket_id' }
      const ticket = host.engine.attach(ticketId, triggerId, str(item.note))
      return { ok: true, trigger_id: triggerId, kind, ticket_id: ticket.id }
    }
    const reason = str(item.reason)
    if (reason === undefined) return { ok: false, trigger_id: triggerId, code: 'missing', error: `${String(kind)} needs a reason` }
    const candidate = host.engine.candidate(triggerId)
    const evalId = candidate?.evalId
    const rules = Array.isArray(item.rules) ? [...new Set(item.rules.filter((r): r is string => typeof r === 'string' && r !== ''))] : []
    let outcome: Outcome
    if (kind === 'accept' && candidate?.strength === 'inferred' && host.settings.acceptMode !== 'auto') {
      // Upstream accept mode `observe`: a positive assessment of an inferred candidate is recorded as an ignore that says
      // it would accept, with the rules it matched; nothing is accepted.
      if (rules.length === 0) return { ok: false, trigger_id: triggerId, code: 'rules', error: 'an inferred candidate is assessed against the enabled rules: name the rules it matches' }
      outcome = { kind: 'ignore', reason: { code: 'observed', values: { text: rules.join(', ') } }, audit: { wouldAccept: true, rules, assessed: reason } }
    } else if (kind === 'accept') {
      const title = str(item.title), scope = str(item.scope)
      if (title === undefined || scope === undefined) return { ok: false, trigger_id: triggerId, code: 'missing', error: 'accept needs a title and a scope' }
      const acknowledgement = str(item.acknowledgement), name = str(item.name), note = str(item.note)
      outcome = { kind: 'accept', title, scope, reason, ...(acknowledgement !== undefined ? { acknowledgement } : {}), ...(name !== undefined ? { name } : {}), ...(note !== undefined ? { note } : {}), ...(rules.length > 0 ? { rules } : {}) }
    } else if (kind === 'ignore') outcome = candidate?.strength === 'inferred' && rules.length === 0 && item.rules !== undefined
      ? { kind: 'ignore', reason, audit: { assessed: true, rules: [] } }
      : { kind: 'ignore', reason }
    else if (kind === 'stop') {
      const ticketId = str(item.ticket_id)
      if (ticketId === undefined) return { ok: false, trigger_id: triggerId, code: 'missing', error: 'stop needs ticket_id' }
      outcome = { kind: 'stop', ticketId, reason }
    } else return { ok: false, trigger_id: triggerId, code: 'kind', error: 'kind must be accept, attach, stop or ignore' }
    const decision = host.engine.decide(triggerId, { ...outcome, ...(evalId !== undefined ? { evalId } : {}) })
    return { ok: true, trigger_id: triggerId, kind, decision_id: decision.id, decision: decision.kind, ...(decision.ticketId !== undefined ? { ticket_id: decision.ticketId } : {}), reason: json(decision.reason) }
  } catch (error) { return { trigger_id: triggerId, ...failure(error) } }
}

export function registerSuperagentTools(ctx: Context, host: () => SuperagentHost | undefined): void {
  /** The host, when the calling session is the team's router; undefined otherwise. */
  const asRouter = (exec: { agent?: { id: unknown } }): SuperagentHost | undefined => {
    const h = host()
    return h !== undefined && h.routerSession !== undefined && exec.agent !== undefined && String(exec.agent.id) === h.routerSession ? h : undefined
  }
  const said = (title: string, value: Record<string, unknown>) => [{ type: 'text' as const, text: value.ok === true ? `${title}: ok` : `${title} refused: ${String(value.error ?? JSON.stringify(value.results ?? ''))}` }]

  ctx.tools.register(defineTool({
    name: 'superagent_route',
    description: 'Team router only: decide candidates by trigger_id. Each item is one of accept (one ticket for the request: title, scope, reason, acknowledgement in the request language; no implementation plan), attach (ticket_id the message explicitly points at), stop (ticket_id a person asked to stop) or ignore (reason). Items are processed independently.',
    parameters: {
      items: { type: 'array', required: true, items: { type: 'object', additionalProperties: true }, description: 'Routing items: { trigger_id, kind, title?, scope?, reason?, acknowledgement?, ticket_id?, name?, note?, rules? }. For an inferred candidate, rules names the enabled rules it matches (required to accept; observe mode records it as would-accept); rules: [] records an assessed ignore.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('superagent route', value) },
    presentCall: args => ({ card: 'generic', title: `superagent route (${String(Array.isArray(args.items) ? args.items.length : 0)})`, kind: 'other', rawInput: args }),
    execute: async (args: { items: RouteItem[] }, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      const items = Array.isArray(args.items) ? args.items : []
      if (items.length === 0 || items.length > 32) return { ok: false, code: 'items', error: 'items must hold 1–32 routing items' }
      const results = items.map(item => routeItem(h, item))
      h.pass()
      return { ok: results.every(r => r.ok === true), results }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'superagent_read',
    description: 'Team router only: read the candidate holding a trigger (kind candidate, trigger_id), one ticket (kind ticket, ticket_id) or the open and recent tickets (kind tickets).',
    parameters: {
      kind: { type: 'string', required: true, description: 'candidate | ticket | tickets' },
      trigger_id: { type: 'string', description: 'For kind candidate.' },
      ticket_id: { type: 'string', description: 'For kind ticket.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('superagent read', value) },
    presentCall: args => ({ card: 'generic', title: `superagent read ${String(args.kind)}`, kind: 'other', rawInput: args }),
    execute: async (args: { kind: string; trigger_id?: string; ticket_id?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      if (args.kind === 'candidate') {
        const candidate = h.engine.candidate(String(args.trigger_id ?? ''))
        return candidate === undefined ? { ok: false, code: 'none', error: 'no Eval holds that trigger' } : { ok: true, candidate: json(candidate) }
      }
      if (args.kind === 'ticket') {
        const ticket = h.ticket(String(args.ticket_id ?? ''))
        return ticket === undefined ? { ok: false, code: 'unknownTicket', error: 'no such ticket' } : { ok: true, ticket: json(ticket) }
      }
      if (args.kind === 'tickets') {
        const tickets = h.store.tickets.list().slice(0, 50).map(t => ({ id: t.id, title: t.title, ended: t.ended ?? null, stage: h.ticket(t.id)?.stage ?? null, origin: t.origin }))
        return { ok: true, tickets: json(tickets) }
      }
      return { ok: false, code: 'kind', error: 'kind must be candidate, ticket or tickets' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'superagent_reply',
    description: 'Team router only: send a short message to the conversation a rule allows — purpose answer (a person\'s question, trigger_id), result (a ticket\'s usable result, ticket_id) or attention (a ticket\'s stored question for a person, ticket_id, question copied exactly). Progress stays internal.',
    parameters: {
      purpose: { type: 'string', required: true, description: 'answer | result | attention' },
      text: { type: 'string', required: true, description: 'The message, in the request\'s language.' },
      ticket_id: { type: 'string' },
      trigger_id: { type: 'string' },
      question: { type: 'string', description: 'For attention: the stored question, copied exactly.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('superagent reply', value) },
    presentCall: args => ({ card: 'generic', title: `superagent reply (${String(args.purpose)})`, kind: 'other', rawInput: args }),
    execute: async (args: { purpose: string; text: string; ticket_id?: string; trigger_id?: string; question?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      if (!['answer', 'result', 'attention'].includes(args.purpose)) return { ok: false, code: 'purpose', error: 'purpose must be answer, result or attention' }
      const text = str(args.text)
      if (text === undefined) return { ok: false, code: 'missing', error: 'text is required' }
      const request = { purpose: args.purpose as 'answer' | 'result' | 'attention', text, ...(str(args.ticket_id) !== undefined ? { ticketId: str(args.ticket_id)! } : {}), ...(str(args.trigger_id) !== undefined ? { triggerId: str(args.trigger_id)! } : {}), ...(str(args.question) !== undefined ? { question: str(args.question)! } : {}) } as ReplyRequest
      try { const reply = h.engine.reply(request); return { ok: true, reply: json(reply) } } catch (error) { return failure(error) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'superagent_status',
    description: 'Team router only: ask the worker of an idle ticket (ended its turn without a report) for a status report. Wakes no other ticket.',
    parameters: { ticket_id: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('superagent status', value) },
    presentCall: args => ({ card: 'generic', title: `superagent status ${String(args.ticket_id)}`, kind: 'other', rawInput: args }),
    execute: async (args: { ticket_id: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      try { return { ok: true, requested: h.engine.requestStatus(String(args.ticket_id ?? '')) } } catch (error) { return failure(error) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_ticket_report',
    description: 'Team member only: report on the superagent ticket assigned to you (upstream orchestrator_report). state: progress (something changed the person must know), waiting (you wait for a Trigger), ready (the result can be reviewed or used — put the pull request link in the summary), blocked or failed (you cannot go on), dropped (nothing to do). question: one concrete question when the ticket owner must decide; null clears an open one.',
    parameters: {
      state: { type: 'string', required: true, description: 'progress | waiting | ready | blocked | failed | dropped' },
      summary: { type: 'string', required: true, description: 'What changed, with evidence; links for results.' },
      question: { type: 'string', description: 'One concrete question for the ticket owner; empty to keep, "null" to clear.' },
      answers: { type: 'string', description: 'The trigger id of the person\'s question this report answers.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('ticket report', value) },
    presentCall: args => ({ card: 'generic', title: `ticket report: ${String(args.state)}`, kind: 'other', rawInput: args }),
    execute: async (args: { state: string; summary: string; question?: string; answers?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = host()
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h === undefined || me === undefined || h.roleOf(me) !== 'member') return { ok: false, code: 'not-member', error: 'a2a_ticket_report serves only the superagent team members the owner named' }
      if (!['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped'].includes(args.state)) return { ok: false, code: 'state', error: 'state must be progress, waiting, ready, blocked, failed or dropped' }
      const summary = str(args.summary)
      if (summary === undefined) return { ok: false, code: 'missing', error: 'summary is required' }
      const question = args.question === 'null' ? null : str(args.question)
      const report = { state: args.state as 'progress', summary, ...(question !== undefined ? { question } : {}), ...(str(args.answers) !== undefined ? { answers: str(args.answers)! } : {}) }
      // PR-C2: a session serving another host's team reports there, signed by this host's key.
      const out = h.settings.serves?.members.includes(me) === true ? await h.forwardReport(me, report) : h.report(me, report)
      return json(out) as Record<string, JsonValue>
    },
  }))
}
