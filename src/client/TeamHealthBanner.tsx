/**
 * What keeps a team from working, shown at the top of both right-bar views (docs/design/superagent-reliability.md, R6), so a
 * problem is seen from the conversation without opening the team page. Records are data: text nodes only.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './TeamRequestTab.module.css'

export interface HealthRow { readonly code: string; readonly team: string; readonly session?: string; readonly title?: string; readonly ticketId?: string; readonly minutes?: number; readonly detail?: string; readonly reason?: string; readonly repo?: string; readonly count?: number }

const POLL_MS = 30_000

/** The words for one problem. */
export function healthLine(row: HealthRow, t: PropsLocale<'a2aNet'>['t']): string {
  const team = row.team === '' ? '' : `${row.team}：`
  if (row.code === 'router-not-loaded') return team + t('team.healthRouter', { session: (row.session ?? '').slice(8, 16) })
  if (row.code === 'router-turn-failed') return team + t('team.healthRouterFailed', { session: (row.session ?? '').slice(8, 16), detail: (row.detail ?? '').slice(0, 120) })
  if (row.code === 'mcp-no-seat') return team + t('team.healthMcpNoSeat', { server: row.title ?? '' })
  if (row.code === 'mcp-token-unavailable') return team + t('team.healthMcpUnavailable', { server: row.title ?? '' })
  if (row.code === 'member-not-loaded') return team + t('team.healthMember', { session: (row.session ?? '').slice(8, 16) })
  if (row.code === 'ticket-quiet') return team + t('team.healthQuiet', { title: row.title ?? row.ticketId ?? '', minutes: String(row.minutes ?? 0) })
  if (row.code === 'tickets-queued') {
    const session = (row.session ?? '').slice(8, 16), repo = row.repo ?? ''
    const why = row.reason === 'member-busy' ? t('team.healthQueuedBusy', { session })
      : row.reason === 'member-absent' ? t('team.healthQueuedAbsent', { session })
      : row.reason === 'no-repo-member' ? t('team.healthQueuedNoRepo', { repo })
      : row.reason === 'repo-busy' ? t('team.healthQueuedRepoBusy', { repo })
      : row.reason === 'delivery-refused' ? t('team.healthQueuedRefused', { session })
      : row.reason === 'launch-stalled' ? t('team.healthQueuedStalled')
      : row.reason === 'at-cap' ? t('team.healthQueuedCap')
      : t('team.healthQueuedAllBusy')
    return team + t('team.healthQueued', { count: String(row.count ?? 1), minutes: String(row.minutes ?? 0), title: row.title ?? row.ticketId ?? '', why })
  }
  return team + row.code
}

export function TeamHealthBanner({ t }: PropsLocale<'a2aNet'>) {
  const [rows, setRows] = useState<readonly HealthRow[]>([])
  useEffect(() => {
    let live = true
    const load = async (): Promise<void> => {
      try {
        const response = await fetch('/__dsh_a2a/superagent/decisions', { cache: 'no-store' })
        if (!response.ok) return
        const out = await response.json() as { health?: HealthRow[] }
        if (live) setRows(out.health ?? [])
      } catch { /* the next poll tries again */ }
    }
    void load()
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => { live = false; clearInterval(timer) }
  }, [])
  if (rows.length === 0) return null
  return (
    <div role="alert" className={styles.health}>
      <strong>{t('team.healthTitle', { count: String(rows.length) })}</strong>
      {rows.slice(0, 5).map(row => <span key={`${row.code}:${row.session ?? row.ticketId ?? ''}:${row.team}`}>{healthLine(row, t)}</span>)}
      <a className={styles.link} href="/__dsh_a2a_nexus/" target="_blank" rel="noreferrer">{t('team.open')}</a>
    </div>
  )
}
