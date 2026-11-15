/**
 * superagent-root-team R8 (S3): the root team's board surfaces — the frame badge, the child chips (a chip, not the
 * child's sessions), the in-flight edge line, and the reasons a dragged frame cannot join a root. Pure DOM/text
 * builders the planning view calls; the drag/drop wiring lives in planning-root-drop.ts.
 */
import type { RootChildRow } from './world'

/** The root badge a root team's frame carries. */
export const ROOT_BADGE = 'root'

/** The state badge a child chip shows (words, one per state). */
export function childStateText(state: RootChildRow['state']): string {
  return state === 'ready' ? '已就绪' : state === 'pending-registration' ? '待子团队登记' : state === 'unreachable' ? '不可达' : '满载'
}

/** One child chip's title line: label, open/slots, the state. */
export function childChipTitle(child: RootChildRow): string {
  return `${child.label} ${String(child.open)}/${String(child.slots)} ${childStateText(child.state)}`
}

/** The stepper's aria label for a child's slots. */
export function childSlotsLabel(child: RootChildRow): string {
  return `${child.label} 并行名额`
}

/** The in-flight edge's line: root → child with the open count. */
export function inFlightLine(root: string, child: RootChildRow): string {
  return `${root} → ${child.label}（在办 ${String(child.open)}）`
}

export type DropRefusal =
  | { ok: true; preview: '加入为子团队' }
  | { ok: false; reason: '它已是 root 团队（root 只有一层）' | '它已是这个 root 的子团队' | '它不是 superagent 团队' }

/**
 * Whether a dragged team frame may join a root: not a root itself (one level), not already its child, and — per the
 * child proof on the server — a superagent team (the board shows what the server will say, before the call).
 */
export function dropRefusal(root: { name: string; root?: boolean; children?: ReadonlyArray<RootChildRow> }, dragged: { name: string; root?: boolean; superagent?: boolean }): DropRefusal {
  if (dragged.root === true) return { ok: false, reason: '它已是 root 团队（root 只有一层）' }
  if (root.children?.some(child => child.ref.includes(`/${dragged.name}@`)) === true) return { ok: false, reason: '它已是这个 root 的子团队' }
  if (dragged.superagent !== true) return { ok: false, reason: '它不是 superagent 团队' }
  return { ok: true, preview: '加入为子团队' }
}

/**
 * Build one child chip: a CONTAINER (not a button — the stepper buttons sit as siblings inside it, valid HTML),
 * with a label span the caller keeps updated (childChipTitle) and `dataset.slots` the stepper reads each click, so a
 * re-render's fresh value is used even before the label repaints. Clicking the label opens the child's seats
 * read-only; double-click does nothing until focusing its frame lands (a no-op beats a meaningless write).
 */
export function buildChildChip(doc: Document, child: RootChildRow, onOpenSeats: () => void): HTMLElement {
  const chip = doc.createElement('div')
  chip.className = 'planning-root-chip'
  chip.dataset.ref = child.ref
  const label = doc.createElement('span')
  label.className = 'planning-root-chip-label'
  label.setAttribute('role', 'button')
  label.setAttribute('aria-label', childChipTitle(child))
  label.textContent = childChipTitle(child)
  label.addEventListener('click', onOpenSeats)
  chip.append(label)
  return chip
}
