/**
 * #881 v2 B2: the network ledger's verdict on a receipt, as the team reads it from the Trigger (a2a-watch carries the
 * mailbox row's `settlement` into `meta.settlement`). A final answer counts only when the ledger settled it with this
 * receipt (`settled`); an interim one only when the ledger marked the owed row with it (`held`). Anything else — a
 * refusal such as settler-off-chain, a task another receipt settled, a verdict still pending, or none at all — is kept as
 * an anomaly for the health view and never written into the ticket as an answer.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/receipt-settlement
 */
import type { Trigger } from '../upstream/dsh-superagent/src/core/index.ts'

/** A receipt the ledger did not settle positively: what the team keeps of it (never its text). */
export interface UnsettledReceipt { readonly key: string; readonly at: string; readonly settlement: string; readonly reason?: string }

/** How many unsettled receipts one record keeps (newest last): enough to show, bounded so the file never grows with them. */
export const UNSETTLED_KEEP = 3

/** The receipt's standing: positive for its kind, or the anomaly to keep. */
export function receiptStanding(trigger: Pick<Trigger, 'id' | 'at' | 'meta'>, interim: boolean): { ok: true } | { ok: false; unsettled: UnsettledReceipt } {
  const settlement = trigger.meta.settlement, reason = trigger.meta.settlementReason
  if (settlement === (interim ? 'held' : 'settled')) return { ok: true }
  return { ok: false, unsettled: { key: trigger.id, at: trigger.at, settlement: typeof settlement === 'string' ? settlement : 'absent', ...(typeof reason === 'string' && reason !== '' ? { reason } : {}) } }
}

/** The kept list with one more anomaly: a replay of the same Trigger adds nothing; the oldest falls off past the bound. */
export function keepUnsettled(list: readonly UnsettledReceipt[] | undefined, entry: UnsettledReceipt): UnsettledReceipt[] {
  const kept = (list ?? []).filter(e => e.key !== entry.key)
  return [...kept, entry].slice(-UNSETTLED_KEEP)
}

/** One line for the owner: the verdict and its reason. */
export const unsettledText = (u: UnsettledReceipt): string => u.reason !== undefined ? `${u.settlement}（${u.reason}）` : u.settlement
