import { CLI_HANDLE_RE } from './cli-deposit.ts'
import type { A2aPeerCard } from './types.ts'

/** A verified, operator-linked host's full card at link time. */
export interface CliHomeCandidate { readonly url: string; readonly linked: boolean; readonly card?: A2aPeerCard }
/** Canonical root HTTP(S) origin; address aliases remain distinct trust decisions. */
export function cliHomeOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : undefined
  } catch { return undefined }
}
export type CliHomeDecision = { readonly ok: true; readonly home?: string } | { readonly ok: false; readonly error: string }

/** Read-only projection of the same fresh evidence used by explicit home validation. */
export function cliHomeChoices(handle: string, candidates: readonly CliHomeCandidate[]): { homes: string[]; unreadable: number } {
  const homes = new Set<string>()
  for (const row of candidates) {
    if (!row.linked || !row.card?.sessionTeams?.some(t => t.team === handle)) continue
    try { homes.add(new URL(row.url).origin) } catch { /* not a host card URL */ }
  }
  return { homes: [...homes], unreadable: candidates.filter(row => row.card === undefined).length }
}

/** Count origins, not URL aliases: two card URLs on one host are one home. */
export function decideCliHome(handle: string, requested: unknown, candidates: readonly CliHomeCandidate[]): CliHomeDecision {
  if (!CLI_HANDLE_RE.test(handle)) return requested === undefined ? { ok: true } : { ok: false, error: 'home is only valid for a CLI handle' }
  const homes = new Set(cliHomeChoices(handle, candidates).homes)
  if (requested !== undefined) {
    const origin = cliHomeOrigin(requested)
    if (origin === undefined || !homes.has(origin)) return { ok: false, error: 'home must be a linked host that currently lists this CLI handle' }
    return { ok: true, home: origin }
  }
  // An unreadable linked host may be another home; lack of evidence is not absence.
  return !candidates.some(row => row.linked && row.card === undefined) && homes.size === 1 ? { ok: true, home: [...homes][0]! } : { ok: true }
}
