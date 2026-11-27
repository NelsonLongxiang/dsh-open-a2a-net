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
import { OBSERVER_OPEN_MAX, proposerKind } from './policy.ts'
import { grantableTool, memberBoundary, roleTools } from './role-tools.ts'
import { parseDecision } from './decisions.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

const notRouter = { ok: false, code: 'not-router', error: 'superagent tools serve only the team router session the owner named; this session is not it' } as const

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue
const failure = (error: unknown): Record<string, JsonValue> => error instanceof UserError
  ? { ok: false, code: error.code, error: error.message }
  : { ok: false, code: 'error', error: error instanceof Error ? error.message : String(error) }

/** A wrong id is refused as before; the refusal now says what the caller does hold, so it can retry from the right id. */
const refusal = (host: SuperagentHost, error: unknown, ids: { trigger?: string; ticket?: string }): Record<string, JsonValue> => {
  const out = failure(error)
  const hint = out.error === 'Unknown trigger' && ids.trigger !== undefined ? host.wrongId('trigger', ids.trigger)
    : out.error === 'Unknown ticket' && ids.ticket !== undefined ? host.wrongId('ticket', ids.ticket) : undefined
  return hint === undefined ? out : { ...out, error: hint }
}

interface RouteItem {
  trigger_id?: unknown; kind?: unknown; title?: unknown; scope?: unknown; reason?: unknown; acknowledgement?: unknown
  ticket_id?: unknown; name?: unknown; note?: unknown; rules?: unknown; repo?: unknown; member?: unknown
}
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

/** One routing item, decided on its own: a refused item never stops the others (upstream docs/002). */
export function routeItem(host: SuperagentHost, item: RouteItem): Record<string, JsonValue> {
  const triggerId = str(item.trigger_id)
  const kind = str(item.kind)
  if (triggerId === undefined) return { ok: false, code: 'missing', error: 'trigger_id is required' }
  host.routerDecided()
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
    const repo = str(item.repo)
    // Named dispatch N3: a request that names a seat goes to that seat; the router's member is not asked for, nor used.
    const named = kind === 'accept' ? host.named.namedIn(candidate?.triggers.map(t => t.id) ?? [triggerId]) : undefined
    const memberName = named === undefined ? str(item.member) : undefined
    const member = memberName !== undefined ? host.resolveMember(memberName) : undefined
    let outcome: Outcome
    if (kind === 'accept' && candidate?.strength === 'inferred' && host.settings.acceptMode !== 'auto') {
      // Upstream accept mode `observe`: a positive assessment of an inferred candidate is recorded as an ignore that says
      // it would accept, with the rules it matched; nothing is accepted.
      if (rules.length === 0) return { ok: false, trigger_id: triggerId, code: 'rules', error: 'an inferred candidate is assessed against the enabled rules: name the rules it matches' }
      outcome = { kind: 'ignore', reason: { code: 'observed', values: { text: rules.join(', ') } }, audit: { wouldAccept: true, rules, assessed: reason } }
    } else if (kind === 'accept') {
      const title = str(item.title), scope = str(item.scope)
      if (title === undefined || scope === undefined) return { ok: false, trigger_id: triggerId, code: 'missing', error: 'accept needs a title and a scope' }
      if (repo !== undefined && !host.teamRepos().has(repo)) {
        const known = [...host.teamRepos().keys()].sort()
        return { ok: false, trigger_id: triggerId, code: 'repo', error: `no member works in ${repo}; the team's repositories: ${known.length > 0 ? known.join(', ') : '(none — accept without repo)'}` }
      }
      if (memberName !== undefined && member === undefined) return { ok: false, trigger_id: triggerId, code: 'member', error: `no such member: ${memberName}. ${host.memberListLine()}` }
      // #921: a split's coordinating parent is held from members (splitHeld), so it names none; only an ordinary accept must.
      if (memberName === undefined && named === undefined && host.membersProfiled() && !host.splits.isSplitting(triggerId)) return { ok: false, trigger_id: triggerId, code: 'member', error: `this team's members have roles and rules: name the one this work fits as member. ${host.memberListLine()}` }
      const acknowledgement = str(item.acknowledgement), name = str(item.name), note = str(item.note)
      outcome = { kind: 'accept', title, scope, reason, ...(acknowledgement !== undefined ? { acknowledgement } : {}), ...(name !== undefined ? { name } : {}), ...(note !== undefined ? { note } : {}), ...(rules.length > 0 ? { rules } : {}) }
    } else if (kind === 'ignore') outcome = candidate?.strength === 'inferred' && rules.length === 0 && item.rules !== undefined
      ? { kind: 'ignore', reason, audit: { assessed: true, rules: [] } }
      : { kind: 'ignore', reason }
    else if (kind === 'stop') {
      const ticketId = str(item.ticket_id)
      if (ticketId === undefined) return { ok: false, trigger_id: triggerId, code: 'missing', error: 'stop needs ticket_id' }
      // An observer's or a member's request is explicit so that it can be accepted; a stop stays a person's (D16, #717).
      const proposer = candidate?.triggers.map(t => proposerKind(t.actor)).find(k => k !== undefined)
      if (proposer !== undefined) return { ok: false, trigger_id: triggerId, code: `${proposer}-stop`, error: `${proposer === 'observer' ? "an observer's" : "a member's"} request cannot stop a ticket: accept, attach or ignore it` }
      outcome = { kind: 'stop', ticketId, reason }
    } else return { ok: false, trigger_id: triggerId, code: 'kind', error: 'kind must be accept, attach, stop or ignore' }
    const decision = host.engine.decide(triggerId, { ...outcome, ...(evalId !== undefined ? { evalId } : {}) })
    // The repository stays with the host (the engine has no such field); it is set before the first Assignment launches.
    const repoSet = decision.kind === 'accept' && decision.ticketId !== undefined && repo !== undefined
    if (repoSet) host.executor.setRepo(decision.ticketId!, repo!)
    // Ticket 269f287e: a member the owner took this work off is not recorded as its member; the ticket goes to another.
    const memberExcluded = decision.kind === 'accept' && decision.ticketId !== undefined && member !== undefined && host.excludedFrom(decision.ticketId, member)
    if (decision.kind === 'accept' && decision.ticketId !== undefined && member !== undefined && !memberExcluded) host.executor.setMember(decision.ticketId, member)
    if (decision.kind === 'accept' && decision.ticketId !== undefined && named !== undefined) host.named.accepted(decision.ticketId, named)
    return { ok: true, trigger_id: triggerId, kind, decision_id: decision.id, decision: decision.kind, ...(decision.ticketId !== undefined ? { ticket_id: decision.ticketId } : {}), ...(repoSet ? { repo: repo! } : {}), ...(memberExcluded ? { member_refused: { code: 'excluded', error: `${memberName!} is excluded from this ticket: the owner took this work off it on a credential-access card; it goes to another member` } } : {}), reason: json(decision.reason) }
  } catch (error) { return { trigger_id: triggerId, ...refusal(host, error, { trigger: triggerId, ...(str(item.ticket_id) !== undefined ? { ticket: str(item.ticket_id)! } : {}) }) } }
}

/**
 * docs/design/superagent-split.md S1/S2: the router splits a request into parts, only when the request asks for them. The
 * request is accepted as the parent (held from members, it only coordinates); each part becomes a child ticket. \`asked\`
 * must be the request's own words that ask for parts, copied exactly.
 */
