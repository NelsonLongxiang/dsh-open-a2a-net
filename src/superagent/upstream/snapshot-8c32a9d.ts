/**
 * superagent type snapshot (p2 design G2, ruled by global review 2026-11-07).
 *
 * Upstream: github.com/deepseek-ai/dsh-superagent-prototype
 * Commit:   8c32a9dc5d72c033816c6a8110b37f40cf94fba4
 * The excerpts below are covered by the upstream license, reproduced here in full (also in ./LICENSE.dsh-superagent):
 *
 * MIT License
 *
 * Copyright (c) 2026 DeepSeek Harness Team
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 *
 * Verbatim excerpts of only the structures the a2a Source uses, each marked with its file and lines at that commit.
 * The excerpts differ from upstream in three declared ways only:
 * - types imported from outside the excerpts become the opaque placeholders below;
 * - `z.ZodType<T>` becomes {@link SchemaLike}: the registry only calls `parse` and `safeParse` on a kind's schemas at this
 *   commit (src/sources/registry.ts:57,65,72-73,135-136; src/app/settings-history.ts:44,60);
 * - members the a2a Source does not use are left out, and each excerpt lists what it leaves out.
 *
 * Nothing here is fetched at build or test time. A new snapshot is a commit of its own whose PR names the old and the
 * new commit; src/superagent/contract.ts and tests/unit/superagent-contract.spec.ts check this repo against it.
 */
import { createHash } from 'node:crypto'

export const UPSTREAM_REPOSITORY = 'deepseek-ai/dsh-superagent-prototype'
export const UPSTREAM_COMMIT = '8c32a9dc5d72c033816c6a8110b37f40cf94fba4'

/** An upstream type this snapshot does not excerpt; the a2a Source never looks inside it. */
export interface Opaque<N extends string> { readonly __opaque: N }
type Deployment = Opaque<'Deployment'>
type Thread = Opaque<'Thread'>
type ThreadFact = Opaque<'ThreadFact'>
type ChannelLinks = Opaque<'ChannelLinks'>
/** Stands in for `z.ZodType<T>` (see the header). */
export interface SchemaLike<T> {
  parse(value: unknown): T
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

// ── src/core/model.ts:5,7,9,12,23-39 (left out: isoTime and everything after Trigger) ──
export interface ActorRef { source: string; id: string }
/** Thread identity; the rule that derives `id` from a native event belongs to the source. */
export interface ThreadRef { source: string; id: string }
/** Write-only address on a thread; the address format belongs to the source. */
export interface ChannelRef { source: string; thread: string; address: Record<string, string> }
export const threadKey = (ref: ThreadRef): string => `${ref.source}:${ref.id}`
/** One immutable event produced by a source. `text` and `meta` are untrusted external data. */
export interface Trigger {
  id: string
  source: string
  /** Every thread the trigger belongs to; the first (`threads[0]`) is the primary thread that hosts its evaluation. */
  threads: ThreadRef[]
  actor: ActorRef
  /** Source-declared: the event was written by a person rather than a bot, CI, or this agent. */
  human: boolean
  /** Source-declared: the sender addressed the agent, by mentioning it or in a direct message to it. */
  addressed?: 'mention' | 'direct'
  at: string
  text: string
  channel?: ChannelRef
  url?: string
  /** Source-native details for adapters; the core never interprets them. */
  meta: Record<string, unknown>
}

// ── src/core/ids.ts:3-5 ──
export function key(...values: string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)
}

// ── src/core/ports.ts:10,72 ──
export type ScopeResult = { listened: true; observed: boolean; row?: string } | { listened: false; reason: string }
export interface OutboundMessage { id: string; channel: ChannelRef; text: string; kind: 'acknowledgement' | 'reply' | 'notice'; ticketId?: string }

// ── src/core/intake.ts:8 ──
export type ReceiveResult = 'stored' | 'duplicate' | 'filtered'

// ── src/infra/text.ts:17 ──
export const fill = (template: string, values: Record<string, string>): string => template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')

