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
  readonly workspace?: string
  readonly joined: boolean
  /** `false` on cold rows: the join intent is persisted but the session's agent is not loaded. */
  readonly live?: boolean
  /** The user-named group this session is assigned to, if any. */
  readonly group?: string
}

/** One peer-side team row as the state route reports it (origin is its natural group). */
export interface A2aRemoteRow {
  readonly team: string
  readonly name: string
  readonly origin?: string
  readonly workspace?: string
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

/** One outbound task owed a receipt, as the state route reports it. */
export interface A2aTaskRow {
  readonly taskId: string
  readonly team: string
  readonly peer: string
  readonly startedAt: number
  readonly status: string
}

/** One canvas-team member chip as the state route reports it. */
export interface A2aCanvasMemberRow {
  /** The member session id. */
  readonly id: string
  /** The member's node alias team (<team>/<id8>). */
  readonly team: string
  /** Whether the member is on the network (live node or join intent). */
  readonly joined: boolean
  /** Whether the member's agent is mounted right now. */
  readonly live: boolean
}

/** One user-composed multi-member routing group (the wire name is <team>/canvas/<name>). */
export interface A2aCanvasTeamRow {
  readonly name: string
  readonly team: string
  readonly members: readonly A2aCanvasMemberRow[]
}

/** The state route's full body. */
export interface A2aState {
  readonly sessions: readonly A2aSessionRow[]
  readonly groups: readonly string[]
  readonly remote: readonly A2aRemoteRow[]
  readonly peers: readonly A2aPeerRow[]
  readonly activity: readonly A2aActivityRow[]
  readonly inFlight: readonly A2aInFlightRow[]
  readonly tasks: readonly A2aTaskRow[]
  /** The host plugin package version, when the state route reports it. */
  readonly version?: string
  /** Canvas teams: present only when the host serves the canvas face. */
  readonly canvas?: { readonly teams: readonly A2aCanvasTeamRow[] }
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
  const body = await response.json() as { nodes?: boolean; version?: string; sessions?: A2aSessionRow[]; groups?: string[]; remote?: A2aRemoteRow[]; peers?: A2aPeerRow[]; activity?: A2aActivityRow[]; inFlight?: A2aInFlightRow[]; tasks?: A2aTaskRow[]; canvas?: { teams?: A2aCanvasTeamRow[] } }
  if (body.nodes !== true || !Array.isArray(body.sessions)) return undefined
  return {
    sessions: body.sessions,
    groups: Array.isArray(body.groups) ? body.groups : [],
    peers: Array.isArray(body.peers) ? body.peers : [],
    activity: Array.isArray(body.activity) ? body.activity : [],
    inFlight: Array.isArray(body.inFlight) ? body.inFlight : [],
    tasks: Array.isArray(body.tasks) ? body.tasks : [],
    remote: Array.isArray(body.remote) ? body.remote : [],
    ...(Array.isArray(body.canvas?.teams) ? { canvas: { teams: body.canvas.teams } } : {}),
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

/**
 * One session row: the facts block opens the session, the toggle joins or
 * leaves, and the tag button opens the group picker (assign / create /
 * clear).
 */
function SessionRow({ row, t, listById, openSession, busy, onToggle, pickerFor, setPickerFor, groups, newGroupName, setNewGroupName, onAssign }: {
  readonly row: A2aSessionRow
  readonly t: A2aControlProps['t']
  readonly listById: Record<string, { displayTitle?: string }>
  readonly openSession: (id: string) => void
  readonly busy: string | null
  readonly onToggle: (row: A2aSessionRow) => void
  readonly pickerFor: string | null
  readonly setPickerFor: (id: string | null) => void
  readonly groups: readonly string[]
  readonly newGroupName: string
  readonly setNewGroupName: (name: string) => void
  readonly onAssign: (id: string, name: string) => void
}) {
  const cold = row.live === false
  const name = cold ? (listById[row.id as keyof typeof listById]?.displayTitle ?? row.label) : (row.name ?? row.label)
  const description = cold ? t('a2a.cold') : (row.description ?? '')
  const pickerOpen = pickerFor === row.id
  return (
    <div className={clsx(css.row, row.joined && css.joined)}>
      <button
        type="button"
        className={css.facts}
        title={cold ? t('a2a.wake') : name}
        onClick={() => { openSession(row.id) }}
      >
        <span className={css.nameRow}>
          <span className={clsx(css.stateDot, cold ? 'cold' : 'live', row.joined && 'joined')} aria-hidden />
          <span className={css.name}>{name}</span>
          {row.group !== undefined ? <span className={css.groupTag}>{row.group}</span> : null}
        </span>
        <span className={css.description}>{description}</span>
        <span className={css.team}>{row.team}</span>
      </button>
      <button
        type="button"
        className={css.groupButton}
        title={t('a2a.group')}
        aria-label={t('a2a.group')}
        onClick={() => { setPickerFor(pickerOpen ? null : row.id) }}
      >
        #
      </button>
      {cold
        ? (
          <Button variant="outline" size="sm" disabled={busy === row.id} onClick={() => { onToggle(row) }}>
            {t('a2a.leave')}
          </Button>
        )
        : (
          <Button
            variant={row.joined ? 'outline' : 'primary'}
            size="sm"
            disabled={busy === row.id}
            onClick={() => { onToggle(row) }}
          >
            {row.joined ? t('a2a.leave') : t('a2a.join')}
          </Button>
        )}
      {pickerOpen && (
        <div className={css.groupPicker}>
          <button type="button" className={css.groupOption} onClick={() => { onAssign(row.id, '') }}>
            {t('a2a.groupClear')}
          </button>
          {groups.map((group) => (
            <button
              type="button"
              key={group}
              className={clsx(css.groupOption, row.group === group && css.groupOptionActive)}
              onClick={() => { onAssign(row.id, group) }}
            >
              {group}
            </button>
          ))}
          <div className={css.groupNew}>
            <input
              className={css.groupInput}
              value={newGroupName}
              placeholder={t('a2a.groupNew')}
              maxLength={40}
              onChange={(event) => { setNewGroupName(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newGroupName.trim() !== '') onAssign(row.id, newGroupName.trim())
              }}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={newGroupName.trim() === ''}
              onClick={() => { if (newGroupName.trim() !== '') onAssign(row.id, newGroupName.trim()) }}
            >
              {t('a2a.groupNewGo')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Render the network toggle and its network panel.
 * @param props - composed slot props.
 * @returns the control element tree.
 */
export function A2aControl({ wide, t, useSessions, openSession }: A2aControlProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<A2aState>({ sessions: [], groups: [], peers: [], activity: [], inFlight: [], tasks: [], remote: [] })
  const [busy, setBusy] = useState<string | null>(null)
  const [seenActivity, setSeenActivity] = useState(0)
  // Panel-local search: filters session rows by name/team/description.
  const [search, setSearch] = useState('')
  // Group UI: the row whose group picker is open, and collapsed groups.
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
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

  /** Assign one session to a group ('' clears), then refresh. */
  const assign = (id: string, name: string): void => {
    void fetch('/__dsh_a2a/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assign', id, name }),
    })
      .then(() => { setPickerFor(null); setNewGroupName(''); refresh() })
      .catch(() => {})
  }

  // Canvas UI state: the team whose add-member picker is open, and the
  // new-team name being typed.
  const [canvasPickerFor, setCanvasPickerFor] = useState<string | null>(null)
  const [canvasNewName, setCanvasNewName] = useState('')

  /** One canvas control action, then refresh the panel. */
  const postCanvas = (payload: Record<string, unknown>, key: string): void => {
    setBusy(key)
    void fetch('/__dsh_a2a/canvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(() => { refresh() })
      .catch(() => {})
      .finally(() => { if (!stopped.current) setBusy(null) })
  }

  /** Create a canvas team from the section input (noop on blank). */
  const createTeam = (): void => {
    const name = canvasNewName.trim()
    if (name === '') return
    postCanvas({ action: 'create', name }, `canvas:create`)
    setCanvasNewName('')
  }

  const { sessions, groups, peers, activity, inFlight, tasks, remote } = state
  const canvasTeams = state.canvas?.teams ?? []
  const rowById = new Map(sessions.map(row => [row.id, row]))
  /** The display name of one member session (host facts, fallback the id). */
  const memberName = (id: string): string => {
    const found = rowById.get(id)
    return found === undefined ? id : ((found.live === false ? (listById[id as keyof typeof listById]?.displayTitle ?? found.label) : (found.name ?? found.label)))
  }
  // Search filters by name, team, or description (case-insensitive).
  const needle = search.trim().toLowerCase()
  const matches = (row: A2aSessionRow): boolean => {
    if (needle === '') return true
    const name = row.live === false ? (listById[row.id as keyof typeof listById]?.displayTitle ?? row.label) : (row.name ?? row.label)
    return name.toLowerCase().includes(needle)
      || row.team.toLowerCase().includes(needle)
      || (row.description ?? '').toLowerCase().includes(needle)
  }
  const visible = sessions.filter(matches)
  const ungrouped = visible.filter(row => row.group === undefined)
  const grouped = groups
    .map(name => ({ name, rows: visible.filter(row => row.group === name) }))
    .filter(group => group.rows.length > 0)

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
            <input
              className={css.searchInput}
              type="search"
              value={search}
              placeholder={t('a2a.search')}
              aria-label={t('a2a.search')}
              onChange={(event) => { setSearch(event.target.value) }}
            />
            {sessions.length === 0
              ? <div className={css.empty}>{t('a2a.empty')}</div>
              : visible.length === 0
                ? <div className={css.empty}>{t('a2a.searchEmpty')}</div>
                : (
                  <>
                    {ungrouped.length > 0 && (
                      <div className={css.sessionGroup}>
                        <button
                          type="button"
                          className={css.groupHead}
                          onClick={() => {
                            setCollapsed((current) => {
                              const next = new Set(current)
                              if (next.has('')) next.delete('')
                              else next.add('')
                              return next
                            })
                          }}
                        >
                          <span className={clsx(css.groupChevron, collapsed.has('') && css.groupChevronClosed)} aria-hidden>▾</span>
                          {t('a2a.groupDefault')} · {String(ungrouped.length)}
                        </button>
                        {!collapsed.has('') && ungrouped.map((row) => (
                          <SessionRow
                            key={row.id}
                            row={row}
                            t={t}
                            listById={listById}
                            openSession={openSession}
                            busy={busy}
                            onToggle={toggle}
                            pickerFor={pickerFor}
                            setPickerFor={setPickerFor}
                            groups={groups}
                            newGroupName={newGroupName}
                            setNewGroupName={setNewGroupName}
                            onAssign={assign}
                          />
                        ))}
                      </div>
                    )}
                    {grouped.map(({ name, rows }) => {
                      const isCollapsed = collapsed.has(name)
                      return (
                        <div className={css.sessionGroup} key={name}>
                          <button
                            type="button"
                            className={css.groupHead}
                            onClick={() => {
                              setCollapsed((current) => {
                                const next = new Set(current)
                                if (next.has(name)) next.delete(name)
                                else next.add(name)
                                return next
                              })
                            }}
                          >
                            <span className={clsx(css.groupChevron, isCollapsed && css.groupChevronClosed)} aria-hidden>▾</span>
                            {name} · {String(rows.length)}
                          </button>
                          {!isCollapsed && rows.map((row) => (
                            <SessionRow
                              key={row.id}
                              row={row}
                              t={t}
                              listById={listById}
                              openSession={openSession}
                              busy={busy}
                              onToggle={toggle}
                              pickerFor={pickerFor}
                              setPickerFor={setPickerFor}
                              groups={groups}
                              newGroupName={newGroupName}
                              setNewGroupName={setNewGroupName}
                              onAssign={assign}
                            />
                          ))}
                        </div>
                      )
                    })}
                  </>
                )}
            <div className={css.note}>{t('a2a.note')}</div>
            {state.canvas !== undefined && (
              <>
                <div className={css.sectionTitle}>{t('a2a.canvasTitle')}</div>
                <div className={css.canvasCreate}>
                  <input
                    className={css.groupInput}
                    value={canvasNewName}
                    placeholder={t('a2a.canvasNew')}
                    maxLength={40}
                    aria-label={t('a2a.canvasNew')}
                    onChange={(event) => { setCanvasNewName(event.target.value) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') createTeam()
                    }}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={canvasNewName.trim() === ''}
                    onClick={() => { createTeam() }}
                  >
                    {t('a2a.canvasNewGo')}
                  </Button>
                </div>
                {canvasTeams.length === 0
                  ? <div className={css.empty}>{t('a2a.canvasEmpty')}</div>
                  : canvasTeams.map(teamRow => {
                    const isCollapsed = collapsed.has('canvas:' + teamRow.name)
                    return (
                      <div className={css.sessionGroup} key={teamRow.name}>
                        <button
                          type="button"
                          className={css.groupHead}
                          onClick={() => {
                            setCollapsed((current) => {
                              const next = new Set(current)
                              if (next.has('canvas:' + teamRow.name)) next.delete('canvas:' + teamRow.name)
                              else next.add('canvas:' + teamRow.name)
                              return next
                            })
                          }}
                        >
                          <span className={clsx(css.groupChevron, isCollapsed && css.groupChevronClosed)} aria-hidden>▾</span>
                          {teamRow.name} · {String(teamRow.members.length)}
                        </button>
                        {!isCollapsed && (
                          <>
                            <span className={css.team}>{teamRow.team}</span>
                            {teamRow.members.map(member => (
                              <span className={css.canvasChip} key={member.id}>
                                <span className={clsx(css.stateDot, member.live ? 'live' : 'cold', member.joined && 'joined')} aria-hidden />
                                <span title={member.team}>{memberName(member.id)}</span>
                                <button
                                  type="button"
                                  className={css.canvasChipRemove}
                                  title={`${String(t('a2a.canvasRemove'))}: ${memberName(member.id)} (${teamRow.name})`}
                                  aria-label={`${String(t('a2a.canvasRemove'))}: ${memberName(member.id)} (${teamRow.name})`}
                                  disabled={busy === `canvas:${teamRow.name}`}
                                  onClick={() => { postCanvas({ action: 'remove-member', name: teamRow.name, id: member.id }, `canvas:${teamRow.name}`) }}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            <div className={css.canvasActions}>
                              <Button variant="outline" size="sm" onClick={() => { setCanvasPickerFor(canvasPickerFor === teamRow.name ? null : teamRow.name) }}>
                                {t('a2a.canvasAdd')}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy === `canvas:del:${teamRow.name}`}
                                onClick={() => { postCanvas({ action: 'remove', name: teamRow.name }, `canvas:del:${teamRow.name}`) }}
                              >
                                {t('a2a.canvasDelete')}
                              </Button>
                            </div>
                            {canvasPickerFor === teamRow.name && (
                              <div className={css.groupPicker}>
                                {((): readonly A2aSessionRow[] => state.sessions.filter(candidate =>
                                  candidate.joined && !teamRow.members.some(member => member.id === candidate.id)))().map(candidate => (
                                    <button
                                      type="button"
                                      key={candidate.id}
                                      className={css.groupOption}
                                      onClick={() => { postCanvas({ action: 'add-member', name: teamRow.name, id: candidate.id }, `canvas:${teamRow.name}`); setCanvasPickerFor(null) }}
                                    >
                                      {memberName(candidate.id)}{candidate.live === false ? ` — ${t('a2a.cold')}` : ''}
                                    </button>
                                  ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
              </>
            )}
            {(needle === '' ? remote : remote.filter(row => row.team.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || (row.origin ?? '').toLowerCase().includes(needle) || (row.workspace ?? '').toLowerCase().includes(needle))).length > 0 && (
              <>
                <div className={css.sectionTitle}>{t('a2a.remote')}</div>
                {Object.entries(
                  (needle === '' ? remote : remote.filter(row => row.team.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || (row.origin ?? '').toLowerCase().includes(needle) || (row.workspace ?? '').toLowerCase().includes(needle)))
                    .reduce<Record<string, A2aRemoteRow[]>>((byOrigin, row) => {
                      const key = row.origin ?? ''
                      byOrigin[key] = [...(byOrigin[key] ?? []), row]
                      return byOrigin
                    }, {}),
                ).map(([origin, rows]) => (
                  <div className={css.sessionGroup} key={origin}>
                    <button
                      type="button"
                      className={css.groupHead}
                      onClick={() => {
                        setCollapsed((current) => {
                          const next = new Set(current)
                          if (next.has('remote:' + origin)) next.delete('remote:' + origin)
                          else next.add('remote:' + origin)
                          return next
                        })
                      }}
                    >
                      <span className={clsx(css.groupChevron, collapsed.has('remote:' + origin) && css.groupChevronClosed)} aria-hidden>▾</span>
                      {origin === '' ? t('a2a.remoteUnknownOrigin') : origin} · {String(rows.length)}
                    </button>
                    {!collapsed.has('remote:' + origin) && rows.map((row) => (
                      <div className={css.row} key={row.team} title={row.workspace ?? undefined}>
                        <div className={css.facts}>
                          <span className={css.nameRow}>
                            <span className={css.stateDot} data-peer aria-hidden />
                            <span className={css.name}>{row.name === '' ? row.team : row.name}</span>
                            {row.workspace !== undefined ? <span className={css.groupTag}>{row.workspace}</span> : null}
                          </span>
                          <span className={css.team}>{row.team}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
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
                  <div
                    key={`${route.team}-${String(route.startedAt)}`}
                    className={clsx(css.inFlightRow, Date.now() - route.startedAt > 120_000 && css.inFlightStale)}
                    title={Date.now() - route.startedAt > 120_000 ? t('a2a.inFlightStale') : undefined}
                  >
                    <span className={css.inFlightPulse} aria-hidden />
                    <span className={clsx(css.activityDir, 'out')}>{'→'}</span>
                    <span className={css.activityTeam} title={route.team}>{route.team}</span>
                    <span className={css.activityPeer}>{route.peer === 'local' ? '' : route.peer.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}</span>
                    <span className={css.activityTime}>{relativeTime(route.startedAt)}</span>
                  </div>
                ))}
              </div>
            )}
            {tasks.length > 0 && (
              <>
                <div className={css.sectionTitle}>{t('a2a.tasks')}</div>
                <div className={css.inFlightList} aria-label={t('a2a.tasks')}>
                  {tasks.map((task) => (
                    <div
                      key={task.taskId}
                      className={css.inFlightRow}
                      title={t('a2a.tasksNote')}
                    >
                      <span className={clsx(css.activityDir, 'out')}>{'→'}</span>
                      <span className={css.activityTeam} title={task.team}>{task.team}</span>
                      <span className={css.activityPeer}>{task.peer === 'local' ? '' : task.peer.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}</span>
                      <span className={css.activityTime}>{relativeTime(task.startedAt)}</span>
                    </div>
                  ))}
                </div>
              </>
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
