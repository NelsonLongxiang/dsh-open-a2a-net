/**
 * The right bar's request view (docs/design/superagent-multi-team.md, M7): a person sends a superagent team a request without
 * leaving the conversation. It uses the team page's own way in, `POST /__dsh_a2a/superagent` `{ action: 'request' }`, so what
 * it sends is the owner's request and goes to the router like any other. Records are data: text nodes only.
 */
import { useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './TeamRequestTab.module.css'

export type TeamRequestTabProps = PropsLocale<'a2aNet'>

/** A team this view can send to. */
export interface RequestTeam { readonly name: string }

export type LoadedTeams = { readonly state: 'ready'; readonly teams: readonly RequestTeam[] } | { readonly state: 'denied' | 'failed' }

const TEAM_ROUTE = '/__dsh_a2a/superagent'

/**
 * This host's team, if it can take a request: bound to a canvas, with a router, and listening on the workbench Source.
 * @returns the teams, or why they could not be read.
 */
export async function loadTeams(): Promise<LoadedTeams> {
  try {
    const response = await fetch(TEAM_ROUTE, { cache: 'no-store' })
    if (response.status === 401 || response.status === 403) return { state: 'denied' }
    if (!response.ok) return { state: 'failed' }
    const { settings } = await response.json() as { settings?: { canvas?: string; router?: string; sources?: { workbench?: boolean } } }
    const ready = settings?.canvas !== undefined && settings.router !== undefined && settings.sources?.workbench !== false
    return { state: 'ready', teams: ready ? [{ name: settings.canvas! }] : [] }
  } catch { return { state: 'failed' } }
}

/** One request, as the team page sends it; undefined when it was taken, otherwise why not. */
async function sendRequest(text: string): Promise<string | undefined> {
  try {
    const response = await fetch(TEAM_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request', text }) })
    const out = await response.json() as { ok?: boolean; error?: string }
    return response.ok && out.ok === true ? undefined : out.error ?? `HTTP ${String(response.status)}`
  } catch (error) { return String(error) }
}

type Note = { readonly tone: 'ok' | 'error'; readonly text: string }

/**
 * The view's body.
 * @param props - the slot's locale.
 * @returns the picker, the text box and the outcome of the last send.
 */
export function TeamRequestTab({ t }: TeamRequestTabProps) {
  const [loaded, setLoaded] = useState<LoadedTeams | undefined>(undefined)
  const [team, setTeam] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | undefined>(undefined)

  useEffect(() => {
    let live = true
    void loadTeams().then((result) => { if (live) setLoaded(result) })
    return () => { live = false }
  }, [])

  const teams = loaded?.state === 'ready' ? loaded.teams : []
  const chosen = teams.find(row => row.name === team) ?? teams[0]
  const canSend = chosen !== undefined && text.trim() !== '' && !busy

  const send = useCallback(async () => {
    if (!canSend) return
    setBusy(true)
    setNote(undefined)
    const refused = await sendRequest(text)
    setBusy(false)
    if (refused !== undefined) { setNote({ tone: 'error', text: t('team.failed', { reason: refused }) }); return }
    setText('')
    setNote({ tone: 'ok', text: t('team.sent', { team: chosen.name }) })
  }, [canSend, chosen, t, text])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send() }
  }

  if (loaded === undefined) return <div className={styles.view}><p className={styles.hint}>{t('team.loading')}</p></div>
  if (loaded.state !== 'ready') return <div className={styles.view}><p className={styles.hint}>{t(loaded.state === 'denied' ? 'team.denied' : 'team.unreadable')}</p></div>
  if (chosen === undefined) return <div className={styles.view}><p className={styles.hint}>{t('team.none')}</p><a className={styles.link} href="/__dsh_a2a_nexus/" target="_blank" rel="noreferrer">{t('team.open')}</a></div>

  return (
    <div className={styles.view}>
      <label className={styles.field}>
        <span className={styles.label}>{t('team.pick')}</span>
        <select className={styles.input} value={chosen.name} onChange={(event) => { setTeam(event.target.value) }}>
          {teams.map(row => <option key={row.name} value={row.name}>{row.name}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('team.request')}</span>
        <textarea className={`${styles.input} ${styles.text}`} value={text} maxLength={20_000} placeholder={t('team.placeholder')} onChange={(event) => { setText(event.target.value) }} onKeyDown={onKeyDown} />
      </label>
      <div className={styles.actions}>
        <button type="button" className={styles.send} disabled={!canSend} onClick={() => { void send() }}>{busy ? t('team.sending') : t('team.send')}</button>
        <a className={styles.link} href="/__dsh_a2a_nexus/" target="_blank" rel="noreferrer">{t('team.open')}</a>
      </div>
      {note !== undefined && <p role="status" className={note.tone === 'ok' ? styles.ok : styles.error}>{note.text}</p>}
    </div>
  )
}
