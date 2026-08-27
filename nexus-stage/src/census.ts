/**
 * Production census writer (gate 2): formats the joined-session census via
 * topology.formatCensus and writes it to the canvas aria-label. main.ts
 * cycle() calls this every poll; tests drive it with two distinct states and
 * assert the DOM attribute actually changed (DOM-level, not formatter unit).
 */
import { setAriaLabel } from './overlay'
import { formatCensus } from './topology'

export function updateCensus(
  canvas: HTMLCanvasElement,
  sessions: readonly { live?: boolean }[],
  teams: readonly { name: string }[],
  peers: readonly unknown[],
): void {
  setAriaLabel(canvas, formatCensus(sessions, teams, peers))
}
