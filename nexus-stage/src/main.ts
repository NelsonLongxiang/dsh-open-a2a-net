/**
 * The A2A workbench boot: fetches /__dsh_a2a/state on a poll, feeds the
 * merged workbench (the 2D planning board as the stage + directory/ledger/
 * activity/plan rail, 0.6.2) and keeps the fault discipline
 * (a fetch failure must never masquerade as an empty fleet — the badge is
 * the honesty surface).
 * @module nexus-stage/main
 */
import { createFaultReporter } from './fault'
import { createWorkbench, type StateBody } from './workbench'
import { createPlanningView } from './planning-view'
import { createSaveLoop, type LampState } from './layout-wire'
import { createCanvasWire } from './canvas-wire'
import type { CanvasAction } from './canvas-ops'
import './workbench.css'

const app = document.getElementById('app')!

const faultBadge = document.createElement('div')
faultBadge.className = 'nexus-fault'
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

// ─── Spatial planning board (restored 0.6.1; wiring from the pre-0.6.0 stage) ───
const planning = createPlanningView({
  onDirty: () => saveLoop.markDirty(),
  onLampClick: () => saveLoop.retry(),
  onCanvasAction: async (a) => {
    const ok = await runCanvasAction(a)
    // Settled: converge on truth either way — success absorbs the host's
    // rich state; failure re-pulls so the rollback matches reality.
    void poll()
    return ok
  },
})

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
    case 'create-team': return canvasWire.createTeam(a.name, a.ids, a.created)
    case 'add-member': return canvasWire.addMembers(a.team, a.ids)
    case 'remove-member': return canvasWire.removeMembers(a.team, a.ids)
    case 'remove-team': return canvasWire.removeTeam(a.name)
    case 'reorder': return canvasWire.runRosterOps(a.team, a.ops)
    case 'join-network':
    case 'leave-network': return postNetworkJoin(a.type === 'join-network' ? 'join' : 'leave', a.id)
  }
}

/** Network join/leave for one session (the panel-slim migration: this
 *  affordance lives on the planning view's node list). */
async function postNetworkJoin(action: 'join' | 'leave', id: string): Promise<boolean> {
  const r = await fetch(`/__dsh_a2a/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    cache: 'no-store',
  }).catch(() => undefined)
  return r !== undefined && r.ok
}

let lampState: LampState = 'idle'
let canvasFace = false
let lastLayoutJson: string | undefined

async function fetchLayout(): Promise<unknown> {
  const r = await fetch('/__dsh_a2a/canvas-layout', { cache: 'no-store' })
    .then(async (res) => await res.json() as { layout?: unknown }).catch(() => undefined)
  return r?.layout
}

// ─── The workbench ───
const bench = createWorkbench({
  now: () => Date.now(),
  async abandon(taskId, reason) {
    try {
      const res = await fetch('/__dsh_a2a/tasks/abandon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, reason }),
      })
      return res.ok
    } catch {
      return false
    }
  },
  copy(text) {
    void navigator.clipboard?.writeText(text).catch(() => {})
  },
  board: {
    root: planning.root,
    activate: () => planning.activate(),
    deactivate: () => planning.deactivate(),
    available: () => canvasFace,
  },
})
app.appendChild(bench.root)

// Legacy entry compatibility: the old stage link ?mode=plan converges on the
// board stage — in the merged shell canvas mode is already the default while
// the host serves the canvas face, so this only guards the first poll.
if (new URLSearchParams(window.location.search).get('mode') === 'plan') {
  const tryBoard = window.setInterval(() => {
    if (canvasFace) {
      bench.selectTab('board')
      window.clearInterval(tryBoard)
    }
  }, 300)
  window.setTimeout(() => window.clearInterval(tryBoard), 30_000)
}

async function poll(): Promise<void> {
  try {
    const res = await fetch('/__dsh_a2a/state', { cache: 'no-store' })
    if (!res.ok) throw new Error(`/__dsh_a2a/state ${res.status}`)
    const body = (await res.json()) as StateBody
    clearFault()
    bench.update(body)

    // ── Planning board shares this poll: same state payload, same layout GET. ──
    // SessionLite needs `joined: boolean` (workbench rows carry `joined?`):
    // tri-state → boolean without losing the unjoined node-list population.
    const allSessions = (body.sessions ?? []).map(s => ({ ...s, joined: s.joined === true }))
    const teams = body.canvas?.teams ?? []
    const peers = (body.peers ?? []).filter(p => p !== null && typeof p === 'object' && typeof (p as { url?: unknown }).url === 'string')
    const inFlight = (body.inFlight ?? []).filter(r => r !== null && typeof r === 'object' && typeof (r as { team?: unknown }).team === 'string' && typeof (r as { peer?: unknown }).peer === 'string' && Number.isFinite((r as { startedAt?: unknown }).startedAt))
    const remoteTeams = (body.remote ?? [])
      .filter(r => r !== null && typeof r === 'object' && typeof (r as { team?: unknown }).team === 'string' && typeof (r as { via?: unknown }).via === 'string')
      .map(r => ({
        team: r.team,
        name: r.name,
        via: r.via,
        workspace: r.workspace,
        ...(typeof r.origin === 'string' && r.origin !== '' ? { origin: r.origin } : {}),
        ...(Array.isArray(r.teams) && r.teams.length > 0 ? { teams: r.teams.filter((t): t is string => typeof t === 'string' && t !== '') } : {}),
      }))
    planning.reconcile({ sessions: allSessions, teams, peerCount: peers.length, peers, inFlight, remoteTeams })
    canvasFace = body.canvas !== undefined

    const layout = canvasFace ? await fetchLayout() : null
    const layoutJson = JSON.stringify(layout ?? null)
    if (layoutJson !== lastLayoutJson) {
      lastLayoutJson = layoutJson
      // Adopt poll-sourced layouts only while nothing is unsaved/in flight —
      // otherwise a slow GET would revert positions the user is still dragging.
      if ((lampState === 'idle' || lampState === 'saved') && !saveLoop.isBusy()) {
        planning.adoptExternalLayout(layout)
      }
    }
  } catch (err) {
    fault(`state 轮询失败：${String(err)}`)
  }
}

void poll()
window.setInterval(() => {
  if (!document.hidden) void poll()
}, 3000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void poll()
})
