/**
 * Test host, 2026-11-12: a team settings write made the host reload while the plugin's loader callback was pending. The
 * plugin fiber went inactive (a service it injects was swapped) but kept its uid, so the callback's `uid !== null` check
 * passed; it reached for `ctx.timer` and threw "cannot get required service "timer" in inactive context" — inside a
 * loader callback, a fatal load failure for the whole host. Whether a fiber is active is not readable from outside the
 * host's cordis, so the late callback catches this one error and gives up; the fiber's next activation redoes the work.
 * @module @nelsonlongxiang/dsh-open-a2a-net/context-live
 */
export const inactiveContextError = (error: unknown): boolean => error instanceof Error && /\bin inactive context\b/.test(error.message)
