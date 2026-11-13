/**
 * The right bar's decisions view (docs/design/superagent-decision-cards.md): every decision this instance's teams wait for,
 * each with the proposer's recommendation. P2 and P3 can be approved with one click; P0 and P1 need an option chosen. The host
 * enforces that too. Records are data: text nodes only.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './TeamRequestTab.module.css'
import { TeamHealthBanner } from './TeamHealthBanner.tsx'
import { AttachedFiles, stageFiles, useAttachedFiles } from './team-files.tsx'

export type TeamDecisionsTabProps = PropsLocale<'a2aNet'>

export interface DecisionRow {
  readonly id: string; readonly teamId: string; readonly team: string; readonly question: string; readonly level: string
  readonly options: readonly string[]; readonly recommended: string; readonly reason?: string; readonly source: string; readonly title?: string
  /** The team's canvas address: the owner's files are granted to it (C8). */
  readonly address?: string
  /** Files the proposer put on the card (C8). */
  readonly files?: ReadonlyArray<{ readonly sha256: string; readonly size: number; readonly name: string }>
}

const ROUTE = '/__dsh_a2a/superagent/decisions'
const POLL_MS = 8_000

/** Where the owner downloads a file on a card (C8). */
export const fileHref = (row: DecisionRow, sha256: string): string => `${ROUTE}/file?card=${encodeURIComponent(row.id)}&sha256=${sha256}${row.teamId !== '' ? `&teamId=${encodeURIComponent(row.teamId)}` : ''}`

const sizeText = (bytes: number): string => bytes < 1024 ? `${String(bytes)} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

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
  const { files, setFiles, addFiles, dragging, dropProps } = useAttachedFiles(t, (text) => { setError(text) })
  const decide = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setError(undefined)
    // The owner's files go with the decision as reference lines, staged to the team like a request's (C8).
    let refs: string[] = []
    if (files.length > 0) {
      if (row.address === undefined) { setBusy(false); setError(t('team.failed', { reason: t('team.noFileTarget') })); return }
      const staged = await stageFiles(files, row.address)
      if ('refused' in staged) { setBusy(false); setError(t('team.failed', { reason: staged.refused })); return }
      refs = staged.refs
    }
    const refused = await postDecision(row, { ...body, ...(refs.length > 0 ? { files: refs } : {}) })
    setBusy(false)
    if (refused !== undefined) { setError(t('team.failed', { reason: refused })); return }
    done()
  }
  const canConfirm = !busy && (picked !== '' || note.trim() !== '')
  return (
    <article className={`${styles.card} ${dragging ? styles.dragging : ''}`} {...dropProps}>
      <header className={styles.cardHead}>
        <span className={styles.level} data-level={row.level}>{row.level}</span>
        <span className={styles.hint}>{row.team} · {t(row.source === 'router' ? 'team.fromRouter' : row.source === 'observer' ? 'team.fromObserver' : row.source === 'health' ? 'team.fromHealth' : row.source === 'tool' ? 'team.fromTool' : row.source === 'outbound' ? 'team.fromOutbound' : row.source === 'sender' ? 'team.fromSender' : row.source === 'staffing' ? 'team.fromStaffing' : 'team.fromMember')}{row.title !== undefined ? ` · ${row.title}` : ''}</span>
      </header>
      <p className={styles.question}>{row.question}</p>
      {row.reason !== undefined && <p className={styles.hint}>{row.reason}</p>}
      {row.files !== undefined && row.files.length > 0 && (
        <div className={styles.files} aria-label={t('team.cardFiles')}>
          {row.files.map(file => <a key={file.sha256} className={styles.link} href={fileHref(row, file.sha256)} download={file.name}>{file.name}（{sizeText(file.size)}）</a>)}
        </div>
      )}
      {row.options.map(option => (
        <label key={option} className={option === row.recommended ? `${styles.option} ${styles.recommended}` : styles.option}>
          <input type="radio" name={row.id} checked={picked === option} disabled={busy} onChange={() => { setPicked(option) }} />
          <span>{option}</span>
          {option === row.recommended && <span className={styles.badge}>{t('team.recommended')}</span>}
        </label>
      ))}
      <input className={styles.input} value={note} disabled={busy} placeholder={t(row.options.length === 0 ? 'team.decisionWrite' : 'team.decisionNote')} aria-label={t('team.decisionNote')} onChange={(event) => { setNote(event.target.value) }} />
      <AttachedFiles t={t} files={files} setFiles={setFiles} addFiles={addFiles} disabled={busy} hint={false} />
      <div className={styles.actions}>
        {canApprove(row) && <button type="button" className={styles.send} disabled={busy} onClick={() => { void decide({ how: 'approve' }) }}>{t('team.approve')}</button>}
        <button type="button" className={styles.attach} disabled={!canConfirm} onClick={() => { void decide({ how: 'choose', ...(picked !== '' ? { option: picked } : {}), ...(note.trim() !== '' ? { note: note.trim() } : {}) }) }}>{t('team.confirmChoice')}</button>
      </div>
      {error !== undefined && <p role="status" className={styles.error}>{error}</p>}
    </article>
  )
}

/** What one read of the waiting decisions gave: the cards, or why there are none to show. */
export type DecisionsRead = { readonly state: 'ready'; readonly rows: readonly DecisionRow[] } | { readonly state: 'denied' | 'failed' }

/**
 * One read of the waiting decisions. Only a 200 with a `decisions` array is a list; anything else is a failure, never an
 * empty list (feedback 2026-11-12: a refused or failed read looked like nothing waiting).
 * @returns the cards, or why they could not be read.
 */
export async function readDecisions(): Promise<DecisionsRead> {
  try {
    const response = await fetch(ROUTE, { cache: 'no-store' })
    if (response.status === 401 || response.status === 403) return { state: 'denied' }
    if (!response.ok) return { state: 'failed' }
    const out = await response.json() as { decisions?: unknown }
    return Array.isArray(out.decisions) ? { state: 'ready', rows: out.decisions as DecisionRow[] } : { state: 'failed' }
  } catch { return { state: 'failed' } }
}

/**
 * The waiting decisions, as a section of the right bar's one team view: nothing at all once a read says none waits. A read
 * that fails says so — the cards from the last good read stay, marked as possibly out of date — and the next poll tries again.
 * @param props - the slot's locale.
 * @returns the cards under a heading that counts them, and why the last read failed if it did.
 */
export function DecisionList({ t }: TeamDecisionsTabProps) {
  const [rows, setRows] = useState<readonly DecisionRow[]>([])
  const [problem, setProblem] = useState<'denied' | 'failed' | undefined>(undefined)
  const load = useCallback(async (): Promise<void> => {
    const read = await readDecisions()
    if (read.state === 'ready') { setRows(read.rows); setProblem(undefined); return }
    setProblem(read.state)
  }, [])
  useEffect(() => {
    void load()
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [load])
  if (rows.length === 0 && problem === undefined) return null
  return (
    <section className={styles.decisions} aria-label={t('team.decisions')}>
      {rows.length > 0 && <span className={styles.label}>{t('team.decisionsCount', { count: String(rows.length) })}</span>}
      {problem !== undefined && <p role="alert" className={styles.error}>{t(problem === 'denied' ? 'team.decisionsDenied' : 'team.decisionsUnreadable')}{rows.length > 0 ? ` ${t('team.decisionsStale')}` : ''}</p>}
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
    const read = await readDecisions()
    if (read.state !== 'ready') { setState(read.state); return }
    setRows(read.rows)
    setState('ok')
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
