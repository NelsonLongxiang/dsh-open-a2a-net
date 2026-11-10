/**
 * The right bar's request view (docs/design/superagent-multi-team.md, M7): a person sends a superagent team a request without
 * leaving the conversation. It uses the team page's own way in, `POST /__dsh_a2a/superagent` `{ action: 'request' }`, so what
 * it sends is the owner's request and goes to the router like any other. Records are data: text nodes only.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './TeamRequestTab.module.css'
import { TeamHealthBanner } from './TeamHealthBanner.tsx'

export type TeamRequestTabProps = PropsLocale<'a2aNet'> & { /** The session the view is open in: a request to another instance is sent as it. */ readonly sessionId?: string }

/** A team this view can send to. */
export interface RequestTeam { /** '' is the instance's primary team. */ readonly id: string; readonly name: string; /** Its canvas address: files are granted to it. */ readonly address: string; /** On another instance, named here. */ readonly host?: string }

export type LoadedTeams = { readonly state: 'ready'; readonly teams: readonly RequestTeam[] } | { readonly state: 'denied' | 'failed' }

const TEAM_ROUTE = '/__dsh_a2a/superagent'
/** The file channel's limits (src/tools/files.ts, src/blob-store.ts). */
export const FILES_MAX = 16, FILE_BYTES_MAX = 64 * 1024 * 1024

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

/**
 * Stage files on this host for a team, each granted to its canvas.
 * @param files - the files to stage.
 * @param address - the team's canvas address.
 * @returns one reference line per file, or why one could not be staged.
 */
async function stageFiles(files: readonly File[], address: string): Promise<{ refs: string[] } | { refused: string }> {
  const refs: string[] = []
  for (const file of files) {
    try {
      const response = await fetch(`/__dsh_a2a/blob?to=${encodeURIComponent(address)}&name=${encodeURIComponent(file.name)}&by=owner`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
      const out = await response.json() as { ok?: boolean; ref?: string; error?: string }
      if (!response.ok || out.ok !== true || out.ref === undefined) return { refused: `${file.name}: ${out.error ?? `HTTP ${String(response.status)}`}` }
      refs.push(out.ref)
    } catch (error) { return { refused: `${file.name}: ${String(error)}` } }
  }
  return { refs }
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
  const [files, setFiles] = useState<readonly File[]>([])
  const picker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const addFiles = (added: readonly File[]): void => {
    const tooBig = added.find(file => file.size > FILE_BYTES_MAX)
    if (tooBig !== undefined) { setNote({ tone: 'error', text: t('team.fileTooBig', { name: tooBig.name }) }); return }
    const known = new Set(files.map(file => `${file.name}:${String(file.size)}`))
    const next = [...files, ...added.filter(file => !known.has(`${file.name}:${String(file.size)}`))]
    if (next.length > FILES_MAX) { setNote({ tone: 'error', text: t('team.tooManyFiles', { max: String(FILES_MAX) }) }); return }
    setFiles(next)
  }

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

  // Only a drag of files is ours: dragging selected text into the box stays the browser's.
  const dragsFiles = (event: DragEvent<HTMLElement>): boolean => [...event.dataTransfer.types].includes('Files')
  const onDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!dragsFiles(event)) return
    event.preventDefault()
    setDragging(true)
  }
  const onDragLeave = (event: DragEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
  }
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    if (!dragsFiles(event)) return
    event.preventDefault()
    setDragging(false)
    // A folder arrives as a File that cannot be read; the entry says what it really is.
    const items = [...event.dataTransfer.items]
    if (items.some(item => item.webkitGetAsEntry?.()?.isDirectory === true)) { setNote({ tone: 'error', text: t('team.noFolders') }); return }
    addFiles([...event.dataTransfer.files])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send() }
  }

  if (loaded === undefined) return <div className={styles.view}><p className={styles.hint}>{t('team.loading')}</p></div>
  if (loaded.state !== 'ready') return <div className={styles.view}><p className={styles.hint}>{t(loaded.state === 'denied' ? 'team.denied' : 'team.unreadable')}</p></div>
  if (chosen === undefined) return <div className={styles.view}><p className={styles.hint}>{t('team.none')}</p><a className={styles.link} href="/__dsh_a2a_nexus/" target="_blank" rel="noreferrer">{t('team.open')}</a></div>

  return (
    <div className={`${styles.view} ${dragging ? styles.dragging : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <TeamHealthBanner t={t} />
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
      <div className={styles.files}>
        <input ref={picker} type="file" multiple hidden aria-label={t('team.addFiles')} onChange={(event) => { addFiles([...(event.target.files ?? [])]); event.target.value = '' }} />
        <button type="button" className={styles.attach} onClick={() => { picker.current?.click() }}>{t('team.addFiles')}</button>
        <span className={styles.hint}>{t('team.dropHint')}</span>
        {files.map(file => (
          <div key={`${file.name}:${String(file.size)}`} className={styles.file}>
            <span className={styles.fileName}>{file.name}</span>
            <button type="button" className={styles.remove} aria-label={t('team.removeFile', { name: file.name })} onClick={() => { setFiles(files.filter(row => row !== file)) }}>×</button>
          </div>
        ))}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.send} disabled={!canSend} onClick={() => { void send() }}>{busy ? t('team.sending') : t('team.send')}</button>
        <a className={styles.link} href="/__dsh_a2a_nexus/" target="_blank" rel="noreferrer">{t('team.open')}</a>
      </div>
      {note !== undefined && <p role="status" className={note.tone === 'ok' ? styles.ok : styles.error}>{note.text}</p>}
    </div>
  )
}
