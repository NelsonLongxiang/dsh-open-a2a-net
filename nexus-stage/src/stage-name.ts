/**
 * Display name for one stage node: the session title when present, then the
 * routable team label (`team/<id8>`), then the host fallback label
 * (`dsh-host-<node>-<id8>`). Untitled cold joined sessions carry no title and
 * without the middle step the canvas drowned in dsh-host-* noise (2026-08-30
 * user report: the planning canvas showed a dozen unreadable label cards).
 * @module nexus-stage/stage-name
 */

/** One node's display title. */
export function displayName(node: { readonly name?: string; readonly team?: string; readonly label?: string }): string {
  return node.name ?? node.team ?? node.label ?? ''
}
