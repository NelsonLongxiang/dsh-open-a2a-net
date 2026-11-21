/** #735: bridge the board's captured-pointer frame gesture to the existing root drop/menu path. */
import { wireRootFrame, type DraggedFrameFacts, type RootFrameDrop } from './planning-root-drop'
import type { RootCompose } from './planning-root-compose'
import type { FrameDragSnapshot, FrameGeom, WorldModel } from './world'

export interface RootFrameDragDeps {
  readonly model: WorldModel
  readonly compose: RootCompose
  readonly signal: AddEventListenerOptions
  frames(): ReadonlyMap<string, HTMLElement>
}

export function createRootFrameDrag(d: RootFrameDragDeps) {
  const wired = new WeakMap<HTMLElement, RootFrameDrop>()
  let previewed: RootFrameDrop | undefined
  let previewTarget: { name: string; rect: FrameGeom } | undefined
  const dragged = (name: string): DraggedFrameFacts | undefined => {
    const frame = d.compose.frame(name)
    return frame === undefined ? undefined : { name, ref: frame.ref ?? '', root: frame.root, superagent: frame.superagentTeam === true && frame.roster !== true }
  }
  const clear = (): void => { previewed?.leave(); previewed = undefined; previewTarget = undefined }
  const contains = (r: FrameGeom, point: { x: number; y: number }): boolean => point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h
  const controller = (name: string): RootFrameDrop | undefined => {
    const el = d.frames().get(name)
    if (el === undefined) return undefined
    let value = wired.get(el)
    if (value !== undefined) return value
    value = wireRootFrame(el, () => d.compose.roots().find(root => root.name === name), event => {
      const source = event.dataTransfer?.getData('text/team-frame')
      return source ? dragged(source) : undefined
    }, {
      signal: d.signal,
      addTeam: (root, ref) => {
        const source = [...d.frames().keys()].find(frame => d.compose.frame(frame)?.ref === ref)
        return source === undefined ? Promise.resolve({ ok: false, error: '团队已不在画布上，请刷新核对' }) : d.compose.join(root, source)
      },
      refusal: (root, source) => d.compose.refusal(root, source.name),
      frameError: d.compose.frameError,
    })
    wired.set(el, value)
    return value
  }
  const target = (source: string, point: { x: number; y: number }): string | undefined => {
    const roots = new Set(d.compose.roots().map(root => root.name))
    return d.model.allFrames().filter(([name, r]) => name !== source && roots.has(name) && contains(r, point))
      .sort((a, b) => a[1].w * a[1].h - b[1].w * b[1].h)[0]?.[0]
  }
  return {
    sync(): void { for (const root of d.compose.roots()) controller(root.name) },
    move(name: string, point: { x: number; y: number }): void {
      const nameAt = target(name, point), next = nameAt === undefined ? undefined : controller(nameAt)
      if (previewed !== next) clear()
      previewed = next
      const rect = nameAt === undefined ? undefined : d.model.getFrame(nameAt)
      previewTarget = nameAt === undefined || rect === undefined ? undefined : { name: nameAt, rect: { ...rect } }
      const source = dragged(name)
      if (source !== undefined) next?.preview(source); else clear()
    },
    drop(snapshot: FrameDragSnapshot, point: { x: number; y: number }): boolean {
      const nameAt = target(snapshot.name, point), source = dragged(snapshot.name), was = previewTarget
      clear()
      const staleTarget = nameAt === undefined && was !== undefined && contains(was.rect, point)
      if (nameAt === undefined && !staleTarget) return false
      // A team join is not a layout edit, including facts disappearing between the preview and release.
      if (d.model.getFrame(snapshot.name) !== undefined) d.model.setFrame(snapshot.name, { ...snapshot.rect })
      if (nameAt === undefined || source === undefined) {
        d.compose.frameError(nameAt ?? was!.name, '团队或 root 已变化，请刷新后重选')
        return true
      }
      controller(nameAt)?.drop(source)
      return true
    },
    clear,
  }
}
