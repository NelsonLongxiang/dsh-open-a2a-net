/**
 * The right bar's decisions view (docs/design/superagent-decision-cards.md): every decision this instance's teams wait for,
 * each with the proposer's recommendation. P2 and P3 can be approved with one click; P0 and P1 need an option chosen. The host
 * enforces that too. Records are data: text nodes only.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './TeamRequestTab.module.css'
import { TeamHealthBanner } from './TeamHealthBanner.tsx'

export type TeamDecisionsTabProps = PropsLocale<'a2aNet'>

export interface DecisionRow {
  readonly id: string; readonly teamId: string; readonly team: string; readonly question: string; readonly level: string
  readonly options: readonly string[]; readonly recommended: string; readonly reason?: string; readonly source: string; readonly title?: string
}

const ROUTE = '/__dsh_a2a/superagent/decisions'
const POLL_MS = 8_000

/** Only P2 and P3 can be approved with one click, and only with a recommendation to approve. */
export const canApprove = (row: DecisionRow): boolean => (row.level === 'P2' || row.level === 'P3') && row.recommended !== ''

async function postDecision(row: DecisionRow, body: Record<string, unknown>): Promise<string | undefined> {
  try {
    const response = await fetch(ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, ...(row.teamId !== '' ? { teamId: row.teamId } : {}), ...body }) })
    const out = await response.json() as { ok?: boolean; error?: string }
    return response.ok && out.ok === true ? undefined : out.error ?? `HTTP ${String(response.status)}`
  } catch (error) { return String(error) }
}

function Card({ row, t, done }: { readonly row: DecisionRow; readonly done: () => void } & TeamDecisionsTabProps) {
  const [picked, setPicked] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const decide = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    const refused = await postDecision(row, body)
    setBusy(false)
    if (refused !== undefined) { setError(t('team.failed', { reason: refused })); return }
    done()
  }
  const canConfirm = !busy && (picked !== '' || note.trim() !== '')
  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <span className={styles.level} data-level={row.level}>{row.level}</span>
        <span className={styles.hint}>{row.team} · {t(row.source === 'router' ? 'team.fromRouter' : row.source === 'observer' ? 'team.fromObserver' : 'team.fromMember')}{row.title !== undefined ? ` · ${row.title}` : ''}</span>
      </header>
      <p className={styles.question}>{row.question}</p>
      {row.reason !== undefined && <p className={styles.hint}>{row.reason}</p>}
      {row.options.map(option => (
        <label key={option} className={option === row.recommended ? `${styles.option} ${styles.recommended}` : styles.option}>
          <input type="radio" name={row.id} checked={picked === option} disabled={busy} onChange={() => { setPicked(option) }} />
          <span>{option}</span>
          {option === row.recommended && <span className={styles.badge}>{t('team.recommended')}</span>}
        </label>
      ))}
      <input className={styles.input} value={note} disabled={busy} placeholder={t(row.options.length === 0 ? 'team.decisionWrite' : 'team.decisionNote')} aria-label={t('team.decisionNote')} onChange={(event) => { setNote(event.target.value) }} />
      <div className={styles.actions}>
        {canApprove(row) && <button type="button" className={styles.send} disabled={busy} onClick={() => { void decide({ how: 'approve' }) }}>{t('team.approve')}</button>}
        <button type="button" className={styles.attach} disabled={!canConfirm} onClick={() => { void decide({ how: 'choose', ...(picked !== '' ? { option: picked } : {}), ...(note.trim() !== '' ? { note: note.trim() } : {}) }) }}>{t('team.confirmChoice')}</button>
      </div>
      {error !== undefined && <p role="status" className={styles.error}>{error}</p>}
    </article>
  )
}

/**
 * The waiting decisions, as a section of the right bar's one team view: nothing at all while none waits.
 * @param props - the slot's locale.
 * @returns the cards under a heading that counts them.
 */
export function DecisionList({ t }: TeamDecisionsTabProps) {
  const [rows, setRows] = useState<readonly DecisionRow[]>([])
  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(ROUTE, { cache: 'no-store' })
      if (!response.ok) return
      const out = await response.json() as { decisions?: DecisionRow[] }
      setRows(out.decisions ?? [])
    } catch { /* the next poll tries again */ }
  }, [])
  useEffect(() => {
    void load()
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [load])
  if (rows.length === 0) return null
  return (
    <section className={styles.decisions} aria-label={t('team.decisions')}>
      <span className={styles.label}>{t('team.decisionsCount', { count: String(rows.length) })}</span>
      {rows.map(row => <Card key={row.id} row={row} t={t} done={() => { void load() }} />)}
    </section>
  )
}

/**
 * The view's body.
 * @param props - the slot's locale.
 * @returns the waiting decisions.
 */
export function TeamDecisionsTab({ t }: TeamDecisionsTabProps) {
  const [rows, setRows] = useState<readonly DecisionRow[] | undefined>(undefined)
  const [state, setState] = useState<'ok' | 'denied' | 'failed'>('ok')

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(ROUTE, { cache: 'no-store' })
      if (response.status === 401 || response.status === 403) { setState('denied'); return }
      if (!response.ok) { setState('failed'); return }
      const out = await response.json() as { decisions?: DecisionRow[] }
      setRows(out.decisions ?? [])
      setState('ok')
    } catch { setState('failed') }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [load])

  if (state !== 'ok') return <div className={styles.view}><p className={styles.hint}>{t(state === 'denied' ? 'team.denied' : 'team.unreadable')}</p></div>
  if (rows === undefined) return <div className={styles.view}><p className={styles.hint}>{t('team.loading')}</p></div>
  if (rows.length === 0) return <div className={styles.view}><TeamHealthBanner t={t} /><p className={styles.hint}>{t('team.noDecisions')}</p></div>
  return <div className={styles.view}><TeamHealthBanner t={t} />{rows.map(row => <Card key={row.id} row={row} t={t} done={() => { void load() }} />)}</div>
}
