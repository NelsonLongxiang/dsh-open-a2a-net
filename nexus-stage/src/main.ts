import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { disposeGeometries } from './dispose'
import { createFaultReporter } from './fault'
import { C, S } from './tokens'
import { LodMachine, prefersReducedMotion } from './lod'
import type { Lod } from './lod'
import {
  MOCK, drawMembership, drawActivity, drawPeers,
  type StateBody,
} from './topology'
import {
  attachLabel, detachLabel, mountChrome, pinInspector, unpinInspector,
} from './overlay'
import { updateCensus } from './census'
import { createStageKeyboardHandler, wireReducedRendering } from './interaction'
import { createPlanningView } from './planning-view'
import { createSaveLoop, type LampState } from './layout-wire'
import { projectFleet } from './reproject'
import { createCanvasWire } from './canvas-wire'
import type { CanvasAction } from './canvas-ops'
import './overlay.css'

// ─── DOM shell ──
const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(app.clientWidth || window.innerWidth, app.clientHeight || window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
app.appendChild(renderer.domElement)

// ─── Fault surface ──
// Fetch failures must never masquerade as an empty fleet. The stage is opened
// directly by humans who cannot watch devtools, so the newest fault rides a
// fixed badge (always current) while console.error stays throttled to one
// line per window (the N2 breadcrumb cadence). A healthy response hides the
// badge — visible silence then genuinely means zero rows, and "empty" stays
// distinguishable from "unreachable". The lifecycle lives in ./fault so the
// unit tests can pin it without a DOM.
const faultBadge = document.createElement('div')
faultBadge.style.cssText =
  'position:fixed;top:10px;right:10px;max-width:48ch;padding:6px 10px;' +
  'border:1px solid #ef4444;background:#2a0d0dcc;color:#fecaca;' +
  'font:12px/1.5 "JetBrains Mono",monospace;border-radius:4px;' +
  'display:none;z-index:9;pointer-events:none'
app.appendChild(faultBadge)
const { fault, clear: clearFault } = createFaultReporter(
  {
    show(message) {
      faultBadge.textContent = message
      faultBadge.style.display = 'block'
    },
    hide() {
      faultBadge.style.display = 'none'
    },
  },
  message => console.error(message),
)

// ─── CSS2D overlay for readable labels (P0 readability) ──
const labelRenderer = new CSS2DRenderer()
labelRenderer.setSize(app.clientWidth || window.innerWidth, app.clientHeight || window.innerHeight)
labelRenderer.domElement.style.position = 'absolute'
labelRenderer.domElement.style.top = '0'
labelRenderer.domElement.style.pointerEvents = 'none'
app.appendChild(labelRenderer.domElement)

// reduced-motion: static equivalence (no per-frame drift; render on demand)


// ─── Scene, camera, controls ──
const scene = new THREE.Scene()
scene.background = new THREE.Color(C.bg0)
scene.fog = new THREE.FogExp2(0x060a12, 0.005)

const camera = new THREE.PerspectiveCamera(60, app.clientWidth / app.clientHeight, 0.1, 500)
camera.position.set(0, 35, 55)

const reducedMotion = prefersReducedMotion()
/** Module-level reduced-motion loop: cycle() end calls renderOnce() through it. */
let reducedLoop: { renderOnce(): void } | undefined = undefined
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = !reducedMotion
controls.dampingFactor = 0.06
controls.minDistance = 8
controls.maxDistance = 180

// ─── Lights ──
scene.add(new THREE.AmbientLight(0x334466, 1.6))
const keyLight = new THREE.DirectionalLight(0xffffff, 1.7)
keyLight.position.set(25, 50, 25)
scene.add(keyLight)
const rim = new THREE.DirectionalLight(0x8b5cf6, 0.35)
rim.position.set(-25, -10, -20)
scene.add(rim)

// ─── Reference grid ──
const grid = new THREE.GridHelper(120, 60, 0x1c2740, 0x111a2e)
grid.position.y = -16
scene.add(grid)

// ─── Groups ──
const nodeGroup = new THREE.Group()
const teamGroup = new THREE.Group()
const peerGroup = new THREE.Group()
const lineGroup = new THREE.Group()
scene.add(teamGroup, nodeGroup, peerGroup, lineGroup)

// ─── Edge material ──
// One shared material for every membership edge: the visibility contract is
// constant, so allocation happens once instead of once per poll cycle.
const edgesMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.6 })

