/**
 * superagent a2a Source, shadow mode (plan node p2a-source-code; design: docs/design/superagent-a2a-p2-source-design.md).
 *
 * Reads one dedicated a2a-net CLI identity's mailbox through `a2a-net inbox --after`, turns each message into a superagent
 * Trigger, and never replies: the only mode is `observe`, and the Channel refuses every address. It is a standalone
 * export (`./a2a-watch`) that nothing in this plugin loads; superagent loads it only where an operator enables it.
 *
 * Trust comes from structured mailbox fields only (`proof`, `receipt_for`, `dup`, `task_id`); the message text and
 * every meta field are data, never parsed for decisions.
 */
import { health, key, threadKey } from './source-types.ts'
import type { ContextPart, FieldSpec, Health, OutboundMessage, SchemaLike, SourceContext, SourceHost, SourceKind, Trigger } from './source-types.ts'

export const KIND = 'a2a'
/** The program superagent's Commands runs; the deployment puts the a2a-net CLI on PATH with this identity's home. */
export const PROGRAM = 'a2a-net'
/** D4 (global review of PR #385): only a host-verified origin or this host's own process makes an actor. */
export const TRUSTED_PROOFS: ReadonlySet<string> = new Set(['origin-claim', 'in-process'])
export const HEALTH = { read: 'a2a', deposit: 'a2a-deposit' } as const
/** Source-scoped KV records (superagent keys are plain strings). */
export const KV = { cursor: 'a2a-cursor', renewedAt: 'a2a-renewed-at', rows: 'a2a-rows', pages: 'a2a-pages', healthLog: 'a2a-health-log' } as const
/**
 * Records kept for the shadow acceptance (D1, D2): the newest ROW_RECORD_CAP row outcomes, PAGE_RECORD_CAP page headers
 * (one per read) and HEALTH_RECORD_CAP health errors. Older ones roll off; none ever holds message text.
 */
export const ROW_RECORD_CAP = 1000
export const PAGE_RECORD_CAP = 1000
export const HEALTH_RECORD_CAP = 200
/** The host's proof vocabulary (src/task-auth.ts AuthProof): a row record keeps a proof only from this closed set. */
const PROOF_VALUES: ReadonlySet<string> = new Set(['origin-claim', 'claim-mismatch', 'legacy-window', 'unbound', 'cli-identity', 'in-process', 'none'])
/** The structured health values a health record may keep; free text (such as a CLI error) stays in the live report only. */
const LOG_VALUE_KEYS: ReadonlySet<string> = new Set(['count', 'lost', 'after', 'epochChanged'])
/** The mailbox's duplicate markers a row record may keep. */
const DUP_VALUES: ReadonlySet<string> = new Set(['sync-answered'])

/** Where one mailbox row went, as the shadow acceptance reads it (A5). */
export type RowOutcome = 'stored' | 'duplicate' | 'filtered:unverified' | 'filtered:receipt' | 'duplicateCopy' | 'unreadable'
/**
 * One row's record: the row's identifying metadata and its outcome, never the text. proof, receipt_for and dup are the
 * mailbox's own fields, so the acceptance can take the rows as the whole set and reconcile the Triggers against them.
 */
export interface RowRecord {
  epoch: string; seq: number | null; task_id: string | null; from: string | null; outcome: RowOutcome; at: string
  proof: string | null; receipt_for: string | null; dup: string | null
}
/** One read's page header as the host printed it, recorded whether or not the Source judged a loss (A7 checks the Source against it). */
export interface PageRecord { at: string; after: string; next: string; epoch: string; lost: number | null; epochChanged: boolean; cursorAhead: boolean }
/** One health error's record: the entry and its state/code/values, never the free-text detail. */
export interface HealthRecord { at: string; entry: string; state: Health['state']; code?: string; values?: Record<string, string> }

/** Append rows by their stable key epoch:seq (a replay records nothing twice), keeping the newest ROW_RECORD_CAP. */
export function recordRows(ctx: SourceContext, rows: readonly RowRecord[]): void {
  if (rows.length === 0) return
  const kept = ctx.state.get<RowRecord[]>(KV.rows) ?? []
  const seen = new Set(kept.map(r => `${r.epoch}:${String(r.seq)}`))
  for (const row of rows) {
    const key = `${row.epoch}:${String(row.seq)}`
    if (row.seq !== null && seen.has(key)) continue
    seen.add(key)
    kept.push(row)
  }
  ctx.state.set(KV.rows, kept.slice(-ROW_RECORD_CAP))
}

