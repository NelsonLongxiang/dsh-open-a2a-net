/**
 * Whether the plugin's context can still use its services. A fiber whose injected service went away is inactive: its
 * store is gone while its uid stays, so `uid !== null` alone lets a late callback reach for `ctx.timer` and throw
 * "cannot get required service … in inactive context" — which, in a loader callback, takes the whole host down
 * (3084, 2026-11-12, after a team settings write). A late callback checks this and gives up; the fiber's next activation
 * runs the plugin again and redoes the work.
 * @module @nelsonlongxiang/dsh-open-a2a-net/context-live
 */
export interface FiberLike { readonly fiber: { readonly uid: number | null; readonly store?: object } }

export const contextLive = (ctx: FiberLike): boolean => ctx.fiber.uid !== null && ctx.fiber.store !== undefined
