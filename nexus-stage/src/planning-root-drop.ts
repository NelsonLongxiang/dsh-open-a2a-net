/**
 * superagent-root-team R8 (S3): the root frame's drag and drop. A team frame dragged onto a root shows the drop
 * preview or the refusal in words on the frame (never a toast alone); dropping calls add-team; dragging a chip out
 * (or its menu) asks a one-line confirm and calls remove-team. Keyboard: the same actions live in the frame menu.
 */
import { dropRefusal } from './planning-root'
import type { RootChildRow } from './world'

export interface RootDropDeps {
  /** add-team on the canvas route; resolves the route's ok and error. */
  readonly addTeam: (root: string, ref: string) => Promise<{ ok: boolean; error?: string }>
  /** remove-team with a one-line confirm the caller runs (returns false when declined). */
  readonly confirmRemove: (root: string, ref: string) => Promise<boolean>
  readonly removeTeam: (root: string, ref: string) => Promise<{ ok: boolean; error?: string }>
  /** Show a refusal or a route error on the frame it concerns, in words, with the next step. */
  readonly frameError: (root: string, text: string) => void
}

export interface RootFrameFacts { readonly name: string; readonly root?: boolean; readonly children?: ReadonlyArray<RootChildRow> }
export interface DraggedFrameFacts { readonly name: string; readonly ref: string; readonly root?: boolean; readonly superagent?: boolean }

/** The preview (or the refusal) a dragover shows, as text on the root frame. */
export function dragPreviewText(root: RootFrameFacts, dragged: DraggedFrameFacts): string {
  const verdict = dropRefusal(root, dragged)
  return verdict.ok ? `松开加入为子团队：${dragged.name}` : `不能加入：${verdict.reason}`
}

/** Whether the drop may proceed (the preview already said why not). */
export function dropAllowed(root: RootFrameFacts, dragged: DraggedFrameFacts): boolean {
  return dropRefusal(root, dragged).ok
}

/** Wire one root frame: dragover preview, drop → add-team, chip drag-out → confirm → remove-team. */
export function wireRootFrame(frame: HTMLElement, root: RootFrameFacts, draggedOf: (event: DragEvent) => DraggedFrameFacts | undefined, d: RootDropDeps): void {
  frame.addEventListener('dragover', (event: DragEvent) => {
    const dragged = draggedOf(event)
    if (dragged === undefined) return
    event.preventDefault()
    frame.dataset.rootDropPreview = dragPreviewText(root, dragged)
  })
  frame.addEventListener('dragleave', () => { delete frame.dataset.rootDropPreview })
  frame.addEventListener('drop', async (event: DragEvent) => {
    const dragged = draggedOf(event)
    delete frame.dataset.rootDropPreview
    if (dragged === undefined || !dropAllowed(root, dragged)) return
    event.preventDefault()
    const out = await d.addTeam(root.name, dragged.ref)
    if (!out.ok) d.frameError(root.name, out.error ?? '加入子团队被拒绝')
  })
  for (const chip of Array.from(frame.querySelectorAll<HTMLElement>('.planning-root-chip'))) {
    chip.draggable = true
    chip.addEventListener('dragstart', (event: DragEvent) => { event.dataTransfer?.setData('text/root-child', chip.dataset.ref ?? '') })
  }
}

/** A chip dropped outside any root frame (the planning view calls this on its own drop zone): confirm and remove. */
export async function chipDroppedOutside(root: string, ref: string, d: RootDropDeps): Promise<void> {
  if (!(await d.confirmRemove(root, ref))) return
  const out = await d.removeTeam(root, ref)
  if (!out.ok) d.frameError(root, out.error ?? '移出子团队被拒绝')
}
