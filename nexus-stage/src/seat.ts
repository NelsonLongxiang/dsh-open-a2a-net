/**
 * Deterministic fallback seating: a session id hashes to a stable polar
 * seat, so a reload reproduces the same star map even when no layout is
 * persisted (saved layouts still win - main.ts checks them first). This
 * replaces three Math.random() calls whose only product was a star map
 * that reshuffled on every reload, making screenshots and sessions
 * incomparable. Same hash family as getHue (FNV-1a 32-bit); zero
 * dependencies so the unit test pins stability/bounds without three.
 * @module nexus-stage/seat
 */

/** Radial distance bounds, mirroring the historical random-seat envelope. */
export const SEAT_DIST_MIN = 12
export const SEAT_DIST_MAX = 30
/** Vertical jitter bound in world units above/below the grid plane. */
export const SEAT_Y_SPAN = 1

/** FNV-1a 32-bit - the same determinism family as getHue. */
export function hashId(sid: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < sid.length; i++) {
    h ^= sid.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Deterministic world seat (x, vertical jitter, z) for one session id. */
export function seatFor(sid: string): { x: number; y: number; z: number } {
  const h = hashId(sid)
  const angle = ((h % 3600) / 3600) * Math.PI * 2
  const dist = SEAT_DIST_MIN + (((h >>> 9) % 1800) / 1800) * (SEAT_DIST_MAX - SEAT_DIST_MIN)
  const y = (((h >>> 18) % 2000) / 1999) * 2 * SEAT_Y_SPAN - SEAT_Y_SPAN
  return { x: Math.cos(angle) * dist, y, z: Math.sin(angle) * dist }
}