export function splitRequest(host: SuperagentHost, input: { trigger_id?: unknown; title?: unknown; scope?: unknown; reason?: unknown; rules?: unknown; asked?: unknown; parts?: unknown }): Record<string, JsonValue> {
  const triggerId = str(input.trigger_id), asked = str(input.asked), reason = str(input.reason)
  if (triggerId === undefined || asked === undefined || reason === undefined) return { ok: false, code: 'missing', error: 'split needs trigger_id, asked (the request\'s words that ask for parts, copied exactly) and reason' }
  const raw = Array.isArray(input.parts) ? input.parts as Array<Record<string, unknown>> : []
  if (raw.length < 2 || raw.length > 6) return { ok: false, code: 'parts', error: 'split takes 2 to 6 parts, each { title, scope, member? }' }
  const parts: Array<{ title: string; scope: string; member?: string }> = []
  const names: Array<string | undefined> = []
  for (const [index, part] of raw.entries()) {
    const title = str(part?.title), scope = str(part?.scope), memberName = str(part?.member)
    if (title === undefined || scope === undefined) return { ok: false, code: 'parts', error: `part ${String(index + 1)} needs a title and a scope` }
    const member = memberName !== undefined ? host.resolveMember(memberName) : undefined
    if (memberName !== undefined && member === undefined) return { ok: false, code: 'member', error: `part ${String(index + 1)}: no such member: ${memberName}. ${host.memberListLine()}` }
    parts.push({ title, scope, ...(member !== undefined ? { member } : {}) })
    names.push(memberName)
  }
  if (!host.askedIn(triggerId, asked)) return { ok: false, code: 'not-asked', error: 'asked is not in the request: split only a request that asks for separate parts, and copy its words exactly. Otherwise accept it as one ticket.' }
  host.splits.beginFor(triggerId)
  try {
    const accepted = routeItem(host, { trigger_id: triggerId, kind: 'accept', title: input.title, scope: input.scope, reason, ...(input.rules !== undefined ? { rules: input.rules } : {}) })
    const parent = typeof accepted.ticket_id === 'string' ? accepted.ticket_id : undefined
    if (accepted.ok !== true || parent === undefined) return accepted
    const out = host.splitParent(parent, asked, parts, reason)
    if (!out.ok) { host.releaseSplit(parent); return { ok: false, code: out.code, error: `${out.error}; the request was accepted as one ticket (${parent}) instead`, ticket_id: parent } }
    // Ticket eabe1586: a part named to an excluded member is reported, as accept reports it; that part goes to another member.
    const refused = out.refused.map(r => ({ part: r.part, code: 'excluded', error: `${names[r.part - 1] ?? r.member} is excluded from part ${String(r.part)}: the owner took this work off it on a credential-access card; it goes to another member` }))
    return { ok: true, trigger_id: triggerId, ticket_id: parent, parts: out.children, ...(refused.length > 0 ? { member_refused: refused } : {}) }
  } finally { host.splits.endFor(triggerId) }
}

/**
 * The text an attention reply sends: the router's words, led by the member's question verbatim when they do not already
 * contain it — the engine checks the question against the ticket's open one, but only the text reaches the person.
 * @param text - what the router wrote.
 * @param question - the ticket's open question, copied exactly.
 * @returns the text to send.
 */
export function attentionText(text: string, question: string): string {
  return text.includes(question) ? text : `${question}\n\n${text}`
}

/** The most a superagent tool result shows the model, in characters of its JSON. */
export const SAID_CAP = 12_000

/** #881 v2: whether a read result carried an outbound result body, persisted on tool/result for the taint backstop. */
export const outboundBodyMeta = (args: unknown, value: unknown): { a2aOutboundBody: boolean } => ({ a2aOutboundBody: (args as { kind?: unknown } | null)?.kind === 'outbound_result' && typeof (value as { body?: unknown } | null)?.body === 'string' })

