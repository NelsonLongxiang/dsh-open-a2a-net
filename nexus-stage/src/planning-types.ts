/**
 * Public shapes of the planning board: its input, dependencies, the
 * handler seam tests drive, and the view surface. planning-view re-exports
 * all of them, so importers keep using `./planning-view`.
 * @module nexus-stage/planning-types
 */
import type { CanvasAction } from './canvas-ops'
import type { InFlightRow, PeerRow, RemoteTeamRow } from './federation'
import type { LampState } from './layout-wire'
import type { LayoutViewport } from './viewport'
import type { SessionLite, TeamLite } from './world'

/** Minimal session/team shapes consumed here (topology rows satisfy them). */
export interface PlanningSession extends SessionLite {}
export interface PlanningTeam extends TeamLite {}

export interface PlanningInput {
  sessions: ReadonlyArray<PlanningSession>
  teams: ReadonlyArray<PlanningTeam>
  peerCount: number
  /** Federation peers (PR D): rows for the badge column right of the content. */
  peers?: ReadonlyArray<PeerRow>
  /** Pending outbound routes (PR D): the accent activity edges. */
  inFlight?: ReadonlyArray<InFlightRow>
  /** Remote team directory rows (PR D v1 ruling): grouped under peer cards. */
  remoteTeams?: ReadonlyArray<RemoteTeamRow>
  /** gh#41 fleet planning: each tracked peer's published canvas org —
   *  rendered as REMOTE team frames (read + cross-host regulation). */
  peerOrg?: ReadonlyArray<{ url: string; org: ReadonlyArray<{ name: string; team: string; members: readonly string[] }> }>
}

/** Screen-width class a viewport is remembered under (window width, not board width — collapsing the rail must not switch buckets). */
export type ViewportBucket = 'narrow' | 'medium' | 'wide'

export function viewportBucket(width: number): ViewportBucket {
  return width < 680 ? 'narrow' : width < 1024 ? 'medium' : 'wide'
}

export interface PlanningDeps {
  /** An edit that should persist happened (drag/nudge/pan/zoom/marquee end). */
  onDirty(): void
  /** The save lamp was clicked (error state -> retry). */
  onLampClick(): void
  /** Viewport size in CSS px (defaults to the root element's box; tests
   *  inject fixed sizes so fit math is assertable without layout). */
  viewSize?(): { w: number; h: number }
  /**
   * Per-device viewport memory. The saved layout's viewport is the LAST
   * saver's screen, so a desktop pan landed on a phone (and any other
   * device's save yanked this one's view). When present, the first adopted
   * layout takes this screen bucket's own viewport — else, on a wide screen,
   * the host's (where it was most likely saved), else a fit — later
   * adoptions leave the viewport alone, and every persisted edit writes the
   * bucket back. Optional: without it the host viewport wins as before.
   */
  viewportStore?: { get(bucket: ViewportBucket): unknown; set(bucket: ViewportBucket, vp: LayoutViewport): void }
  /**
   * A team write action (optimistic state already applied by the view).
   * Resolves true when the host accepted it — or it was an idempotent
   * no-op (ok:false without an error string). Resolves false when the
   * write was refused/failed: the view then rolls the action's scoped
   * undo back itself. Rejecting the promise is also handled (treated as
   * false) — the channel must not leave the team's guard pinned.
   */
  onCanvasAction(a: CanvasAction): Promise<boolean>
  /** A plain (non-shift, no-drag) left click selected exactly one node
   * (0.6.13): the host may open the reading face (chat drawer) for it.
   * Selection itself is already applied — this is a notification, not a
   * command; the host decides what (if anything) to show. */
  onNodePick?(id: string): void
  /** Wall clock for the inFlight age labels (tests pin it; default Date.now). */
  now?(): number
}

/** Pointer-like event surface the handlers consume (real events satisfy it). */
export interface SeamPointer {
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  clientX: number
  clientY: number
  pointerId?: number
  target: Element | null
  deltaX?: number
  deltaY?: number
  deltaMode?: number
  preventDefault(): void
}

export interface SeamKey { key: string; shiftKey: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; target: Element | null; preventDefault(): void }

export interface PlanningView {
  root: HTMLElement
  reconcile(input: PlanningInput): void
  activate(): void
  deactivate(): void
  /** Adopt a (possibly normalized) layout document when the save loop allows. */
  adoptExternalLayout(layout: unknown): void
  /** The current document for the save loop, read at send time. */
  snapshotDoc(): unknown
  setLamp(state: LampState, savedAt?: string): void
  /** A transient notice (host error verbatim or an info hint). */
  notice(kind: 'error' | 'info', text: string): void
  seam: {
    pointerDown(ev: SeamPointer): void
    pointerMove(ev: SeamPointer): void
    pointerUp(ev: SeamPointer): void
    pointerCancel(ev: SeamPointer): void
    wheel(ev: SeamPointer): void
    key(ev: SeamKey): void
    keyUp(ev: SeamKey): void
    contextMenu(ev: SeamPointer): void
  }
  destroy(): void
}