// ── src/infra/commands.ts:67-68, as an interface of the two members the a2a Source calls (left out: the class body, gh, api, pages, lark) ──
export interface Commands {
  withSignal(signal?: AbortSignal): Commands
  run(program: string, args: string[], cwd?: string): Promise<string>
}

// ── src/kv.ts:11,13,15 ──
export type Key<V> = string & { readonly __value?: V }
export type Family<V, A extends unknown[]> = ((...name: A) => Key<V>) & { readonly prefix: string }
export const record = <V>(key: string) => key as Key<V>

// ── src/sources/host.ts:11-22,29 ──
export const HEALTH_TEXT = {
  setupPending: 'Waiting for the deployment check',
  sourceOff: 'Off',
  feishuCliUnset: 'The Source is on, and its bot lark-cli is not set',
  feishuBotMissing: 'Waiting for the Feishu bot',
  pollFailures: '{count} consecutive failed polls; last: {error}',
} as const
export type HealthCode = keyof typeof HEALTH_TEXT
export type Health = { state: 'starting' | 'ready' | 'paused' | 'error'; detail: string; at?: string; code?: HealthCode; values?: Record<string, string> }
export function health(state: Health['state'], code: HealthCode, values: Record<string, string> = {}): Health {
  return { state, detail: fill(HEALTH_TEXT[code], values), code, ...Object.keys(values).length ? { values } : {} }
}
/** Display label, URL, and facts (`null` removes a fact) that a Source publishes on a Thread. */
export interface ThreadDescription { label?: string; url?: string; facts?: Record<string, ThreadFact | null> }

// ── src/sources/host.ts:31-66 (left out: problem, atomic, state.keys, threads.get/subscribed/patch, tickets, triggers, notify) ──
/** Application capabilities exposed to a Source kind for reading state, ingesting triggers, managing threads/tickets, and reporting health. */
export interface SourceContext {
  readonly deployment: Deployment
  readonly commands: Commands
  readonly ready: Promise<void>
  /** True once setup resolved the repository and accounts; Sources poll only then. */
  configured(): boolean
  /** Returns a Source's configuration while enabled, or undefined while disabled or uninstalled. */
  config<C extends Record<string, unknown>>(kind: string): C | undefined
  /** Ingests a trigger into the Engine and schedules the next evaluation pass; callers should await completion before advancing read cursors. */
  receive(trigger: Trigger): ReceiveResult | Promise<ReceiveResult>
  /** Source-scoped KV records (such as read cursors); setting `undefined` removes an entry. */
  state: { get<V>(key: Key<V>): V | undefined; set<V>(key: Key<V>, value: V | undefined): void }
  threads: {
    describe(key: string, description: ThreadDescription): void
  }
  /** Reports the state of one of this kind's declared health entries; throws for undeclared entry names. */
  report(entry: string, health: Health): void
}

// ── src/sources/kind.ts:9,11,16-22,24-26,28-41,43,46-56,58-63,65-75,85-113 ──
// (left out: Policy `unnamed` and `sync`; ThreadContext `images` and `image`; SourceKind `facts`, `find`, `repliesTo` and
//  `refreshLabels`; TriggerContext; SourceInstance)
export interface Localized { zh: string; en: string }
/** `advanced` folds a rarely changed field (such as a polling tunable) behind the card's Advanced section. */
interface FieldBase { key: string; label: Localized; hint?: Localized; advanced?: true }
/**
 * Configuration field specification; `rows` edits a list of records keyed by its first column, `choose` picks from
 * resolved source labels, and `fact` displays a read-only value from `facts`.
 */
export type FieldSpec =
  | FieldBase & { type: 'switch' }
  | FieldBase & { type: 'select'; options: { value: string; label: Localized }[] }
  | FieldBase & { type: 'number'; min: number; max: number }
  | FieldBase & { type: 'text'; pattern?: string; readonly?: boolean; choose?: Localized }
  | FieldBase & { type: 'fact'; settings?: 'deployment' }
  | FieldBase & { type: 'rows'; columns: ({ key: string; label: Localized; type: 'text'; pattern?: string; optional?: boolean; choose?: Localized; refresh?: Localized } | { key: string; label: Localized; type: 'select'; options: { value: string; label: Localized }[] })[] }

