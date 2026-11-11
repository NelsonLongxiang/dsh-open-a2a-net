/**
 * Receipt text codec — single home for the correlation pattern and the v2
 * structured envelope (receipt-envelope-v2.md). The header line
 * `[A2A receipt] task <id> …` stays byte-identical to the network's original
 * contract; the machine payload rides EXACTLY ONE following line that must be
 * a complete JSON object containing at least one known key. Everything after
 * it is human continuation and every consumer ignores unknown keys.
 *
 * Discriminator over a bare `{`: an object qualifies as an envelope only when
 * one of the known keys is present, so legacy prose summaries that happen to
 * open with a brace can never be mistaken for machine payloads.
 * @module @nelsonlongxiang/dsh-open-a2a-net/receipt
 */

/**
 * #114 S5: what a task id may not contain. The id is spliced into the
 * `[A2A direct] (task <id>)` steer header and the `[A2A receipt] task <id>`
 * correlation header; a `)` would let one id's header start with another's
 * (`foo) x` → `(task foo) x)`), and whitespace or control characters break
 * the `\S+` correlation and the header's one-line shape.
 */
const TASK_ID_FORBIDDEN = /[\s)\u0000-\u001f\u007f]/

/**
 * Refusal text for an unusable task id, or undefined when the id is fine.
 * Both delivery paths (wire face, local candidate) refuse at intake.
 */
export function taskIdRefusal(taskId: string): string | undefined {
  return TASK_ID_FORBIDDEN.test(taskId)
    ? 'task_id must not contain whitespace, ")" or control characters — it is spliced into the [A2A direct] (task <id>) and [A2A receipt] task <id> headers'
    : undefined
}

/** The network's fixed, case-sensitive correlation template. */
export const RECEIPT_PATTERN = /^\[A2A receipt\] task (\S+)\s*([\s\S]*)$/

/**
 * Controlled outcome vocabulary — how the work ended. One of the envelope's two
 * branchable fields; {@link RECEIPT_DISPOSITIONS} is the other.
 */
export const RECEIPT_OUTCOMES = [
  'completed',
  'failed',
  'abandoned',
  'expired',
  'rejected',
  'sync_completed',
  'unknown',
] as const

export type ReceiptOutcomeV2 = (typeof RECEIPT_OUTCOMES)[number]

/**
 * superagent p1-receipt-cmd (S14): what the receipt hands back — the work's
 * result, or a question that needs the caller's attention. A closed set; any
 * other value is dropped. An attention receipt settles the task like any
 * receipt but is not a completion (it carries no outcome); the answer comes
 * back as a new task in the same context.
 *
 * `acknowledged` (superagent v4, requester acknowledgement): the target took the task up and will answer later — the
 * caller's row stays owed (the result receipt settles it) but no longer counts against the queue cap or expires at the
 * 24-hour TTL. It rides the receipt form so every hop treats it as settlement traffic (no debt of its own, never refused
 * by a queue). A host that predates it drops the unknown value and settles the row on it; the result then arrives as a
 * late receipt that updates the settled row's summary and outcome.
 */
export const RECEIPT_DISPOSITIONS = ['result', 'attention', 'acknowledged', 'progress'] as const

export type ReceiptDisposition = (typeof RECEIPT_DISPOSITIONS)[number]

const KNOWN_ENVELOPE_KEYS: readonly string[] = ['outcome', 'idempotencyKey', 'sessionKey', 'elapsedMs', 'artifacts', 'onBehalfOf', 'authRef', 'disposition', 'by', 'question', 'progress', 'tickets']
void KNOWN_ENVELOPE_KEYS

