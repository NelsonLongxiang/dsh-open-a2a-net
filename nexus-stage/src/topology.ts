/** Topology plane: shared types, the mock hard-acceptance dataset, and the
 *  edge drawers. Membership uses a hub-star (team centroid + spokes) so GPU
 *  cost grows linearly with roster size instead of O(n²) pairwise lines. */
import * as THREE from 'three'

export interface SessionRow { id: string; label: string; team: string; name?: string; joined: boolean; live?: boolean; inFlight?: boolean }
export interface TeamMember { id: string; team: string; joined: boolean; live: boolean }
export interface CanvasTeam { name: string; team: string; members: TeamMember[] }
export interface StateBody { sessions?: SessionRow[]; canvas?: { teams: CanvasTeam[] }; peers?: Array<{ url: string; score?: number }> }

/** Normalize one raw session row from /state: drops rows without a usable
 *  id, coerces the booleans, and keeps inFlight for activity edges. */
export function normalizeSession(raw: unknown): SessionRow | null {
  const c = raw as Partial<SessionRow> | null | undefined
  if (c === null || typeof c !== 'object') return null
  if (typeof c.id !== 'string' || c.id === '') return null
  return {
    id: c.id,
    label: typeof c.label === 'string' && c.label !== '' ? c.label : c.id,
    team: typeof c.team === 'string' && c.team !== '' ? c.team : 'unassigned',
    name: typeof c.name === 'string' ? c.name : undefined,
    joined: c.joined !== false,
    live: c.live !== false,
    inFlight: c.inFlight === true,
  }
}

/** Normalize a whole state body: malformed rows are skipped individually. */
export function normalizeStateBody(raw: unknown): { sessions: SessionRow[]; teams: CanvasTeam[]; peers: Array<{ url: string; score?: number }> } {
  const body = (raw ?? {}) as Partial<StateBody>
  const sessions: SessionRow[] = []
  if (Array.isArray(body.sessions)) {
    for (const r of body.sessions) {
      const s = normalizeSession(r)
      if (s !== null) sessions.push(s)
    }
  }
  const teams = Array.isArray(body.canvas?.teams) ? body.canvas!.teams : []
  const peers = (Array.isArray(body.peers) ? body.peers : []).filter(
    (p): p is { url: string; score?: number } => p !== null && typeof p === 'object' && typeof (p as { url?: unknown }).url === 'string',
  )
  return { sessions, teams, peers }
}

/** inFlight pairs derive from normalized rows flagged inFlight (the round
 *  ledger's activity projection), drawn by the caller after seeding. */
export function inFlightPairs(sessions: readonly SessionRow[]): Array<[string, string]> {
  const live: string[] = []
  for (const s of sessions) if (s.inFlight === true && s.joined !== false) live.push(s.id)
  const pairs: Array<[string, string]> = []
  for (let i = 0; i + 1 < live.length; i += 2) pairs.push([live[i]!, live[i + 1]!])
  return pairs
}

/** Mock hard-acceptance dataset: 5 nodes / 2 teams / 1 peer. */
export const MOCK = {
  sessions: [
    { id: 's1', label: 'ontology/main', team: 'ontology', name: 'ontology-main', joined: true, live: true },
    { id: 's2', label: 'ontology/dev', team: 'ontology', name: 'ontology-dev', joined: true, live: false },
    { id: 's3', label: 'god/dispatch', team: 'god', name: 'god-dispatch', joined: true, live: true },
    { id: 's4', label: 'logistics/ops', team: 'logistics', name: 'logistics-ops', joined: true, live: true },
    { id: 's5', label: 'pocket/ui', team: 'pocket', name: 'pocket-ui', joined: true, live: false },
  ],
  canvas: { teams: [
    { name: 'core', team: 'ontology', members: [
      { id: 's1', team: 'ontology', joined: true, live: true },
      { id: 's2', team: 'ontology', joined: true, live: false },
      { id: 's3', team: 'god', joined: true, live: true },
    ] },
    { name: 'edge', team: 'logistics', members: [
      { id: 's4', team: 'logistics', joined: true, live: true },
      { id: 's5', team: 'pocket', joined: true, live: false },
    ] },
  ] },
  peers: [{ url: 'http://192.168.3.156:13080', score: 0.9 }],
} satisfies StateBody

/** Team centroid hub + one spoke per member (mesh map keyed by session id). */
export function drawMembership(
  teams: readonly CanvasTeam[],
  meshesById: ReadonlyMap<string, THREE.Object3D>,
  lineGroup: THREE.Group,
  teamGroup: THREE.Group,
): void {
  const mat = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.18 })
  for (const team of teams) {
    const members = team.members.filter(m => meshesById.has(m.id))
    if (members.length < 2) continue
    const centroid = new THREE.Vector3()
    for (const m of members) centroid.add(meshesById.get(m.id)!.position)
    centroid.divideScalar(members.length)
    const hub = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5 }))
    hub.position.copy(centroid)
    teamGroup.add(hub)
    for (const m of members) {
      const g = new THREE.BufferGeometry().setFromPoints([centroid, meshesById.get(m.id)!.position.clone()])
      lineGroup.add(new THREE.Line(g, mat.clone()))
    }
  }
}

/** inFlight activity edges (solid amber). */
export function drawActivity(pairs: ReadonlyArray<readonly [string, string]>, meshesById: ReadonlyMap<string, THREE.Object3D>, lineGroup: THREE.Group): void {
  const mat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.65 })
  for (const [a, b] of pairs) {
    const am = meshesById.get(a); const bm = meshesById.get(b)
    if (!am || !bm) continue
    const g = new THREE.BufferGeometry().setFromPoints([am.position.clone(), bm.position.clone()])
    lineGroup.add(new THREE.Line(g, mat.clone()))
  }
}

/** Peer federation nodes (dashed link from origin). */
export function drawPeers(peers: ReadonlyArray<{ url: string }>, peerGroup: THREE.Group, lineGroup: THREE.Group): void {
  for (const p of peers) {
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 0), new THREE.MeshStandardMaterial({ color: 0x6366f1, emissive: 0x6366f1, emissiveIntensity: 0.5, transparent: true, opacity: 0.75 }))
    mesh.position.set(-20, 14, -12)
    mesh.userData = { label: 'Peer: ' + p.url.slice(7, 36), kind: 'peer' }
    peerGroup.add(mesh)
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -4, 0), mesh.position.clone()])
    const dash = new THREE.LineDashedMaterial({ color: 0x6366f1, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.35 })
    const line = new THREE.Line(g, dash)
    line.computeLineDistances()
    lineGroup.add(line)
  }
}
