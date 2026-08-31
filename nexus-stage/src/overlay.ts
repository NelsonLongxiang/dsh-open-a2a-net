/** CSS2D overlay lifecycle for the nexus stage: label attach/detach keeps
 *  mesh and label in one lifetime (mesh retired ⇒ label retired); the
 *  inspector pins a readable detail line; HUD/legend/aria chrome mounts once. */
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import * as THREE from 'three'

const labelByNode = new Map<string, CSS2DObject>()
const NAME_CAP = 18

/** Shorten a label: strip the team prefix, break long slugs at '-' or cap. */
export function shortName(raw: string): string {
  const base = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw
  if (base.length <= NAME_CAP) return base
  return base.slice(0, NAME_CAP) + '…'
}

export function attachLabel(mesh: THREE.Object3D, name: string, live: boolean, team: string): CSS2DObject {
  // XSS discipline: remote-sourced name/team land via createElement +
  // textContent, never innerHTML — a session label is attacker-shaped data.
  const el = document.createElement('div')
  el.className = 'nexus-label ' + (live ? 'live' : 'cold')
  const nm = document.createElement('span')
  nm.className = 'nm'
  nm.textContent = shortName(name)
  const sub = document.createElement('span')
  sub.className = 'sub'
  sub.textContent = (live ? 'live' : 'cold') + ' · ' + team
  el.append(nm, sub)
  const obj = new CSS2DObject(el)
  obj.position.set(0, 1.6, 0)
  mesh.add(obj)
  return obj
}

export function detachLabel(obj: CSS2DObject): void {
  obj.removeFromParent()
}

export function labelCount(): number {
  return labelByNode.size
}

export function clearLabels(): void {
  for (const obj of labelByNode.values()) obj.removeFromParent()
  labelByNode.clear()
}

export function disposeOverlay(): void {
  clearLabels()
  inspector = null
}

export function hasLabel(id: string): boolean {
  return labelByNode.has(id)
}

let inspector: HTMLDivElement | null = null
export function pinInspector(app: HTMLElement, text: string): void {
  if (!inspector) {
    inspector = document.createElement('div')
    inspector.className = 'nexus-inspector'
    app.appendChild(inspector)
  }
  inspector.textContent = text
  inspector.style.display = 'block'
}
export function unpinInspector(): void { if (inspector) inspector.style.display = 'none' }

export function setAriaLabel(canvas: HTMLCanvasElement, label: string): void {
  canvas.setAttribute('aria-label', label)
}

/** Keyboard surface for the readability contract: Enter/Tab advance the
 *  roster, Esc unpins. Bound here so tests can drive dispatchEvent and the
 *  production path stays identical. Handlers are pure wiring — the caller
 *  supplies the roster navigation and inspector rendering callbacks. */
export function bindInspectorKeys(
  canvas: HTMLElement,
  handlers: {
    advance: () => string | undefined
    current: () => string
    onEscape: () => void
  },
): void {
  canvas.setAttribute('tabindex', '0')
  canvas.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault()
      const next = handlers.advance()
      if (next !== undefined) pinInspector(canvas.ownerDocument?.body ?? document.body, handlers.current())
      return
    }
    if (ev.key === 'Escape') {
      handlers.onEscape()
      unpinInspector()
    }
  })
}
