/**
 * The right bar's team view (docs/design/superagent-multi-team.md, M7): what the teams need decided, and a request box, in one
 * place (owner 2026-11-10: switching between two views was a chore). A person sends a superagent team a request without
 * leaving the conversation. It uses the team page's own way in, `POST /__dsh_a2a/superagent` `{ action: 'request' }`, so what
 * it sends is the owner's request and goes to the router like any other. Records are data: text nodes only.
 */
import { useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './TeamRequestTab.module.css'
import { TeamHealthBanner } from './TeamHealthBanner.tsx'
import { DecisionList } from './TeamDecisionsTab.tsx'
import { AttachedFiles, stageFiles, useAttachedFiles } from './team-files.tsx'

export { FILES_MAX, FILE_BYTES_MAX } from './team-files.tsx'

export type TeamRequestTabProps = PropsLocale<'a2aNet'> & { /** The session the view is open in: a request to another instance is sent as it. */ readonly sessionId?: string }

/** A team this view can send to. */
export interface RequestTeam { /** '' is the instance's primary team. */ readonly id: string; readonly name: string; /** Its canvas address: files are granted to it. */ readonly address: string; /** On another instance, named here. */ readonly host?: string }

export type LoadedTeams = { readonly state: 'ready'; readonly teams: readonly RequestTeam[] } | { readonly state: 'denied' | 'failed' }

const TEAM_ROUTE = '/__dsh_a2a/superagent'

/**
 * This instance's teams that can take a request: bound to a canvas, with a router, and listening on the workbench Source.
 * @returns the teams, or why they could not be read.
 */
export async function loadTeams(): Promise<LoadedTeams> {
  try {
    const response = await fetch(`${TEAM_ROUTE}/teams`, { cache: 'no-store' })
    if (response.status === 401 || response.status === 403) return { state: 'denied' }
    if (!response.ok) return { state: 'failed' }
    const { teams } = await response.json() as { teams?: Array<{ id: string; canvas?: string; address?: string; open?: boolean; remote?: boolean; host?: string }> }
    return { state: 'ready', teams: (teams ?? []).flatMap(row => row.open === true && row.canvas !== undefined && row.address !== undefined ? [{ id: row.id, name: row.canvas, address: row.address, ...(row.remote === true ? { host: row.host ?? '' } : {}) }] : []) }
  } catch { return { state: 'failed' } }
}


/** One request, as the team page sends it; undefined when it was taken, otherwise why not. */
async function sendRequest(team: string, text: string): Promise<string | undefined> {
  try {
    const response = await fetch(TEAM_ROUTE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request', text, ...(team !== '' ? { teamId: team } : {}) }) })
    const out = await response.json() as { ok?: boolean; error?: string }
    return response.ok && out.ok === true ? undefined : out.error ?? `HTTP ${String(response.status)}`
  } catch (error) { return String(error) }
}

type Note = { readonly tone: 'ok' | 'error'; readonly text: string }

/** One request to a team on another instance, as this session; the sender's handle, or why not. */
async function sendRemote(address: string, session: string | undefined, text: string): Promise<{ sender: string } | { refused: string }> {
  try {
    const response = await fetch(`${TEAM_ROUTE}/teams`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', address, session, text }) })
    const out = await response.json() as { ok?: boolean; error?: string; sender?: string }
    return response.ok && out.ok !== false && out.sender !== undefined ? { sender: out.sender } : { refused: out.error ?? `HTTP ${String(response.status)}` }
  } catch (error) { return { refused: String(error) } }
}

/**
 * The view's body.
 * @param props - the slot's locale.
 * @returns the picker, the text box and the outcome of the last send.
 */
export function TeamRequestTab({ t, sessionId }: TeamRequestTabProps) {
  const [loaded, setLoaded] = useState<LoadedTeams | undefined>(undefined)
  const [team, setTeam] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | undefined>(undefined)
  const { files, setFiles, addFiles, dragging, dropProps } = useAttachedFiles(t, (text) => { setNote({ tone: 'error', text }) })

  useEffect(() => {
    let live = true
    void loadTeams().then((result) => { if (live) setLoaded(result) })
    return () => { live = false }
  }, [])

  const teams = loaded?.state === 'ready' ? loaded.teams : []
  const chosen = teams.find(row => row.id === team) ?? teams[0]
  const canSend = chosen !== undefined && (text.trim() !== '' || files.length > 0) && !busy

  const send = useCallback(async () => {
    if (!canSend) return
    setBusy(true)
    setNote(undefined)
    const staged = await stageFiles(files, chosen.address)
    if ('refused' in staged) { setBusy(false); setNote({ tone: 'error', text: t('team.failed', { reason: staged.refused }) }); return }
    const message = [...(text.trim() !== '' ? [text] : []), ...staged.refs].join('\n')
    if (chosen.host !== undefined) {
      const out = await sendRemote(chosen.address, sessionId, message)
      setBusy(false)
      if ('refused' in out) { setNote({ tone: 'error', text: t('team.failed', { reason: out.refused }) }); return }
      setText('')
      setFiles([])
      setNote({ tone: 'ok', text: t('team.sentRemote', { team: chosen.name, sender: out.sender }) })
      return
    }
    const refused = await sendRequest(chosen.id, message)
    setBusy(false)
    if (refused !== undefined) { setNote({ tone: 'error', text: t('team.failed', { reason: refused }) }); return }
    setText('')
    setFiles([])
    setNote({ tone: 'ok', text: t('team.sent', { team: chosen.name }) })
  }, [canSend, chosen, files, sessionId, t, text])


  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send() }
  }

  if (loaded === undefined) return <div className={styles.view}><p className={styles.hint}>{t('team.loading')}</p></div>
  if (loaded.state !== 'ready') return <div className={styles.view}><p className={styles.hint}>{t(loaded.state === 'denied' ? 'team.denied' : 'team.unreadable')}</p></div>
  if (chosen === undefined) return <div className={styles.view}><p className={styles.hint}>{t('team.none')}</p><a className={styles.link} href="/__dsh_a2a_nexus/" target="_blank" rel="noreferrer">{t('team.open')}</a></div>

  return (
    <div className={`${styles.view} ${dragging ? styles.dragging : ''}`} {...dropProps}>
      <TeamHealthBanner t={t} />
      <DecisionList t={t} />
      <label className={styles.field}>
        <span className={styles.label}>{t('team.pick')}</span>
        <select className={styles.input} value={chosen.id} onChange={(event) => { setTeam(event.target.value) }}>
          {teams.map(row => <option key={row.id} value={row.id}>{row.host !== undefined ? `${row.name}（${row.host}）` : row.name}</option>)}
        </select>
        {chosen.host !== undefined && <span className={styles.hint}>{t('team.remoteHint')}</span>}
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t('team.request')}</span>
        <textarea className={`${styles.input} ${styles.text}`} value={text} maxLength={20_000} placeholder={t('team.placeholder')} onChange={(event) => { setText(event.target.value) }} onKeyDown={onKeyDown} />
      </label>
      <AttachedFiles t={t} files={files} setFiles={setFiles} addFiles={addFiles} />
      <div className={styles.actions}>
        <button type="button" className={styles.send} disabled={!canSend} onClick={() => { void send() }}>{busy ? t('team.sending') : t('team.send')}</button>
        <a className={styles.link} href="/__dsh_a2a_nexus/" target="_blank" rel="noreferrer">{t('team.open')}</a>
      </div>
      {note !== undefined && <p role="status" className={note.tone === 'ok' ? styles.ok : styles.error}>{note.text}</p>}
    </div>
  )
}
