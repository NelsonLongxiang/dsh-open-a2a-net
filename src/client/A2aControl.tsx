/**
 * A2A network control: a footer action opening this host's recent network
 * activity feed. The feed is the panel's whole content — in-flight routes,
 * owed receipts, and the routing activity ring. Session/team management
 * lives in the planning view (design: docs/design/panel-activity-feed.md):
 * the stage links row above the feed is the explicit navigation to it.
 * Probes the host's state route at registration time (the seat renders only
 * on a host that serves it). While open, the feed polls so it visibly
 * follows each turn; the closed trigger's unread badge rides a slow poll.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './A2aControl.module.css'

/** One session as the host's state route reports it (jump-target lookup only). */
export interface A2aSessionRow {
  readonly id: string
  readonly team: string
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

/** One outbound task owed a receipt, as the state route reports it. */
export interface A2aTaskRow {
  readonly taskId: string
  readonly team: string
  readonly peer: string
  readonly startedAt: number
  readonly status: string
}

/** The state the feed renders. */
export interface A2aState {
  /** Session rows exist only to resolve an activity row's jump target. */
  readonly sessions: readonly A2aSessionRow[]
  readonly activity: readonly A2aActivityRow[]
  readonly inFlight: readonly A2aInFlightRow[]
  readonly tasks: readonly A2aTaskRow[]
  /** The host plugin package version, when the state route reports it. */
  readonly version?: string
  /** Whether the host serves the canvas face (gates the planning deep link). */
  readonly hasCanvas: boolean
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
  const body = await response.json() as { nodes?: boolean; version?: string; sessions?: A2aSessionRow[]; activity?: A2aActivityRow[]; inFlight?: A2aInFlightRow[]; tasks?: A2aTaskRow[]; canvas?: { teams?: unknown[] } }
  if (body.nodes !== true || !Array.isArray(body.sessions)) return undefined
  return {
    sessions: body.sessions,
    activity: Array.isArray(body.activity) ? body.activity : [],
    inFlight: Array.isArray(body.inFlight) ? body.inFlight : [],
    tasks: Array.isArray(body.tasks) ? body.tasks : [],
    hasCanvas: body.canvas !== undefined,
    ...(typeof body.version === 'string' ? { version: body.version } : {}),
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

/** One feed row: direction glyph (aria-labelled), team, peer host, age, fail mark. */
function FeedRow({ dir, team, peer, ts, ok, target, openSession, t }: {
  readonly dir: 'in' | 'out'
  readonly team: string
  readonly peer: string
  readonly ts: number
  readonly ok?: boolean
  readonly target?: A2aSessionRow
  readonly openSession: (id: string) => void
  readonly t: A2aControlProps['t']
}) {
  const fresh = Date.now() - ts < 5_000
  return (
    <div
      className={clsx(css.activityRow, fresh && css.fresh)}
      data-ok={ok === undefined ? undefined : String(ok)}
      data-jump={target !== undefined}
      title={target !== undefined ? t('a2a.jump') : undefined}
      onClick={() => { if (target !== undefined) openSession(target.id) }}
      role={target !== undefined ? 'button' : undefined}
    >
      <span className={clsx(css.activityDir, dir)} aria-label={dir === 'in' ? 'inbound' : 'outbound'}>{dir === 'in' ? '←' : '→'}</span>
      <span className={css.activityTeam} title={team}>{team}</span>
      <span className={css.activityPeer} title={peer}>{peer === '' || peer === 'local' ? '' : peer.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}</span>
      {ok === false ? <span className={css.failMark} aria-label="failed">✕</span> : null}
      <span className={css.activityTime}>{relativeTime(ts)}</span>
    </div>
  )
}

/**
 * Render the network toggle and its activity feed.
 * @param props - composed slot props.
 * @returns the control element tree.
 */
export function A2aControl({ wide, t, openSession }: A2aControlProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<A2aState>({ sessions: [], activity: [], inFlight: [], tasks: [], hasCanvas: false })
  const [seenActivity, setSeenActivity] = useState(0)
  const stopped = useRef(false)
  useEffect(() => () => { stopped.current = true }, [])
  const wrap = useRef<HTMLDivElement>(null)
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
    // While the feed is open, it polls so the ring visibly follows turns.
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

  const { sessions, activity, inFlight, tasks } = state

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
            <div className={css.title}>
              {t('a2a.title')}
              {state.version !== undefined ? <span className={css.versionTag} title={state.version}>v{state.version}</span> : null}
            </div>
            <div className={css.stageRow}>
              <span className={css.stageTitle}>{t('a2a.stageTitle')}</span>
              <span className={css.stageLinks}>
                <a className={css.stageLink} href="/__dsh_a2a_nexus/" target="_blank" rel="noreferrer" title={t('a2a.stageScene')}>
                  {t('a2a.stageScene')}
                </a>
                {state.hasCanvas && (
                  <a className={css.stageLink} href="/__dsh_a2a_nexus/?mode=plan" target="_blank" rel="noreferrer" title={t('a2a.stagePlan')}>
                    {t('a2a.stagePlan')}
                  </a>
                )}
              </span>
            </div>
            <div aria-live="polite">
              {inFlight.length > 0 && (
                <div className={css.inFlightList} aria-label={t('a2a.inFlight')}>
                  {inFlight.map((route) => (
                    <div
                      key={`${route.team}-${String(route.startedAt)}`}
                      className={clsx(css.inFlightRow, Date.now() - route.startedAt > 120_000 && css.inFlightStale)}
                      title={Date.now() - route.startedAt > 120_000 ? t('a2a.inFlightStale') : undefined}
                    >
                      <span className={css.inFlightPulse} aria-hidden />
                      <FeedRow dir="out" team={route.team} peer={route.peer} ts={route.startedAt} openSession={openSession} t={t} />
                    </div>
                  ))}
                </div>
              )}
              {tasks.length > 0 && (
                <>
                  <div className={css.sectionTitle}>{t('a2a.tasks')}</div>
                  <div className={css.inFlightList} aria-label={t('a2a.tasks')}>
                    {tasks.map((task) => (
                      <div key={task.taskId} className={css.inFlightRow} title={t('a2a.tasksNote')}>
                        <FeedRow dir="out" team={task.team} peer={task.peer} ts={task.startedAt} openSession={openSession} t={t} />
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className={css.sectionTitle}>{t('a2a.activity')}</div>
              {activity.length === 0
                ? <div className={css.empty}>{t('a2a.activityEmpty')}</div>
                : (
                  <div className={css.activityList}>
                    {[...activity].reverse().slice(0, 10).map((entry, index) => {
                      // A same-host session team resolves to its session row;
                      // clicking the activity line jumps there (the linkage
                      // into an ongoing collaboration).
                      const target = sessions.find(row => row.team === entry.team)
                      return (
                        <FeedRow
                          key={`${String(entry.ts)}-${String(index)}`}
                          dir={entry.dir}
                          team={entry.team}
                          peer={entry.peer}
                          ts={entry.ts}
                          ok={entry.ok}
                          {...(target !== undefined ? { target } : {})}
                          openSession={openSession}
                          t={t}
                        />
                      )
                    })}
                  </div>
                )}
            </div>
          </div>
        )
        : null}
    </div>
  )
}
