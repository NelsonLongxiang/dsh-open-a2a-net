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
  const cut = base.lastIndexOf('-', NAME_CAP)
  if (cut > 4) return base.slice(0, cut) + '<br/>' + base.slice(cut + 1)
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

/** HUD (top-left) + legend (bottom-left) + aria role on the canvas. */
export function mountChrome(app: HTMLElement, canvas: HTMLCanvasElement): void {
  const hud = document.createElement('div')
  hud.className = 'nexus-hud'
  hud.textContent = 'A2A Nexus'
  app.appendChild(hud)
  const legend = document.createElement('div')
  legend.className = 'nexus-legend'
  const dotLive = document.createElement('span'); dotLive.className = 'dot live'
  const tLive = document.createElement('span'); tLive.textContent = 'live'
  const dotCold = document.createElement('span'); dotCold.className = 'dot cold'
  const tCold = document.createElement('span'); tCold.textContent = 'cold'
  const dash = document.createElement('span'); dash.className = 'dashline'
  const tFed = document.createElement('span'); tFed.textContent = 'federation'
  const act = document.createElement('span'); act.className = 'act'
  const tAct = document.createElement('span'); tAct.textContent = 'in-flight'
  legend.append(dotLive, tLive, dotCold, tCold, dash, tFed, act, tAct)
  app.appendChild(legend)
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('tabindex', '0')
}

export function setAriaLabel(canvas: HTMLCanvasElement, label: string): void {
  canvas.setAttribute('aria-label', label)
}
