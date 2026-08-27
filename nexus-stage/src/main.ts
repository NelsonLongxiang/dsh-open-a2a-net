import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FRAME_HUES, S } from './tokens'

// ─── DOM shell ──
const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(app.clientWidth || window.innerWidth, app.clientHeight || window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
app.appendChild(renderer.domElement)

// ─── Fault surface ──
// Fetch failures must never masquerade as an empty fleet. The stage is opened
// directly by humans who cannot see devtools logs in passing, so the newest
// fetch fault rides a fixed badge plus a throttled console.error. A healthy
// response hides the badge — visible silence then genuinely means zero rows,
// and "empty" stays distinguishable from "unreachable".
const faultBadge = document.createElement('div')
faultBadge.style.cssText =
  'position:fixed;top:10px;right:10px;max-width:48ch;padding:6px 10px;' +
  'border:1px solid #ef4444;background:#2a0d0dcc;color:#fecaca;' +
  'font:12px/1.5 "JetBrains Mono",monospace;border-radius:4px;' +
  'display:none;z-index:9;pointer-events:none'
app.appendChild(faultBadge)
let lastFaultLoggedAt = 0
function fault(message: string): void {
  const now = Date.now()
  if (now - lastFaultLoggedAt > 60_000) {
    console.error(`[nexus] ${message}`)
    lastFaultLoggedAt = now
  }
  faultBadge.textContent = message
  faultBadge.style.display = 'block'
}
function clearFault(): void {
  if (faultBadge.style.display !== 'none') {
    faultBadge.style.display = 'none'
    lastFaultLoggedAt = 0
  }
}

// ─── Scene, camera, controls ──
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x060a12)
scene.fog = new THREE.FogExp2(0x060a12, 0.005)

const camera = new THREE.PerspectiveCamera(60, app.clientWidth / app.clientHeight, 0.1, 500)
camera.position.set(0, 35, 55)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
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

// ─── Types ──
interface SessionRow {
  id: string; label: string; team: string; name?: string
  joined: boolean; live?: boolean
}
interface TeamMember { id: string; team: string; joined: boolean; live: boolean }
interface CanvasTeam { name: string; team: string; members: TeamMember[] }
interface StateBody { sessions?: SessionRow[]; canvas?: { teams: CanvasTeam[] }; peers?: Array<{ url: string; score?: number }> }

// ─── Mesh builders ──
function makeNode(color: number, r: number): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(r, 1)
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.3 })
  return new THREE.Mesh(g, m)
}

function getHue(s: string): number {
  let h = 0; for (let i = 0; i < s.length; i++) h = ((h * 31 + s.charCodeAt(i)) & 0xfffffff) >>> 0
  return FRAME_HUES[h % FRAME_HUES.length]
}

// ─── Layout persistence ──
async function fetchLayout(): Promise<any | null> {
  try {
    const r = await fetch('/__dsh_a2a/canvas-layout', { cache: 'no-store' }); if (!r.ok) return null;
    const j = await r.json(); return j.layout ?? null
  } catch { return null }
}

// ─── Boot / poll / reconcile ──
const meshesById = new Map<string, THREE.Mesh>()
/** Seat index for edge drawing: sid → the mesh currently sitting there. */
const sessionMeshes = new Map<string, THREE.Mesh>()

function seatAt(i: number): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2; const dist = 12 + Math.random() * 18
  return new THREE.Vector3(Math.cos(angle) * dist, (Math.random() - 0.5) * 2, Math.sin(angle) * dist)
}

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
  const sessions = (body.sessions ?? []).filter((s) => s.joined === true)
  const teams = body.canvas?.teams ?? []
  const peers = body.peers ?? []
  // Read-path of layout persistence (write-path arrives with planning mode):
  // a node saved on a previous visit keeps its world spot instead of a fresh
  // random seat, so saved arrangements survive reloads.
  const layout = await fetchLayout()

  // Seat un-seated nodes.
  for (let i = 0; i < sessions.length; i++) {
    const sid = sessions[i]!.id
    if (!meshesById.has(sid)) {
      const isLive = sessions[i]!.live !== false
      const color = isLive ? S.nodeLive : S.nodeCold
      const mesh = makeNode(color, isLive ? 0.9 : 0.5)
      mesh.userData = { label: sessions[i]!.name ?? sessions[i]!.label, sid }
      const saved = layout?.nodes?.[sid]
      mesh.position.copy(saved ? new THREE.Vector3(saved.x, 0, saved.y) : seatAt(i))
      nodeGroup.add(mesh)
      sessionMeshes.set(sid, mesh)
    }
  }

  // Draw membership edges between nodes sharing a canvas team. The opacity
  // is empirical: 0.15 cyan on near-black measured invisible against the fog
  // even while technically rendering (external UX review P0-3), so the view
  // drew six silent non-lines over today's demo team. One shared material is
  // enough — every edge answers to the same visibility contract.
  lineGroup.clear()
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.6 })
  for (const team of teams) {
    for (let mi = 0; mi < team.members.length; mi++) {
      for (let mj = mi + 1; mj < team.members.length; mj++) {
        const aMesh = meshesById.get(team.members[mi].id)
        const bMesh = meshesById.get(team.members[mj].id)
        if (aMesh && bMesh) {
          const geo = new THREE.BufferGeometry().setFromPoints([aMesh.position.clone(), bMesh.position.clone()])
          lineGroup.add(new THREE.Line(geo, edgesMat))
        }
      }
    }
  }
}

setInterval(() => void cycle(), 5000)
void cycle()

// ─── Animate ──
const clock = new THREE.Clock()
function tick(): void {
  requestAnimationFrame(tick)
  controls.update()
  renderer.render(scene, camera)
}
tick()
