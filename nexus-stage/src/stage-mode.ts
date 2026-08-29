/**
 * Boot deep-link for the stage: `?mode=plan` on the stage URL lands the
 * viewer on the 2D planning canvas (the A2A network panel's 规划 link);
 * anything else keeps the 3D observation landing. Pure and URL-shaped so
 * the root suite pins it without a DOM.
 * @module nexus-stage/stage-mode
 */

/** The stage mode a boot URL asks for. */
export type StageMode = 'scene' | 'plan'

/**
 * Parse one location.search string into the boot mode. Only the exact
 * value `plan` selects planning; every other spelling (or absence) keeps
 * the observation landing — a typo must not strand a viewer in a mode the
 * host may not even serve (the poll's face guard flips back anyway, but
 * never selecting it up front avoids the flash entirely).
 */
export function requestedBootMode(search: string): StageMode {
  return new URLSearchParams(search).get('mode') === 'plan' ? 'plan' : 'scene'
}
