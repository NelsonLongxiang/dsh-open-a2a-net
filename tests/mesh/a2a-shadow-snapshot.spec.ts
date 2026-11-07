// @vitest-environment node
/**
 * The p2 shadow collector against a real host overflow (A7b calibration). The a2a Source reads its mailbox through the
 * real `a2a-net inbox --after`, with its KV kept in a superagent-shaped SQLite file (the upstream kv/trigger/disposition
 * tables); then 70 more mails push 6 out of the host's 64-row cap. `verify-probe --a2a-shadow` must find exactly those 6
 * seqs as gaps and find each covered by the loss page's (after_seq, after_seq+lost] — the interval the host computes.
 * Temporary homes live under tmp/ (gitignored, removed by tests/temp-dirs.ts); keys are throwaway test identities; the
 * host runs on loopback only.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from '../temp-dirs.ts'
import { bootNode, cliEnv, reservePort } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { MAILBOX_CAP } from '../../src/cli-deposit.ts'
import { KV, pollMailbox, scope } from '../../src/superagent/a2a-watch.ts'
import type { SourceContext } from '../../src/superagent/source-types.ts'

const SOURCE = { name: 'shadow-src', handle: 'shadow-src/a1b2c3d4e5f60718', key: generateKeyPairSync('ed25519').privateKey }

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

function cli(home: string, args: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
    let stdout = ''
    child.stdout.on('data', d => { stdout += String(d) })
    child.on('error', reject); child.on('close', code => resolve({ code, stdout }))
  })
}

describe('superagent p2: shadow collector on a real host overflow', () => {
  it('reports exactly the pushed-out seqs as gaps, each covered by the loss page', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
    const dir = mkdtempSync(join(process.cwd(), 'tmp', 'p2-shadow-collector-'))
    const a = await bootNode({ name: 'A', session: 'mesh-shadow-collector', team: 'dsh', sessionNodes: true, port: await reservePort() })
    try {
      // The flood guard admits 16 fresh tasks per sender per minute: spread 73 mails over 5 deposited senders.
      const deposit = async (name: string, handle: string, key: typeof SOURCE.key) => {
        const card = signCard({ name, session: `cli-${name}`, team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, key)
        const dep = await fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }) }).then(r => r.json() as Promise<{ ok?: boolean }>)
        expect(dep.ok).toBe(true)
      }
      await deposit(SOURCE.name, SOURCE.handle, SOURCE.key)
      const senders = Array.from({ length: 5 }, (_, i) => ({ name: `snd${String(i)}`, handle: `snd${String(i)}/a1b2c3d4e5f6072${String(i)}`, key: generateKeyPairSync('ed25519').privateKey }))
      for (const s of senders) await deposit(s.name, s.handle, s.key)
      let sent = 0
      const send = async () => {
        const s = senders[Math.floor(sent / 15)]!
        sent += 1
        const callerUrl = `${a.baseUrl}/a2a/cli/${encodeURIComponent(s.handle)}`
        const ts = Date.now()
        const sig = edSign(undefined, Buffer.from(JSON.stringify([s.name, callerUrl, ts])), s.key).toString('base64')
        const r = await fetch(`${a.baseUrl}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': s.name, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': sig }, body: JSON.stringify({ team: SOURCE.handle, message: `mail ${String(sent)} SECRET-BODY`, caller_session: s.handle, wait: false }) }).then(res => res.json() as Promise<{ delivered?: boolean }>)
        expect(r.delivered, JSON.stringify(r)).toBe(true)
      }
      const home = join(dir, 'source-home')
      mkdirSync(home)
      writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: SOURCE.name, uuid: 'a1b2c3d4e5f60718', handle: SOURCE.handle, home: a.baseUrl, privateKeyPem: SOURCE.key.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })

      // superagent's store as the Source and the Engine use it: KV values as JSON, Triggers and dispositions as rows.
      const dbPath = join(dir, 'superagent.db')
      const db = new DatabaseSync(dbPath)
      db.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE trigger (id TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
        CREATE TABLE disposition (id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE outbox (id TEXT PRIMARY KEY, value TEXT NOT NULL);`)
      const ctx: SourceContext = {
        commands: { withSignal: () => ctx.commands, run: async (_p: string, args: string[]) => { const out = await cli(home, args); if (out.code !== 0) throw new Error('a2a-net failed'); return out.stdout } },
        ready: Promise.resolve(), configured: () => true, config: () => undefined,
        receive: async trigger => {
          if (db.prepare('SELECT 1 FROM trigger WHERE id = ?').get(trigger.id) !== undefined) return 'duplicate'
          db.prepare('INSERT INTO trigger VALUES (?,?,?)').run(trigger.id, JSON.stringify(trigger), trigger.at)
          const verdict = scope(trigger)
          if (verdict.listened) return 'stored'
          db.prepare('INSERT INTO disposition VALUES (?,?)').run(trigger.id, JSON.stringify({ filtered: { code: verdict.reason } }))
          return 'filtered'
        },
        state: {
          get: <V>(k: string) => { const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(k); return r === undefined ? undefined : JSON.parse(String(r.value)) as V },
          set: (k, v) => { if (v === undefined) db.prepare('DELETE FROM kv WHERE key = ?').run(k); else db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v)) },
        },
        threads: { describe: () => {} },
        tickets: { get: () => undefined },
        report: () => {},
      }

      const windowFrom = new Date(Date.now() - 60_000).toISOString()
      for (let i = 0; i < 3; i += 1) await send()
      expect(await pollMailbox(ctx, new AbortController().signal)).toMatchObject({ read: 3 })
      const cursor = ctx.state.get<string>(KV.cursor)!
      const epoch = cursor.slice(0, cursor.lastIndexOf(':'))
      expect(cursor).toBe(`${epoch}:3`)
      // 70 more: seq 4..73; the host keeps the newest 64 (10..73), so a reader at 3 lost 4..9.
      for (let i = 0; i < 70; i += 1) await send()
      const round = await pollMailbox(ctx, new AbortController().signal)
      expect(round).toMatchObject({ read: MAILBOX_CAP, loss: { state: 'error' } })
      db.close()

      const out = join(dir, 'snap.sqlite')
      const windowTo = new Date(Date.now() + 60_000).toISOString()
      const r = spawnSync(process.execPath, ['scripts/verify-probe.mjs', '--a2a-shadow', dbPath, '--cli-home', home, '--window', `${windowFrom}..${windowTo}`, '--out', out], { cwd: process.cwd(), encoding: 'utf8' })
      expect(r.status, r.stdout + r.stderr).toBe(0)
      expect(JSON.parse(r.stdout)).toMatchObject({ handle: SOURCE.handle, counts: { rows: 3 + MAILBOX_CAP, pages: 3, health: 1, seq_gaps: 6, triggers: 3 + MAILBOX_CAP } })

      const snap = new DatabaseSync(out, { readOnly: true })
      try {
        // The host said lost=6 after seq 3: the gaps are 4..9 and every one is covered. Plan P (p3): the first read's header,
        // that round's heartbeat (the first one), then the loss round's header.
        expect(snap.prepare('SELECT after, lost, loss FROM shadow_pages ORDER BY rowid').all()).toEqual([
          { after: 'start', lost: 0, loss: 0 }, { after: 'start', lost: 0, loss: 0 }, { after: `${epoch}:3`, lost: 6, loss: 1 }])
        expect(snap.prepare('SELECT epoch, seq, covered FROM shadow_seq_gaps ORDER BY seq').all()).toEqual([4, 5, 6, 7, 8, 9].map(seq => ({ epoch, seq, covered: 1 })))
        // A7: the loss round left an a2a error health record at the same at.
        expect(snap.prepare(`SELECT COUNT(*) AS n FROM shadow_pages p JOIN shadow_health h ON h.at = p.at AND h.entry = 'a2a' AND h.state = 'error' WHERE p.loss = 1`).get()).toEqual({ n: 1 })
        // Lookup columns on real data: each row finds its Trigger once (deposited CLI callers are linked since p3, so stored),
        // the loss page its health error, all in the window.
        expect(snap.prepare(`SELECT trigger_present, trigger_filtered_code, seq_records, COUNT(*) AS n FROM shadow_rows GROUP BY 1, 2, 3`).all())
          .toEqual([{ trigger_present: 1, trigger_filtered_code: null, seq_records: 1, n: 3 + MAILBOX_CAP }])
        expect(snap.prepare('SELECT loss, health_error FROM shadow_pages ORDER BY rowid').all()).toEqual([{ loss: 0, health_error: 0 }, { loss: 0, health_error: 0 }, { loss: 1, health_error: 1 }])
        expect(snap.prepare('SELECT in_window, COUNT(*) AS n FROM shadow_triggers GROUP BY 1').all()).toEqual([{ in_window: 1, n: 3 + MAILBOX_CAP }])
        // The deposited CLI callers are linked cli-identity requests taken in (p3 A14): every row counts; the rest stay 0.
        expect(snap.prepare('SELECT name, n FROM shadow_tally ORDER BY name').all()).toEqual(['cli_identity_stored', 'gaps_uncovered', 'heartbeat_row_delta', 'outbox_sent', 'source_sent', 'tickets_a2a']
          .map(name => ({ name, n: name === 'cli_identity_stored' ? 3 + MAILBOX_CAP : 0 })))
        // Every row's trigger_id is a stored Trigger (cli callers: all stored, no filter code), and no text came across.
        expect(snap.prepare(`SELECT COUNT(*) AS n FROM shadow_rows r LEFT JOIN shadow_triggers t ON t.id = r.trigger_id WHERE t.id IS NULL OR t.filtered_code IS NOT NULL OR r.outcome IS NOT 'stored'`).get()).toEqual({ n: 0 })
      } finally { snap.close() }
      expect(readFileSync(out).toString('latin1')).not.toContain('SECRET-BODY')

      // Reverse: a row record removed by hand (seq 20, never reported lost) is a gap no page covers.
      const edit = new DatabaseSync(dbPath)
      const kept = JSON.parse(String((edit.prepare('SELECT value FROM kv WHERE key = ?').get(KV.rows) as { value: string }).value)) as Array<{ seq: number }>
      edit.prepare('UPDATE kv SET value = ? WHERE key = ?').run(JSON.stringify(kept.filter(row => row.seq !== 20)), KV.rows)
      edit.close()
      const out2 = join(dir, 'snap-row-removed.sqlite')
      const r2 = spawnSync(process.execPath, ['scripts/verify-probe.mjs', '--a2a-shadow', dbPath, '--cli-home', home, '--window', `${windowFrom}..${windowTo}`, '--out', out2], { cwd: process.cwd(), encoding: 'utf8' })
      expect(r2.status, r2.stdout + r2.stderr).toBe(0)
      const snap2 = new DatabaseSync(out2, { readOnly: true })
      try {
        expect(snap2.prepare("SELECT n FROM shadow_tally WHERE name = 'gaps_uncovered'").get()).toEqual({ n: 1 })
        expect(snap2.prepare('SELECT seq, covered FROM shadow_seq_gaps ORDER BY seq').all()).toEqual([...[4, 5, 6, 7, 8, 9].map(seq => ({ seq, covered: 1 })), { seq: 20, covered: 0 }])
      } finally { snap2.close() }
    } finally {
      await a.dispose()
    }
  }, 120_000)
})
