/**
 * #731: owner-only access for the a2a state directory on Windows.
 *
 * Every journal under `<home>/a2a` (task ledger with its receipt outbox, CLI mailbox receipt commits, the recovery
 * journal, the outbound log) is written by `writeTaskLedger` with mode 0600. POSIX honours that mode. Windows ignores
 * it (Node reports 0666): who may open a file is decided by the ACL the file inherits from its directory. So on
 * Windows this module gives the directory itself an owner-only ACL once per start: inheritance from the parent is
 * removed and only the current user's SID gets full control, inherited by files and subdirectories created in it
 * (owner decision 2026-11-21, option A of #731).
 *
 * The system tools are called by absolute path under %SystemRoot% (never a PATH lookup) and without a shell. A
 * failure never stops the host: it is returned, logged by the caller and shown in the state face.
 * @module @nelsonlongxiang/dsh-open-a2a-net/windows-private-dir
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { win32 } from 'node:path'

/** What this host does to keep its a2a journals private. */
export type DirPrivacy =
  | { readonly mode: 'posix-0600' }
  | { readonly mode: 'windows-acl'; readonly ok: true }
  | { readonly mode: 'windows-acl'; readonly ok: false; readonly error: string }

/** Runs one executable with arguments (no shell) and returns its stdout. Tests inject a fake. */
export type Exec = (file: string, args: readonly string[]) => string

const realExec: Exec = (file, args) => execFileSync(file, [...args], { encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] })
const SID = /^S-1-\d+(?:-\d+)+$/

function systemTool(name: string, env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
  return win32.join(root, 'System32', name)
}

/** The SID of the user this process runs as, from `whoami /user /fo csv /nh` (`"domain\user","S-1-5-21-…"`). */
export function currentUserSid(exec: Exec, env: NodeJS.ProcessEnv = process.env): string {
  const line = exec(systemTool('whoami.exe', env), ['/user', '/fo', 'csv', '/nh']).trim().split(/\r?\n/)[0] ?? ''
  const sid = /"([^"]*)"\s*$/.exec(line)?.[1] ?? ''
  if (!SID.test(sid)) throw Error('current user SID not found in whoami output')
  return sid
}

/**
 * Restrict `dir` to the current user on Windows; elsewhere report the per-file 0600 mode already in force.
 * @param dir - the a2a state directory (created if missing).
 * @param options - platform, command runner and environment overrides (tests only).
 * @returns the privacy posture, never throws.
 */
export function restrictDirToCurrentUser(dir: string, options: { platform?: NodeJS.Platform; exec?: Exec; env?: NodeJS.ProcessEnv } = {}): DirPrivacy {
  if ((options.platform ?? process.platform) !== 'win32') return { mode: 'posix-0600' }
  const exec = options.exec ?? realExec, env = options.env ?? process.env
  try {
    mkdirSync(dir, { recursive: true })
    const sid = currentUserSid(exec, env)
    // (OI)(CI)F: full control for this SID, inherited by files and subdirectories; /inheritance:r drops the parent's ACEs.
    exec(systemTool('icacls.exe', env), [dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`])
    return { mode: 'windows-acl', ok: true }
  } catch (error) {
    const code = (error as { code?: unknown; status?: unknown })
    const detail = typeof code.code === 'string' ? code.code : typeof code.status === 'number' ? 'exit ' + String(code.status) : String((error as Error)?.message ?? error).split('\n')[0]!.slice(0, 200)
    return { mode: 'windows-acl', ok: false, error: detail }
  }
}
