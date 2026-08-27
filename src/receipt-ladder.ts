/**
 * Receipt delivery three-tier hard order (work-order P2 / B1 residual):
 * caller lane first; if it fails, escalate ONCE to the owner mailbox so the
 * outcome still lands somewhere answerable on this host; total failure stays
 * a breadcrumb (correlation & archive remain the authoritative truth).
 *
 * Extracted pure so the ladder is unit-drivable without live agents.
 * @module @nelsonlongxiang/dsh-open-a2a-net/receipt-ladder
 */

/** Everything the ladder needs from its host — all seams, zero globals. */
export interface ReceiptLadderDeps {
  /** Try delivering the receipt text to one routable team. */
  deliver: (team: string) => Promise<unknown>
  /** This host's process/team mailbox (tier two). */
  ownerTeam: string
  /** Observability hook: `stage` distinguishes `to <team>` / `to owner <team>` / `both lanes`. */
  log: (stage: string, error: unknown) => void
}

/**
 * Attempt delivery through the ladder.
 * @param callerTeam - tier-one target (`callbackTarget`). When it already IS
 * the owner team, a failure terminates after tier one — escalating to
 * yourself would just double the noise.
 */
export async function runReceiptLadder(deps: ReceiptLadderDeps, callerTeam: string): Promise<void> {
  try {
    await deps.deliver(callerTeam)
    return
  } catch (error) {
    deps.log(`to ${callerTeam}`, error)
    if (callerTeam === deps.ownerTeam) throw error
  }
  try {
    await deps.deliver(deps.ownerTeam)
    return
  } catch (error) {
    deps.log(`to owner ${deps.ownerTeam}`, error)
    deps.log('both lanes', error)
    throw error
  }
}
