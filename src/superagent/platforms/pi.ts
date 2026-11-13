/**
 * docs/design/superagent-pi-platform.md (PR-B): a Pi seat is a CLI identity that declares `capabilities.piSeat` on its
 * own signed card. It joins a superagent team's canvas as a member (R4 as revised by P1), with the deposit's key pinned
 * on its canvas row (P2). Its work arrives in its CLI mailbox (P3) and its reports come back as CLI-signed ops on the
 * team face (P4). This module holds the platform's own rules; `host/index.ts` and the wiring only route to it.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/platforms/pi
 */
import { CLI_HANDLE_RE } from '../../cli-deposit.ts'

/** The capability a Pi seat declares on its own signed card (inside the signed core, so no one else can add it). */
export const PI_SEAT_CAPABILITY = 'piSeat'
/** The platform tag a Pi seat's member row carries. */
export const PI_PLATFORM = 'pi'

/** What the host knows of a CLI deposit held here. */
export interface PiDeposit { readonly cardJson: string }

/** The deposit card's public key and whether it declares the Pi seat capability. */
export function piCardOf(cardJson: string): { key?: string; piSeat: boolean } {
  try {
    const card = JSON.parse(cardJson) as { publicKey?: unknown; capabilities?: Record<string, unknown> } | null
    return { ...(typeof card?.publicKey === 'string' ? { key: card.publicKey } : {}), piSeat: card?.capabilities?.[PI_SEAT_CAPABILITY] === true }
  } catch { return { piSeat: false } }
}

/**
 * P1/P2: whether a CLI handle may join a team canvas as a Pi seat, and the key to pin. Only a live deposit on this host
 * counts (the team host is the seat's home; another home is not supported in this version).
 * @param handle - the CLI handle being added.
 * @param deposit - its deposit on this host, if any.
 * @returns the key to pin, or why it is refused.
 */
export function piSeatAdmission(handle: string, deposit: PiDeposit | undefined): { ok: true; key: string } | { ok: false; error: string } {
  if (!CLI_HANDLE_RE.test(handle)) return { ok: false, error: `${handle} is not a CLI handle` }
  if (deposit === undefined) return { ok: false, error: `[pi-seat] ${handle} has no deposit on this host: a Pi seat must be deposited on the team host (home = this host); another home is not supported in this version` }
  const card = piCardOf(deposit.cardJson)
  if (!card.piSeat || card.key === undefined) return { ok: false, error: `[pi-seat] ${handle} is a CLI handle that is not a Pi seat: its card does not declare capabilities.${PI_SEAT_CAPABILITY}` }
  return { ok: true, key: card.key }
}

/**
 * P3: whether a mailbox delivery to a Pi seat may go ahead — its deposit is still here and still under the pinned key.
 * A lapsed, removed or re-keyed seat gets nothing (the executor records the failed delivery); a re-keyed seat must be
 * added to the canvas again by the owner to pin the new key.
 */
export function piDeliverable(deposit: PiDeposit | undefined, pinnedKey: string): boolean {
  if (deposit === undefined) return false
  const card = piCardOf(deposit.cardJson)
  return card.piSeat && card.key === pinnedKey
}

/** P3: the Pi variant of a member card: how to answer is a CLI command, not the `a2a_ticket_report` model tool. */
export function piCardText(text: string, kind: 'assign' | 'input' | 'stop', ticketId: string): string {
  if (kind === 'stop') return text
  return `${text}

[pi seat] Answer with the a2a-net CLI, signed as this seat (the model tools named above are not available here):
  a2a-net ticket read --ticket ${ticketId}
  a2a-net ticket ack|handback --trigger <trigger_id> -- <text>
  a2a-net ticket report --ticket ${ticketId} --state progress|waiting|ready|blocked|failed|dropped -- <summary>
  a2a-net ticket idle | a2a-net ticket error -- <what failed>`
}