// ─── Types re-exported from topology ──

// ─── LOD hysteresis machine (B5: far↔mid↔near 双向滞回) ──
const lodMachine = new LodMachine()

// ─── Mock toggle ──
let useMock = false

// ─── Mesh builders ──
function makeNode(color: number, r: number): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(r, 1)
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.3 })
  return new THREE.Mesh(g, m)
}

// ─── Layout persistence ──
async function fetchLayout(): Promise<any | null> {
  try {
    const r = await fetch('/__dsh_a2a/canvas-layout', { cache: 'no-store' }); if (!r.ok) return null
    const j = await r.json(); return j.layout ?? null
  } catch { return null }
}

// ─── Boot / poll / reconcile (pairwise cleanup: mesh+label same lifetime) ──
const meshesById = new Map<string, THREE.Mesh>()
const labelByNode = new Map<string, CSS2DObject>()
/** Normalized session rows from the latest real cycle (never MOCK) — the
 *  interaction handlers read live/name/team from here, not from fixtures. */
const sessionById = new Map<string, import('./topology').SessionRow>()
const sessionTeam = new Map<string, string>()

async function cycle(): Promise<void> {
  let res: Response
  try {
    res = await fetch('/__dsh_a2a/state', { cache: 'no-store' })
  } catch (error) {
    fault(`state unreachable: ${String((error as Error | undefined)?.message ?? error).slice(0, 80)}`)
    return
  }
  if (!res.ok) { fault(`state ${res.status} from host`); return }
  clearFault()
  let body: StateBody
  try {
    body = await res.json() as StateBody
  } catch (error) {
    fault(`state JSON parse failed: ${String((error as Error | undefined)?.message ?? error).slice(0, 80)}`)
    return
  }
  // Mock hard-acceptance toggle: five nodes / two teams / one peer for the
  // readability acceptance run without a live fleet.
  const sessions = useMock ? MOCK.sessions : (body.sessions ?? []).filter((s) => s.joined === true)
  const teams = useMock ? MOCK.canvas.teams : (body.canvas?.teams ?? [])
  const peers = useMock ? MOCK.peers : (body.peers ?? [])
  // Read-path of layout persistence (write-path arrives with planning mode):
  // a node saved on a previous visit keeps its world spot instead of a fresh
  // random seat, so saved arrangements survive reloads.
  const layout = useMock ? null : await fetchLayout()

  // Retire departed nodes first — mesh and CSS2D label share one lifetime.
  const liveIds = new Set(sessions.map(s => s.id))
  for (const [sid, mesh] of [...meshesById]) {
    if (!liveIds.has(sid)) { const lbl = labelByNode.get(sid); if (lbl) detachLabel(lbl); nodeGroup.remove(mesh); meshesById.delete(sid) }
  }

  // Seat un-seated nodes (position arrives in the reprojection pass below).
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]!
    const sid = s.id
    const isLive = s.live !== false
    let mesh = meshesById.get(sid)
    if (!mesh) {
      const color = isLive ? S.nodeLive : S.nodeCold
      mesh = makeNode(color, isLive ? 0.9 : 0.5)
      mesh.userData = { label: s.name ?? s.label, sid }
      nodeGroup.add(mesh)
      meshesById.set(sid, mesh)
    }
    if (!labelByNode.has(sid)) labelByNode.set(sid, attachLabel(mesh, s.name ?? s.label, isLive, s.team))
    sessionTeam.set(sid, s.team)
    // Real normalized row: interaction handlers read this, never MOCK.
    sessionById.set(sid, s)
  }

  // 3D lens reprojection (ruling A of review-node-position.md): the shared
  // layout document is 2D pixels (card centers), so the scene re-projects
  // the whole fleet - saved positions plus unsaved polar fallbacks - into
  // its observation envelope every poll. This keeps ANY arrangement on
  // camera (a modest 2D arrange used to throw 4 of 5 nodes off camera) and
  // makes the 3D view follow 2D saves mid-session (P3: layout was read
  // only at mesh creation). Runs before the edge pass so edges follow.
  const targets = projectFleet(
    sessions.map(s => s.id),
    (layout?.nodes ?? {}) as Record<string, { x: number; y: number }>,
  )
  for (const [sid, mesh] of meshesById) {
    const t = targets.get(sid)
    if (t !== undefined) mesh.position.set(t.x, 0, t.y)
  }

  // Membership edges: hub-star (team centroid + spokes) instead of the O(n²)
  // pairwise mesh — every pair still visually implied through the hub, and
  // the GPU cost grows linearly. Each rebuild releases the previous batch's
  // geometries before clearing - without that, every 5s poll leaks GPU
  // buffers for the page's lifetime. Hub meshes (teamGroup) and peer nodes
  // (peerGroup) are rebuilt on the same cadence, so they release too.
  disposeGeometries(lineGroup.children)
  disposeGeometries(teamGroup.children)
  teamGroup.clear()
  disposeGeometries(peerGroup.children)
  peerGroup.clear()
  drawMembership(teams, meshesById, lineGroup, teamGroup)
  drawPeers(peers, peerGroup, lineGroup)

  updateCensus(renderer.domElement, sessions, teams, peers)
  // Reduced-motion contract: a settled cycle is an external render driver —
  // the stage must repaint fresh data (5s updates were invisible without it).
  reducedLoop?.renderOnce()
  if (useMock) drawActivity([['s1', 's3'], ['s4', 's5']], meshesById, lineGroup)

  // ── Planning mode shares this poll: same state payload, same layout GET. ──
  const layoutJson = JSON.stringify(layout ?? null)
  if (layoutJson !== lastLayoutJson) {
    lastLayoutJson = layoutJson
    // Adopt poll-sourced layouts only while nothing is unsaved/in flight —
    // otherwise a slow GET would revert positions the user is still dragging.
    if ((lampState === 'idle' || lampState === 'saved') && !saveLoop.isBusy()) {
      planning.adoptExternalLayout(layout)
    }
  }
  planning.reconcile({ sessions, teams, peerCount: peers.length })
  canvasFace = body.canvas !== undefined
  tabPlan.style.display = canvasFace ? '' : 'none'
  if (!canvasFace && mode === 'plan') setMode('scene')
}

