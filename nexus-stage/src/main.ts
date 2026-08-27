import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FRAME_HUES } from './tokens'

// ─── DOM shell ──
const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(app.clientWidth || window.innerWidth, app.clientHeight || window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
app.appendChild(renderer.domElement)

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

function seatAt(i: number): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2; const dist = 12 + Math.random() * 18
  return new THREE.Vector3(Math.cos(angle) * dist, (Math.random() - 0.5) * 2, Math.sin(angle) * dist)
}

async function cycle(): Promise<void> {
  try {
    const res = await fetch('/__dsh_a2a/state', { cache: 'no-store' }); if (!res.ok) return
    const body = await res.json() as StateBody
    const sessions = (body.sessions ?? []).filter((s) => s.joined === true)
    const teams = body.canvas?.teams ?? []
    const peers = body.peers ?? []

    // Seat un-seated nodes
    for (let i = 0; i < sessions.length; i++) {
      const sid = sessions[i]!.id
      if (!meshesById.has(sid)) {
        const isLive = sessions[i]!.live !== false
        const color = isLive ? T.S.nodeLive : T.S.nodeCold
        const mesh = makeNode(color, isLive ? 0.9 : 0.5)
        mesh.userData = { label: sessions[i]!.name ?? sessions[i]!.label, sid }
        mesh.position.copy(seatAt(i))
        nodeGroup.add(mesh); sessionMeshes.set(sid, mesh)
      }
    }

    // Draw membership edges between nodes sharing a canvas team
    lineGroup.clear()
    const edgesMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.15 })

    for (const team of teams) {
      for (let mi = 0; mi < team.members.length; mi++) {
        for (let mj = mi + 1; mj < team.members.length; mj++) {
          const aMesh = meshesById.get(team.members[mi].id)
          const bMesh = meshesById.get(team.members[mj].id)
          if (aMesh && bMesh) {
            const geo = new THREE.BufferGeometry().setFromPoints([aMesh.position.clone(), bMesh.position.clone()])
            lineGroup.add(new THREE.Line(geo, edgesMat.clone()))
          }
        }
      }
    }
  } catch { /* host unreachable */ }
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