export interface VariableSpec { key: string; description: Localized }
export interface EnvironmentInput<C> { deployment: Deployment; config: C; trigger?: Trigger }
export interface AdmissionRowView { id: string; label: Localized | string; note: Localized; cells: { listedUnaddressed: boolean; unlistedAddressed: boolean; unlistedUnaddressed: boolean } }
/** Policy extension for a source kind, defining allowed senders, admission table rows, and optional external roster sync. */
export interface SourcePolicyPart<P extends Record<string, unknown>> {
  /** Validates the Source's part of the Policy, including `allowed` (senders who may originate work). */
  schema: SchemaLike<P>
  /** Form fields of the policy part; the first is `allowed`. */
  fields: FieldSpec[]
  /** Describes what the Source marks as addressed to the agent, which an allowed sender's explicit request requires. */
  explicit: Localized
  /** Receiving scopes of the Policy's admission table under `config` (matching `scope().row`); kinds without `rows` use the table's defaults. */
  rows?(config: Record<string, unknown>): AdmissionRowView[]
}
/** UI link for a channel address; `triggerId` names the Trigger whose own deep link is preferred when available. */
export interface ChannelLink { url: string; label: Localized; triggerId?: string }
/** Outbound messaging adapter for a source kind's threads. */
export interface SourceChannel<C> {
  /** Whether a reply may still go to `address`; without it, every address may receive replies. */
  allowed?(address: Record<string, string>, config: C): boolean
  /**
   * Sends a message idempotently by ID; returns `'gone'` when the target conversation no longer accepts replies.
   * @throws when delivery failed but may succeed on a later retry.
   */
  send(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'>
  /** Returns the URL and label for `address`; `url` is empty when `links` lack the required deployment info. */
  link(address: Record<string, string>, links: ChannelLinks): ChannelLink
}
/** Normalized message returned by thread context readers; `bot` marks a non-human sender whose message can never authorize work on its own (at most an inferred candidate). */
export interface ContextMessage {
  id: string; from: string; at: string; text: string
  bot?: true; deleted?: true; reply_to?: string; url?: string; path?: string; line?: number
}
export type ContextPartName = 'thread' | 'root' | 'parent'
export interface ContextPart { messages: ContextMessage[]; next?: string | undefined; body: Record<string, unknown>; status?: string }
/** Bounded thread context reader used by assessments to inspect messages and images around a trigger. */
export interface ThreadContext<C> {
  /** The ID of the Trigger's own message among the messages of its Thread. */
  messageId(trigger: Trigger): string
  /** Reads a page of thread messages (`thread`, first page when `cursor` is omitted), the topic root (`root`), or the replied-to message (`parent`). */
  read(commands: Commands, trigger: Trigger, part: ContextPartName, cursor: string | undefined, config: C): Promise<ContextPart>
}
/** Pluggable source kind descriptor registered with SourceRegistry. */
export interface SourceKind<C extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable ID; a default instance with the same ID exists when none is stored. */
  kind: string
  title: Localized
  description: Localized
  /** Validates stored and submitted configuration and fills defaults. */
  schema: SchemaLike<C>
  fields: FieldSpec[]
  /** Health entry names owned by this kind under `health[...]`; no other kind or core loop may report them. */
  health: string[]
  /** Listening rule for a trigger (or recorded Mandate basis) of this kind; kinds without `scope` listen to everything they produce and observe none of it. */
  scope?(input: { meta: Record<string, unknown> }, config: C): ScopeResult
  /** Outbound reply adapter; kinds without `channel` produce no replies or channel checks. */
  channel?: SourceChannel<C>
  /** Bounded context reader for assessments; assessments of a kind without `threadContext` read none. */
  threadContext?: ThreadContext<C>
  /** Policy section for kinds whose senders have their own identity. */
  policy?: SourcePolicyPart<Record<string, unknown> & { allowed: { id: string; name?: string }[] }>
  /** Variables the kind registers with the execution environment and how their values are computed. */
  environment?: { variables: readonly VariableSpec[]; values(input: EnvironmentInput<C>): Record<string, string> }
}