/** Keep one read's page header, newest PAGE_RECORD_CAP. */
export function recordPage(ctx: SourceContext, page: PageRecord): void {
  const kept = ctx.state.get<PageRecord[]>(KV.pages) ?? []
  kept.push(page)
  ctx.state.set(KV.pages, kept.slice(-PAGE_RECORD_CAP))
}

/** Report a health error and keep its record (A7: every loss round leaves a record, whatever the current value says). */
export function reportError(ctx: SourceContext, entry: string, h: Health, now: () => Date = () => new Date()): void {
  const log = ctx.state.get<HealthRecord[]>(KV.healthLog) ?? []
  const values = h.values === undefined ? undefined : Object.fromEntries(Object.entries(h.values).filter(([name]) => LOG_VALUE_KEYS.has(name)))
  log.push({ at: h.at ?? now().toISOString(), entry, state: h.state, ...(h.code !== undefined ? { code: h.code } : {}), ...(values !== undefined ? { values } : {}) })
  ctx.state.set(KV.healthLog, log.slice(-HEALTH_RECORD_CAP))
  ctx.report(entry, h)
}

export interface A2aConfig extends Record<string, unknown> {
  /** p2 knows one mode. `reply` belongs to p3 and is refused here, as is anything else. */
  mode: 'observe'
  pollSeconds: number
  renewMinutes: number
}
const DEFAULTS: A2aConfig = { mode: 'observe', pollSeconds: 30, renewMinutes: 60 }

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const intIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** A strict schema without zod (superagent only calls parse / safeParse on it): unknown keys and any mode but observe fail closed. */
function strictSchema<T>(check: (value: Record<string, unknown>) => T | undefined): SchemaLike<T> {
  const safeParse = (value: unknown): { success: true; data: T } | { success: false } => {
    const data = isRecord(value) ? check(value) : undefined
    return data === undefined ? { success: false } : { success: true, data }
  }
  return {
    safeParse,
    parse(value) {
      const result = safeParse(value)
      if (!result.success) throw new Error('a2a Source: invalid configuration')
      return result.data
    },
  }
}

export const configSchema = strictSchema<A2aConfig>(value => {
  if (Object.keys(value).some(name => !(name in DEFAULTS))) return undefined
  const mode = value.mode ?? DEFAULTS.mode
  const pollSeconds = value.pollSeconds ?? DEFAULTS.pollSeconds
  // The deposit lives 4h on its home host; renewing at least every 230 minutes keeps it live.
  const renewMinutes = value.renewMinutes ?? DEFAULTS.renewMinutes
  if (mode !== 'observe' || !intIn(pollSeconds, 10, 3600) || !intIn(renewMinutes, 10, 230)) return undefined
  return { mode, pollSeconds, renewMinutes }
})

type Allowed = { id: string; name?: string }[]
export const policySchema = strictSchema<Record<string, unknown> & { allowed: Allowed }>(value => {
  if (Object.keys(value).some(name => name !== 'allowed')) return undefined
  const allowed = value.allowed ?? []
  if (!Array.isArray(allowed)) return undefined
  const rows: Allowed = []
  for (const row of allowed) {
    if (!isRecord(row) || typeof row.id !== 'string' || row.id === '' || Object.keys(row).some(name => name !== 'id' && name !== 'name')) return undefined
    if (row.name !== undefined && typeof row.name !== 'string') return undefined
    rows.push({ id: row.id, ...(row.name !== undefined ? { name: row.name } : {}) })
  }
  return { allowed: rows }
})

/** One row of `a2a-net inbox --after`, as far as the Source reads it. */
interface MailRow {
  at: number
  from: string
  text: string
  seq: number
  task_id?: string
  context_id?: string
  proof?: string
  receipt_for?: string
  dup?: string
}

/** Where one mailbox row went: a Trigger (whose scope then decides), a duplicate copy, or unreadable. */
export type Translation =
  | { kind: 'trigger'; trigger: Trigger }
  | { kind: 'duplicateCopy' }
  | { kind: 'unreadable' }