/** Envelope fields this codec extracts; anything else rides through ignored (append-only). */
export interface ReceiptEnvelopeV2Fields {
  outcome?: ReceiptOutcomeV2
  idempotencyKey?: string
  sessionKey?: string
  elapsedMs?: number
  /**
   * #114 S5: the session a host-synthesized receipt speaks for (the host is
   * only its courier). Additive: parsers that predate it ignore it.
   */
  onBehalfOf?: string
  /** #114 S5: 16-hex ref of the inbound authorization record (task-auth.ts authorizationRef); audit only. */
  authRef?: string
  /** p1-receipt-cmd: result or attention (S14). Additive: parsers that predate it ignore it. */
  disposition?: ReceiptDisposition
  /** market N1c: the seat that took the work up (docs/design/receipt-envelope-fields.md). Additive. */
  by?: ReceiptBy
  /** market N1c: what the work produced, as ids in the requester's system (a table, a file, an SOP run). Additive. */
  artifacts?: ReceiptArtifact[]
  /**
   * market N1d/N2c: the structured question of an `attention` receipt. An attention receipt that carries one is an open
   * question, not an ending: it marks the caller's row (owed until the result) and rides its own task id
   * `attention-<task>-<question id>`, so the task's result receipt still follows. Additive.
   */
  question?: ReceiptQuestion
  /**
   * market N2a (superagent-market-progress-roster P1): a `progress` receipt's step — marks the caller's row like an
   * acknowledgement, rides `progress-<task>-<n>`. Additive.
   */
  progress?: ReceiptProgress
  /** market N2b: the tickets the request became or was fanned into, with who holds each and its state. Additive. */
  tickets?: ReceiptTicket[]
}

/** Where a request stands between its acknowledgement and its result. */
export const PROGRESS_STATES = ['queued', 'working', 'waiting', 'blocked'] as const
export type ProgressState = (typeof PROGRESS_STATES)[number]
/** One progress step: its number (1, 2, …), the state, a one-line summary, when, and for `queued` how many are ahead. */
export interface ReceiptProgress { n: number; state: ProgressState; summary?: string; at: string; ahead?: number }
export const TICKET_STATES = ['queued', 'working', 'waiting', 'blocked', 'ended'] as const
/** One ticket a request became: its id and title, the seat holding it, its state and, once ended, its outcome. */
export interface ReceiptTicket { id: string; title?: string; seat?: string; state: (typeof TICKET_STATES)[number]; outcome?: string }

/** Bounds on the added fields: what a parser keeps, and what a sender may claim. */
export const RECEIPT_FIELD_LIMITS = { text: 2000, short: 200, artifacts: 16, options: 6, questionId: 24, tickets: 16 } as const

/** The roles a seat can have in its team: the router decides and hands out, a member or an observer does the work. */
export const SEAT_ROLES = ['router', 'member', 'observer'] as const
/**
 * Who took the work up: a seat id (a session id or a qualified member ref), its display name, the team it serves, and its
 * role — `router` until a member holds the work (an acknowledgement, a queued step), then the member.
 */
export interface ReceiptBy { seat: string; name?: string; team?: string; role?: (typeof SEAT_ROLES)[number] }
/** One product of the work, named by the system that keeps it (`kind` such as table, file, sop-run). */
export interface ReceiptArtifact { kind: string; id: string }
/** A question for the caller: its id, its text, the answers offered and the one taken when nobody answers. */
export interface ReceiptQuestion { id: string; text: string; options?: string[]; default?: string }

/** A question id: what may follow `attention-<task>-` in a task id. */
export const QUESTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,23}$/

/** Whether a receipt marks the caller's row instead of settling it: an acknowledgement, or an attention carrying a question. */
export function holdsRow(envelope: ReceiptEnvelopeV2Fields | undefined): boolean {
  return envelope?.disposition === 'acknowledged' || envelope?.disposition === 'progress' || (envelope?.disposition === 'attention' && envelope.question !== undefined)
}

const shortText = (value: unknown, cap: number = RECEIPT_FIELD_LIMITS.short): string | undefined =>
  typeof value === 'string' && value.trim() !== '' && value.length <= cap ? value : undefined

/** The `by` field, or undefined when it is not a well-formed one. */
export function parseBy(value: unknown): ReceiptBy | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const r = value as Record<string, unknown>
  const seat = shortText(r['seat'])
  if (seat === undefined) return undefined
  const name = shortText(r['name']), team = shortText(r['team'])
  const role = typeof r['role'] === 'string' && (SEAT_ROLES as readonly string[]).includes(r['role']) ? r['role'] as ReceiptBy['role'] : undefined
  return { seat, ...(name !== undefined ? { name } : {}), ...(team !== undefined ? { team } : {}), ...(role !== undefined ? { role } : {}) }
}

/** The `artifacts` field, or undefined when it holds no well-formed item; malformed items are dropped. */
export function parseArtifacts(value: unknown): ReceiptArtifact[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: ReceiptArtifact[] = []
  for (const item of value.slice(0, RECEIPT_FIELD_LIMITS.artifacts)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const kind = shortText((item as Record<string, unknown>)['kind']), id = shortText((item as Record<string, unknown>)['id'])
    if (kind !== undefined && id !== undefined) items.push({ kind, id })
  }
  return items.length > 0 ? items : undefined
}

