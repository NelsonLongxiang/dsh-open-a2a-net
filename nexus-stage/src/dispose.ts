/**
 * Explicit GPU-side release for rebuilt batches: Group.clear() only detaches
 * children, so the per-edge BufferGeometry allocations survive until
 * disposed - a polling rebuild without this leaks GPU buffers linearly with
 * page uptime. Structural typing keeps the helper DOM/THREE-free and unit
 * testable; THREE.Line satisfies the shape.
 * @module nexus-stage/dispose
 */

/** Minimal shape of a mesh-like child whose geometry can be released. */
interface Disposable {
  readonly geometry?: { dispose(): void }
}

/**
 * Release every geometry-bearing child.
 * @returns how many geometries were disposed.
 */
export function disposeGeometries(children: ReadonlyArray<unknown>): number {
  let disposed = 0
  for (const child of children) {
    const geometry = (child as Disposable).geometry
    if (geometry !== undefined) {
      geometry.dispose()
      disposed += 1
    }
  }
  return disposed
}