/**
 * Translate one mailbox row. The id is key('a2a', from, task_id): a task id is unique only inside the host's idempotency
 * window, so the caller is part of it. Rows without a task id (an older host) are unreadable, never guessed; a
 * `dup: 'sync-answered'` row is a copy of a reply the caller already got and makes no second Trigger.
 */
export function translate(row: unknown, epoch: string): Translation {
  if (!isRecord(row)) return { kind: 'unreadable' }
  const mail = row as Partial<MailRow>
  if (typeof mail.from !== 'string' || mail.from === '' || typeof mail.text !== 'string' || typeof mail.at !== 'number' || !Number.isInteger(mail.seq)) return { kind: 'unreadable' }
  if (typeof mail.task_id !== 'string' || mail.task_id === '') return { kind: 'unreadable' }
  if (mail.dup === 'sync-answered') return { kind: 'duplicateCopy' }
  const thread = typeof mail.context_id === 'string' && mail.context_id !== '' ? mail.context_id : mail.task_id
  const proof = typeof mail.proof === 'string' ? mail.proof : undefined
  const receiptFor = typeof mail.receipt_for === 'string' && mail.receipt_for !== '' ? mail.receipt_for : undefined
  return {
    kind: 'trigger',
    trigger: {
      id: key(KIND, mail.from, mail.task_id),
      source: KIND,
      threads: [{ source: KIND, id: thread }],
      actor: { source: KIND, id: mail.from },
      // D7 (global review of PR #385): an A2A caller is an agent, so a bot by fact; p3 settles S13 ② against this.
      human: false,
      addressed: 'direct',
      at: new Date(mail.at).toISOString(),
      text: mail.text,
      channel: { source: KIND, thread: `${KIND}:${thread}`, address: { caller: mail.from, task: mail.task_id, ...(thread !== mail.task_id ? { context: thread } : {}) } },
      meta: {
        taskId: mail.task_id,
        ...(thread !== mail.task_id ? { contextId: thread } : {}),
        seq: mail.seq,
        epoch,
        ...(proof !== undefined ? { proof } : {}),
        ...(receiptFor !== undefined ? { receiptFor } : {}),
        // Observation only (D7): what S13 ② would give a verified caller once it is on the allowed list. The Source
        // cannot read the Policy, so this records the verification half; nothing reads it for a decision.
        ...(proof !== undefined && TRUSTED_PROOFS.has(proof) ? { s13Strength: 'explicit-if-allowed' } : {}),
      },
    },
  }
}

/** Receiving scope from the stored meta alone: an untrusted proof first (fail closed), then receipts, then the mailbox row. */
export function scope(input: { meta: Record<string, unknown> }): { listened: true; observed: boolean; row?: string } | { listened: false; reason: string } {
  const proof = input.meta.proof
  if (typeof proof !== 'string' || !TRUSTED_PROOFS.has(proof)) return { listened: false, reason: 'unverified' }
  if (typeof input.meta.receiptFor === 'string') return { listened: false, reason: 'receipt' }
  return { listened: true, observed: false, row: 'mailbox' }
}

/** The page `a2a-net inbox --after` prints. */
interface MailPage { epoch: string; next: string; mail: unknown[]; lost: number | null; epochChanged: boolean; cursorAhead?: true }

function parsePage(output: string): MailPage {
  const page = JSON.parse(output) as unknown
  if (!isRecord(page) || typeof page.epoch !== 'string' || typeof page.next !== 'string' || !Array.isArray(page.mail) ||
    !(page.lost === null || (typeof page.lost === 'number' && Number.isInteger(page.lost))) || typeof page.epochChanged !== 'boolean') {
    throw new Error('a2a-net inbox --after printed an unexpected page')
  }
  return page as unknown as MailPage
}

