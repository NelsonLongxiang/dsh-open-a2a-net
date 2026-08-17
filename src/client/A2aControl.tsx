/**
 * A2A network control: a footer action opening this host's network panel.
 * Probes the host's session-node state route at registration time (the seat
 * renders only on a host that serves it). The panel has three sections:
 * session nodes (live rows show title, recent-activity excerpt, and team with
 * a join/leave toggle and open the session on row click — the wake action on
 * cold rows opens the session through the standard flow), the peer fleet
 * (tracked URLs with quality scores), and the recent routing activity ring
 * (inbound and outbound outcomes). While open, the panel polls so listings
 * visibly follow each turn.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './A2aControl.module.css'

/** One session as the host's state route reports it. */
export interface A2aSessionRow {
  readonly id: string
  readonly label: string
  readonly team: string
  readonly name?: string
  readonly description?: string
  readonly joined: boolean
  /** `false` on cold rows: the join intent is persisted but the session's agent is not loaded. */
  readonly live?: boolean
}

/** One tracked peer as the state route reports it. */
export interface A2aPeerRow {
  readonly url: string
  readonly score?: number
}

/** One routing outcome as the state route reports it. */
export interface A2aActivityRow {
  readonly ts: number
  readonly dir: 'in' | 'out'
  readonly team: string
  readonly peer: string
  readonly ok: boolean
}

/** One in-flight outbound route as the state route reports it. */
export interface A2aInFlightRow {
  readonly team: string
  readonly peer: string
  readonly startedAt: number
}

/** The state route's full body. */
export interface A2aState {
  readonly sessions: readonly A2aSessionRow[]
  readonly peers: readonly A2aPeerRow[]
  readonly activity: readonly A2aActivityRow[]
  readonly inFlight: readonly A2aInFlightRow[]
}

/** Wake face the registration injects: opens one session through the standard sessions flow. */
export interface A2aControlInjected {
  readonly openSession: (id: string) => void
}

/** Full component props: the footer-action owner share, the locale seat, and the wake face. */
export type A2aControlProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'a2aNet'> & A2aControlInjected

/** Fetch the host's network state; undefined means the route is absent. */
async function fetchState(): Promise<A2aState | undefined> {
  const response = await fetch('/__dsh_a2a/state', { cache: 'no-store' })
  if (!response.ok) return undefined
  const body = await response.json() as { nodes?: boolean; sessions?: A2aSessionRow[]; peers?: A2aPeerRow[]; activity?: A2aActivityRow[]; inFlight?: A2aInFlightRow[] }
  if (body.nodes !== true || !Array.isArray(body.sessions)) return undefined
  return {
    sessions: body.sessions,
    peers: Array.isArray(body.peers) ? body.peers : [],
    activity: Array.isArray(body.activity) ? body.activity : [],
    inFlight: Array.isArray(body.inFlight) ? body.inFlight : [],
  }
}