// ─── Planning mode (2D): view + save loop + mode tabs (design.md §1 双模) ──
// The 3D observation scene stays the landing mode; the planning canvas is
// created eagerly but hidden, so the first poll fills it without a flash.
let mode: 'scene' | 'plan' = 'scene'
let canvasFace = false
let lampState: LampState = 'idle'
let lastLayoutJson: string | undefined

// ─── Canvas write face: the wire + the action channel (PR C) ──
const canvasWire = createCanvasWire({
  send: async (body) => {
    const r = await fetch('/__dsh_a2a/canvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    return { status: r.status, body: await r.json() as { ok?: boolean; error?: string } }
  },
  onNotice: (kind, text) => planning.notice(kind, text),
})

function runCanvasAction(a: CanvasAction): Promise<boolean> {
  switch (a.type) {
    case 'create-team': return canvasWire.createTeam(a.name, a.ids)
    case 'add-member': return canvasWire.addMembers(a.team, a.ids)
    case 'remove-member': return canvasWire.removeMembers(a.team, a.ids)
    case 'remove-team': return canvasWire.removeTeam(a.name)
    case 'reorder': return canvasWire.runRosterOps(a.team, a.ops)
  }
}

const planning = createPlanningView({
  onDirty: () => saveLoop.markDirty(),
  onLampClick: () => saveLoop.retry(),
  onCanvasAction: async (a) => {
    const ok = await runCanvasAction(a)
    // Settled: converge on truth either way — success absorbs the host's
    // rich state; failure re-pulls so the rollback matches reality.
    void cycle()
    return ok
  },
})
app.appendChild(planning.root)

const saveLoop = createSaveLoop({
  snapshot: () => planning.snapshotDoc(),
  send: (doc, opts) => fetch('/__dsh_a2a/canvas-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', layout: doc }),
    cache: 'no-store',
    keepalive: opts.keepalive,
  }).then(async (r) => await r.json() as { ok: boolean; layout?: unknown; error?: string }),
  schedule: (fn, ms) => { const t = setTimeout(fn, ms); return () => { clearTimeout(t) } },
  now: Date.now,
  onLamp: (state) => {
    lampState = state
    const now = new Date()
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    planning.setLamp(state, hhmm)
  },
  onAdopt: (normalized) => { planning.adoptExternalLayout(normalized) },
  onHttpError: (message) => fault(message),
})
window.addEventListener('pagehide', () => saveLoop.flush())

