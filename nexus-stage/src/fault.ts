/**
 * The stage's fault surface as pure logic: whoever calls {@link fault}
 * gets the newest message on the sink immediately, while the diagnostic
 * log line is throttled to one per window (the N2 breadcrumb cadence).
 * {@link clear} hides the sink and resets the throttle clock, so the first
 * fault after a healthy stretch logs promptly again.
 *
 * DOM-free on purpose: the browser shell in main.ts supplies the sink, and
 * the unit test supplies fakes — the lifecycle (sink-always-current,
 * log-throttled, clear-resets) is what the regression net owns. This module
 * exists because the incident class it guards against (a catch burying a
 * ReferenceError behind a healthy render loop) shipped once already.
 * @module nexus-stage/fault
 */

/** How long one diagnostic log line suppresses its successors. */
export const FAULT_LOG_THROTTLE_MS = 60_000

/** Anything the fault reporter can render onto. */
export interface FaultSink {
  /** Surface the newest fault; the sink becomes visible with this text. */
  show(message: string): void
  /** Retract the sink after a healthy response. */
  hide(): void
}

export interface FaultReporter {
  /** Surface a fault: the sink always updates, the log line throttles. */
  fault(message: string): void
  /** A healthy response arrived: hide the sink and reset the throttle. */
  clear(): void
}

/**
 * @param sink - render target (DOM badge in the shell, recording fake in tests).
 * @param log - diagnostic channel (console.error in the shell, spy in tests).
 * @param now - injectable clock for deterministic throttle tests. A fault
 *   exactly one window after the previous logs again (window is inclusive).
 */
export function createFaultReporter(sink: FaultSink, log: (message: string) => void, now: () => number = Date.now): FaultReporter {
  let lastLoggedAt = -FAULT_LOG_THROTTLE_MS
  return {
    fault(message) {
      const at = now()
      if (at - lastLoggedAt >= FAULT_LOG_THROTTLE_MS) {
        log(`[nexus] ${message}`)
        lastLoggedAt = at
      }
      sink.show(message)
    },
    clear() {
      sink.hide()
      lastLoggedAt = -FAULT_LOG_THROTTLE_MS
    },
  }
}
