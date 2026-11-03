import { CLI_HANDLE_RE } from './cli-deposit.ts'
import type { A2aPeerCard } from './types.ts'

/** A verified, operator-linked host's full card at link time. */
export interface CliHomeCandidate { readonly url: string; readonly linked: boolean; readonly card?: A2aPeerCard }
export type CliHomeDecision = { readonly ok: true; readonly home?: string } | { readonly ok: false; readonly error: string }

/** Count origins, not URL aliases: two card URLs on one host are one home. */
export function decideCliHome(handle: string, requested: unknown, candidates: readonly CliHomeCandidate[]): CliHomeDecision {
  if (!CLI_HANDLE_RE.test(handle)) return requested === undefined ? { ok: true } : { ok: false, error: 'home is only valid for a CLI handle' }
  const homes = new Set<string>()
  for (const row of candidates) {
    if (!row.linked || !row.card?.sessionTeams?.some(t => t.team === handle)) continue
    try { homes.add(new URL(row.url).origin) } catch { /* not a host card URL */ }
  }
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !(requested.startsWith('http://') || requested.startsWith('https://')) || !homes.has(requested)) return { ok: false, error: 'home must be a linked host that currently lists this CLI handle' }
    return { ok: true, home: requested }
  }
  return homes.size === 1 ? { ok: true, home: [...homes][0]! } : { ok: true }
}
