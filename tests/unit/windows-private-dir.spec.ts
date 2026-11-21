// @vitest-environment node
/** #731: the a2a journals stay owner-only — POSIX by the 0600 file mode, Windows by an owner-only directory ACL. */
import { describe, expect, it } from 'vitest'
import { existsSync, statSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { writeTaskLedger } from '../../src/task-ledger-persistence.ts'
import { currentUserSid, restrictDirToCurrentUser, type Exec } from '../../src/windows-private-dir.ts'

const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1001'
const env = { SystemRoot: 'C:\\Windows' }
function recorder(answers: Record<string, string | Error> = {}): { exec: Exec; calls: Array<{ file: string; args: readonly string[] }> } {
  const calls: Array<{ file: string; args: readonly string[] }> = []
  return { calls, exec: (file, args) => {
    calls.push({ file, args })
    const answer = answers[file.split('\\').pop()!] ?? ''
    if (answer instanceof Error) throw answer
    return answer
  } }
}

describe('POSIX: journals written by writeTaskLedger are 0600', () => {
  // Windows does not carry POSIX mode bits; its contract is the directory ACL below.
  it.runIf(process.platform !== 'win32')('a new journal and a replaced 0644 journal are both 0600', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a2a-731-')), path = join(dir, 'a2a', 'tasks.json')
    writeTaskLedger(path, '{"version":1}')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    chmodSync(path, 0o644)
    writeTaskLedger(path, '{"version":2}')
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
})

describe('Windows: the a2a directory gets an owner-only ACL', () => {
  it('reports the per-file mode and runs nothing off Windows', () => {
    const r = recorder()
    expect(restrictDirToCurrentUser('/x/a2a', { platform: 'darwin', exec: r.exec, env })).toEqual({ mode: 'posix-0600' })
    expect(r.calls).toEqual([])
  })

  it('grants only the current SID, inherited by files and folders, by absolute tool path and with the path as one argument', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a2a 731 '))
    const r = recorder({ 'whoami.exe': `"host\\someone","${SID}"\r\n` })
    expect(restrictDirToCurrentUser(join(dir, 'a2a'), { platform: 'win32', exec: r.exec, env })).toEqual({ mode: 'windows-acl', ok: true })
    expect(existsSync(join(dir, 'a2a'))).toBe(true)
    expect(r.calls).toEqual([
      { file: 'C:\\Windows\\System32\\whoami.exe', args: ['/user', '/fo', 'csv', '/nh'] },
      { file: 'C:\\Windows\\System32\\icacls.exe', args: [join(dir, 'a2a'), '/inheritance:r', '/grant:r', `*${SID}:(OI)(CI)F`] },
    ])
  })

  it('refuses a whoami answer without a SID and never calls icacls with it', () => {
    const r = recorder({ 'whoami.exe': '"host\\someone","not-a-sid; Everyone"' })
    const dir = mkdtempSync(join(tmpdir(), 'a2a-731-'))
    const result = restrictDirToCurrentUser(join(dir, 'a2a'), { platform: 'win32', exec: r.exec, env })
    expect(result).toMatchObject({ mode: 'windows-acl', ok: false })
    expect(r.calls.map(c => c.file)).toEqual(['C:\\Windows\\System32\\whoami.exe'])
    expect(() => currentUserSid(r.exec, env)).toThrow(/SID/)
  })

  it('a failing icacls is reported, not thrown, and carries no command output', () => {
    const failure = Object.assign(Error('icacls failed\nAccess is denied. C:\\private\\path'), { status: 5 })
    const r = recorder({ 'whoami.exe': `"host\\someone","${SID}"`, 'icacls.exe': failure })
    const dir = mkdtempSync(join(tmpdir(), 'a2a-731-'))
    expect(restrictDirToCurrentUser(join(dir, 'a2a'), { platform: 'win32', exec: r.exec, env })).toEqual({ mode: 'windows-acl', ok: false, error: 'exit 5' })
  })

  it('uses %SystemRoot% when it is not C:\\Windows', () => {
    const r = recorder({ 'whoami.exe': `"host\\someone","${SID}"` })
    const dir = mkdtempSync(join(tmpdir(), 'a2a-731-'))
    restrictDirToCurrentUser(join(dir, 'a2a'), { platform: 'win32', exec: r.exec, env: { SystemRoot: 'D:\\Win' } })
    expect(r.calls.map(c => c.file)).toEqual(['D:\\Win\\System32\\whoami.exe', 'D:\\Win\\System32\\icacls.exe'])
  })
})
