/**
 * A2A network control: a footer action listing this host's sessions as
 * joinable network nodes. Probes the host's session-node state route at
 * registration time (the seat renders only on a host that serves it); each
 * live row shows the session's title, recent-activity excerpt, and team with
 * a join/leave toggle, while cold rows (persisted join intent, agent not back
 * — the dev-restart shape) show the session's list title with a wake action
 * that opens it through the standard flow; the remount joins it after load.
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

/** Wake face the registration injects: opens one session through the standard sessions flow. */
export interface A2aControlInjected {
  readonly openSession: (id: string) => void
}

/** Full component props: the footer-action owner share, the locale seat, and the wake face. */
export type A2aControlProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'a2aNet'> & A2aControlInjected

/** Fetch the host's session-node state; undefined means the route is absent. */
async function fetchState(): Promise<A2aSessionRow[] | undefined> {
  const response = await fetch('/__dsh_a2a/state', { cache: 'no-store' })
  if (!response.ok) return undefined
  const body = await response.json() as { nodes?: boolean; sessions?: A2aSessionRow[] }
  if (body.nodes !== true || !Array.isArray(body.sessions)) return undefined
  return body.sessions
}

/**
 * Render the network toggle and its session popover.
 * @param props - composed slot props.
 * @returns the control element tree.
 */
export function A2aControl({ wide, t, useSessions, openSession }: A2aControlProps) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<A2aSessionRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const stopped = useRef(false)
  useEffect(() => () => { stopped.current = true }, [])
  const wrap = useRef<HTMLDivElement>(null)
  // Cold rows carry no host-side facts; the client's own session list holds
  // the durable title for exactly those sessions.
  const listById = useSessions(state => state.byId)
  // The popover anchors to the trigger's viewport rect: the sidebar column
  // clips its descendants (the collapse slide), so an in-column absolute
  // popover is cut at the column edge whenever the column is narrower than
  // the popover; fixed positioning escapes the clip at rest (the ui-settings
  // panel precedent). The left edge clamps so a narrow viewport never hides
  // the popover's right side.
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const toggleOpen = (): void => {
    if (open) { setOpen(false); return }
    const rect = wrap.current?.getBoundingClientRect()
    if (rect !== undefined) {
      setAnchor({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 336)),
        bottom: window.innerHeight - rect.top + 8,
      })
    }
    setOpen(true)
  }

  const refresh = useCallback((): void => {
    void fetchState().then((rows) => {
      if (!stopped.current && rows !== undefined) setSessions(rows)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    // While the popover is open, titles and activity excerpts keep moving
    // with each turn; poll so the listing visibly follows.
    const poll = setInterval(refresh, 5_000)
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
        <IconGlobeOutline14 />
        {wide ? <span>{t('a2a.label')}</span> : null}
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
                    <div className={css.facts}>
                      <div className={css.name}>{name}</div>
                      <div className={css.description} title={description}>{description}</div>
                      <div className={css.team}>{row.team}</div>
                    </div>
                    {cold
                      ? (
                        <>
                          <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => { toggle(row) }}>
                            {t('a2a.leave')}
                          </Button>
                          <Button variant="primary" size="sm" onClick={() => { openSession(row.id) }}>
                            {t('a2a.wake')}
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
          </div>
        )
        : null}
    </div>
  )
}