/** A loss the read must surface (S2): never hidden, always with its numbers. */
export function lossHealth(page: Pick<MailPage, 'lost' | 'epochChanged' | 'cursorAhead'>, after: string, at: string): Health | undefined {
  const values = { lost: String(page.lost), after, epochChanged: String(page.epochChanged) }
  if (page.epochChanged || page.lost === null) {
    return { state: 'error', at, values, detail: `The home host's mailbox store restarted (new epoch); mail during the restart may be lost (lost=${String(page.lost)}, epochChanged=${String(page.epochChanged)}, cursor ${after})` }
  }
  if (page.cursorAhead === true) return { state: 'error', at, values, detail: `The stored cursor ${after} is ahead of the home host; it was not issued there (lost unknown)` }
  if (page.lost > 0) return { state: 'error', at, values, detail: `${String(page.lost)} message(s) were pushed out of the mailbox before this read; they cannot be recovered` }
  return undefined
}

/** One read. `loss` is the health error this round reported, so the loop does not cover it with a ready in the same round. */
export interface RoundSummary { read: number; triggers: number; duplicateCopies: number; unreadable: number; next: string; loss?: Health }

/**
 * Read the mailbox after the stored cursor, take in each row, then move the cursor. An interrupted round leaves the cursor
 * where it was; the stable Trigger ids make the replay a duplicate, never a second Trigger.
 */
export async function pollMailbox(ctx: SourceContext, signal: AbortSignal, now: () => Date = () => new Date()): Promise<RoundSummary> {
  const after = ctx.state.get<string>(KV.cursor) ?? 'start'
  const page = parsePage(await ctx.commands.withSignal(signal).run(PROGRAM, ['inbox', '--after', after]))
  const at = now().toISOString()
  // The header is recorded unconditionally, before any judgement, so a missed loss still shows in the records.
  recordPage(ctx, { at, after, next: page.next, epoch: page.epoch, lost: page.lost, epochChanged: page.epochChanged, cursorAhead: page.cursorAhead === true })
  const loss = lossHealth(page, after, at)
  if (loss !== undefined) reportError(ctx, HEALTH.read, loss, now)
  const summary: RoundSummary = { read: page.mail.length, triggers: 0, duplicateCopies: 0, unreadable: 0, next: page.next, ...(loss !== undefined ? { loss } : {}) }
  // Each row's record is written as soon as the row is through, so an interrupted round keeps what it did; the cursor
  // moves only after every row of the round has its record (D1).
  for (const row of page.mail) {
    if (signal.aborted) throw new Error('The a2a Source stopped during the read')
    const result = translate(row, page.epoch)
    const raw = isRecord(row) ? row : {}
    const base = { epoch: page.epoch, seq: Number.isInteger(raw.seq) ? raw.seq as number : null,
      task_id: typeof raw.task_id === 'string' && raw.task_id !== '' ? raw.task_id : null, from: typeof raw.from === 'string' && raw.from !== '' ? raw.from : null, at,
      proof: typeof raw.proof === 'string' && PROOF_VALUES.has(raw.proof) ? raw.proof : null,
      receipt_for: typeof raw.receipt_for === 'string' && raw.receipt_for !== '' ? raw.receipt_for : null,
      dup: typeof raw.dup === 'string' && DUP_VALUES.has(raw.dup) ? raw.dup : null }
    if (result.kind === 'duplicateCopy') { summary.duplicateCopies += 1; recordRows(ctx, [{ ...base, outcome: 'duplicateCopy' }]); continue }
    if (result.kind === 'unreadable') { summary.unreadable += 1; recordRows(ctx, [{ ...base, outcome: 'unreadable' }]); continue }
    const received = await ctx.receive(result.trigger)
    summary.triggers += 1
    // The Engine says whether it filtered the Trigger; this kind's own scope says why.
    const verdict = scope(result.trigger)
    const outcome: RowOutcome = received !== 'filtered' ? received : !verdict.listened && verdict.reason === 'receipt' ? 'filtered:receipt' : 'filtered:unverified'
    recordRows(ctx, [{ ...base, outcome }])
    ctx.threads.describe(threadKey(result.trigger.threads[0]!), { label: `A2A ${result.trigger.actor.id}` })
  }
  ctx.state.set(KV.cursor, page.next)
  return summary
}

/** Re-publish the deposit when `renewMinutes` passed since the last success; returns whether it published. */
export async function renewDeposit(ctx: SourceContext, config: A2aConfig, signal: AbortSignal, now: () => number = Date.now): Promise<boolean> {
  const last = ctx.state.get<number>(KV.renewedAt)
  if (typeof last === 'number' && now() - last < config.renewMinutes * 60_000) return false
  await ctx.commands.withSignal(signal).run(PROGRAM, ['publish'])
  ctx.state.set(KV.renewedAt, now())
  return true
}

