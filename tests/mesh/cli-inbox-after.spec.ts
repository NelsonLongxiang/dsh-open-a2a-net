// @vitest-environment node
/**
 * superagent p1-inbox-after on a real host: `a2a inbox --after <cursor>` is a
 * replayable read whose cursor the caller keeps. It reports what the 64-row
 * cap pushed out, says "unknown" (null) across an epoch change, refuses bad
 * cursors and never touches the local inbox.cursor.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, cliEnv, reservePort } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { MAILBOX_CAP } from '../../src/cli-deposit.ts'

const { privateKey } = generateKeyPairSync('ed25519')
const HANDLE = 'after-cli/a1b2c3d4e5f60718'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

type AfterRead = { handle: string; epoch: string; after: string; next: string; mail: Array<{ seq: number; text: string }>; lost: number | null; epochChanged: boolean }

function cli(home: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
  })
}
const read = async (home: string, after: string): Promise<AfterRead> => {
  const out = await cli(home, ['inbox', '--after', after])
  expect(out.code, out.stderr).toBe(0)
  return JSON.parse(out.stdout) as AfterRead
}

describe('superagent p1: inbox --after (real host)', () => {
  it('replays from a caller-kept cursor, reports cap loss, is honest across an epoch, and leaves inbox.cursor alone', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-after', team: 'dsh', sessionNodes: true, port: await reservePort() })
    try {
      // The flood guard admits 16 fresh tasks per sender per minute, so the overflow below is spread over
      // several deposited senders (15 each); every one of them mails the reader's handle.
      const deposit = async (name: string, handle: string, key: typeof privateKey) => {
        const card = signCard({ name, session: `cli-${name}`, team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, key)
        const dep = await fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }) }).then(r => r.json() as Promise<{ ok?: boolean }>)
        expect(dep.ok).toBe(true)
      }
      const senders = [{ name: 'after-cli', handle: HANDLE, key: privateKey }]
      for (let i = 0; i < 5; i += 1) senders.push({ name: `snd${String(i)}`, handle: `snd${String(i)}/a1b2c3d4e5f6071${String(i)}`, key: generateKeyPairSync('ed25519').privateKey })
      for (const s of senders) await deposit(s.name, s.handle, s.key)
      let sent = 0
      const send = async (message: string) => {
        const s = senders[Math.floor(sent / 15) % senders.length]
        sent += 1
        const callerUrl = `${a.baseUrl}/a2a/cli/${encodeURIComponent(s.handle)}`
        const ts = Date.now()
        const sig = edSign(undefined, Buffer.from(JSON.stringify([s.name, callerUrl, ts])), s.key).toString('base64')
        const r = await fetch(`${a.baseUrl}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': s.name, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': sig }, body: JSON.stringify({ team: HANDLE, message, caller_session: s.handle, wait: false }) }).then(res => res.json() as Promise<{ delivered?: boolean }>)
        expect(r.delivered, JSON.stringify(r)).toBe(true)
      }
      const home = mkdtempSync(join(tmpdir(), 'cli-after-'))
      writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: 'after-cli', uuid: 'a1b2c3d4e5f60718', handle: HANDLE, home: a.baseUrl, privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })

      for (const t of ['m1', 'm2', 'm3']) await send(t)
      const first = await read(home, 'start')
      expect(first.mail.map(m => m.seq)).toEqual([1, 2, 3])
      expect(first.mail[0].text).toContain('m1')
      expect(first).toMatchObject({ handle: HANDLE, after: 'start', lost: 0, epochChanged: false, next: `${first.epoch}:3` })

      for (const t of ['m4', 'm5']) await send(t)
      const second = await read(home, first.next)
      expect(second.mail.map(m => m.seq)).toEqual([4, 5])
      expect(second).toMatchObject({ lost: 0, epochChanged: false, next: `${first.epoch}:5` })
      // Replayable: the same cursor reads the same window again.
      expect((await read(home, first.next)).mail.map(m => m.seq)).toEqual([4, 5])
      // Caught up: nothing new, the cursor stays put.
      expect(await read(home, second.next)).toMatchObject({ mail: [], lost: 0, next: second.next })

      // Overflow: 66 more → seq 6..71, the host keeps the newest 64 (8..71); 6 and 7 are lost for a reader at 5.
      for (let i = 6; i <= 71; i += 1) await send(`m${String(i)}`)
      const third = await read(home, second.next)
      expect(third.mail).toHaveLength(MAILBOX_CAP)
      expect(third.mail[0].seq).toBe(8)
      expect(third).toMatchObject({ lost: 2, epochChanged: false, next: `${first.epoch}:71` })
      // A reader still at 3 has lost 4 (seq 4..7).
      expect((await read(home, first.next)).lost).toBe(4)

      // A cursor past the newest seq this host issued: flagged, no mail, kept as given.
      expect(await read(home, `${first.epoch}:999`)).toMatchObject({ mail: [], lost: null, cursorAhead: true, next: `${first.epoch}:999` })
      expect((await read(home, third.next))).not.toHaveProperty('cursorAhead')
      // A cursor from another epoch: every row, loss unknown — never a guessed 0.
      const foreign = await read(home, 'gone-epoch:5')
      expect(foreign).toMatchObject({ epochChanged: true, lost: null, next: `${first.epoch}:71` })
      expect(foreign.mail).toHaveLength(MAILBOX_CAP)

      // Usage errors exit 2; nothing touched the local cursor file.
      expect((await cli(home, ['inbox', '--after', 'not a cursor'])).code).toBe(2)
      expect((await cli(home, ['inbox', '--after', 'start', '--new'])).code).toBe(2)
      expect(existsSync(join(home, 'inbox.cursor'))).toBe(false)
      // The local cursor flow is unchanged: --new still sees everything as unread.
      const fresh = await cli(home, ['inbox', '--new', '--json'])
      expect(fresh.code).toBe(0)
      expect((JSON.parse(fresh.stdout) as unknown[]).length).toBe(MAILBOX_CAP)
    } finally {
      await a.dispose()
    }
  }, 60_000)
})
