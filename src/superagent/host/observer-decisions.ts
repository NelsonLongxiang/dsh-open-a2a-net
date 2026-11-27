import { type StoredCard, needsInput } from './decisions.ts'
import type { TicketInput } from '../upstream/dsh-superagent/src/core/index.ts'

const LEVEL = { P0: 0, P1: 1, P2: 2, P3: 3 } as const
export const OBSERVER_DECISION_WINDOW_MS = 24 * 3_600_000
export const OBSERVER_QUOTA_WINDOW_MS = 3_600_000

export interface ObserverDecisionRule {
  readonly maxLevel: 'P1' | 'P2' | 'P3'
  readonly perHour: number
  readonly armedAt?: string
}

/** Server-owned binding from a card version to the only effects it permits. */
export type ObserverDecisionTarget =
  | { readonly kind: 'router-receipt'; readonly session: string }
  | { readonly kind: 'ticket-answer'; readonly ticketId: string; readonly questionVersion: string; readonly member: string }
  | { readonly kind: 'credential-ack'; readonly supervised: string; readonly optionIndex: number; readonly preview: string }

export interface ObserverCardBinding {
  readonly generation: string
  readonly createdAt: string
  readonly proposer: string
  readonly target: ObserverDecisionTarget
}

export interface ObserverDecision {
  readonly id: string
  readonly teamId: string
  readonly cardId: string
  readonly generation: string
  readonly human: false
  readonly session: string
  readonly name: string
  readonly at: string
  readonly option: number
  readonly reason: string
  readonly level: StoredCard['level']
  readonly target: ObserverDecisionTarget
  readonly state: 'pending' | 'attempting' | 'applied' | 'failed' | 'unknown'
  readonly correction?: { readonly at: string; readonly option: number; readonly reason: string }
  readonly credentialControl?: { readonly at: string; readonly option: number }
}

/** Host-owned structured metadata on the upstream engine's existing non-authorizing note. */
interface ObserverAnswerNote extends Extract<TicketInput, { kind: 'note' }> {
  readonly observerDecision: Pick<ObserverDecision, 'teamId' | 'cardId' | 'generation' | 'session' | 'human' | 'option' | 'level'> & { readonly questionVersion: string }
}

export function observerAnswerNote(decision: ObserverDecision, questionVersion: string): ObserverAnswerNote {
  return { id: decision.id, kind: 'note', at: decision.at, text: '[观察者代决答复] ' + decision.id,
    observerDecision: { teamId: decision.teamId, cardId: decision.cardId, generation: decision.generation,
      session: decision.session, human: false, option: decision.option, level: decision.level, questionVersion },
  }
}

export function isObserverAnswerReceipt(input: TicketInput, decision: ObserverDecision, questionVersion: string): boolean {
  if (input.kind !== 'note' || input.id !== decision.id || input.at !== decision.at || !('observerDecision' in input)) return false
  const metadata = input.observerDecision as Partial<ObserverAnswerNote['observerDecision']> | null | undefined
  return metadata?.teamId === decision.teamId && metadata.cardId === decision.cardId && metadata.generation === decision.generation
    && metadata.session === decision.session && metadata.human === false && metadata.option === decision.option
    && metadata.level === decision.level && metadata.questionVersion === questionVersion
}

/** Reject malformed observer records before any quota or execution calculation. */
export function validObserverCardState(card: StoredCard): boolean {
  const binding = card.observerBinding
  const decision = card.observerDecision
  if (binding === undefined) return decision === undefined
  if (binding === null || typeof binding !== 'object' || typeof binding.generation !== 'string' || typeof binding.proposer !== 'string'
    || !Number.isFinite(Date.parse(binding.createdAt)) || !Array.isArray(card.options)) return false
  const target = binding.target
  if (target === null || typeof target !== 'object') return false
  if (target.kind === 'router-receipt') { if (card.source !== 'router' || typeof target.session !== 'string' || binding.proposer !== target.session) return false }
  else if (target.kind === 'ticket-answer') { if (card.source !== 'ticket' || typeof target.ticketId !== 'string' || card.ticketId !== target.ticketId || typeof target.questionVersion !== 'string' || typeof target.member !== 'string') return false }
  else if (target.kind === 'credential-ack') { if (card.source !== 'health' || typeof target.supervised !== 'string' || typeof target.preview !== 'string' || !Number.isInteger(target.optionIndex) || card.options[target.optionIndex] !== '知道了') return false }
  else return false
  if (decision === undefined) return true
  return decision !== null && typeof decision === 'object' && decision.generation === binding.generation
    && decision.id === 'observer-' + binding.generation && typeof decision.teamId === 'string' && decision.cardId === card.id
    && Object.hasOwn(LEVEL, decision.level) && decision.level !== 'P0' && decision.level === card.level
    && decision.human === false && typeof decision.session === 'string' && typeof decision.reason === 'string'
    && typeof decision.name === 'string' && Number.isFinite(Date.parse(decision.at))
    && Number.isInteger(decision.option) && typeof card.options[decision.option] === 'string'
    && JSON.stringify(decision.target) === JSON.stringify(target)
    && ['pending', 'attempting', 'applied', 'failed', 'unknown'].includes(decision.state)
    && card.decided?.by === 'observer' && card.decided.option === decision.option && card.decided.at === decision.at
}

