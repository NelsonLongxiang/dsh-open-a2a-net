/**
 * The board's 适配 (fit) framing (review 2026-10-27).
 *
 * 适配 used to fit the local content into the whole board at any scale: a
 * small board zoomed to 167%, the top frame's title slid under the toolbar,
 * and the peer cards on the right were cut off. 适配 now frames what the
 * first-run fit frames:
 * - local content plus the peer cards;
 * - the frame titles that sit above their frames;
 * - never magnified past 100%;
 * - the area below the HUD (toolbar / status chip), not under it.
 * @module nexus-stage/planning-fit
 */
import { FRAME_HEAD_TOP } from './edges'
import { fitView, type LayoutViewport, type WorldBounds } from './viewport'
import { nodeRect, type WorldNode } from './world'

/** Local content bounds ∪ peer cards, lifted to include the frame titles
 *  (a title straddles its frame's top border, FRAME_HEAD_TOP above it). */
export function boardBounds(content: WorldBounds | null, nodes: Iterable<WorldNode>): WorldBounds | null {
  let b = content === null ? null : { ...content, minY: content.minY + FRAME_HEAD_TOP }
  for (const n of nodes) {
    if (n.remote !== true) continue
    const r = nodeRect(n)
    b = b === null
      ? { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h }
      : { minX: Math.min(b.minX, r.x), minY: Math.min(b.minY, r.y), maxX: Math.max(b.maxX, r.x + r.w), maxY: Math.max(b.maxY, r.y + r.h) }
  }
  return b
}

/** Fit `bounds` at ≤100% into the board area below the HUD's bottom edge
 *  (`hudBottom` px from the board's top; 0 when the HUD is not laid out). */
export function fitBelowHud(bounds: WorldBounds | null, viewW: number, viewH: number, hudBottom: number): LayoutViewport {
  const inset = hudBottom > 0 && hudBottom < viewH / 2 ? hudBottom : 0
  const vp = fitView(bounds, viewW, viewH - inset, 1)
  return inset === 0 || bounds === null ? vp : { ...vp, y: vp.y - inset / vp.scale }
}

/** The HUD's bottom edge inside the board root: the lowest of the toolbar
 *  and status chip, plus a small gap; 0 before layout (jsdom, hidden). */
export function hudBottomOf(...els: ReadonlyArray<HTMLElement>): number {
  const bottom = Math.max(0, ...els.map(e => e.offsetHeight > 0 ? e.offsetTop + e.offsetHeight : 0))
  return bottom > 0 ? bottom + 8 : 0
}