/** Compact relative time for an activity row. */
function relativeTime(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m`
  return `${String(Math.round(minutes / 60))}h`
}

/**
 * Render the network toggle and its network panel.
 * @param props - composed slot props.
 * @returns the control element tree.
 */
export function A2aControl({ wide, t, useSessions, openSession }: A2aControlProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<A2aState>({ sessions: [], peers: [], activity: [], inFlight: [] })
  const [busy, setBusy] = useState<string | null>(null)
  const [seenActivity, setSeenActivity] = useState(0)
  const stopped = useRef(false)
  useEffect(() => () => { stopped.current = true }, [])
  const wrap = useRef<HTMLDivElement>(null)
  // Cold rows carry no host-side facts; the client's own session list holds
  // the durable title for exactly those sessions.
  const listById = useSessions(state2 => state2.byId)
  // The popover anchors to the trigger's viewport rect: the sidebar column
  // clips its descendants (the collapse slide), so an in-column absolute
  // popover is cut at the column edge whenever the column is narrower than
  // the popover; fixed positioning escapes the clip at rest (the ui-settings
  // panel precedent). The left edge clamps so a narrow viewport never hides
  // the popover's right side.
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  // The unread badge counts inbound activity entries that arrived while the
  // panel was closed; opening the panel clears it.
  const unread = Math.max(0, state.activity.filter(entry => entry.dir === 'in').length - seenActivity)
  const toggleOpen = (): void => {
    if (open) { setOpen(false); return }
    const rect = wrap.current?.getBoundingClientRect()
    if (rect !== undefined) {
      setAnchor({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 336)),
        bottom: window.innerHeight - rect.top + 8,
      })
    }
    setSeenActivity(state.activity.filter(entry => entry.dir === 'in').length)
    setOpen(true)
  }

  const refresh = useCallback((): void => {
    void fetchState().then((next) => {
      if (!stopped.current && next !== undefined) setState(next)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  useEffect(() => {
    // The unread badge lives on the closed trigger, so the state must move
    // even while the panel is closed — a slow poll keeps it fresh; the open
    // panel's faster poll below takes over while visible.
    const slow = setInterval(refresh, 10_000)
    refresh()
    return () => { clearInterval(slow) }
  }, [refresh])

  useEffect(() => {
    if (!open) return
    // While the panel is open, titles, activity excerpts, and the routing
    // ring keep moving; poll so the listing visibly follows.
    const poll = setInterval(refresh, 2_000)
    return () => { clearInterval(poll) }
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if ((event.target as HTMLElement).closest(`.${css.wrap}`) === null) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown) }
  }, [open])

  /** Join or leave one session, then refresh the listing. */
  const toggle = (row: A2aSessionRow): void => {
    setBusy(row.id)
    void fetch(`/__dsh_a2a/${row.joined ? 'leave' : 'join'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id }),
    })
      .then(() => { refresh() })
      .catch(() => {})
      .finally(() => { if (!stopped.current) setBusy(null) })
  }

  const { sessions, peers, activity, inFlight } = state

  return (
    <div ref={wrap} className={clsx(css.wrap, wide ? css.wide : css.rail)}>
      <Button
        variant="ghost"
        size="sm"
        title={t('a2a.label')}
        aria-label={t('a2a.label')}
        aria-expanded={open}
        onClick={() => { toggleOpen() }}
      >
        <span className={css.trigger}>
          <IconGlobeOutline14 />
          {wide ? <span>{t('a2a.label')}</span> : null}
          {unread > 0 ? <span className={css.unreadBadge} aria-label={String(unread)}>{unread > 9 ? '9+' : String(unread)}</span> : null}
        </span>
      </Button>
      {open
        ? (
          <div
            className={css.popover}
            role="dialog"
            aria-label={t('a2a.title')}
            style={anchor === null ? undefined : { left: `${String(anchor.left)}px`, bottom: `${String(anchor.bottom)}px` }}
          >
            <div className={css.title}>{t('a2a.title')}</div>
            {sessions.length === 0
              ? <div className={css.empty}>{t('a2a.empty')}</div>
              : sessions.map((row) => {
                const cold = row.live === false
                const name = cold ? (listById[row.id as keyof typeof listById]?.displayTitle ?? row.label) : (row.name ?? row.label)
                const description = cold ? t('a2a.cold') : (row.description ?? '')
                return (
                  <div key={row.id} className={clsx(css.row, row.joined && css.joined)}>
                    <button
                      type="button"
                      className={css.facts}
                      title={row.live === false ? t('a2a.wake') : name}
                      onClick={() => { openSession(row.id) }}
                    >
                      <span className={css.nameRow}>
                        <span className={clsx(css.stateDot, cold ? 'cold' : 'live', row.joined && 'joined')} aria-hidden />
                        <span className={css.name}>{name}</span>
                      </span>
                      <span className={css.description}>{description}</span>
                      <span className={css.team}>{row.team}</span>
                    </button>
                    {cold
                      ? (
                        <>
                          <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => { toggle(row) }}>
                            {t('a2a.leave')}
                          </Button>
                        </>
                      )
                      : (
                        <Button
                          variant={row.joined ? 'outline' : 'primary'}
                          size="sm"
                          disabled={busy === row.id}
                          onClick={() => { toggle(row) }}
                        >
                          {row.joined ? t('a2a.leave') : t('a2a.join')}
                        </Button>
                      )}
                  </div>
                )
              })}
            <div className={css.note}>{t('a2a.note')}</div>
            <div className={css.sectionTitle}>{t('a2a.peers')}</div>
            {peers.length === 0
              ? <div className={css.empty}>{t('a2a.peersEmpty')}</div>
              : (
                <div className={css.peerGrid}>
                  {peers.map((peer) => (
                    <span key={peer.url} className={css.peerChip} title={peer.url}>
                      <span className={css.peerHost}>{peer.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}</span>
                      {typeof peer.score === 'number' ? <span className={css.peerScore}>{String(Math.round(peer.score))}</span> : null}
                    </span>
                  ))}
                </div>
              )}
            <div className={css.sectionTitle}>{t('a2a.activity')}</div>
            {inFlight.length > 0 && (
              <div className={css.inFlightList} aria-label={t('a2a.inFlight')}>
                {inFlight.map((route) => (
                  <div key={`${route.team}-${String(route.startedAt)}`} className={css.inFlightRow}>
                    <span className={css.inFlightPulse} aria-hidden />
                    <span className={clsx(css.activityDir, 'out')}>{'→'}</span>
                    <span className={css.activityTeam} title={route.team}>{route.team}</span>
                    <span className={css.activityPeer}>{route.peer === 'local' ? '' : route.peer.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}</span>
                    <span className={css.activityTime}>{relativeTime(route.startedAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {activity.length === 0
              ? <div className={css.empty}>{t('a2a.activityEmpty')}</div>
              : (
                <div className={css.activityList}>
                  {[...activity].reverse().slice(0, 10).map((entry, index) => {
                    // A same-host session team resolves to its session row;
                    // clicking the activity line jumps there (the linkage
                    // into an ongoing collaboration).
                    const target = sessions.find(row => row.team === entry.team)
                    const fresh = Date.now() - entry.ts < 5_000
                    return (
                      <div
                        key={`${String(entry.ts)}-${String(index)}`}
                        className={clsx(css.activityRow, fresh && css.fresh)}
                        data-ok={entry.ok}
                        data-jump={target !== undefined}
                        title={target !== undefined ? t('a2a.jump') : undefined}
                        onClick={() => { if (target !== undefined) openSession(target.id) }}
                        role={target !== undefined ? 'button' : undefined}
                      >
                        <span className={clsx(css.activityDir, entry.dir)}>{entry.dir === 'in' ? '←' : '→'}</span>
                        <span className={css.activityTeam} title={entry.team}>{entry.team}</span>
                        <span className={css.activityPeer} title={entry.peer}>{entry.peer === '' ? '' : entry.peer.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}</span>
                        <span className={css.activityTime}>{relativeTime(entry.ts)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
          </div>
        )
        : null}
    </div>
  )
}
