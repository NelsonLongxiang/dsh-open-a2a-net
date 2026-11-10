/**
 * Files the owner hands a team from the right bar: picked or dragged in, staged on this host's file channel and granted to
 * the team's canvas, then sent as "[A2A file] v1 …" reference lines (the request box, and a decision on a card, C8).
 */
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './TeamRequestTab.module.css'

/** The file channel's limits (src/tools/files.ts, src/blob-store.ts). */
export const FILES_MAX = 16, FILE_BYTES_MAX = 64 * 1024 * 1024

type T = PropsLocale<'a2aNet'>['t']

/**
 * Stage files on this host for a team, each granted to its canvas.
 * @param files - the files to stage.
 * @param address - the team's canvas address.
 * @returns one reference line per file, or why one could not be staged.
 */
export async function stageFiles(files: readonly File[], address: string): Promise<{ refs: string[] } | { refused: string }> {
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

/**
 * The files picked so far, and the drag handlers that add to them.
 * @param t - the locale.
 * @param refuse - shows why files were not added.
 * @returns the files, the setters, and the props for the element files are dropped on.
 */
export function useAttachedFiles(t: T, refuse: (text: string) => void) {
  const [files, setFiles] = useState<readonly File[]>([])
  const [dragging, setDragging] = useState(false)
  const addFiles = (added: readonly File[]): void => {
    const tooBig = added.find(file => file.size > FILE_BYTES_MAX)
    if (tooBig !== undefined) { refuse(t('team.fileTooBig', { name: tooBig.name })); return }
    const known = new Set(files.map(file => `${file.name}:${String(file.size)}`))
    const next = [...files, ...added.filter(file => !known.has(`${file.name}:${String(file.size)}`))]
    if (next.length > FILES_MAX) { refuse(t('team.tooManyFiles', { max: String(FILES_MAX) })); return }
    setFiles(next)
  }
  // Only a drag of files is ours: dragging selected text stays the browser's. A drop is handled once, by the innermost taker.
  const dragsFiles = (event: DragEvent<HTMLElement>): boolean => [...event.dataTransfer.types].includes('Files')
  const dropProps = {
    onDragOver: (event: DragEvent<HTMLElement>): void => {
      if (!dragsFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      setDragging(true)
    },
    onDragLeave: (event: DragEvent<HTMLElement>): void => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
    },
    onDrop: (event: DragEvent<HTMLElement>): void => {
      if (!dragsFiles(event)) return
      event.preventDefault()
      event.stopPropagation()
      setDragging(false)
      // A folder arrives as a File that cannot be read; the entry says what it really is.
      if ([...event.dataTransfer.items].some(item => item.webkitGetAsEntry?.()?.isDirectory === true)) { refuse(t('team.noFolders')); return }
      addFiles([...event.dataTransfer.files])
    },
  }
  return { files, setFiles, addFiles, dragging, dropProps }
}

/**
 * The picker and the list of picked files.
 * @param props - the files and how to change them.
 * @returns the controls.
 */
export function AttachedFiles({ t, files, setFiles, addFiles, disabled = false, hint = true }: { readonly t: T; readonly files: readonly File[]; readonly setFiles: (files: readonly File[]) => void; readonly addFiles: (files: readonly File[]) => void; readonly disabled?: boolean; readonly hint?: boolean }) {
  const picker = useRef<HTMLInputElement>(null)
  return (
    <div className={styles.files}>
      <input ref={picker} type="file" multiple hidden aria-label={t('team.addFiles')} onChange={(event) => { addFiles([...(event.target.files ?? [])]); event.target.value = '' }} />
      <button type="button" className={styles.attach} disabled={disabled} onClick={() => { picker.current?.click() }}>{t('team.addFiles')}</button>
      {hint && <span className={styles.hint}>{t('team.dropHint')}</span>}
      {files.map(file => (
        <div key={`${file.name}:${String(file.size)}`} className={styles.file}>
          <span className={styles.fileName}>{file.name}</span>
          <button type="button" className={styles.remove} disabled={disabled} aria-label={t('team.removeFile', { name: file.name })} onClick={() => { setFiles(files.filter(row => row !== file)) }}>×</button>
        </div>
      ))}
    </div>
  )
}