/** Null disables. The caller supplies configuration only; the host owns the stamp. */
export function parseObserverDecisionRule(raw: unknown): ObserverDecisionRule | undefined | string {
  if (raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'observerDecides must be an object or null'
  const { maxLevel, perHour = 10 } = raw as Record<string, unknown>
  if (maxLevel !== 'P1' && maxLevel !== 'P2' && maxLevel !== 'P3') return 'observerDecides.maxLevel must be P1, P2 or P3'
  if (typeof perHour !== 'number' || !Number.isInteger(perHour) || perHour < 1 || perHour > 60) return 'observerDecides.perHour must be a whole number from 1 to 60'
  return { maxLevel, perHour }
}

export function armObserverDecisionRule(previous: ObserverDecisionRule | undefined, next: ObserverDecisionRule | undefined, now: string): ObserverDecisionRule | undefined {
  if (next === undefined) return undefined
  const expands = previous === undefined || previous.armedAt === undefined || LEVEL[next.maxLevel] < LEVEL[previous.maxLevel] || next.perHour > previous.perHour
  return { maxLevel: next.maxLevel, perHour: next.perHour, armedAt: expands ? now : previous.armedAt }
}

export interface ObserverDecisionCheck {
  readonly observer: boolean
  readonly session: string
  readonly paused: boolean
  readonly rule?: ObserverDecisionRule
  readonly now: number
  readonly used: number
  readonly pending: boolean
  readonly targetAvailable: boolean
}

/** A single check shared by the view, the commit and recovery before any attempt. */
export function observerRefusal(card: StoredCard, check: ObserverDecisionCheck, recovering = false): string | undefined {
  if (!check.observer) return 'not-observer'
  if (check.paused) return 'paused'
  const rule = check.rule
  if (rule?.armedAt === undefined) return 'off'
  if (!recovering && (card.decided !== undefined || card.autoApproved !== undefined || !check.pending)) return 'stale'
  const binding = card.observerBinding
  if (binding === undefined) return 'source'
  const armed = Date.parse(rule.armedAt), created = Date.parse(binding.createdAt)
  if (!Number.isFinite(check.now) || !Number.isFinite(armed) || !Number.isFinite(created) || armed > check.now || created > check.now || created <= armed) return 'card-age'
  if (card.level === 'P0' || LEVEL[card.level] === undefined || LEVEL[card.level] < LEVEL[rule.maxLevel]) return 'level'
  if (needsInput(card)) return 'needs-input'
  if (binding.proposer === check.session || (binding.target.kind === 'credential-ack' && binding.target.supervised === check.session)) return 'own'
  if (!check.targetAvailable) return 'target'
  if (!recovering && check.used >= rule.perHour) return 'cap'
  return undefined
}

export function observerOptions(card: StoredCard): Array<{ index: number; text: string }> {
  const target = card.observerBinding?.target
  if (target === undefined) return []
  return card.options.flatMap((text, index) => target.kind !== 'credential-ack' || target.optionIndex === index ? [{ index, text }] : [])
}

/** Excluded cards return metadata only. In particular outbound text may be embedded in question. */
export function observerCardView(card: StoredCard, why: string | undefined) {
  const binding = card.observerBinding
  const meta = { cardId: card.id, source: card.source, level: card.level, ...(binding === undefined ? {} : { createdAt: binding.createdAt }), eligible: why === undefined, ...(why === undefined ? {} : { why }) }
  if (why !== undefined || binding === undefined) return meta
  const target = binding.target
  return { ...meta, generation: binding.generation, question: card.question, options: observerOptions(card),
    ...(target.kind === 'ticket-answer' ? { ticketId: target.ticketId } : {}),
    ...(target.kind === 'credential-ack' ? { preview: target.preview } : {}),
  }
}
