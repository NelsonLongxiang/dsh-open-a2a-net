/** Level-of-detail gating for the nexus stage: camera distance decides how
 *  much annotation weight each node carries (far = shapes only, mid = +labels,
 *  near = +inspector detail). Callers re-evaluate every render tick. */

export type Lod = 'far' | 'mid' | 'near'

export function lodFor(camDist: number): Lod {
  if (camDist > 90) return 'far'
  if (camDist > 45) return 'mid'
  return 'near'
}

/** Match-media probe: reduced-motion users get a static-equivalent stage
 *  (no per-frame drift, render on demand). Exposed for tests. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
