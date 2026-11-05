/** Host-specific badge projection only. Never use this to admit callers or choose CLI homes. */
import type { A2aPeerCard } from './types.ts'
export function peerLinkDisplay(peerUrl: string, d: {
  readonly card: A2aPeerCard | undefined
  readonly ownUrl: string
  /** Display aliases only; not an authorization or CLI-home proof. */
  readonly ownAudiences?: readonly string[]
  readonly seeds: readonly string[]
  readonly refs: readonly string[]
  readonly ownHandles: ReadonlySet<string>
  readonly cards: readonly A2aPeerCard[]
}): { link: 'linked' | 'stranger'; verified: boolean } {
  const { card } = d
  if (card === undefined) return { link: 'stranger', verified: false }
  const origin = (url: string): string => { try { return new URL(url).origin } catch { return '' } }
  const peerOrigin = origin(peerUrl)
  const ownOrigins = new Set([d.ownUrl, ...d.ownAudiences ?? []].map(origin).filter(value => value !== ''))
  const bilateral = peerOrigin !== '' && d.seeds.some(url => origin(url) === peerOrigin) && (card.peers ?? []).some(url => ownOrigins.has(origin(url)))
  const exactMember = d.refs.some(ref => !d.ownHandles.has(ref) && (card.sessionTeams ?? []).some(row => row.team === ref) && !d.cards.some(other => other.publicKey !== card.publicKey && (other.sessionTeams ?? []).some(row => row.team === ref)))
  return { link: bilateral || exactMember ? 'linked' : 'stranger', verified: true }
}
