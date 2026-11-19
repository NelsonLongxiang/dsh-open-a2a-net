/**
 * #650: team-frame selection is presentation state, separate from session-card selection and layout history.
 * The view retains its single-frame drag/resize semantics; selecting several frames never moves their members.
 */
export function createFrameSelection(frames: () => ReadonlyMap<string, HTMLElement>, clearCards: () => void) {
  const selected = new Set<string>()
  function sync(): void {
    const current = frames()
    for (const name of selected) if (!current.has(name)) selected.delete(name)
    for (const [name, frame] of current) {
      const active = selected.has(name)
      frame.classList.toggle('selected', active)
      frame.querySelector('.p-frame-head')?.setAttribute('aria-pressed', String(active))
    }
  }
  function clear(): void { selected.clear(); sync() }
  function select(name: string, additive = false): void {
    if (!frames().has(name)) return
    clearCards()
    if (!additive) { selected.clear(); selected.add(name) }
    else if (selected.has(name)) selected.delete(name)
    else selected.add(name)
    sync()
  }
  return {
    /** Detached names; later polls or gestures cannot mutate an already accepted user selection. */
    names: (): readonly string[] => [...selected],
    select, clear, sync,
    beforePointer(target: Element | null): void {
      if (target?.closest('.p-node')) { clear(); return }
      if (target?.closest('.p-frame-head, .p-frame-handle')) return
      const frame = target?.closest<HTMLElement>('.p-frame')
      if (!frame || !selected.has(frame.dataset.name ?? '')) clear()
    },
    keyboard(event: { key: string; shiftKey: boolean; target: Element | null; preventDefault(): void }): boolean {
      const head = event.target?.closest<HTMLElement>('.p-frame-head')
      if (event.key !== ' ' || !event.shiftKey || !head) return false
      select(head.dataset.frame ?? '', true)
      event.preventDefault()
      return true
    },
  }
}
