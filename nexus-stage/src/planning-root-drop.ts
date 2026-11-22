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
  /** Optional board admission shares the menu's current facts, including missing addresses and unreachable peers. */
  readonly refusal?: (root: string, dragged: DraggedFrameFacts) => string | undefined
  readonly signal?: AddEventListenerOptions
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

/** One target controller shared by native drops and the board's pointer-capture drag. */
export interface RootFrameDrop {
  preview(dragged: DraggedFrameFacts): void
  leave(): void
  drop(dragged: DraggedFrameFacts): void
}

/** Wire once; facts may change on a poll while a keyed frame element and a drag remain alive. */
export function wireRootFrame(frame: HTMLElement, facts: RootFrameFacts | (() => RootFrameFacts | undefined), draggedOf: (event: DragEvent) => DraggedFrameFacts | undefined, d: Pick<RootDropDeps, 'addTeam' | 'frameError' | 'refusal' | 'signal'>): RootFrameDrop {
  const current = (): RootFrameFacts | undefined => typeof facts === 'function' ? facts() : facts
  const leave = (): void => { delete frame.dataset.rootDropPreview; frame.querySelector(':scope > .p-root-drop-preview')?.remove() }
  const reason = (root: RootFrameFacts, dragged: DraggedFrameFacts): string | undefined => {
    const verdict = dropRefusal(root, dragged)
    return verdict.ok ? d.refusal?.(root.name, dragged) : verdict.reason
  }
  const preview = (dragged: DraggedFrameFacts): void => {
    const root = current()
    if (root?.root !== true) { leave(); return }
    const refusal = reason(root, dragged)
    const text = refusal === undefined ? `松开加入为子团队：${dragged.name}` : `不能加入：${refusal}`
    frame.dataset.rootDropPreview = text
    let line = frame.querySelector<HTMLElement>(':scope > .p-root-drop-preview')
    if (line === null) { line = document.createElement('div'); line.className = 'p-root-drop-preview'; line.setAttribute('role', 'status'); frame.append(line) }
    line.textContent = text
  }
  const drop = (dragged: DraggedFrameFacts): void => {
    const root = current(); leave()
    if (root?.root !== true) return
    const refusal = reason(root, dragged)
    if (refusal !== undefined) { d.frameError(root.name, refusal); return }
    const alive = (): boolean => d.signal?.signal?.aborted !== true
    void d.addTeam(root.name, dragged.ref).then(out => { if (alive() && !out.ok) d.frameError(root.name, out.error ?? '加入子团队被拒绝') }, () => { if (alive()) d.frameError(root.name, '加入子团队的结果未知，请刷新核对，不要重复提交') })
  }
  frame.addEventListener('dragover', (event: DragEvent) => { const dragged = draggedOf(event); if (dragged === undefined) return; event.preventDefault(); preview(dragged) }, d.signal)
  frame.addEventListener('dragleave', leave, d.signal)
  frame.addEventListener('drop', (event: DragEvent) => { const dragged = draggedOf(event); if (dragged === undefined) return; event.preventDefault(); drop(dragged) }, d.signal)
  for (const chip of Array.from(frame.querySelectorAll<HTMLElement>('.planning-root-chip'))) {
    chip.draggable = true
    chip.addEventListener('dragstart', (event: DragEvent) => { event.dataTransfer?.setData('text/root-child', chip.dataset.ref ?? '') }, d.signal)
  }
  return { preview, leave, drop }
}

/** A chip dropped outside any root frame (the planning view calls this on its own drop zone): confirm and remove. */
export async function chipDroppedOutside(root: string, ref: string, d: RootDropDeps): Promise<void> {
  if (!(await d.confirmRemove(root, ref))) return
  const out = await d.removeTeam(root, ref)
  if (!out.ok) d.frameError(root, out.error ?? '移出子团队被拒绝')
}
