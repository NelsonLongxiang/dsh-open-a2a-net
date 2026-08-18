/**
 * In-process decentralized A2A client: the outbound peer surface — verified
 * agent-card fetches (discovery) and direct routes to a peer's
 * `/a2a/direct` endpoint. Timing and fetch seams are constructor-injected so
 * tests drive them without a network.
 * @module @nelsonlongxiang/dsh-open-a2a-net/a2a-client
 */

import { verifyCard } from './card.ts'
import type { A2aPeerCard, A2aRouteResult } from './types.ts'

/** One-shot delayed callback returning its disposer. */
export type A2aSchedule = (callback: () => void, delayMs: number) => () => void

/** Minimal fetch face; the first HTTP-level failure rejects. */
export type A2aFetch = (url: string, init: {
  readonly method: 'GET' | 'POST'
  readonly headers: Record<string, string>
  readonly body?: string
  readonly signal?: AbortSignal
}) => Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }>

/** Constructor facts; every seam is explicit so tests inject doubles. */
export interface A2aClientOptions {
  /** `X-API-Key` value sent on peer requests; empty omits the header. */
  readonly apiKey: string
  /** This node's caller label stamped on outbound routes. */
  readonly sessionId: string
  /** Delayed-callback seam (HTTP timeouts). */
  readonly schedule: A2aSchedule
  /** HTTP seam. */
  readonly fetch: A2aFetch
}

/** Direct-route HTTP budget. */
const HTTP_TIMEOUT_MS = 15_000

type WireRoute = {
  readonly routed?: unknown
  readonly delivered?: unknown
  readonly error?: unknown
  readonly code?: unknown
  readonly task_id?: unknown
  readonly context_id?: unknown
  readonly task_status?: unknown
  readonly result?: unknown
}

/** Wire strings are absent-or-string; anything else degrades to ''. */
function wireText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * The A2A peer client. One instance serves the whole fiber's outbound
 * card fetches and direct routes; it owns no connection state.
 */
export class A2aClient {
  private readonly options: A2aClientOptions

