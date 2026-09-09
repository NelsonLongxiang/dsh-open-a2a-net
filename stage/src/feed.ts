import { useStore, type Agent, type StatusKind } from '@/store/store'
import { ACCENTS, CHARACTERS } from './casting'

/**
 * The A2A wire feed. Polls the plugin's session-node state route and
 * projects it into the floor's agent roster; bridges routed-message events
 * behind the same `window.cth.onHiveMessage` seam the upstream floor reads,
 * so the scene file stays verbatim.
 */

interface SessionRow {
  readonly id: string
  readonly label: string
  readonly joined?: boolean
  readonly team: string
  readonly name?: string
  readonly live?: boolean
}

interface ActivityRow {
  readonly ts: number
  readonly dir: 'in' | 'out'
  readonly team: string
  readonly ok: boolean
}

let recentActivityAt = new Map<string, number>()

function statusOf(row: SessionRow): StatusKind {
  if (row.live === false) return 'idle'
  var last = recentActivityAt.get(row.team)
  return last !== undefined && Date.now() - last < 90_000 ? 'working' : 'idle'
}

async function jsonGet(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

export async function refreshFloor(): Promise<void> {
  const body = await jsonGet('/__dsh_a2a/state')
  if (!body || body.nodes !== true || !Array.isArray(body.sessions)) return
  const activity: ActivityRow[] = Array.isArray(body.activity) ? body.activity : []
  const nextRecent = new Map<string, number>()
  for (const a of activity) nextRecent.set(a.team, a.ts)
  recentActivityAt = nextRecent
  const joined = body.sessions.filter((r: SessionRow) => r.joined === true)
  // Deterministic seating: canvas teams first (their member order), then the
  // unassigned bench - so teammates cluster across desk zones naturally.
  const ordered: SessionRow[] = []
  const seen = new Set<string>()
  const teams = body.canvas && Array.isArray(body.canvas.teams) ? body.canvas.teams : []
  for (const t of teams) {
    for (const m of t.members) {
      const row = joined.find((r: SessionRow) => r.id === m.id)
      if (row && !seen.has(row.id)) { ordered.push(row); seen.add(row.id) }
    }
  }
  for (const row of joined) if (!seen.has(row.id)) ordered.push(row)
  const agents: Agent[] = ordered.map((row, i) => ({
    id: row.id,
    name: row.name || row.label,
    character: CHARACTERS[i % CHARACTERS.length],
    accent: ACCENTS[i % ACCENTS.length],
    description: row.team,
    project: '',
    status: statusOf(row),
    action: row.live === false ? 'cold - waiting to be woken' : 'on the floor',
    progress: 0,
    isGod: false,
  }))
  useStore.getState().applyFeed(agents)
}

// ---- window.cth bridge -------------------------------------------------
type HiveMessageEvent = { from: string; targets: string[]; act: any; needsHuman: boolean }
type CthBridge = {
  onHiveMessage: (cb: (e: HiveMessageEvent) => void) => () => void
  hiveTasks: () => Promise<{ tasks?: any[] } | null>
}

const listeners = new Set<(e: HiveMessageEvent) => void>()

declare global {
  interface Window { cth: CthBridge }
}

window.cth = {
  onHiveMessage: function (cb) {
    listeners.add(cb)
    return function () { listeners.delete(cb) }
  },
  hiveTasks: async function () {
    try {
      const body = await jsonGet('/__dsh_a2a/state')
      const tasks = Array.isArray(body && body.tasks) ? body.tasks : []
      return { tasks: tasks.map(function (t: any) { return { id: t.taskId, status: t.status === 'pending' ? 'open' : 'done', assignee: t.team } }) }
    } catch { return null }
  },
}

/** Emit one arrival per new activity row since the watermark. */
export function emitRoutingEvents(previous: ActivityRow[], now: ActivityRow[]): void {
  if (previous.length === now.length) return
  for (let i = previous.length; i < now.length; i++) {
    const row = now[i]
    const act = !row.ok ? 'refuse' : row.dir === 'out' ? 'propose' : 'query'
    const targetAgent = useStore.getState().agents.find(function (a) { return a.description === row.team })
    const targetId = targetAgent ? targetAgent.id : 'human'
    for (const cb of listeners) cb({ from: 'human', targets: [targetId], act: act, needsHuman: false })
  }
}

export async function startPolling(): Promise<void> {
  let prev: ActivityRow[] = []
  for (;;) {
    try {
      const body = await jsonGet('/__dsh_a2a/state')
      const now: ActivityRow[] = Array.isArray(body.activity) ? body.activity : []
      emitRoutingEvents(prev, now)
      prev = now
      await refreshFloor()
    } catch { /* host briefly unreachable; keep the last frame */ }
    await new Promise(function (r) { setTimeout(r, 5000) })
  }
}