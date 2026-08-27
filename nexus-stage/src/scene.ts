import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { StateBody, CanvasTeamRow, SessionRow } from './data'
import { FRAME_HUES } from './tokens'

export class NexusScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly nodeGroup = new THREE.Group()
  private readonly teamGroup = new THREE.Group()
  private readonly peerGroup = new THREE.Group()
  private readonly lineGroup = new THREE.Group()
  private readonly nodeMeshes = new Map<string, THREE.Mesh>()
  private readonly peerMeshes: THREE.Mesh[] = []
  private readonly raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()

  constructor(container: HTMLElement) {
    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x060a12)
    container.appendChild(this.renderer.domElement)

    this.scene.fog = new THREE.FogExp2(0x060a12, 0.006)

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500)
    this.camera.position.set(0, 30, 55)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.minDistance = 10
    this.controls.maxDistance = 160

    // Lights
    this.scene.add(new THREE.AmbientLight(0x334466, 1.5))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(25, 50, 25)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x8b5cf6, 0.4)
    rim.position.set(-25, -8, -18)
    this.scene.add(rim)

    // Reference grid (infinite-canvas feel)
    const gridHelper = new THREE.GridHelper(120, 60, 0x1c2740, 0x111a2e)
    gridHelper.position.y = -16
    this.scene.add(gridHelper)

    this.scene.add(this.teamGroup, this.nodeGroup, this.peerGroup, this.lineGroup)

    window.addEventListener('resize', () => {
      const nw = container.clientWidth || window.innerWidth
      const nh = container.clientHeight || window.innerHeight
      this.renderer.setSize(nw, nh)
      this.camera.aspect = nw / nh
      this.camera.updateProjectionMatrix()
    })
  }

  addNode(id: string, label: string, live: boolean): void {
    if (this.nodeMeshes.has(id)) return
    const color = live ? 0x4ade80 : 0x4a5568
    const radius = live ? 0.9 : 0.55
    const geo = new THREE.IcosahedronGeometry(radius, 1)
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.3 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.userData = { label, id, kind: 'node' }
    const angle = Math.random() * Math.PI * 2
    const dist = 8 + Math.random() * 20
    mesh.position.set(Math.cos(angle) * dist, (Math.random() - 0.5) * 3, Math.sin(angle) * dist)
    this.nodeGroup.add(mesh)
    this.nodeMeshes.set(id, mesh)
  }

  addPeer(url: string): void {
    if (this.peerMeshes.some(p => p.userData.url === url)) return
    const geo = new THREE.OctahedronGeometry(1.3, 0)
    let hash = 0; for (let i = 0; i < url.length; i++) hash = ((hash * 31 + url.charCodeAt(i)) & 0xfffffff) >>> 0
    const color = [0x8b5cf6, 0x14b8a6, 0xf59e0b][hash % 3] ?? 0x8b5cf6
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.75 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set((hash % 50) - 25, 10 + (hash % 12), (hash % 35) - 17)
    mesh.userData = { label: 'Peer: ' + url.slice(7, 36), url, kind: 'peer' }
    this.peerGroup.add(mesh)
    this.peerMeshes.push(mesh)
  }

  drawMembershipLines(teams: Array<{ name: string; members: Array<{ id: string }> }>): void {
    // Clear old membership lines
    for (const child of [...this.lineGroup.children]) {
      this.lineGroup.remove(child)
      if (child instanceof THREE.Line) child.geometry.dispose()
    }

    const lineMat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.15 })
    for (const team of teams) {
      // Team centroid
      const points: THREE.Vector3[] = []
      for (const m of team.members) {
        const nm = this.nodeGroup.children.find(c => c.userData.sid === m.id)
        if (nm && nm instanceof THREE.Mesh) {
          points.push(nm.position.clone())
        }
      }
      if (points.length < 2) continue
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!, b = points[(i + 1) % points.length]
        const g = new THREE.BufferGeometry().setFromPoints([a, b])
        this.lineGroup.add(new THREE.Line(g, lineMat.clone()))
      }
    }

    // Federal lines: origin to each peer channel
    const federalMat = new THREE.LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.2 })
    for (const pm of this.peerMeshes) {
      const fg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -4, 0), pm.position.clone()])
      this.lineGroup.add(new THREE.Line(fg, federalMat.clone()))
    }
  }

  animate(): void {
    requestAnimationFrame(() => this.animate())
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }
}