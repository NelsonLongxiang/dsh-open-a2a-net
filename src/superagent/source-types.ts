/**
 * The superagent Source surface the a2a Source is written against (p2 design G2): minimal structural types declared in
 * this repo, so the plugin needs neither superagent's build nor its package. src/superagent/contract.ts holds them to the
 * upstream snapshot in ./upstream; a field here that upstream does not accept fails the typecheck.
 */
import { createHash } from 'node:crypto'

export interface Localized { zh: string; en: string }
export interface ThreadRef { source: string; id: string }
export interface ChannelRef { source: string; thread: string; address: Record<string, string> }
/** One message of the mailbox as superagent takes it in; `text` and `meta` are untrusted data. */
export interface Trigger {
  id: string
  source: string
  threads: ThreadRef[]
  actor: { source: string; id: string }
  human: boolean
  addressed?: 'mention' | 'direct'
  at: string
  text: string
  channel?: ChannelRef
  url?: string
  meta: Record<string, unknown>
}
export type ScopeResult = { listened: true; observed: boolean; row?: string } | { listened: false; reason: string }
export interface OutboundMessage { id: string; channel: ChannelRef; text: string; kind: 'acknowledgement' | 'reply' | 'notice'; ticketId?: string }
export type ReceiveResult = 'stored' | 'duplicate' | 'filtered'
export interface Commands {
  withSignal(signal?: AbortSignal): Commands
  run(program: string, args: string[], cwd?: string): Promise<string>
}
/** Only the codes the a2a Source reports with. */
export type HealthCode = 'setupPending' | 'sourceOff' | 'pollFailures'
export interface Health { state: 'starting' | 'ready' | 'paused' | 'error'; detail: string; at?: string; code?: HealthCode; values?: Record<string, string> }
export interface SchemaLike<T> {
  parse(value: unknown): T
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}
export type FieldSpec =
  | { key: string; label: Localized; advanced?: true; type: 'number'; min: number; max: number }
  | { key: string; label: Localized; advanced?: true; type: 'select'; options: { value: string; label: Localized }[] }
  | { key: string; label: Localized; type: 'rows'; columns: { key: string; label: Localized; type: 'text'; optional?: boolean }[] }
export interface ContextMessage { id: string; from: string; at: string; text: string; bot?: true }
export interface ContextPart { messages: ContextMessage[]; next?: string; body: Record<string, unknown> }

/** What the a2a Source uses of the context superagent hands a Source plugin. */
export interface SourceContext {
  readonly commands: Commands
  readonly ready: Promise<void>
  configured(): boolean
  config<C extends Record<string, unknown>>(kind: string): C | undefined
  receive(trigger: Trigger): ReceiveResult | Promise<ReceiveResult>
  state: { get<V>(key: string): V | undefined; set<V>(key: string, value: V | undefined): void }
  threads: { describe(key: string, description: { label?: string; url?: string }): void }
  report(entry: string, health: Health): void
}

/** The kind descriptor the a2a Source registers. */
export interface SourceKind<C extends Record<string, unknown>> {
  kind: string
  title: Localized
  description: Localized
  schema: SchemaLike<C>
  fields: FieldSpec[]
  health: string[]
  scope(input: { meta: Record<string, unknown> }, config: C): ScopeResult
  channel: {
    allowed(address: Record<string, string>, config: C): boolean
    send(host: { commands: Commands }, message: OutboundMessage): Promise<'sent' | 'gone'>
    link(address: Record<string, string>, links: unknown): { url: string; label: Localized }
  }
  threadContext: {
    messageId(trigger: Trigger): string
    read(commands: Commands, trigger: Trigger, part: 'thread' | 'root' | 'parent', cursor: string | undefined, config: C): Promise<ContextPart>
  }
  policy: {
    schema: SchemaLike<Record<string, unknown> & { allowed: { id: string; name?: string }[] }>
    fields: FieldSpec[]
    explicit: Localized
    rows(config: Record<string, unknown>): { id: string; label: string; note: Localized; cells: { listedUnaddressed: boolean; unlistedAddressed: boolean; unlistedUnaddressed: boolean } }[]
  }
  environment: { variables: readonly { key: string; description: Localized }[]; values(input: { config: C; trigger?: Trigger }): Record<string, string> }
}

/** superagent's content-derived id: the same inputs always give the same 32-hex id (contract-checked against upstream). */
export function key(...values: string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)
}
/** superagent's Thread key, `<source>:<id>`. */
export const threadKey = (ref: ThreadRef): string => `${ref.source}:${ref.id}`

const HEALTH_TEXT: Record<HealthCode, string> = {
  setupPending: 'Waiting for the deployment check',
  sourceOff: 'Off',
  pollFailures: '{count} consecutive failed polls; last: {error}',
}
/** superagent's fixed health entry for `code`; the panel localizes it by code. */
export function health(state: Health['state'], code: HealthCode, values: Record<string, string> = {}): Health {
  const detail = HEALTH_TEXT[code].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
  return { state, detail, code, ...Object.keys(values).length ? { values } : {} }
}