interface ThreadEntry { dir: 'in' | 'out'; at: number; seq?: number; task_id?: string; from?: string; text: string }

const fields: FieldSpec[] = [
  { key: 'mode', type: 'select', label: { zh: '模式', en: 'Mode' }, options: [{ value: 'observe', label: { zh: '影子（只登记，不回发）', en: 'Shadow (records only, never replies)' } }] },
  { key: 'pollSeconds', type: 'number', advanced: true, min: 10, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' } },
  { key: 'renewMinutes', type: 'number', advanced: true, min: 10, max: 230, label: { zh: '户口续期间隔 / 分钟', en: 'Deposit renewal / minutes' } },
]

export const a2aKind: SourceKind<A2aConfig> = {
  kind: KIND,
  title: { zh: 'A2A 信箱', en: 'A2A mailbox' },
  description: { zh: '接收一个专用 a2a-net CLI 身份信箱里的消息（影子模式：只登记，不回发）。', en: "Receives the messages in a dedicated a2a-net CLI identity's mailbox (shadow mode: records only, never replies)." },
  schema: configSchema,
  fields,
  health: [HEALTH.read, HEALTH.deposit],
  scope: (input, _config) => scope(input),
  channel: {
    // Shadow mode: no address may receive a reply, whatever the Engine produces; Outbox keeps such messages as dropped.
    allowed: () => false,
    send(_host, _message: OutboundMessage): Promise<'sent' | 'gone'> {
      return Promise.reject(new Error('The a2a Source is observe-only; it never sends'))
    },
    link: address => ({ url: '', label: { zh: `A2A 调用方 ${address.caller ?? ''}`, en: `A2A caller ${address.caller ?? ''}` } }),
  },
  threadContext: {
    messageId: trigger => String(trigger.meta.taskId ?? ''),
    // An A2A exchange is flat: the thread, its root and the parent all read the same pages of `a2a-net thread`.
    async read(commands, trigger, _part, cursor): Promise<ContextPart> {
      const context = typeof trigger.meta.contextId === 'string' ? trigger.meta.contextId : typeof trigger.meta.taskId === 'string' ? trigger.meta.taskId : ''
      if (context === '') return { messages: [], body: { messages: [] } }
      const page = JSON.parse(await commands.run(PROGRAM, ['thread', context, '--limit', '20', ...(cursor !== undefined ? ['--before', cursor] : [])])) as { handle?: string; entries?: ThreadEntry[]; next_before?: string | null }
      const messages = (page.entries ?? []).map(entry => ({
        id: entry.task_id ?? `${entry.dir}:${String(entry.seq ?? entry.at)}`,
        from: entry.dir === 'in' ? entry.from ?? '' : page.handle ?? '',
        at: new Date(entry.at).toISOString(),
        text: entry.text,
        bot: true as const,
      }))
      return { messages, ...(typeof page.next_before === 'string' ? { next: page.next_before } : {}), body: { messages } }
    },
  },
  policy: {
    schema: policySchema,
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的调用方', en: 'Callers who may originate work' }, columns: [
      { key: 'id', type: 'text', label: { zh: '调用方句柄', en: 'Caller handle' } },
      { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] }],
    explicit: { zh: '名单里的调用方经宿主校验后路由到本身份。', en: 'A listed caller, verified by the host, routes to this identity.' },
    // One receiving scope, every cell closed: shadow mode admits nothing.
    rows: () => [{ id: 'mailbox', label: 'mailbox', note: { zh: 'A2A 信箱', en: 'A2A mailbox' }, cells: { listedUnaddressed: false, unlistedAddressed: false, unlistedUnaddressed: false } }],
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_A2A_CALLER', description: { zh: '发起工单的 A2A 调用方句柄；工单不是从本来源来的时为空', en: 'The A2A caller that started the ticket; empty when it did not start on this Source' } },
      { key: 'DSH_SUPERAGENT_A2A_CONTEXT', description: { zh: '该工单的 A2A context id；工单不是从本来源来的时为空', en: "The ticket's A2A context id; empty when it did not start on this Source" } },
    ],
    values: ({ trigger }) => ({
      DSH_SUPERAGENT_A2A_CALLER: trigger?.source === KIND ? trigger.actor.id : '',
      DSH_SUPERAGENT_A2A_CONTEXT: trigger?.source === KIND ? String(trigger.meta.contextId ?? trigger.meta.taskId ?? '') : '',
    }),
  },
}

