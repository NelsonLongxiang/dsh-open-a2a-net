/**
 * What keeps a team from working, shown at the top of both right-bar views (docs/design/superagent-reliability.md, R6), so a
 * problem is seen from the conversation without opening the team page. Records are data: text nodes only.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './TeamRequestTab.module.css'

export interface HealthRow { readonly code: string; readonly team: string; readonly session?: string; readonly title?: string; readonly ticketId?: string; readonly minutes?: number; readonly detail?: string }

const POLL_MS = 30_000

/** The words for one problem. */
export function healthLine(row: HealthRow, t: PropsLocale<'a2aNet'>['t']): string {
  const team = row.team === '' ? '' : `${row.team}：`
  if (row.code === 'router-not-loaded') return team + t('team.healthRouter', { session: (row.session ?? '').slice(8, 16) })
  if (row.code === 'router-turn-failed') return team + t('team.healthRouterFailed', { session: (row.session ?? '').slice(8, 16), detail: (row.detail ?? '').slice(0, 120) })
  if (row.code === 'member-not-loaded') return team + t('team.healthMember', { session: (row.session ?? '').slice(8, 16) })
  if (row.code === 'ticket-quiet') return team + t('team.healthQuiet', { title: row.title ?? row.ticketId ?? '', minutes: String(row.minutes ?? 0) })
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
