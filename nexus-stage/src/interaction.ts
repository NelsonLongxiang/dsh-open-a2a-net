/**
 * Interaction + motion seams (gates 1/3/4) — IMPORTED AND CALLED BY main.ts.
 * These are not test doubles: main.ts wires its real state through them.
 *
 * Gate 1: keyboard seam shared by the stage keydown listener.
 * Gate 3: reduced-motion loop that never auto-ticks; renders happen only via
 *         explicit renderOnce() calls driven by controls change or a cycle.
 * Census: aria census formatter for the canvas surface (gate 2).
 */

/** Minimal state surface main.ts wires into the keyboard handler. */
export interface KeyboardSeam {
  /** Currently pinned session id (undefined = none). */
  pinned(): string | undefined
  /** Ids in pin order (the cycle domain). */
  ids(): readonly string[]
  /** Advance: pin the id after `current` (wraps). Returns the new id. */
  nextAfter(current: string | undefined): string | undefined
  /** Pin a session and update the inspector. */
  pin(id: string): void
  /** Unpin, update the inspector, and return focus to the stage surface. */
  escape(): void
}

/**
 * The stage keydown handler. Escape unpins AND focuses the stage surface
 * (the focus-return contract — the handler itself calls focus(), tests spy
 * on the focus target). Enter/Tab cycle the pinned id with wrap-around.
 */
export function createStageKeyboardHandler(
  seam: KeyboardSeam,
  focusTarget: { focus(): void },
): (ev: { key: string; preventDefault(): void }) => void {
  return (ev) => {
    if (ev.key === 'Escape') {
      seam.escape()
      focusTarget.focus()
      return
    }
    if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault()
      const next = seam.nextAfter(seam.pinned())
      if (next !== undefined) seam.pin(next)
    }
  }
}

/** The reduced-motion loop contract: never auto-ticks; renderOnce on demand. */
export interface ReducedMotionLoop {
  isTicking(): boolean
  renderOnceCount(): number
  renderOnce(): void
}

/**
 * Wire the reduced-motion rendering path THE WAY main.ts runs it:
 * controls 'change' and every settled cycle call renderOnce(); no rAF loop.
 * Returns the loop plus the single renderOnce main.ts passes to cycle().
 */
export function wireReducedRendering(
  controls: { addEventListener(type: 'change', listener: () => void): void },
  renderOnce: () => void,
): ReducedMotionLoop {
  let renders = 0
  controls.addEventListener('change', () => { renderOnce() })
  return {
    isTicking: () => false,
    renderOnceCount: () => renders,
    renderOnce: () => { renders += 1; renderOnce() },
  }
}

/** Census entry: one joined session rendered as a canvas aria entry. */
export interface CensusRow {
  id: string
  label: string
  team: string
  live: boolean
}

/**
 * Format the canvas aria census (gate 2): one line per joined session,
 * deterministic order (input order), live/cold suffix.
 */
export function formatCensus(rows: readonly CensusRow[]): string {
  return rows
    .map(r => `${r.label} (${r.team}) ${r.live ? 'live' : 'cold'}`)
    .join('; ')
}
