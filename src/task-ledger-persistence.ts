/** Atomic single-writer ledger replacement. Never truncate committed bytes on failure. */
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Brief AV/indexer contention must not turn into an unbounded synchronous stall. */
export const LEDGER_RENAME_RETRY_MS = [2, 4] as const
const retryWait = new Int32Array(new SharedArrayBuffer(4))
function renameCommittedFile(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try { renameSync(from, to); return } catch (error) {
      const code = (error as { code?: unknown })?.code
      if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= LEDGER_RENAME_RETRY_MS.length) throw error
      // The ledger API is synchronous; at most two waits (6ms total), never delete the target.
      Atomics.wait(retryWait, 0, 0, LEDGER_RENAME_RETRY_MS[attempt]!)
    }
  }
}
export function writeTaskLedger(path: string, bytes: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  let fd: number | undefined, owned = false, renamed = false
  try {
    fd = openSync(temporary, 'wx', 0o600); owned = true
    writeFileSync(fd, bytes, { encoding: 'utf8' })
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    renameCommittedFile(temporary, path); renamed = true
  } finally {
    if (fd !== undefined) { try { closeSync(fd) } catch { /* preserve producer error */ } }
    if (owned && !renamed) { try { unlinkSync(temporary) } catch { /* preserve producer error */ } }
  }
}
