/** Level-of-detail gating for the nexus stage: camera distance decides how
 *  much annotation weight each node carries (far = shapes only, mid = +labels,
 *  near = +inspector detail). */

export type Lod = 'far' | 'mid' | 'near'

export function lodFor(camDist: number): Lod {
  if (camDist > 90) return 'far'
  if (camDist > 45) return 'mid'
  return 'near'
}

export const LOD_HYSTERESIS = 6

/** Stateful hysteresis machine: transitions require crossing the boundary by
 *  more than LOD_HYSTERESIS; within the band the previous state sticks. */
export class LodMachine {
  private state: Lod = 'mid'

  get current(): Lod { return this.state }

  update(camDist: number): Lod {
    const nearEdge = 45 - LOD_HYSTERESIS
    const nearEdgeBack = 45 + LOD_HYSTERESIS
    const farEdge = 90 + LOD_HYSTERESIS
    const farEdgeBack = 90 - LOD_HYSTERESIS
    if (this.state === 'near' && camDist > nearEdgeBack) this.state = 'mid'
    else if (this.state === 'mid') {
      if (camDist < nearEdge) this.state = 'near'
      else if (camDist > farEdgeBack) this.state = 'far'
    } else if (this.state === 'far' && camDist < farEdge) this.state = 'mid'
    return this.state
  }

  reset(state: Lod = 'mid'): void { this.state = state }
}

/** Match-media probe: reduced-motion users get a static-equivalent stage
 *  (no per-frame drift, render on demand). Exposed for tests. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
