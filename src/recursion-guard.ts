/**
 * Recursion guard (#60, first step: the hop budget) per
 * docs/protocol/recursion-guard.md. State rides the payload: the origin
 * mints the envelope with a full budget, every forwarded leg decrements,
 * and a zero-budget arrival is refused with a STRUCTURED budget-exhausted
 * error — silent swallowing is forbidden. The visited set (protocol §4.3)
 * is the SECOND step and is deliberately absent here.
 *
 * Wire form: the X-A2A-Guard header carries a base64 JSON payload
 * { visitToken, hopBudget, deadlineAt? }. An ABSENT header means a
 * non-forwarding origin: the receiver grants the default one-shot budget
 * and records guardMode 'default' (protocol §6 — old peers are
 * constrained, not broken). Parse cost is O(1) for the budget path.
 * @module @nelsonlongxiang/dsh-open-a2a-net/recursion-guard
 */

export const DEFAULT_HOP_BUDGET = 4
/** Wire code for a zero-budget arrival (cluster-C registry, after -32006). */
export const WIRE_ERROR_BUDGET_EXHAUSTED = -32007

/** The guard payload as it travels on the wire. */
export interface RecursionGuard {
  readonly visitToken: string
  readonly hopBudget: number
  readonly deadlineAt?: number
}

export type GuardVerdict =
  | { readonly kind: 'ok'; readonly guard: RecursionGuard; readonly mode: 'explicit' | 'default' }
  | { readonly kind: 'budget-exhausted' }

/**
 * Ingress check: parse the header, validate the budget, fail closed. A
 * malformed payload falls back to the default budget (a guard that cannot
 * be evaluated must not reject honest first-hop traffic; the budget bound
 * still applies). hopBudget <= 0 on arrival ⇒ budget-exhausted.
 */
export function checkGuardAtIngress(header: string | undefined): GuardVerdict {
  if (header === undefined || header === '') {
    return { kind: 'ok', guard: { visitToken: '', hopBudget: DEFAULT_HOP_BUDGET }, mode: 'default' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
  } catch {
    return { kind: 'ok', guard: { visitToken: '', hopBudget: DEFAULT_HOP_BUDGET }, mode: 'default' }
  }
  const hopBudget = (parsed as { hopBudget?: unknown } | null)?.hopBudget
  if (typeof hopBudget !== 'number' || !Number.isInteger(hopBudget)) {
    return { kind: 'ok', guard: { visitToken: '', hopBudget: DEFAULT_HOP_BUDGET }, mode: 'default' }
  }
  if (hopBudget <= 0) return { kind: 'budget-exhausted' }
  const visitToken = typeof (parsed as { visitToken?: unknown }).visitToken === 'string'
    ? String((parsed as { visitToken: string }).visitToken)
    : ''
  const deadlineRaw = (parsed as { deadlineAt?: unknown }).deadlineAt
  return {
    kind: 'ok',
    guard: { visitToken, hopBudget, ...(typeof deadlineRaw === 'number' ? { deadlineAt: deadlineRaw } : {}) },
    mode: 'explicit',
  }
}

/** Mint the outbound guard for a first-hop dispatch (full budget at origin). */
export function mintGuard(): RecursionGuard {
  return {
    visitToken: Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
    hopBudget: DEFAULT_HOP_BUDGET,
  }
}

/** Serialize for the X-A2A-Guard header. */
export function guardHeader(guard: RecursionGuard): string {
  return Buffer.from(JSON.stringify(guard), 'utf8').toString('base64')
}

/**
 * The ingress refusal path (gh#60): budget-exhausted answers the structured
 * error, records the receiptless ledger row, and reports true (the caller
 * returns). The whole response lives here so the ingress seam stays ONE
 * line (the index.ts ratchet pays-as-it-goes: no net line growth).
 */
export function refuseIfBudgetExhausted(
  req: { headers: Record<string, unknown> },
  res: { writeHead: (status: number, headers: Record<string, string | number>) => void; end: (body: string) => void },
  team: string, caller: string, taskId: string,
  ledger: { trackReceiptless: (taskId: string, team: string, peer: string, contextId?: string, brief?: string) => void },
): boolean {
  const verdict = checkGuardAtIngress(req.headers['x-a2a-guard'] as string | undefined)
  if (verdict.kind !== 'budget-exhausted') return false
  ledger.trackReceiptless(taskId, team, caller === '' ? 'unknown' : caller, undefined, 'budget-exhausted at ingress (hopBudget=0)')
  const payload = JSON.stringify({ error: 'budget-exhausted: the hop budget is spent (recursion-guard #60) — this delivery traversed its full forwarding allowance and is refused at ingress', code: WIRE_ERROR_BUDGET_EXHAUSTED, team, task_status: 'TASK_STATE_FAILED' })
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
  return true
}
