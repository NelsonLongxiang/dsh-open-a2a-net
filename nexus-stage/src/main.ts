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

// gh#9 §10: the host injects the control-plane key into the shell when
// apiKey is configured — stamp it on every /__dsh_a2a write so the GUI
// survives a keyed host (same-origin disclosure only, see the serve site).
const CONTROL_KEY = (window as unknown as { __DSH_A2A_KEY__?: string }).__DSH_A2A_KEY__ ?? ''
const controlFetch = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined ?? {}), ...(CONTROL_KEY !== '' ? { 'X-API-Key': CONTROL_KEY } : {}) } })

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
// 0.6.13: board node picks forward to the workbench chat drawer. The bench
// is created later (it embeds the board), so the dep is a late-bound slot.
let openNodeChat: ((id: string) => void) | undefined
const planning = createPlanningView({
  onDirty: () => saveLoop.markDirty(),
  onLampClick: () => saveLoop.retry(),
  onNodePick: (id) => { openNodeChat?.(id) },
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
  send: (doc, opts) => controlFetch('/__dsh_a2a/canvas-layout', {
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
    const r = await controlFetch('/__dsh_a2a/canvas', {
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
  const r = await controlFetch(`/__dsh_a2a/${action}`, {
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
/** True once any layout answer (saved doc or an explicit null) has been
 * seen; the board build waits for that answer on the very first poll. */
let layoutSeen = false

/** Fetch the persisted layout; throws on transport failure so the poll can
 * hold the board build instead of silently building on ring seats. */
async function fetchLayout(): Promise<unknown> {
  const res = await controlFetch('/__dsh_a2a/canvas-layout', { cache: 'no-store' })
  if (!res.ok) throw new Error(`/__dsh_a2a/canvas-layout ${res.status}`)
  return ((await res.json()) as { layout?: unknown }).layout ?? null
}

// ─── The workbench ───
const bench = createWorkbench({
  now: () => Date.now(),
  async abandon(taskId, reason) {
    try {
      const res = await controlFetch('/__dsh_a2a/tasks/abandon', {
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
  // 0.6.10: the ↗ jump affordances (0.6.7 L1 broadcast / 0.6.8 L2 deep
  // link) are REMOVED by ruling — 禁止任何跳转，全部使用响应式布局.
  // The only reach primitive is the inline 快派 form: it works for local
  // session teams, canvas teams and remote rows alike, and never leaves
  // this page.
  async canvasOp(action, name, id) {
    // Same control route the planning board's wire uses; the inspector's
    // member writes are one id at a time, so no serial fan-out needed.
    try {
      const res = await controlFetch('/__dsh_a2a/canvas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, name, id }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (res.ok && body.ok !== false) return true
      console.warn(`canvas ${action} ${name}: ${body.error ?? `HTTP ${res.status}`}`)
      return false
    } catch {
      return false
    }
  },
  async dispatchQuick(team, message) {
    // Quick dispatch (0.6.9): host-face POST; the trunk answers with the
    // canonical route shape ({ok, task_id, task_status, team, ...} on
    // delivery) or {ok:false, error}.
    try {
      const res = await controlFetch('/__dsh_a2a/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ team, message }),
      })
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; task_id?: string; reply?: string; error?: string }
      return {
        ok: res.ok && body.ok === true,
        task_id: body.task_id,
        reply: body.reply,
        error: body.error ?? `HTTP ${res.status}`,
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  async sessionLog(id) {
    // Inline transcript (0.6.11): read-only tail of a local session's own
    // log from the host control face. Caps live server-side.
    try {
      const res = await controlFetch(`/__dsh_a2a/session-log?id=${encodeURIComponent(id)}`)
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; messages?: Array<{ role: string; text: string }>; error?: string }
      // 0.6.16: error stays undefined on success — an unconditional
      // `body.error ?? HTTP ${status}` painted "HTTP 200" on listing-shaped
      // successes that lacked a messages field.
      return { ok: res.ok && body.ok === true, messages: body.messages, error: body.error ?? (res.ok ? undefined : `HTTP ${res.status}`) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  async sessionLogList() {
    // 0.6.12: host-scope readable-log listing — archived and never-joined
    // sessions included; the network directory is not the reading gate.
    try {
      const res = await controlFetch('/__dsh_a2a/session-log')
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; sessions?: Array<{ id: string; mtimeMs: number; sizeBytes: number }>; error?: string }
      return { ok: res.ok && body.ok === true, sessions: body.sessions, error: body.error ?? (res.ok ? undefined : `HTTP ${res.status}`) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  async remoteSessionLog(query) {
    // 0.6.15: proxy read of a remote host's /a2a/log — by tracked peer url or
    // by team handle (directory-resolved). The proxy is the only reader; the
    // browser never dials the peer directly.
    try {
      const params = new URLSearchParams()
      if (query.team !== undefined) params.set('team', query.team)
      if (query.peer !== undefined) params.set('peer', query.peer)
      if (query.id !== undefined) params.set('id', query.id)
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      const res = await controlFetch(`/__dsh_a2a/remote-session-log?${params.toString()}`)
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        messages?: Array<{ role: string; text: string }>
        sessions?: Array<{ id: string; mtimeMs: number; sizeBytes: number }>
        error?: string
        via?: string
      }
      return { ok: res.ok && body.ok === true, messages: body.messages, sessions: body.sessions, error: body.error ?? (res.ok ? undefined : `HTTP ${res.status}`), via: body.via }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
  board: {
    root: planning.root,
    activate: () => planning.activate(),
    deactivate: () => planning.deactivate(),
    available: () => canvasFace,
  },
})
app.appendChild(bench.root)
// 0.6.13: board node picks now resolve against the live bench state.
openNodeChat = (id) => { bench.openNodeChat(id) }

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
    const res = await controlFetch('/__dsh_a2a/state', { cache: 'no-store' })
    if (!res.ok) throw new Error(`/__dsh_a2a/state ${res.status}`)
    const body = (await res.json()) as StateBody
    clearFault()
    bench.update(body)
    canvasFace = body.canvas !== undefined

    // ── The layout answer precedes the first reconcile on purpose ──
    // The board's first build reads `layoutDoc` for saved positions and
    // frame rects; every later pass keeps live geometry ("live rect wins").
    // A layout landing AFTER the build therefore never displaces the ring
    // seats — the refresh-reset-to-middle bug. Until any answer (doc or
    // null) has been seen, a failed GET holds the board one poll rather
    // than building on seats; after that, failures leave the last doc in
    // place and the poll continues.
    if (canvasFace) {
      try {
        const layout = await fetchLayout()
        const layoutJson = JSON.stringify(layout ?? null)
        if (layoutJson !== lastLayoutJson) {
          lastLayoutJson = layoutJson
          // Adopt poll-sourced layouts only while nothing is unsaved/in
          // flight — otherwise a slow GET would revert positions the user
          // is still dragging.
          if ((lampState === 'idle' || lampState === 'saved') && !saveLoop.isBusy()) {
            planning.adoptExternalLayout(layout)
          }
        }
        layoutSeen = true
      } catch (err) {
        if (!layoutSeen) {
          fault(`canvas layout 获取失败：${String(err)}`)
          return
        }
      }
    } else {
      layoutSeen = true
    }

    // ── Planning board shares this poll: same state payload. ──
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