/** The `progress` field, or undefined when it is not a well-formed one. */
export function parseProgress(value: unknown): ReceiptProgress | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const r = value as Record<string, unknown>
  const n = r['n'], state = r['state'], at = shortText(r['at'])
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || typeof state !== 'string' || !(PROGRESS_STATES as readonly string[]).includes(state) || at === undefined) return undefined
  const summary = shortText(r['summary'], RECEIPT_FIELD_LIMITS.text)
  const ahead = typeof r['ahead'] === 'number' && Number.isSafeInteger(r['ahead']) && r['ahead'] >= 0 ? r['ahead'] : undefined
  return { n, state: state as ProgressState, ...(summary !== undefined ? { summary } : {}), at, ...(ahead !== undefined ? { ahead } : {}) }
}

/** The `tickets` field, or undefined when it holds no well-formed item; malformed items are dropped. */
export function parseTickets(value: unknown): ReceiptTicket[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: ReceiptTicket[] = []
  for (const item of value.slice(0, RECEIPT_FIELD_LIMITS.tickets)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const r = item as Record<string, unknown>
    const id = shortText(r['id']), state = r['state']
    if (id === undefined || typeof state !== 'string' || !(TICKET_STATES as readonly string[]).includes(state)) continue
    const title = shortText(r['title']), seat = shortText(r['seat']), outcome = shortText(r['outcome'])
    items.push({ id, ...(title !== undefined ? { title } : {}), ...(seat !== undefined ? { seat } : {}), state: state as ReceiptTicket['state'], ...(outcome !== undefined ? { outcome } : {}) })
  }
  return items.length > 0 ? items : undefined
}

/** The `question` field, or undefined when it is not a well-formed one (an id the task-id grammar takes, and a text). */
export function parseQuestion(value: unknown): ReceiptQuestion | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const r = value as Record<string, unknown>
  const id = typeof r['id'] === 'string' && QUESTION_ID_PATTERN.test(r['id']) ? r['id'] : undefined
  const text = shortText(r['text'], RECEIPT_FIELD_LIMITS.text)
  if (id === undefined || text === undefined) return undefined
  const options = Array.isArray(r['options']) ? r['options'].map(o => shortText(o)).filter((o): o is string => o !== undefined).slice(0, RECEIPT_FIELD_LIMITS.options) : []
  const fallback = shortText(r['default'])
  return { id, text, ...(options.length > 0 ? { options } : {}), ...(fallback !== undefined ? { default: fallback } : {}) }
}

export interface ParsedReceipt {
  /** Correlation key from the immutable header. */
  taskId: string
  /**
   * Raw post-id text. When a machine line was recognized this is ONLY the
   * human summary line (continuation prose excluded); without one it is the
   * legacy multi-line remainder, byte-for-byte.
   */
  summary: string
  /** Present when the second line carried a recognized envelope. */
  envelope?: ReceiptEnvelopeV2Fields
}

function tryEnvelopeLine(line: string): ReceiptEnvelopeV2Fields | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const value = JSON.parse(trimmed) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    // Discriminator: a known key must EXTRACT at least one valid field —
    // an object carrying only garbage values stays human prose (v1).
    const fields: ReceiptEnvelopeV2Fields = {}
    if (typeof record['outcome'] === 'string' && (RECEIPT_OUTCOMES as readonly string[]).includes(record['outcome'])) {
      fields.outcome = record['outcome'] as ReceiptOutcomeV2
    }
    if (typeof record['idempotencyKey'] === 'string') fields.idempotencyKey = record['idempotencyKey']
    if (typeof record['sessionKey'] === 'string') fields.sessionKey = record['sessionKey']
    if (typeof record['elapsedMs'] === 'number' && Number.isFinite(record['elapsedMs'])) fields.elapsedMs = record['elapsedMs']
    if (typeof record['onBehalfOf'] === 'string' && record['onBehalfOf'] !== '') fields.onBehalfOf = record['onBehalfOf']
    if (typeof record['authRef'] === 'string' && /^[0-9a-f]{16}$/.test(record['authRef'])) fields.authRef = record['authRef']
    if (typeof record['disposition'] === 'string' && (RECEIPT_DISPOSITIONS as readonly string[]).includes(record['disposition'])) {
      fields.disposition = record['disposition'] as ReceiptDisposition
    }
    const by = parseBy(record['by'])
    if (by !== undefined) fields.by = by
    const artifacts = parseArtifacts(record['artifacts'])
    if (artifacts !== undefined) fields.artifacts = artifacts
    // A question means something only on an attention receipt; on any other it is dropped.
    const question = fields.disposition === 'attention' ? parseQuestion(record['question']) : undefined
    if (question !== undefined) fields.question = question
    const progress = fields.disposition === 'progress' ? parseProgress(record['progress']) : undefined
    if (progress !== undefined) fields.progress = progress
    const tickets = parseTickets(record['tickets'])
    if (tickets !== undefined) fields.tickets = tickets
    if (Object.keys(fields).length === 0) return undefined
    return fields
  } catch {
    return undefined
  }
}