const delay = (ms: number, signal: AbortSignal): Promise<void> => new Promise(resolve => {
  if (signal.aborted) { resolve(); return }
  const timer = setTimeout(() => { signal.removeEventListener('abort', done); resolve() }, ms)
  const done = () => { clearTimeout(timer); resolve() }
  signal.addEventListener('abort', done, { once: true })
})

/** The polling loop: waits for setup (observe mode reads while setup is pending), follows the switch, renews the deposit, reads, and reports health. */
export async function watch(ctx: SourceContext, signal: AbortSignal, now: () => Date = () => new Date()): Promise<void> {
  await ctx.ready
  let readFailures = 0
  let depositFailures = 0
  while (!signal.aborted) {
    const config = ctx.config<A2aConfig>(KIND)
    // Setup restarts dsh-superagent once it resolves the accounts (superagent docs/008-cookbook.md, step 9), so a Source
    // that is not configured yet normally reads nothing and returns. Observe mode deliberately reads anyway: while setup is
    // pending superagent still records what Sources receive and only holds evaluation, dispatch and sending (runtime.ts
    // paused(): "sources still record incoming triggers"; passes.ts pump()), which is exactly a shadow run. Any other mode
    // keeps waiting for setup.
    if (!ctx.configured() && config?.mode !== 'observe') { ctx.report(HEALTH.read, health('paused', 'setupPending')); return }
    if (config === undefined) ctx.report(HEALTH.read, health('paused', 'sourceOff'))
    else {
      try {
        if (await renewDeposit(ctx, config, signal, () => now().getTime())) ctx.report(HEALTH.deposit, { state: 'ready', detail: 'deposit renewed', at: now().toISOString() })
        depositFailures = 0
      } catch (error) {
        depositFailures += 1
        if (!signal.aborted && depositFailures >= 3) reportError(ctx, HEALTH.deposit, { state: 'error', detail: `${String(depositFailures)} consecutive failed deposit renewals; last: ${String(error)}`, at: now().toISOString(), values: { count: String(depositFailures) } }, now)
      }
      try {
        const round = await pollMailbox(ctx, signal, now)
        readFailures = 0
        // A round that lost mail ends on its error (S2: never hidden). The next clean round reports ready again: the
        // loss stays visible for at least one poll interval, and the round summary in each ready says what was read.
        if (round.loss === undefined) ctx.report(HEALTH.read, { state: 'ready', detail: `${String(round.read)} read, ${String(round.triggers)} taken in, ${String(round.duplicateCopies)} duplicate copies, ${String(round.unreadable)} unreadable`, at: now().toISOString() })
      } catch (error) {
        readFailures += 1
        if (!signal.aborted && readFailures >= 3) reportError(ctx, HEALTH.read, { ...health('error', 'pollFailures', { count: String(readFailures), error: String(error) }), at: now().toISOString() }, now)
      }
    }
    await delay((config?.pollSeconds ?? DEFAULTS.pollSeconds) * 1000, signal)
  }
}

/** The cordis surface the plugin entry uses (superagent injects its host as `orchestrator`). */
export interface PluginContext {
  effect(run: () => (() => void) | (() => Promise<void>), label?: string): void
  readonly orchestrator: SourceHost
}

export const name = 'dsh-superagent-a2a'
export const inject = ['orchestrator']
export function apply(ctx: PluginContext): void {
  ctx.effect(() => ctx.orchestrator.sources.register(a2aKind), 'a2a: source kind')
  ctx.effect(() => {
    const source = ctx.orchestrator.context(a2aKind)
    const controller = new AbortController()
    // A failure that escapes the loop becomes the Source's health instead of an unhandled rejection.
    const running = watch(source, controller.signal).catch((error: unknown) => { reportError(source, HEALTH.read, { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  }, 'a2a: mailbox loop')
}
