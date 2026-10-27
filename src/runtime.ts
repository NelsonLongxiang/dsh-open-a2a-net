/**
 * Shared A2A runtime types (gh#77): shapes that used to be declared inside
 * `apply()` and are now read by the face modules as well.
 * @module src/runtime
 */
import type { A2aPeerCard } from './types.ts'

/**
 * Recent routing activity for the network panel: a bounded ring of the
 * latest inbound and outbound route outcomes, newest last. The state route
 * serves a copy; the panel derives unread badges from new entries.
 */
export interface RouteActivityEntry {
  readonly ts: number
  readonly dir: 'in' | 'out'
  readonly team: string
  readonly peer: string
  readonly ok: boolean
}

/**
 * In-flight outbound routes: a route registers on dial and unregisters on
 * settlement, so the panel can show collaboration in progress ("who is
 * waiting on whom") — the state route serves a snapshot.
 */
export interface InFlightRoute {
  readonly id: number
  readonly team: string
  readonly peer: string
  readonly startedAt: number
}

/** One peer-card cache entry: when it was fetched and what came back. */
export interface CardCacheEntry { at: number; card: A2aPeerCard | undefined }
