/**
 * Drag a local session from the workbench rail (目录 · 本机会话) straight into
 * a canvas team frame on the board (owner request 2026-11-04). The rail row
 * carries the session id in a private drag type; the board accepts it only
 * over a frame and turns the drop into the same add-member action a card drop
 * makes, so roster frames, mirror frames (fleet relay) and the host's own
 * refusals all behave exactly as for an on-board drag.
 * @module nexus-stage/session-drag
 */

/** Private drag type: an arbitrary page or file dropped on the board is ignored. */
export const SESSION_DRAG_TYPE = 'application/x-dsh-session'

/** Make one rail row draggable as a local session. */
export function makeSessionDraggable(item: HTMLElement, sessionId: string): void {
  item.draggable = true
  item.classList.add('is-draggable')
  item.title = `${item.title === '' ? sessionId : item.title} · 可拖入画布队`
  item.addEventListener('dragstart', ev => {
    if (ev.dataTransfer === null) return
    ev.dataTransfer.setData(SESSION_DRAG_TYPE, sessionId)
    ev.dataTransfer.effectAllowed = 'copy'
  })
}

export interface SessionDropDeps {
  /** The innermost team frame under a client point, if any. */
  frameAt(clientX: number, clientY: number): string | undefined
  /** Frame elements by team name, for the drop-target highlight. */
  frames(): ReadonlyMap<string, HTMLElement>
  /** A session dropped on a frame. */
  drop(team: string, sessionId: string): void
  readonly signal: AddEventListenerOptions
}

/** Accept rail session drags on the board root. */
export function attachSessionDrop(root: HTMLElement, d: SessionDropDeps): void {
  const carries = (ev: DragEvent): boolean => ev.dataTransfer !== null && [...ev.dataTransfer.types].includes(SESSION_DRAG_TYPE)
  const highlight = (team: string | undefined): void => {
    for (const [name, el] of d.frames()) el.classList.toggle('drop-target', name === team)
  }
  root.addEventListener('dragover', ev => {
    if (!carries(ev)) return
    const team = d.frameAt(ev.clientX, ev.clientY)
    highlight(team)
    if (team === undefined) return
    ev.preventDefault() // only a frame is a drop target
    ev.dataTransfer!.dropEffect = 'copy'
  }, d.signal)
  root.addEventListener('dragleave', ev => {
    if (carries(ev) && (ev.relatedTarget === null || !root.contains(ev.relatedTarget as Node))) highlight(undefined)
  }, d.signal)
  // A drag cancelled with Esc over a frame fires no dragleave on the board: the source's dragend clears it.
  root.ownerDocument.addEventListener('dragend', () => highlight(undefined), d.signal)
  root.addEventListener('drop', ev => {
    if (!carries(ev)) return
    highlight(undefined)
    const team = d.frameAt(ev.clientX, ev.clientY)
    const id = ev.dataTransfer!.getData(SESSION_DRAG_TYPE)
    if (team === undefined || id === '') return
    ev.preventDefault()
    d.drop(team, id)
  }, d.signal)
}
