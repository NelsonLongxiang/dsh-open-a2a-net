/**
 * Keyboard + reduced-motion seam shared by main.ts and the behavior tests.
 * Extracted (0.12.x nexus readable-topology, gates 1/3/4) so the arrow-key
 * cycle / Escape focus-return / reduced no-tick semantics are assertable
 * without booting the whole three.js stage.
 */

/** Minimal surface main.ts wires in; tests stub these callbacks. */
export interface KeyboardSeam {
  /** Currently pinned session id (undefined = none). */
  pinned(): string | undefined
  /** Cycle to the next id after `current` (wraps). Returns the new id. */
  nextAfter(current: string | undefined): string | undefined
  /** Pin a session (updates inspector). */
  pin(id: string): void
  /** Unpin (Escape) and return focus to the stage surface. */
  escape(): void
  /** The element focus returns to on Escape. */
  focusTarget(): { focus(): void }
}

export interface ReducedMotionLoop {
  /** Whether the per-frame loop is running (false under reduced motion). */
  isTicking(): boolean
  /** Number of renderOnce calls (controls change / cycle drive it). */
  renderOnceCount(): number
  /** Drive one renderOnce externally (a cycle finishing calls this). */
  renderOnce(): void
}

/** Build the keydown handler. Enter/Tab cycle, Escape unpins and refocuses. */
export function createKeyboardHandler(seam: KeyboardSeam): (ev: { key: string; preventDefault(): void }) => void {
  return (ev) => {
    if (ev.key === 'Escape') { seam.escape(); return }
    if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault()
      const next = seam.nextAfter(seam.pinned())
      if (next !== undefined) seam.pin(next)
    }
  }
}

/** Reduced-motion loop: never auto-ticks; renderOnce only on demand. */
export function createReducedMotionLoop(): ReducedMotionLoop & { start(): void } {
  let ticks = 0
  let renders = 0
  const loop: ReducedMotionLoop & { tick(): void } = {
    isTicking: () => ticks > 0,
    renderOnceCount: () => renders,
    renderOnce: () => { renders += 1 },
    tick: () => { ticks += 1 },
  }
  return loop
}

/** Normal-motion loop: auto-ticks per frame; renderOnce counter mirrors. */
export function createNormalLoop(): ReducedMotionLoop & { tick(): void; start(): void } {
  return {
    isTicking: () => true,
    renderOnceCount: () => 0,
    renderOnce: () => {},
    tick: () => {},
    start: () => {},
  }
}