/**
 * Parse one inbound message against the receipt contract.
 * @returns `null` when the message is not a receipt at all; otherwise the
 * correlation key with its summary and, when present, the v2 envelope.
 */
export function parseReceipt(message: string): ParsedReceipt | null {
  const match = RECEIPT_PATTERN.exec(message)
  if (match === null) return null
  const taskId = match[1] ?? ''
  const rest = match[2] ?? ''
  const newlineAt = rest.indexOf('\n')
  const firstRestLine = newlineAt === -1 ? '' : rest.slice(0, newlineAt)
  const envelope =
    newlineAt !== -1
      ? tryEnvelopeLine(rest.slice(newlineAt + 1).split('\n', 1)[0] ?? '')
      : undefined
  // Without a machine line the legacy remainder flows through untouched so
  // multi-line human summaries keep their exact historical shape.
  const summary = envelope !== undefined ? firstRestLine : rest
  return { taskId, summary, ...(envelope !== undefined ? { envelope } : {}) }
}

/**
 * Compose a receipt text: the immutable header (+ human summary) followed,
 * when any envelope field is supplied, by exactly one complete JSON line.
 * @param taskId - correlation key echoed in the header.
 * @param summary - human-readable outcome tail on the header line.
 * @param fields - structured projection; omit entirely for a pure v1 receipt.
 */
export function formatReceipt(
  taskId: string,
  summary: string,
  fields?: ReceiptEnvelopeV2Fields,
): string {
  const header = `[A2A receipt] task ${taskId}${summary !== '' ? ` ${summary}` : ''}`
  if (fields === undefined) return header
  const ordered: Record<string, unknown> = {}
  if (fields.outcome !== undefined) ordered['outcome'] = fields.outcome
  if (fields.idempotencyKey !== undefined) ordered['idempotencyKey'] = fields.idempotencyKey
  if (fields.sessionKey !== undefined) ordered['sessionKey'] = fields.sessionKey
  if (fields.elapsedMs !== undefined) ordered['elapsedMs'] = fields.elapsedMs
  if (fields.onBehalfOf !== undefined) ordered['onBehalfOf'] = fields.onBehalfOf
  if (fields.authRef !== undefined) ordered['authRef'] = fields.authRef
  if (fields.disposition !== undefined) ordered['disposition'] = fields.disposition
  if (fields.by !== undefined) ordered['by'] = fields.by
  if (fields.artifacts !== undefined && fields.artifacts.length > 0) ordered['artifacts'] = fields.artifacts
  if (fields.question !== undefined) ordered['question'] = fields.question
  if (fields.progress !== undefined) ordered['progress'] = fields.progress
  if (fields.tickets !== undefined && fields.tickets.length > 0) ordered['tickets'] = fields.tickets
  const keys = Object.keys(ordered)
  if (keys.length === 0) return header
  return `${header}\n${JSON.stringify(ordered)}`
}

/**
 * market N1c/N1d: the receipt switches that add fields (`a2a-net receipt` and the host's team face read the same ones):
 * `--by SEAT [--by-name NAME] [--by-team TEAM]`, `--artifacts KIND:ID[,KIND:ID…]`, and with `--attention`
 * `--question-id ID [--options A|B|…] [--default X]` (the receipt's one line is the question's text). Returns the fields,
 * or the usage error that sends nothing. cli/a2a.mjs keeps a copy of these rules (it runs without the plugin's sources).
 */