export function registerSuperagentTools(ctx: Context, teamOf: (sessionId: string) => SuperagentHost | undefined): void {
  /** The team the calling session has a role in. */
  const host = (exec: { agent?: { id: unknown } }): SuperagentHost | undefined => exec.agent === undefined ? undefined : teamOf(String(exec.agent.id))
  /** The host, when the calling session is the team's router; undefined otherwise. */
  const asRouter = (exec: { agent?: { id: unknown } }): SuperagentHost | undefined => {
    const h = host(exec)
    return h !== undefined && h.routerSession !== undefined && exec.agent !== undefined && String(exec.agent.id) === h.routerSession ? h : undefined
  }
  // The model sees what the call returned, not just that it ran: the router reads tickets and candidates through these
  // tools, and a decision's ticket id or a refused item's code is what it acts on next (router acceptance RJ2/RJ6).
  const said = (title: string, value: Record<string, unknown>) => {
    const { ok, ...rest } = value
    const body = JSON.stringify(rest)
    const shown = body.length > SAID_CAP ? `${body.slice(0, SAID_CAP)}… (clipped, ${String(body.length)} chars)` : body
    return [{ type: 'text' as const, text: `${title}${ok === true ? ': ok' : ' refused:'} ${shown}` }]
  }

  ctx.tools.register(defineTool({
    name: 'superagent_split',
    description: 'Team router only, and only when a request explicitly asks for separate parts: accept it split into 2–6 parts. The request becomes the parent ticket, which only coordinates; each part is a ticket a member works on (member names one). asked is the request\'s own words that ask for parts, copied exactly — the host refuses a split it cannot find them in. The requester gets one result when every part has ended.',
    parameters: {
      trigger_id: { type: 'string', required: true, description: 'The candidate request.' },
      title: { type: 'string', required: true, description: 'The parent ticket\'s title.' },
      scope: { type: 'string', required: true, description: 'What the whole request asks for.' },
      reason: { type: 'string', required: true, description: 'Why it is accepted and split.' },
      asked: { type: 'string', required: true, description: 'The request\'s words that ask for separate parts, copied exactly.' },
      rules: { type: 'array', items: { type: 'string' }, description: 'For an inferred candidate: the enabled rules it matches.' },
      parts: { type: 'array', required: true, items: { type: 'object', additionalProperties: true }, description: 'The parts: { title, scope, member? }, 2 to 6.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('superagent split', value) },
    presentCall: args => ({ card: 'generic', title: `superagent split (${String(Array.isArray(args.parts) ? args.parts.length : 0)})`, kind: 'other', rawInput: args }),
    execute: async (args: Record<string, unknown>, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      const out = splitRequest(h, args)
      h.pass()
      return out
    },
  }))

  ctx.tools.register(defineTool({
    name: 'superagent_route',
    description: 'Team router only: decide candidates by trigger_id. Each item is one of accept (one ticket for the request: title, scope, reason, acknowledgement in the request language; no implementation plan), attach (ticket_id of an open ticket the message points at or asks for again — a duplicate is attached, never accepted twice), stop (ticket_id a person asked to stop) or ignore (reason). Items are processed independently.',
    parameters: {
      items: { type: 'array', required: true, items: { type: 'object', additionalProperties: true }, description: 'Routing items: { trigger_id, kind, title?, scope?, reason?, acknowledgement?, ticket_id?, name?, note?, rules?, repo? }. repo (owner/name, a repository the team members work in) sends an accepted ticket to a member working in that repository. member names the member the work fits; the ticket then waits for that member. For an inferred candidate, rules names the enabled rules it matches (required to accept; observe mode records it as would-accept); rules: [] records an assessed ignore.' },
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
    description: 'Team router only: read the candidate holding a trigger (kind candidate, trigger_id), one ticket (kind ticket, ticket_id) or the open and recent tickets (kind tickets), or recent decisions and the rules they named (kind decisions).',
    parameters: {
      kind: { type: 'string', required: true, description: 'candidate | ticket | tickets | decisions | decision-receipts | outbound_result' },
      trigger_id: { type: 'string', description: 'For kind candidate.' },
      ticket_id: { type: 'string', description: 'For kind ticket and outbound_result.' },
      task_id: { type: 'string', description: 'For kind outbound_result: the outbound request task.' },
    },
    // #881 v2: the host-written mark that this result carried an outbound result body (the log backstop of the taint).
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('superagent read', value), presentationMeta: outboundBodyMeta },
    presentCall: args => ({ card: 'generic', title: `superagent read ${String(args.kind)}`, kind: 'other', rawInput: args }),
    execute: async (args: { kind: string; trigger_id?: string; ticket_id?: string; task_id?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      if (args.kind === 'peer-channel-audit') return json(h.peerChannelAdmin(callerOf(exec), 'audit', args.ticket_id)) as Record<string, JsonValue>
      if (args.kind === 'decision-receipts') return json(h.observerDecisionReceipts(String((exec.agent as { id: unknown } | undefined)?.id ?? ''))) as Record<string, JsonValue>
      // #881 v2 B1: before every other branch, never wrongId, no similar or available ids.
      if (args.kind === 'outbound_result') return json(h.outboundResult(String((exec.agent as { id: unknown } | undefined)?.id ?? ''), String(args.ticket_id ?? ''), String(args.task_id ?? ''))) as Record<string, JsonValue>
      if (args.kind === 'candidate') {
        const candidate = h.engine.candidate(String(args.trigger_id ?? ''))
        return candidate === undefined ? { ok: false, code: 'none', error: h.wrongId('trigger', String(args.trigger_id ?? '')) } : { ok: true, candidate: json(candidate) }
      }
      if (args.kind === 'ticket') {
        const ticket = h.ticket(String(args.ticket_id ?? ''))
        if (ticket === undefined) return { ok: false, code: 'unknownTicket', error: h.wrongId('ticket', String(args.ticket_id ?? '')) }
        const queue = h.queueOf(ticket.id)
        return { ok: true, ticket: json(ticket), ...(queue !== undefined ? { queue: json(queue) } : {}) }
      }
      if (args.kind === 'tickets') {
        const tickets = h.store.tickets.list().slice(0, 50).map(t => ({ id: t.id, title: t.title, ended: t.ended ?? null, stage: h.ticket(t.id)?.stage ?? null, origin: t.origin, queue: h.queueOf(t.id) ?? null }))
        return { ok: true, tickets: json(tickets) }
      }
      if (args.kind === 'decisions') return { ok: true, decisions: json(h.recentDecisions()) }
      return { ok: false, code: 'kind', error: 'kind must be candidate, ticket, tickets or decisions' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'superagent_reply',
    description: 'Team router only: send a short message to the conversation a rule allows — purpose answer (a person\'s question, trigger_id), result (a ticket\'s usable result, ticket_id) or attention (a ticket\'s stored question for a person, ticket_id, question copied exactly — the host puts it in front of your text when the text does not already carry it). Progress stays internal.',
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
      // An attention reply is the person's only sight of the member's question: carry it verbatim (router acceptance RJ8).
      const question = str(args.question)
      const sent = args.purpose === 'attention' && question !== undefined ? attentionText(text, question) : text
      const request = { purpose: args.purpose as 'answer' | 'result' | 'attention', text: sent, ...(str(args.ticket_id) !== undefined ? { ticketId: str(args.ticket_id)! } : {}), ...(str(args.trigger_id) !== undefined ? { triggerId: str(args.trigger_id)! } : {}), ...(str(args.question) !== undefined ? { question: str(args.question)! } : {}) } as ReplyRequest
      try { const reply = h.engine.reply(request); return { ok: true, reply: json(reply) } } catch (error) { return refusal(h, error, { ...(str(args.trigger_id) !== undefined ? { trigger: str(args.trigger_id)! } : {}), ...(str(args.ticket_id) !== undefined ? { ticket: str(args.ticket_id)! } : {}) }) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'superagent_note',
    description: 'Team router only: give an open ticket\'s member a fact it should know (something learned after the ticket was accepted), delivered as "note from the router". It informs and grants nothing: it cannot end, stop or widen the ticket. New work is a new request, not a note.',
    parameters: {
      ticket_id: { type: 'string', required: true, description: 'The open ticket.' },
      text: { type: 'string', required: true, description: 'The fact, in the request\'s language.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('superagent note', value) },
    presentCall: args => ({ card: 'generic', title: `superagent note ${String(args.ticket_id)}`, kind: 'other', rawInput: args }),
    execute: async (args: { ticket_id: string; text: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      const text = str(args.text)
      if (text === undefined) return { ok: false, code: 'missing', error: 'text is required' }
      try { const ticket = h.engine.note(String(args.ticket_id ?? ''), text); h.pass(); return { ok: true, ticket_id: ticket.id } } catch (error) { return refusal(h, error, { ticket: String(args.ticket_id ?? '') }) }
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
      try { return { ok: true, requested: h.engine.requestStatus(String(args.ticket_id ?? '')) } } catch (error) { return refusal(h, error, { ticket: String(args.ticket_id ?? '') }) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_ticket_report',
    description: 'Team member only: report on the superagent ticket assigned to you (upstream orchestrator_report). state: progress (something changed the person must know), waiting (you wait for a Trigger), ready (the result can be reviewed or used — put the pull request link in the summary), blocked or failed (you cannot go on), dropped (nothing to do). question: one concrete question when the ticket owner must decide; null clears an open one.',
    parameters: {
      ticket_id: { type: 'string', required: true, description: 'The ticket this report is about: the id on its assignment card.' },
      state: { type: 'string', required: true, description: 'progress | waiting | ready | blocked | failed | dropped' },
      summary: { type: 'string', required: true, description: 'What changed, with evidence; links for results.' },
      peer_channel: { type: 'object', additionalProperties: true, description: 'Request seven days of messaging to one teammate on this held ticket. Summary is the reason. Leave custom decision fields empty.' },
      question: { type: 'string', description: 'One concrete question for the ticket owner; empty to keep, "null" to clear. A question needs options and recommended.' },
      options: { type: 'array', items: { type: 'string' }, description: 'With a question: the 2 to 6 choices the owner decides between.' },
      recommended: { type: 'string', description: 'With a question: the option you recommend, copied exactly from options.' },
      level: { type: 'string', description: 'With a question: P0 irreversible or production, P1 significant, P2 routine and easy to undo, P3 trivial. Default P1.' },
      inputs: { type: 'object', additionalProperties: true, description: 'With a question (#888): Per option, what the owner must fill in to choose it: { "<option, copied exactly>": { kind: text | file | text+file, prompt: what to write or attach } }. Use it whenever an answer needs the owner\'s words or files, instead of an unmarked 「其他（请说明）」 option.' },
      pull_request: { type: 'string', description: 'The URL of the pull request this ticket opened. The ticket then ends when that pull request merges or closes.' },
      answers: { type: 'string', description: 'The trigger id of the person\'s question this report answers.' },
      files: { type: 'array', items: { type: 'string' }, description: 'With a question: up to 16 files from your workspace for the owner to look at (paths relative to it). They show on the card for the owner to download, and the team can pull them.' },
      ygl: { type: 'array', items: { type: 'string' }, description: 'The ygl-trees ids you wrote for this ticket (evidence, claims, kb notes). Expected with ready when you have the ygl tools.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('ticket report', value) },
    presentCall: args => ({ card: 'generic', title: `ticket report: ${String(args.state)}`, kind: 'other', rawInput: args }),
    execute: async (args: { ticket_id: string; state: string; summary: string; question?: string; answers?: string; pull_request?: string; options?: string[]; recommended?: string; level?: string; inputs?: Record<string, unknown>; files?: string[]; ygl?: string[]; peer_channel?: { to?: string } }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h === undefined || me === undefined || h.roleOf(me) !== 'member') return { ok: false, code: 'not-member', error: 'a2a_ticket_report serves only the superagent team members the owner named' }
      if (!['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped'].includes(args.state)) return { ok: false, code: 'state', error: 'state must be progress, waiting, ready, blocked, failed or dropped' }
      const ticketId = str(args.ticket_id)
      if (ticketId === undefined) return { ok: false, code: 'missing', error: 'ticket_id is required: the id on the ticket\'s assignment card' }
      const said = str(args.summary)
      if (said === undefined) return { ok: false, code: 'missing', error: 'summary is required' }
      if (args.peer_channel !== undefined) {
        if (typeof args.peer_channel?.to !== 'string' || args.question !== undefined || args.options !== undefined || args.level !== undefined ||
          args.inputs !== undefined || args.files !== undefined || args.recommended !== undefined || args.pull_request !== undefined) return { ok: false, code: 'peer-channel-arguments' }
        return json(await h.proposePeerChannel(me, ticketId, args.peer_channel.to, said)) as Record<string, JsonValue>
      }
      const ygl = Array.isArray(args.ygl) ? args.ygl.map(id => String(id).trim()).filter(id => id !== '') : []
      if (ygl.length > 40 || ygl.some(id => id.length > 120)) return { ok: false, code: 'ygl', error: 'ygl takes at most 40 ids of at most 120 characters' }
      const remind = h.settings.serves?.members.includes(me) === true ? undefined : h.yglReadyRefusal(me, ticketId, args.state, ygl)
      if (remind !== undefined) return json(remind) as Record<string, JsonValue>
      // The ids ride in the summary, so the router and the owner see what the ticket left in the team's memory.
      const summary = ygl.length > 0 ? `${said}\nygl: ${ygl.join(', ')}` : said
      const question = args.question === 'null' ? null : str(args.question)
      // A question reaches the owner as a decision card, so it must say what to decide between and what you would do (C1, C2).
      const decision = typeof question === 'string' ? parseDecision(args) : undefined
      if (typeof decision === 'string') return { ok: false, code: 'decision', error: `a question for the owner is a decision card: ${decision}` }
      // #888 D2: inputs belong to a question's options; without a question they are refused, as files are.
      if (args.inputs !== undefined && args.inputs !== null && decision === undefined) return { ok: false, code: 'inputs', error: 'inputs go with a question for the owner' }
      const serving = h.settings.serves?.members.includes(me) === true
      const wantFiles = Array.isArray(args.files) && args.files.length > 0
      if (wantFiles && (decision === undefined || serving)) return { ok: false, code: 'files', error: serving ? 'files on a question go only to a team on this host' : 'files go with a question for the owner' }
      const staged = wantFiles ? h.stageCardFiles(me, args.files) : { ok: true as const, files: [] }
      if (!staged.ok) return json(staged) as Record<string, JsonValue>
      const report = { state: args.state as 'progress', summary, ...(question !== undefined ? { question } : {}), ...(str(args.answers) !== undefined ? { answers: str(args.answers)! } : {}) }
      // PR-C2: a session serving another host's team reports there, signed by this host's key.
      const out = serving ? await h.forwardReport(me, { ...report, ...(decision !== undefined ? { options: decision.options, recommended: decision.recommended, level: decision.level, ...(decision.inputs !== undefined ? { inputs: decision.inputs } : {}) } : {}), ticket_id: ticketId, ...(str(args.pull_request) !== undefined ? { pull_request: str(args.pull_request)! } : {}) }) : h.report(me, { ...report, ...(decision !== undefined ? { decision: { ...decision, ...(staged.files.length > 0 ? { files: staged.files } : {}) } } : {}) }, ticketId, str(args.pull_request))
      return json(out) as Record<string, JsonValue>
    },
  }))

  // The owner working through the router and its members (docs/design/superagent-router-owner-asks.md).
  const notOwner = { ok: false, code: 'not-the-owner', error: 'this works only in a turn answering the owner\'s own message in this session; ask them to say it here or use 提需求' } as const
  const callerOf = (exec: { agent?: { id: unknown } }): string | undefined => exec.agent === undefined ? undefined : String(exec.agent.id)
  const anyProps = { schema: { type: 'object', additionalProperties: true } } as const

  ctx.tools.register(defineTool({
    name: 'superagent_request',
    description: 'Team router only: when a message of the owner in this session asks for work, file it as a request, without first asking whether to open a ticket. It takes no text: the host files their words verbatim, once, and the request comes back to you as a candidate to accept as usual.',
    parameters: {},
    output: { ...anyProps, render: (_args, value) => said('superagent request', value) },
    presentCall: () => ({ card: 'generic', title: 'superagent request', kind: 'other', rawInput: {} }),
    execute: async (_args: Record<string, never>, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      const person = h.personMessageOf(callerOf(exec)!)
      return person === undefined ? { ...notOwner } : json(h.requestForPerson(person)) as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'superagent_assign',
    description: 'Team router only: give a ticket to another member. A ticket that has not started yet (stage working / queued) can be given to any member at any time, e.g. when it waits for a busy member (superagent_read shows what it waits for under queue). A running ticket moves only when its member left or reported it cannot go on.',
    parameters: { ticket_id: { type: 'string', required: true }, member: { type: 'string', required: true, description: 'The member\'s name or id.' } },
    output: { ...anyProps, render: (_args, value) => said('superagent assign', value) },
    presentCall: args => ({ card: 'generic', title: `superagent assign ${String(args.ticket_id)}`, kind: 'other', rawInput: args }),
    execute: async (args: { ticket_id: string; member: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      return json(h.assignTicket(String(args.ticket_id ?? ''), String(args.member ?? ''))) as Record<string, JsonValue>
    },
  }))

  const routerScope = (value: unknown): 'team' | 'dispatch' | undefined => value === 'team' || value === 'dispatch' ? value : undefined
  ctx.tools.register(defineTool({
    name: 'superagent_rules_propose',
    description: 'Team router only: propose the whole new text of the team rules (scope team: rules, a list of { name, text, enabled }) or the dispatch rules (scope dispatch: text). Nothing changes: show the owner the text and wait for their reply.',
    parameters: {
      scope: { type: 'string', required: true, description: 'team | dispatch' },
      rules: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'For scope team: the whole list.' },
      text: { type: 'string', description: 'For scope dispatch: the whole text.' },
      reason: { type: 'string', required: true, description: 'Why, in the owner\'s language.' },
    },
    output: { ...anyProps, render: (_args, value) => said('superagent rules propose', value) },
    presentCall: args => ({ card: 'generic', title: `superagent rules propose ${String(args.scope)}`, kind: 'other', rawInput: args }),
    execute: async (args: { scope: string; rules?: unknown; text?: unknown; reason: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      const scope = routerScope(args.scope)
      if (scope === undefined) return { ok: false, code: 'scope', error: 'scope must be team or dispatch' }
      return json(h.proposeRules(scope, callerOf(exec)!, scope === 'team' ? args.rules : args.text, String(args.reason ?? ''))) as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'superagent_rules_apply',
    description: 'Team router only: apply your pending proposal after the owner has agreed to it in this session. Only their own message since the proposal lets it through.',
    parameters: { scope: { type: 'string', required: true, description: 'team | dispatch' } },
    output: { ...anyProps, render: (_args, value) => said('superagent rules apply', value) },
    presentCall: args => ({ card: 'generic', title: `superagent rules apply ${String(args.scope)}`, kind: 'other', rawInput: args }),
    execute: async (args: { scope: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      if (h === undefined) return { ...notRouter }
      const scope = routerScope(args.scope)
      if (scope === undefined) return { ok: false, code: 'scope', error: 'scope must be team or dispatch' }
      const me = callerOf(exec)!
      return json(h.applyRules(scope, me, h.personMessageOf(me))) as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_member_rules_propose',
    description: 'Team member only: propose the whole new text of your own role and rules, for yourself only. Nothing changes: show the owner the text and wait for their reply.',
    parameters: {
      role: { type: 'string', description: 'One line: what you are for.' },
      rules: { type: 'array', required: true, items: { type: 'object', additionalProperties: true }, description: 'The whole list: { name, text, enabled }.' },
      reason: { type: 'string', required: true, description: 'Why, in the owner\'s language.' },
    },
    output: { ...anyProps, render: (_args, value) => said('a2a_member_rules_propose', value) },
    presentCall: () => ({ card: 'generic', title: 'a2a_member_rules_propose', kind: 'other', rawInput: {} }),
    execute: async (args: { role?: string; rules: unknown; reason: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = callerOf(exec)
      if (h === undefined || me === undefined || h.roleOf(me) !== 'member') return { ok: false, code: 'not-member', error: 'a2a_member_rules_propose serves only the superagent team members the owner named' }
      const value = { ...(typeof args.role === 'string' ? { role: args.role } : {}), rules: args.rules }
      const reason = String(args.reason ?? '')
      const out = h.settings.serves?.members.includes(me) === true ? await h.forwardRules(me, 'rules-propose', { value, reason }) : h.proposeRules(`member:${me}`, me, value, reason)
      return json(out) as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_member_rules_apply',
    description: 'Team member only: apply your pending proposal about your own role and rules after the owner has agreed to it in this session.',
    parameters: {},
    output: { ...anyProps, render: (_args, value) => said('a2a_member_rules_apply', value) },
    presentCall: () => ({ card: 'generic', title: 'a2a_member_rules_apply', kind: 'other', rawInput: {} }),
    execute: async (_args: Record<string, never>, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = callerOf(exec)
      if (h === undefined || me === undefined || h.roleOf(me) !== 'member') return { ok: false, code: 'not-member', error: 'a2a_member_rules_apply serves only the superagent team members the owner named' }
      const person = h.personMessageOf(me)
      if (person === undefined) return { ...notOwner }
      const out = h.settings.serves?.members.includes(me) === true ? await h.forwardRules(me, 'rules-apply', { person }) : h.applyRules(`member:${me}`, me, person)
      return json(out) as Record<string, JsonValue>
    },
  }))

  const cardParameters = {
    question: { type: 'string', required: true, description: 'What the owner has to decide, in their language.' },
    options: { type: 'array', required: true, items: { type: 'string' }, description: 'The 2 to 6 choices.' },
    recommended: { type: 'string', required: true, description: 'The option you recommend, copied exactly from options.' },
    level: { type: 'string', description: 'P0 irreversible or production, P1 significant, P2 routine and easy to undo, P3 trivial. Default P1.' },
    reason: { type: 'string', required: true, description: 'Why you recommend it, in a sentence or two (required: design owner-reporting R3).' },
    inputs: { type: 'object', additionalProperties: true, description: '#888: Per option, what the owner must fill in to choose it: { "<option, copied exactly>": { kind: text | file | text+file, prompt: what to write or attach } }. Use it whenever an answer needs the owner\'s words or files, instead of an unmarked 「其他（请说明）」 option.' },
    files: { type: 'array', items: { type: 'string' }, description: 'Up to 16 files from your workspace the owner should look at to decide (paths relative to it). They show on the card for the owner to download.' },
  } as const
  type CardArgs = { question?: string; options?: string[]; recommended?: string; level?: string; inputs?: Record<string, unknown>; reason?: string; files?: string[] }
  const raise = (h: SuperagentHost, source: 'router' | 'observer', by: string, args: CardArgs): Record<string, JsonValue> => {
    const spec = parseDecision(args)
    if (typeof spec === 'string') return { ok: false, code: 'decision', error: spec }
    // Design owner-reporting R3: a card the owner decides carries the reason for its recommendation.
    if (typeof args.reason !== 'string' || args.reason.trim() === '') return { ok: false, code: 'reason', error: 'a decision card needs reason: why you recommend that option, in a sentence or two' }
    const staged = h.stageCardFiles(by, args.files)
    if (!staged.ok) return json(staged) as Record<string, JsonValue>
    return json(h.proposeDecision(source, by, String(args.question ?? ''), spec, args.reason, staged.files)) as Record<string, JsonValue>
  }
  ctx.tools.register(defineTool({
    name: 'superagent_decision_propose',
    description: 'Team router only: put a recommendation of yours to the owner as a decision card, with options and the one you recommend. Any recommendation goes this way, not as prose. Once the owner decides, the decision comes back to you as a request to accept.',
    parameters: cardParameters,
    output: { ...anyProps, render: (_args, value) => said('decision card', value) },
    presentCall: () => ({ card: 'generic', title: 'decision card', kind: 'other', rawInput: {} }),
    execute: async (args: CardArgs, exec): Promise<Record<string, JsonValue>> => {
      const h = asRouter(exec)
      return h === undefined ? { ...notRouter } : raise(h, 'router', h.routerSession!, args)
    },
  }))
  ctx.tools.register(defineTool({
    name: 'a2a_decision_propose',
    description: 'Team observer only: put something you noticed to the owner as a decision card, with options and the one you recommend. Once the owner decides, the decision goes to the router as a request.',
    parameters: cardParameters,
    output: { ...anyProps, render: (_args, value) => said('decision card', value) },
    presentCall: () => ({ card: 'generic', title: 'decision card', kind: 'other', rawInput: {} }),
    execute: async (args: CardArgs, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h === undefined || me === undefined || !h.isObserver(me)) return { ok: false, code: 'not-observer', error: 'a2a_decision_propose serves only the sessions on this team created under the observer preset' }
      return raise(h, 'observer', me, args)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_ticket_request',
    description: `Team member or observer: propose work you noticed that nobody has asked for yet; you need not hold a ticket. Say in text what needs doing and why. The host files it in your name, as an agent's request and never a person's, and the router decides whether to accept, attach or ignore it and who works it. Filing it does not assign it to you or let you start it, and it does not end, stop, change or widen any ticket (a question about your own ticket goes on a2a_ticket_report; another team's help on a2a_outbound_request). An identical open text returns the same request; at most ${String(OBSERVER_OPEN_MAX)} of yours may be open at once.`,
    parameters: { text: { type: 'string', required: true, description: 'What needs doing and why, for the router and the member who gets it.' } },
    output: { ...anyProps, render: (_args, value) => said('a2a_ticket_request', value) },
    presentCall: () => ({ card: 'generic', title: 'a2a_ticket_request', kind: 'other', rawInput: {} }),
    execute: async (args: { text?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h === undefined || me === undefined) return { ok: false, code: 'not-member', error: 'a2a_ticket_request serves only the members and observers of this team' }
      const text = String(args.text ?? '')
      // A session serving another host's team proposes there, through the same signed forward as its reports.
      const out = h.settings.serves?.members.includes(me) === true ? await h.forwardProposal(me, text) : h.requestForMember(me, text)
      return json(out) as Record<string, JsonValue>
    },
  }))

  // R7b (workbench-market 18, #880): the observer answers on a ticket with a note; it can only leave the note.
  ctx.tools.register(defineTool({
    name: 'a2a_ticket_note',
    description: 'Team observer only: leave a note on one of this team\'s open tickets. It reaches the member holding the ticket as a fact for the work, like the router\'s notes; it grants nothing and cannot change, stop or reassign the ticket. Use it to answer a question with the background the member lacks, or to point to where the data already is. To settle a question the host passed you, put its [提问 <ticket>] token in the text.',
    parameters: {
      ticket_id: { type: 'string', required: true, description: 'The open ticket of this team.' },
      text: { type: 'string', required: true, description: 'The note, at most 4000 characters.' },
    },
    output: { ...anyProps, render: (_args, value) => said('a2a_ticket_note', value) },
    presentCall: args => ({ card: 'generic', title: `a2a_ticket_note ${String(args.ticket_id)}`, kind: 'other', rawInput: { ticket_id: args.ticket_id } }),
    execute: async (args: { ticket_id?: string; text?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h === undefined || me === undefined) return { ok: false, code: 'not-observer', error: 'a2a_ticket_note serves only the team\'s observer' }
      return json(h.observerNote(me, String(args.ticket_id ?? '').trim(), String(args.text ?? ''))) as Record<string, JsonValue>
    },
  }))

  // Observer phase 2 (T5-A): the observer casts a card into one of its team's sessions; off unless the owner turns it on.
  ctx.tools.register(defineTool({
    name: 'a2a_card_cast',
    description: 'Team observer only: cast one card from this host\'s prompt-template library into another session of your team. It goes in at that session\'s next step as a visible message naming you, your reason and its basis; it is not an instruction and grants nothing. Pick the card with a2a_ticket_read kind library or templates (each card says kind workshop or template). Name what the cast rests on in basis: ticket:<id> of this team, event:<id>, or none: <why>. Works only while the owner has turned observerCast on and the host has dsh-prompt-templates with the cast service; one copy of a card waits per session, and a queued card survives a restart. How it goes in (mode): insert (default: at the session\'s next step, waking it), queue (at the first step of its next turn, without waking it), trigger (only into an idle session, and into the router only if the owner allows it: queued and woken now; at most once every 30 minutes per session), or release (armed now and cast later, once, when its condition holds: when ticket:<id> <person|person:<action>|working|idle|ended>, idle:<minutes 10..1440>, or at:<ISO time>; then says how it goes in; it expires after expires_hours, default 24; at most 5 armed per session). A member the owner turned casting off for takes no card (member-off). An event basis must name a trigger this team recorded; otherwise write none: <what you saw>. See or withdraw what waits, and the releases, with a2a_card_queue. Record each cast in ygl-trees.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'The team session to cast into.' },
      template_id: { type: 'string', required: true, description: 'The card id, from kind library or templates.' },
      reason: { type: 'string', required: true, description: 'Why this card, why now: one line, at most 500 characters.' },
      basis: { type: 'string', required: true, description: 'What it rests on: ticket:<id> (a ticket of this team; a prefix of 8+ characters is enough), event:<id>, or none: <one sentence>. At most 200 characters.' },
      mode: { type: 'string', description: 'insert (default), queue, trigger or release.' },
      when: { type: 'string', description: 'For release: ticket:<id> <stage>, idle:<minutes>, or at:<ISO time>.' },
      then: { type: 'string', description: 'For release: insert (default), queue or trigger once released.' },
      expires_hours: { type: 'number', description: 'For release: hours until an unreleased card expires, 1..168 (default 24).' },
    },
    output: { ...anyProps, render: (_args, value) => said('a2a_card_cast', value) },
    presentCall: args => ({ card: 'generic', title: `a2a_card_cast ${String(args.template_id)} → ${String(args.session_id)}`, kind: 'other', rawInput: { session_id: args.session_id, template_id: args.template_id } }),
    execute: async (args: { session_id?: string; template_id?: string; reason?: string; basis?: string; mode?: string; when?: string; then?: string; expires_hours?: number }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h === undefined || me === undefined) return { ok: false, code: 'not-observer', error: 'a2a_card_cast serves only the team\'s observer' }
      return json(h.castCard(me, args)) as Record<string, JsonValue>
    },
  }))

  // #902 S2: the observer writes its own cards for named members of its team.
  ctx.tools.register(defineTool({
    name: 'a2a_card_draft',
    description: 'Team observer only: write your own cards for your team — for a business situation a library card does not fit, adapt one (from) or write it fresh. A card is a template of your own session, written for named members of your team (for: a list of their sessions, or ["team"]), with a one-line scene. Cast it with a2a_card_cast like a library card; it goes only to the members it is for, marked 定制. Actions: list (default), create (name, content, for, scene, from?), update (id and the same fields), delete (id). Works only while the owner has turned observerCardDraft on; at most 50 cards of your own per team. A card is guidance, never a grant: do not write one that asks for a tool, a credential or an action outside the member\'s rules.',
    parameters: {
      action: { type: 'string', description: 'list (default), create, update or delete.' },
      id: { type: 'string', description: 'The card, for update or delete.' },
      name: { type: 'string', description: 'The card\'s name, one line, at most 128 characters.' },
      content: { type: 'string', description: 'The card\'s text, at most 8000 characters; {{session}} and the date variables expand when it goes in.' },
      for: { type: 'array', items: { type: 'string' }, description: 'The team sessions it is written for (not you); ["team"] for the whole team.' },
      scene: { type: 'string', description: 'The business situation it is for, one line, at most 200 characters.' },
      from: { type: 'string', description: 'The library card it adapts, if any (its id).' },
    },
    output: { ...anyProps, render: (_args, value) => said('a2a_card_draft', value) },
    presentCall: args => ({ card: 'generic', title: `a2a_card_draft ${String(args.action ?? 'list')}${args.name !== undefined ? ` ${String(args.name)}` : ''}`, kind: 'other', rawInput: { action: args.action, id: args.id, for: args.for } }),
    execute: async (args: { action?: string; id?: string; name?: string; content?: string; for?: unknown; scene?: string; from?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h === undefined || me === undefined) return { ok: false, code: 'not-observer', error: 'a2a_card_draft serves only the team\'s observer' }
      return json(h.cardDraft(me, args)) as Record<string, JsonValue>
    },
  }))

  // #902 S1: the observer sees, and may withdraw, the cards waiting for its own team's sessions.
  ctx.tools.register(defineTool({
    name: 'a2a_card_queue',
    description: 'Team observer only: list the cards cast into your team\'s sessions — waiting, delivered, withdrawn or expired, newest first, with the reason and basis but not the text — or withdraw one that still waits (action withdraw, with its session_id and id). Also lists your team\'s releases (armed, releasing, released, expired, withdrawn or failed, with the result); withdraw an armed one by its id (r-…). Rows say mine when you cast them; you withdraw only your own, and the owner withdraws the rest. A withdrawn card never goes in. Only your own team\'s sessions are shown or touched.',
    parameters: {
      action: { type: 'string', description: 'list (default) or withdraw.' },
      session_id: { type: 'string', description: 'One team session; required to withdraw.' },
      id: { type: 'string', description: 'The queued cast to withdraw (from list).' },
      state: { type: 'string', description: 'List only waiting, delivered, withdrawn or expired.' },
    },
    output: { ...anyProps, render: (_args, value) => said('a2a_card_queue', value) },
    presentCall: args => ({ card: 'generic', title: `a2a_card_queue ${String(args.action ?? 'list')}${args.session_id !== undefined ? ` ${String(args.session_id)}` : ''}`, kind: 'other', rawInput: { action: args.action, session_id: args.session_id } }),
    execute: async (args: { action?: string; session_id?: string; id?: string; state?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h === undefined || me === undefined) return { ok: false, code: 'not-observer', error: 'a2a_card_queue serves only the team\'s observer' }
      return json(h.cardQueue(me, args)) as Record<string, JsonValue>
    },
  }))

  // Design tool-requests T3: a tool the role's list hides can still be asked for by name; the owner decides on a P0 card.
  ctx.tools.register(defineTool({
    name: 'a2a_tool_request',
    description: 'Team router only: ask the owner to let this team use a tool that is not on your role\'s list (for example a shell a plugin on this host provides). Name the tool exactly and say why you need it. The owner decides on a P0 decision card; once approved the tool appears in your list. Tools that leave the team (routes, sessions, subagents) are never granted.',
    parameters: { name: { type: 'string', required: true, description: 'The exact tool name.' }, why: { type: 'string', required: true, description: 'What you need it for, in a sentence.' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('a2a_tool_request', value) },
    presentCall: args => ({ card: 'generic', title: `a2a_tool_request ${String(args.name)}`, kind: 'other', rawInput: args }),
    execute: async (args: { name?: string; why?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      const role = me === undefined ? undefined : h?.toolRoleOf(me)
      if (h === undefined || me === undefined || role === undefined) return { ok: false, code: 'not-team', error: 'a2a_tool_request serves only the sessions of a superagent team on this host' }
      const name = String(args.name ?? '').trim()
      if (h.grantedTools(me).includes(name) || roleTools(role).includes(name)) return { ok: true, granted: true, note: `${name} is already yours to use` }
      // T6: a member or an observer already has every tool but the boundary and what the owner blocked; a grant would never
      // apply to it (its guard reads no grants), so it never raises a card (redundancy review 2026-11-18).
      if (role !== 'router' && memberBoundary(role, name)) return { ok: false, code: 'not-grantable', error: `${name} leaves the team: members and observers work with their host's tools and say what they lack in their report` }
      if (role !== 'router' && (h.settings.blockedTools ?? []).includes(name)) return { ok: false, code: 'blocked', error: `the owner has blocked ${name} for this team's members` }
      if (role !== 'router') return { ok: true, granted: true, note: `${name} is already yours to use: members have every tool of this host except those that leave the team` }
      if (!grantableTool(role, name)) return { ok: false, code: 'not-grantable', error: `${name} is not something a team session may be granted (it would leave the team, or it belongs to another role)` }
      return { ok: true, requested: true, note: h.requestTool(me, role, name, String(args.why ?? '')) }
    },
  }))

  // Design outbound-requests O1, O2: asking another team on a ticket, through a P0 card the owner or an approver decides.
  ctx.tools.register(defineTool({
    name: 'a2a_outbound_request',
    description: 'Team session only: ask another team for something this ticket needs. You do not message other teams yourself: this raises a P0 decision card with the address and your exact text, and the host sends it from the team\'s A2A identity once the owner, or an approver the owner named, approves. Their formal receipt comes back to the ticket as a note. The router may ask on any open ticket; a member or an observer only on the ticket it holds. address: another team\'s, <zone>/<id8> or <zone>/canvas/<name> (optionally @<fp8>).',
    parameters: {
      ticket_id: { type: 'string', required: true, description: 'The open ticket this is for.' },
      address: { type: 'string', required: true, description: 'The other team\'s A2A address.' },
      text: { type: 'string', required: true, description: 'Exactly what to send (at most 4000 characters); nothing else from the ticket goes with it.' },
      why: { type: 'string', required: true, description: 'Why the ticket needs it, for whoever decides.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('a2a_outbound_request', value) },
    presentCall: args => ({ card: 'generic', title: `a2a_outbound_request → ${String(args.address)}`, kind: 'other', rawInput: args }),
    execute: async (args: { ticket_id?: string; address?: string; text?: string; why?: string }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec), me = callerOf(exec)
      if (h === undefined || me === undefined) return { ok: false, code: 'not-team', error: 'a2a_outbound_request serves only the sessions of a superagent team on this host' }
      return h.requestOutbound(me, args) as Record<string, JsonValue>
    },
  }))

  ctx.tools.register(defineTool({
    name: 'a2a_team_message',
    description: 'Send context to an approved teammate. Use a stable message_id. With status=true only look up the existing attempt. Queued says nothing about reading or accepting work.',
    parameters: {
      to: { type: 'string', required: true, description: 'The approved teammate’s unique name or session identity.' },
      ticket_id: { type: 'string', description: 'Required if more than one held ticket grants this destination.' },
      message_id: { type: 'string', required: true, description: 'Stable id for this exact message.' },
      text: { type: 'string', description: 'Context to send.' },
      file: { type: 'object', additionalProperties: true, description: 'File reference metadata only, on confirmed shared storage.' },
      status: { type: 'boolean', description: 'Look up the existing attempt without sending.' },
    },
    output: { ...anyProps, render: (_args, value) => said('team message', value) },
    presentCall: () => ({ card: 'generic', title: 'Team message', kind: 'other', rawInput: null }),
    execute: async (args: { status?: boolean }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec), me = callerOf(exec)
      if (!h || !me || h.roleOf(me) !== 'member') return { ok: false, code: 'not-granted' }
      return json(await h.teamMessage(me, args, args.status === true)) as Record<string, JsonValue>
    },
  }))

  // Design outbound-requests O3: an approver the owner named decides outbound cards it did not raise, with a reason.
  ctx.tools.register(defineTool({
    name: 'a2a_decision_decide',
    description: 'Named approvers decide outbound cards as before. Team observers may decide an eligible local card using its generation from a2a_ticket_read kind=cards. Give one existing option and a reason.',
    parameters: {
      card_id: { type: 'string', required: true, description: 'The card id, or the grant id when revoking.' },
      revoke_grant: { type: 'boolean', description: 'Observer only. Revoke the named team message grant.' },
      generation: { type: 'string', description: 'Exact version from kind=cards for an observer decision.' },
      option: { type: 'string', required: true, description: 'One of the card’s options. For revoke_grant, use revoke.' },
      reason: { type: 'string', required: true, description: 'Why, in a sentence or two; it is recorded with the decision.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('a2a_decision_decide', value) },
    presentCall: args => ({ card: 'generic', title: `a2a_decision_decide ${String(args.card_id)}`, kind: 'other', rawInput: args }),
    execute: async (args: { card_id?: string; generation?: string; option?: string; reason?: string; revoke_grant?: boolean }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec), me = callerOf(exec)
      if (h === undefined || me === undefined) return { ok: false, code: 'not-team', error: 'a2a_decision_decide serves only the sessions of a superagent team on this host' }
      if (args.revoke_grant === true) {
        if (!h.isObserver(me) || typeof args.reason !== 'string' || !args.reason.trim()) return { ok: false, code: 'not-authorized' }
        return json(h.peerChannelAdmin(me, 'revoke', args.card_id, args.reason)) as Record<string, JsonValue>
      }
      const id = String(args.card_id ?? '')
      if (h.isObserver(me) && h.isPeerChannelCard(id) && !await h.checkPeerDecision(id, args.option)) return { ok: false, code: 'not-granted' }
      const out = h.observerOrApproverDecide(me, id, args.generation, args.option, args.reason)
      // Approving is not delivering (live check): the host sends it now, and the answer reaches the asking ticket as a note.
      return (out.approved === true ? { ...out, note: 'Approved. The host sends the text from the team\'s A2A identity now; whether it went out, and the other team\'s receipt, reach the asking ticket as notes.' } : out) as Record<string, JsonValue>
    },
  }))

  // A member reads its own tickets, an observer its team's tickets and decisions; nobody but the router reads candidates or
  // acts on tickets through this (owner 2026-11-10: a scheduled turn reads where things stand before it acts).
  ctx.tools.register(defineTool({
    name: 'a2a_ticket_read',
    description: 'Team member or observer only, read-only: where your work stands before you act on it. kind mine: your open tickets; kind ticket: one of them (ticket_id). An observer can also read kind team (the team\'s open and recent tickets) and kind decisions (the router\'s recent decisions), kind health (the host\'s health problems, which reach the observer first), and from this host\'s prompt-template plugin kind library (the cards, their versions, switches and intervals), kind templates (one session\'s own templates, session_id) and kind interventions (each time a card went into a session: schedule, event, manual by the owner, or a plugin; digests only, never text). An approver the owner named reads kind outbound: the outbound cards waiting for a decision, with their ids. It changes nothing.',
    parameters: {
      kind: { type: 'string', required: true, description: 'mine | ticket | team | decisions | cards | decision-receipts | health | library | templates | interventions | outbound | outbound_result' },
      session_id: { type: 'string', description: 'For kind templates (required): the session whose own templates to read; for kind interventions: one session.' },
      since: { type: 'string', description: 'For kind interventions: only rows at or after this ISO time.' },
      source: { type: 'string', description: 'For kind interventions: schedule | event | manual | plugin (manual = the owner sending a card by hand).' },
      limit: { type: 'number', description: 'For kind interventions: at most this many rows (newest kept).' },
      ticket_id: { type: 'string', description: 'For kind ticket and outbound_result.' },
      task_id: { type: 'string', description: 'For kind outbound_result: the outbound request task.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said('a2a_ticket_read', value), presentationMeta: outboundBodyMeta },
    presentCall: args => ({ card: 'generic', title: `a2a_ticket_read ${String(args.kind)}`, kind: 'read', rawInput: args }),
    execute: async (args: { kind?: string; ticket_id?: string; task_id?: string; session_id?: string; since?: string; source?: string; limit?: number }, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h !== undefined && me !== undefined && args.kind === 'decision-receipts') return json(h.observerDecisionReceipts(me, args.ticket_id)) as Record<string, JsonValue>
      if (h === undefined || me === undefined || h.roleOf(me) !== 'member' || !h.settings.members.includes(me)) return { ok: false, code: 'not-member', error: 'a2a_ticket_read serves only the members on this host of a superagent team' }
      if (args.kind === 'peer-channels' || args.kind === 'peer-channel-audit') return json(h.peerChannelAdmin(me, args.kind === 'peer-channels' ? 'list' : 'audit', args.ticket_id)) as Record<string, JsonValue>
      if (args.kind === 'cards') return json(h.observerDecisionCards(me)) as Record<string, JsonValue>
      // #881 v2 B1: the outbound result status, before every other branch; the host decides who may see what.
      if (args.kind === 'outbound_result') return json(h.outboundResult(me, String(args.ticket_id ?? ''), String(args.task_id ?? ''))) as Record<string, JsonValue>
      const observer = h.isObserver(me)
      const summary = (ticketId: string): JsonValue => {
        const t = h.store.tickets.get(ticketId)
        if (t === undefined) return null
        const report = t.assignments.at(-1)?.report
        return json({ id: t.id, title: t.title, scope: t.mandate?.scope ?? null, stage: t.ended !== undefined ? { stage: 'ended', outcome: t.ended.outcome } : h.ticket(t.id)?.stage ?? null,
          report: report === undefined ? null : { state: report.state, summary: report.summary, at: report.at }, question: t.attention?.question ?? null, updatedAt: t.updatedAt, queue: h.queueOf(t.id) ?? null })
      }
      const mine = (): string[] => h.store.tickets.list().filter(t => t.ended === undefined && h.executor.memberOfTicket(t.id)?.member === me).map(t => t.id)
      if (args.kind === 'mine') return { ok: true, tickets: mine().map(summary) }
      if (args.kind === 'ticket') {
        const id = String(args.ticket_id ?? '')
        if (!observer && !mine().includes(id)) return { ok: false, code: 'not-yours', error: 'a member reads only the tickets it holds' }
        const t = summary(id)
        return t === null ? { ok: false, code: 'unknownTicket', error: 'no ticket has that id' } : { ok: true, ticket: t }
      }
      // Design outbound-requests O3: an approver finds the waiting outbound cards here (live check: a member approver could not list them).
      if (args.kind === 'outbound') {
        if (!(h.settings.approvers ?? []).includes(me)) return { ok: false, code: 'not-approver', error: 'kind outbound is for the approvers the owner named in the team settings' }
        return { ok: true, cards: json(h.decisionCards().filter(card => card.source === 'outbound').map(card => ({ id: card.id, question: card.question, ...(card.reason !== undefined ? { reason: card.reason } : {}), by: card.by, at: card.at, options: card.options }))) }
      }
      if (!observer) return { ok: false, code: 'not-observer', error: 'kind team, decisions, health, library, templates and interventions are for observers; a member reads kind mine or ticket' }
      // The observer has no assignment card to name the team's ygl-trees project: kind team carries it (#762 review).
      // The ygl block comes before the tickets: the host prunes long tool results keeping the head, and the 3084 pilot's
      // observer lost ygl.project behind 50 tickets.
      if (args.kind === 'team') return { ok: true, ...(h.yglProject() !== undefined ? { ygl: json({ project: h.yglProject()!, ...(h.yglScope() !== undefined ? { scope: h.yglScope()! } : {}) }) } : {}), tickets: h.store.tickets.list().slice(0, 50).map(t => summary(t.id)) }
      if (args.kind === 'decisions') return { ok: true, decisions: json(h.recentDecisions()) }
      // R7a (workbench-market 18 §七 3): the host's health list, which the observer sees first.
      if (args.kind === 'health') return { ok: true, health: json(h.health()) }
      // Observer phase 1 (#883): the same host's prompt-template library, a session's own templates, and the intervention log.
      if (args.kind === 'library' || args.kind === 'templates' || args.kind === 'interventions') {
        return json(await h.promptTemplates(args.kind, { ...(args.session_id !== undefined ? { session_id: String(args.session_id) } : {}), ...(args.since !== undefined ? { since: String(args.since) } : {}), ...(args.source !== undefined ? { source: String(args.source) } : {}), ...(args.limit !== undefined ? { limit: Number(args.limit) } : {}) })) as Record<string, JsonValue>
      }
      return { ok: false, code: 'kind', error: 'kind must be mine, ticket, team, decisions, health, library, templates or interventions' }
    },
  }))

  // PR-F (upstream orchestrator_ack / orchestrator_trigger_handback): a member takes up, or hands back, a person's message that
  // reached its ticket, by the trigger id its card shows.
  const takeUpTool = (name: 'a2a_ticket_ack' | 'a2a_ticket_handback', op: 'ack' | 'handback', description: string, textName: 'text' | 'reason', textHelp: string) => defineTool({
    name, description,
    parameters: {
      trigger_id: { type: 'string', required: true, description: 'The trigger id the assignment or input card shows for that message.' },
      [textName]: { type: 'string', required: true, description: textHelp },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => said(name, value) },
    presentCall: args => ({ card: 'generic', title: `${name}: ${String(args.trigger_id)}`, kind: 'other', rawInput: args }),
    execute: async (args: Record<string, string>, exec): Promise<Record<string, JsonValue>> => {
      const h = host(exec)
      const me = exec.agent === undefined ? undefined : String((exec.agent as { id: unknown }).id)
      if (h === undefined || me === undefined || h.roleOf(me) !== 'member') return { ok: false, code: 'not-member', error: `${name} serves only the superagent team members the owner named` }
      const triggerId = String(args.trigger_id ?? ''), text = String(args[textName] ?? '')
      const out = h.settings.serves?.members.includes(me) === true ? await h.forwardTakeUp(me, op, triggerId, text) : h.takeUp(me, op, triggerId, text)
      return json(out) as Record<string, JsonValue>
    },
  })
  ctx.tools.register(takeUpTool('a2a_ticket_ack', 'ack',
    'Team member only: acknowledge a person\'s message that reached your ticket before you act on it (upstream orchestrator_ack). It posts your short acknowledgement on that person\'s thread (for a GitHub comment it is only recorded, nothing is posted), and the message is yours to handle from then on.',
    'text', 'One or two sentences to the person: what you will do with their message, in their language.'))
  ctx.tools.register(takeUpTool('a2a_ticket_handback', 'handback',
    'Team member only: hand back a person\'s message that asks for work beyond your ticket or for another one, so the router assesses it afresh (upstream orchestrator_trigger_handback). Once per message.',
    'reason', 'One sentence on what it asks for beyond this ticket.'))
}