const tabBar = document.createElement('div')
tabBar.className = 'nexus-modes'
tabBar.setAttribute('role', 'tablist')
tabBar.setAttribute('aria-label', '舞台模式')
const mkTab = (label: string, title: string): HTMLButtonElement => {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.title = title
  b.setAttribute('role', 'tab')
  return b
}
const tabScene = mkTab('观测', '3D 拓扑观测模式')
const tabPlan = mkTab('规划', '2D 无限画布 · 规划模式')
// The planning tab exists only while the host serves the canvas face
// (state.canvas !== undefined — the contract's master switch).
tabPlan.style.display = 'none'
tabBar.append(tabScene, tabPlan)
app.appendChild(tabBar)

function setMode(next: 'scene' | 'plan'): void {
  mode = next
  tabScene.setAttribute('aria-selected', String(next === 'scene'))
  tabPlan.setAttribute('aria-selected', String(next === 'plan'))
  if (next === 'plan') {
    // 3D chrome must not leak onto the planning canvas: the inspector is
    // appended to #app last, and CSS2DRenderer stamps each label with its
    // own z-index (distance-sorted), so both float above z:auto #dsh-plan
    // no matter the DOM order. Hide the layer wholesale - the 3D rAF is
    // paused in plan mode, so the labels have nothing live to show.
    pinned = undefined
    unpinInspector()
    labelRenderer.domElement.style.display = 'none'
    planning.activate()
  } else {
    labelRenderer.domElement.style.display = ''
    planning.deactivate()
  }
}
tabScene.addEventListener('click', () => setMode('scene'))
tabPlan.addEventListener('click', () => setMode('plan'))
setMode('scene')

setInterval(() => void cycle(), 5000)
void cycle()

// ─── Interaction: click/Enter pins inspector; Esc unpins; Tab traverses roster ──
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let pinned: string | undefined

renderer.domElement.addEventListener('pointerdown', (ev) => {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObjects(nodeGroup.children, false)[0]
  if (hit) {
    const ud = hit.object.userData as { label?: string; sid?: string }
    pinned = ud.sid
    const row = ud.sid !== undefined ? sessionById.get(ud.sid) : undefined
    const live = row ? (row.live !== false ? 'live' : 'cold') : '?'
    pinInspector(app, (ud.label ?? '') + ' · ' + live + ' · 团队 ' + (row?.team ?? sessionTeam.get(ud.sid ?? '') ?? '?'))
  } else { pinned = undefined; unpinInspector() }
})

renderer.domElement.addEventListener('keydown', createStageKeyboardHandler(
  {
    pinned: () => pinned,
    ids: () => [...meshesById.keys()],
    nextAfter: (current) => {
      const idx = current !== undefined ? [...meshesById.keys()].indexOf(current) : -1
      return [...meshesById.keys()][(idx + 1) % [...meshesById.keys()].length]
    },
    pin: (next) => {
      const row = sessionById.get(next)
      const team = sessionTeam.get(next) ?? '?'
      const liveTxt = row ? (row.live !== false ? 'live' : 'cold') : '?'
      pinned = next
      pinInspector(app, next + ' · ' + liveTxt + ' · 团队 ' + team)
    },
    escape: () => { pinned = undefined; unpinInspector() },
  },
  renderer.domElement,
))


// ─── Animate: full rAF loop in normal mode; reduced-motion gets renderOnce
//  — static frames are still rendered after controls change or a cycle, so
//  the stage never goes blank, it just does not drift on its own. In plan
//  mode the 3D loop pauses (one guarded entry, never cancelled — planning
//  root covers the canvas, so a frozen frame is invisible). ──
function renderOnce(): void {
  if (mode !== 'scene') return
  labelRenderer.render(scene, camera)
  renderer.render(scene, camera)
}

if (prefersReducedMotion()) {
  // Reduced-motion (gate 3): no rAF loop. controls change and each settled
  // cycle call renderOnce() through the wired loop — the stage never drifts
  // on its own, and renderOnceCount() is observable for the behavior tests.
  reducedLoop = wireReducedRendering(controls, renderOnce)
  controls.addEventListener('change', () => controls.update())
} else {
  function tick(): void {
    requestAnimationFrame(tick)
    if (mode !== 'scene') return
    controls.update()
    labelRenderer.render(scene, camera)
    renderer.render(scene, camera)
  }
  tick()
}
