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

/** Controlled outcome vocabulary — the ONLY branchable field of an envelope. */
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

const KNOWN_ENVELOPE_KEYS: readonly string[] = ['outcome', 'idempotencyKey', 'sessionKey', 'elapsedMs', 'artifacts', 'onBehalfOf', 'authRef']
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
  const keys = Object.keys(ordered)
  if (keys.length === 0) return header
  return `${header}\n${JSON.stringify(ordered)}`
}