export function receiptExtras(flag: (name: string) => string | undefined, attention: boolean, text: string, now: () => string = () => new Date().toISOString()): { fields: Pick<ReceiptEnvelopeV2Fields, 'by' | 'artifacts' | 'question' | 'progress' | 'tickets'> } | { error: string } {
  const fields: Pick<ReceiptEnvelopeV2Fields, 'by' | 'artifacts' | 'question' | 'progress' | 'tickets'> = {}
  // market N2a/N2b: --progress N --state S [--ahead K] [--tickets JSON] (the one line is the step's summary).
  const step = flag('--progress')
  if (step !== undefined) {
    if (attention) return { error: '--progress does not go with --attention' }
    const ahead = flag('--ahead')
    const progress = parseProgress({ n: Number(step), state: flag('--state'), summary: text, at: now(), ...(ahead !== undefined ? { ahead: Number(ahead) } : {}) })
    if (progress === undefined || (ahead !== undefined && progress.ahead === undefined)) return { error: `--progress takes a step number from 1 with --state ${PROGRESS_STATES.join('|')} [--ahead K]` }
    fields.progress = progress
  } else if (flag('--state') !== undefined || flag('--ahead') !== undefined) return { error: '--state and --ahead go with --progress' }
  const ticketsJson = flag('--tickets')
  if (ticketsJson !== undefined) {
    let tickets: ReceiptTicket[] | undefined
    try { tickets = parseTickets(JSON.parse(ticketsJson) as unknown) } catch { tickets = undefined }
    if (tickets === undefined) return { error: `--tickets takes a JSON array of up to ${String(RECEIPT_FIELD_LIMITS.tickets)} {id, state, title?, seat?, outcome?}` }
    fields.tickets = tickets
  }
  const seat = flag('--by')
  if (seat !== undefined) {
    const role = flag('--by-role')
    if (role !== undefined && !(SEAT_ROLES as readonly string[]).includes(role)) return { error: `--by-role takes ${SEAT_ROLES.join(', ')}` }
    const by = parseBy({ seat, name: flag('--by-name'), team: flag('--by-team'), role })
    if (by === undefined) return { error: `--by takes a seat id of at most ${String(RECEIPT_FIELD_LIMITS.short)} characters` }
    fields.by = by
  } else if (flag('--by-name') !== undefined || flag('--by-team') !== undefined || flag('--by-role') !== undefined) return { error: '--by-name, --by-team and --by-role go with --by' }
  const artifacts = flag('--artifacts')
  if (artifacts !== undefined) {
    const items = artifacts.split(',').map(item => item.trim()).filter(item => item !== '')
    const parsed = items.map(item => { const at = item.indexOf(':'); return at > 0 ? { kind: item.slice(0, at), id: item.slice(at + 1) } : undefined })
    if (items.length === 0 || items.length > RECEIPT_FIELD_LIMITS.artifacts || parsed.some(item => item === undefined || parseArtifacts([item]) === undefined)) {
      return { error: `--artifacts takes up to ${String(RECEIPT_FIELD_LIMITS.artifacts)} KIND:ID items, comma-separated` }
    }
    fields.artifacts = parsed as ReceiptArtifact[]
  }
  const id = flag('--question-id')
  if (id !== undefined) {
    if (!attention) return { error: '--question-id goes with --attention' }
    const options = flag('--options')?.split('|').map(o => o.trim()).filter(o => o !== '')
    const question = parseQuestion({ id, text, ...(options !== undefined ? { options } : {}), default: flag('--default') })
    if (question === undefined) return { error: `--question-id takes letters, digits, . _ : - (at most ${String(RECEIPT_FIELD_LIMITS.questionId)} characters)` }
    if (options !== undefined && question.options?.length !== options.length) return { error: `--options takes up to ${String(RECEIPT_FIELD_LIMITS.options)} answers of at most ${String(RECEIPT_FIELD_LIMITS.short)} characters, separated by |` }
    fields.question = question
  } else if (flag('--options') !== undefined || flag('--default') !== undefined) return { error: '--options and --default go with --question-id' }
  return { fields }
}

/** The task id a receipt rides: `ack-<task>`, `attention-<task>-<question id>` for a question, else `receipt-<task>`. */
export function receiptTaskId(task: string, disposition: ReceiptDisposition, question?: ReceiptQuestion, progress?: ReceiptProgress): string {
  if (disposition === 'progress' && progress !== undefined) return `progress-${task}-${String(progress.n)}`
  return disposition === 'acknowledged' ? `ack-${task}` : disposition === 'attention' && question !== undefined ? `attention-${task}-${question.id}` : `receipt-${task}`
}
