/** Atomic single-writer ledger replacement. Never truncate committed bytes on failure. */
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
export function writeTaskLedger(path: string, bytes: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  let fd: number | undefined, owned = false, renamed = false
  try {
    fd = openSync(temporary, 'wx', 0o600); owned = true
    writeFileSync(fd, bytes, { encoding: 'utf8' })
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    renameSync(temporary, path); renamed = true
  } finally {
    if (fd !== undefined) { try { closeSync(fd) } catch { /* preserve producer error */ } }
    if (owned && !renamed) { try { unlinkSync(temporary) } catch { /* preserve producer error */ } }
  }
}