  /** @param options - resolved caller facts and injected seams. */
  constructor(options: A2aClientOptions) {
    this.options = options
  }

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = {}
    if (json) headers['Content-Type'] = 'application/json'
    if (this.options.apiKey !== '') headers['X-API-Key'] = this.options.apiKey
    return headers
  }

  private async http(path: string, init: {
    readonly method: 'GET' | 'POST'
    readonly body?: string
    readonly signal?: AbortSignal
  }, baseUrl: string): Promise<unknown> {
    if (init.signal?.aborted) throw new Error('A2A request aborted before dispatch')
    const controller = new AbortController()
    const timer = this.options.schedule(() => {
      controller.abort()
    }, HTTP_TIMEOUT_MS)
    const abort = (): void => {
      controller.abort()
    }
    init.signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await this.options.fetch(`${baseUrl}${path}`, {
        method: init.method,
        headers: this.headers(init.body !== undefined),
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`A2A HTTP ${String(response.status)}: ${text.slice(0, 200)}`)
      return JSON.parse(text) as unknown
    } finally {
      timer()
      init.signal?.removeEventListener('abort', abort)
    }
  }

  /**
   * Fetch one peer's agent card (discovery): team, session, capabilities.
   * The card is verified at parse — unsigned, badly signed, or expired cards
   * are rejected here, so a stale peer disappears from discovery without any
   * background cleanup.
   * @param baseUrl - the peer's base URL.
   * @returns the verified card, or `undefined` when unreachable, malformed, or rejected.
   */
  async fetchCard(baseUrl: string): Promise<A2aPeerCard | undefined> {
    try {
      const candidate = await this.http('/.well-known/agent-card.json', { method: 'GET' }, baseUrl)
      const verified = verifyCard(candidate, Date.now())
      if (!verified.ok) return undefined
      return verified.card
    } catch {
      // An unreachable or malformed peer leaves discovery to the other peers.
      return undefined
    }
  }

  /**
   * Extract the reply text from a route result member: the wire carries a
   * plain string, a `{text}` object, or anything else JSON-encoded.
   * @param inner - the raw `result` member of a route response.
   * @param fallback - what a nullish member encodes as.
   * @returns the reply text.
   */
  private replyText(inner: unknown, fallback: unknown): string {
    if (typeof inner === 'string') return inner
    if (inner !== null && typeof inner === 'object' && typeof (inner as { readonly text?: unknown }).text === 'string') {
      return (inner as { readonly text: string }).text
    }
    return JSON.stringify(inner ?? fallback)
  }

  /**
   * Route directly to a peer node's `/a2a/direct` endpoint. The peer steers
   * the message into its live agent (or the named session team's agent) and
   * answers within its own final-reply budget.
   * @param baseUrl - the peer's base URL.
   * @param team - target team name (the peer's own or a session team).
   * @param message - request text.
   * @param contextId - context id from a prior reply, for multi-turn.
   * @param signal - caller cancellation.
   * @param callerSession - caller label overriding the node's label (the calling session's node label).
   * @returns the canonical route result (success or explicit failure).
   */
  async routeDirect(
    baseUrl: string,
    team: string,
    message: string,
    contextId?: string,
    signal?: AbortSignal,
    callerSession?: string,
    asyncMode = false,
    taskIdFromCaller?: string,
  ): Promise<A2aRouteResult> {
    const args: Record<string, unknown> = { team, message, caller_session: callerSession ?? this.options.sessionId }
    if (contextId !== undefined) args.context_id = contextId
    // wait:false asks the peer to steer and answer delivered immediately —
    // the async half of the receipt contract for cross-host long tasks.
    if (asyncMode) args.wait = false
    // The caller-born task id rides the request (idempotency key): a peer
    // that echoes it keeps the receipt header correlated with this route's
    // own result; the fallback below stamps it when the peer generated its
    // own (pre-0.5.3 peers).
    if (taskIdFromCaller !== undefined) args.task_id = taskIdFromCaller
    let raw: WireRoute
    try {
      raw = await this.http('/a2a/direct', {
        method: 'POST',
        body: JSON.stringify(args),
        ...(signal !== undefined ? { signal } : {}),
      }, baseUrl) as WireRoute
    } catch (error) {
      return { ok: false, error: `direct route to peer failed: ${String(error)}`, code: -32000 }
    }
    if (raw.error !== undefined && raw.error !== null) {
      const failure: { ok: false; error: string; code?: number } = {
        ok: false,
        error: typeof raw.error === 'string' ? raw.error : JSON.stringify(raw.error),
      }
      if (typeof raw.code === 'number') failure.code = raw.code
      return failure
    }
    // The delivered shape (wait:false): no result member — the reply rides
    // the receipt contract back to the caller's team instead.
    if (raw.routed === true && raw.delivered === true) {
      const taskId = wireText(raw.task_id) !== '' ? wireText(raw.task_id) : taskIdFromCaller ?? ''
      return {
        ok: true,
        team,
        reply: `Delivered to ${team} (async). The target routes a receipt — a message starting "[A2A receipt] task ${taskId} <outcome summary>" — back to your team when done; watch a2a_status activity or follow up with the context id.`,
        task_id: taskId,
        context_id: wireText(raw.context_id),
        task_status: wireText(raw.task_status) === '' ? 'TASK_STATE_DELIVERED' : wireText(raw.task_status),
      }
    }
    const reply = this.replyText(raw.result, '')
    return {
      ok: true,
      team,
      reply,
      task_id: wireText(raw.task_id) !== '' ? wireText(raw.task_id) : taskIdFromCaller ?? wireText(raw.task_id),
      context_id: wireText(raw.context_id),
      task_status: wireText(raw.task_status),
    }
  }
}
