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
// gh#40: a REMOTE face (LAN-bound test host, tunnel) serves the shell
// WITHOUT the injected key by design — the credential must not leak to any
// network fetcher. The operator still needs the panel there, so the key
// can be typed once: sessionStorage is browser-local (never transmitted in
// the page), stamped on the same X-API-Key header thereafter.
const storedKey = (() => { try { return window.sessionStorage.getItem('dsh_a2a_key') ?? '' } catch { return '' } })()
const CONTROL_KEY = (window as unknown as { __DSH_A2A_KEY__?: string }).__DSH_A2A_KEY__ ?? storedKey
const controlFetch = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined ?? {}), ...(CONTROL_KEY !== '' ? { 'X-API-Key': CONTROL_KEY } : {}) } })

// gh#40: key-entry affordance — mounts BEFORE the panel when the shell came
// keyless (remote face) and the control plane answers 401. One input, one
// submit; the stored key survives until the tab closes.
if (CONTROL_KEY === '') {
  void controlFetch('/__dsh_a2a/owner-settings').then(res => {
    if (res.status !== 401) return
    const gate = document.createElement('div')
    gate.className = 'nexus-keygate'
    gate.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:#fff;z-index:9999;font:14px/1.5 system-ui,sans-serif;color:#000'
    const label = document.createElement('div')
    label.textContent = '此面板经远程面打开（密钥不随页面下发）——输入控制密钥'
    const input = document.createElement('input')
    input.type = 'password'
    input.placeholder = 'X-API-Key'
    input.setAttribute('aria-label', '控制密钥')
    const submit = document.createElement('button')
    submit.type = 'button'
    submit.textContent = '进入面板'
    const err = document.createElement('div')
    err.style.color = '#b00'
    const tryKey = (): void => {
      const v = input.value.trim()
      if (v === '') return
      void fetch('/__dsh_a2a/owner-settings', { headers: { 'X-API-Key': v } }).then(r => {
        if (r.status === 401) { err.textContent = '密钥不对，再试一次'; return }
        try { window.sessionStorage.setItem('dsh_a2a_key', v) } catch { /* blocked site data: keep in-page */ }
        window.location.reload()
      })
    }
    submit.addEventListener('click', tryKey)
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') tryKey() })
    gate.append(label, input, submit, err)
    document.body.appendChild(gate)
  })
}

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
// Per-device viewport memory: browser-local, one slot per screen bucket.
// Storage can be absent or throw (private windows, blocked site data) —
// every access is guarded and the board falls back to the host/fit path.
const VIEWPORT_KEY = 'dsh-a2a.viewport.'
const viewportStore = {
  get(bucket: string): unknown {
    try {
      const raw = window.localStorage.getItem(VIEWPORT_KEY + bucket)
      return raw === null ? undefined : JSON.parse(raw)
    } catch {
      return undefined
    }
  },
  set(bucket: string, vp: { x: number; y: number; scale: number }): void {
    try {
      window.localStorage.setItem(VIEWPORT_KEY + bucket, JSON.stringify({ x: vp.x, y: vp.y, scale: vp.scale }))
    } catch { /* presentation memory only */ }
  },
}

const planning = createPlanningView({
  viewportStore,
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

/** One relayed op on a REMOTE peer's team. THIS host signs the envelope
 *  and forwards; the peer's link gate authorizes the write. */
async function fleetOp(peer: string, op: 'add-member' | 'remove-member' | 'remove', name: string, id?: string): Promise<boolean> {
  const r = await controlFetch('/__dsh_a2a/fleet-canvas-op', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ peer, op, name, ...(id !== undefined ? { id } : {}) }),
    cache: 'no-store',
  }).catch(() => undefined)
  const body = r !== undefined ? await r.json().catch(() => undefined) : undefined
  if (body?.ok === true && op === 'remove' && body.removed === false) planning.notice('info', `属主那边已没有「${name}」，无需解散`)
  if (body?.ok === true) return true
  // Say WHY the peer refused (not linked, untrusted origin, unknown member…), not just that it did.
  planning.notice('error', `跨主机团队操作失败：${String(body?.error ?? '对端无响应')}`)
  return false
}

function runCanvasAction(a: CanvasAction): Promise<boolean> {
  // gh#41: a remote-frame drop forks to the fleet relay; so does dissolving
  // a mirror frame (single owner + mirror: the owner's store is the truth).
  if ((a.type === 'add-member' || a.type === 'remove-member') && a.fleetPeer !== undefined) {
    const peer = a.fleetPeer
    return (async () => {
      for (const id of a.ids) if (!(await fleetOp(peer, a.type, a.team, id))) return false
      return true
    })()
  }
  if (a.type === 'remove-team' && a.fleetPeer !== undefined) return fleetOp(a.fleetPeer, 'remove', a.name)
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
  // gh#34: the owner three-key panel rides the control face.
  async ownerSettingsRead() {
    try {
      const res = await controlFetch('/__dsh_a2a/owner-settings')
      return await res.json()
    } catch {
      return { ok: false, error: 'unreachable' }
    }
  },
  async ownerSettingsWrite(changes) {
    try {
      const res = await controlFetch('/__dsh_a2a/owner-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      })
      return await res.json()
    } catch {
      return { ok: false, error: 'unreachable' }
    }
  },
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
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; sessions?: Array<{ id: string; mtimeMs: number; sizeBytes: number }>; count?: number; error?: string }
      // count: how many logs the host holds — the list face caps at 50, so the
      // directory can say it is showing 50 of N instead of silently truncating.
      return { ok: res.ok && body.ok === true, sessions: body.sessions, count: typeof body.count === 'number' ? body.count : undefined, error: body.error ?? (res.ok ? undefined : `HTTP ${res.status}`) }
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
    // canvasFace first: bench.update reads board.available() to pick the
    // mode, so assigning it afterwards held the very first paint in data
    // mode (board display:none, 0px wide) until the next 3s poll — and the
    // board's first reconcile measured a zero-width view.
    canvasFace = body.canvas !== undefined
    bench.update(body)

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
    // gh#41: the peers' published canvas org rides the board (remote frames).
    const peerOrg = (body.peerOrg as unknown[] ?? [])
      .filter((r): r is { url?: unknown; org?: unknown } => r !== null && typeof r === 'object')
      .filter(r => typeof r.url === 'string' && Array.isArray(r.org))
      .map(r => ({
        url: r.url as string,
        org: (r.org as unknown[])
          .filter((e): e is { name?: unknown; team?: unknown; members?: unknown } => e !== null && typeof e === 'object')
          .filter(e => typeof e.team === 'string' && e.team !== '')
          .map(e => ({ name: typeof e.name === 'string' ? e.name : '', team: e.team as string, members: Array.isArray(e.members) ? e.members.filter((m): m is string => typeof m === 'string') : [] })),
      }))
    planning.reconcile({ sessions: allSessions, teams, peerCount: peers.length, peers, inFlight, remoteTeams, peerOrg })
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
