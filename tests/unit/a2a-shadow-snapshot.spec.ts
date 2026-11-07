// @vitest-environment node
/**
 * The p2 shadow-acceptance collector (`verify-probe --a2a-shadow`): a snapshot producer, never a verdict. A synthetic
 * superagent database (the upstream 8c32a9d table shapes: kv, trigger, disposition, outbox, ticket) and a CLI home are
 * flattened into a new snapshot; the source stays byte-identical, an existing --out is refused, malformed records fail
 * closed with no file left behind, and no text crosses into the snapshot. Temp dirs live under tmp/ (tests/temp-dirs.ts).
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync } from '../temp-dirs.ts'
import { CAPS, KV as SNAP_KV, key as snapKey, LINK_RULES as SNAP_LINK_RULES, LOOP_PREFIX as SNAP_LOOP_PREFIX, seqGaps, isLoss, parseWindow, checkTally, TALLY, flattenShadow } from '../../scripts/a2a-shadow-snapshot.mjs'
import { HEALTH_RECORD_CAP, KV, LINK_RULES, LOOP_PREFIX, PAGE_RECORD_CAP, ROW_RECORD_CAP } from '../../src/superagent/a2a-watch.ts'
import { key } from '../../src/superagent/source-types.ts'

const repo = process.cwd()
const SOURCE_HANDLE = 'shadow-src/a1b2c3d4e5f60718'
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** superagent store.ts (8c32a9d) DDL for the tables the collector reads. */
const UPSTREAM_DDL = `CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE trigger (id TEXT PRIMARY KEY, value TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE disposition (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE outbox (id TEXT PRIMARY KEY, value TEXT NOT NULL);`

const row = (seq: number | null, outcome: string, at: string, extra: Record<string, unknown> = {}) =>
  ({ epoch: 'ep1', seq, task_id: seq === null ? null : `t${String(seq)}`, from: 'caller/0011223344556677', outcome, at, proof: 'in-process', receipt_for: null, dup: null, ...extra })

function fixture(over: { rows?: unknown; pages?: unknown; health?: unknown; triggerAt?: Record<string, string> } = {}) {
  mkdirSync(join(repo, 'tmp'), { recursive: true })
  const dir = mkdtempSync(join(repo, 'tmp', 'a2a-shadow-unit-'))
  const db = new DatabaseSync(join(dir, 'superagent.db'))
  db.exec(UPSTREAM_DDL)
  const kv = (k: string, v: unknown) => db.prepare('INSERT INTO kv VALUES (?,?)').run(k, JSON.stringify(v))
  kv(KV.rows, over.rows ?? [
    row(1, 'stored', '2026-11-06T23:59:00.000Z'), // before the window: counted in shadow_meta, not in shadow_rows
    row(2, 'stored', '2026-11-07T01:00:00.000Z'),
    row(3, 'filtered:unverified', '2026-11-07T01:00:00.000Z', { proof: 'cli-identity' }),
    row(6, 'filtered:receipt', '2026-11-07T02:00:00.000Z', { receipt_for: 'job-1' }),
    row(null, 'unreadable', '2026-11-07T02:00:00.000Z', { task_id: null }),
  ])
  kv(KV.pages, over.pages ?? [
    { at: '2026-11-07T01:00:00.000Z', after: 'ep1:1', next: 'ep1:3', epoch: 'ep1', lost: 0, epochChanged: false, cursorAhead: false },
    { at: '2026-11-07T02:00:00.000Z', after: 'ep1:3', next: 'ep1:6', epoch: 'ep1', lost: 2, epochChanged: false, cursorAhead: false },
  ])
  kv(KV.healthLog, over.health ?? [{ at: '2026-11-07T02:00:00.000Z', entry: 'a2a', state: 'error', values: { lost: '2', after: 'ep1:3', epochChanged: 'false' } }])
  kv(KV.cursor, 'ep1:6')
  const trig = (id: string, source: string, human: boolean, filtered?: string) => {
    const at = over.triggerAt?.[id] ?? '2026-11-07T01:00:00.000Z'
    db.prepare('INSERT INTO trigger VALUES (?,?,?)').run(id, JSON.stringify({ id, source, human, text: 'SECRET-TRIGGER-TEXT', at }), at)
    if (filtered !== undefined) db.prepare('INSERT INTO disposition VALUES (?,?)').run(id, JSON.stringify({ filtered: { code: filtered } }))
  }
  trig(key('a2a', 'caller/0011223344556677', 't2'), 'a2a', false)
  trig(key('a2a', 'caller/0011223344556677', 't3'), 'a2a', false, 'unverified')
  trig(key('a2a', 'caller/0011223344556677', 't9'), 'a2a', true) // a human:true a2a Trigger is what A8 must see
  trig('gh-1', 'github', true)
  db.prepare('INSERT INTO outbox VALUES (?,?)').run('o1', JSON.stringify({ id: 'o1', channel: { source: 'a2a' }, text: 'SECRET-OUT', status: 'dropped', dropped: { at: 'x', reason: 'channelIgnored' } }))
  db.prepare('INSERT INTO outbox VALUES (?,?)').run('o2', JSON.stringify({ id: 'o2', channel: { source: 'feishu' }, text: 'x', status: 'sent' }))
  db.prepare('INSERT INTO ticket VALUES (?,?)').run('k1', JSON.stringify({ id: 'k1', mandate: { basis: { source: 'github', via: 'addressed' } } }))
  db.prepare('INSERT INTO ticket VALUES (?,?)').run('k2', JSON.stringify({ id: 'k2' }))
  db.close()
  const cliHome = join(dir, 'cli')
  mkdirSync(cliHome)
  writeFileSync(join(cliHome, 'cli.json'), JSON.stringify({ name: 'shadow-src', handle: SOURCE_HANDLE }))
  writeFileSync(join(cliHome, 'sent.1.jsonl'), `${JSON.stringify({ handle: 'other/1', at: Date.parse('2026-11-07T01:30:00Z'), task_id: 'x1', text: 'SECRET-SENT' })}\n`)
  writeFileSync(join(cliHome, 'sent.jsonl'), `${JSON.stringify({ handle: SOURCE_HANDLE, at: Date.parse('2026-11-08T05:00:00Z'), task_id: 'late' })}\n{"torn`)
  return { dir, source: join(dir, 'superagent.db'), cliHome, out: join(dir, 'snap.sqlite') }
}

const probe = (args: string[]) => {
  const r = spawnSync(process.execPath, [join(repo, 'scripts/verify-probe.mjs'), ...args], { cwd: repo, encoding: 'utf8' })
  return { code: r.status, json: JSON.parse(r.stdout) as Record<string, unknown>, stdout: r.stdout, stderr: r.stderr }
}
const WINDOW = '2026-11-07T00:00:00Z..2026-11-08T00:00:00Z'
const all = (file: string, sql: string) => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare(sql).all() } finally { db.close() } }

describe('p2 shadow collector (verify-probe --a2a-shadow)', () => {
  it('pins the plugin record keys, caps and Trigger id', () => {
    expect(SNAP_KV).toEqual({ rows: KV.rows, pages: KV.pages, healthLog: KV.healthLog })
    expect(CAPS).toEqual({ rows: ROW_RECORD_CAP, pages: PAGE_RECORD_CAP, health: HEALTH_RECORD_CAP })
    expect(snapKey('a2a', 'from/1', 'task-9')).toBe(key('a2a', 'from/1', 'task-9'))
    expect([...SNAP_LINK_RULES].sort()).toEqual([...LINK_RULES].sort())
    expect(SNAP_LOOP_PREFIX).toBe(LOOP_PREFIX)
  })

  it('p3: rows keep the admission; heartbeat pages carry their counts and both gaps; A14 and A15 tallies', () => {
    const hb = (at: string, rounds: number, rows: number) => ({ at, after: 'ep1:9', next: 'ep1:9', epoch: 'ep1', lost: 0, epochChanged: false, cursorAhead: false, heartbeat: true, rounds, rows })
    const f = fixture({
      rows: [
        row(1, 'stored', '2026-11-07T00:10:00.000Z', { proof: 'cli-identity', admission: 'cli-deposit' }), // before the first heartbeat's delta, still an A14 row
        row(2, 'stored', '2026-11-07T00:40:00.000Z', { proof: 'cli-identity', admission: 'cli-deposit' }), // A14 counts it
        row(3, 'stored', '2026-11-07T00:40:00.000Z', { proof: 'cli-identity', admission: 'roster-shared' }), // not a link
        row(4, 'filtered:loop', '2026-11-07T00:40:00.000Z', { proof: 'cli-identity', admission: 'cli-deposit', task_id: 'a2a-x' }),
        row(7, 'stored', '2026-11-07T00:40:00.000Z', { proof: 'cli-identity', admission: 'cli-deposit', task_id: 'a2a-y' }), // even stored, a loop id never counts for A14
        row(5, 'stored', '2026-11-07T01:10:00.000Z', { proof: 'cli-identity', admission: 'canvas-shared', receipt_for: 'j' }), // a receipt
        row(6, 'stored', '2026-11-07T01:10:00.000Z', { proof: 'origin-claim', admission: 'canvas-shared' }),
      ],
      pages: [
        hb('2026-11-07T00:10:00.000Z', 20, 1),
        { at: '2026-11-07T00:40:00.000Z', after: 'ep1:1', next: 'ep1:4', epoch: 'ep1', lost: 0, epochChanged: false, cursorAhead: false },
        hb('2026-11-07T01:10:00.000Z', 120, 6), // rows 2..7 lie in (00:10, 01:10]: delta 0
        hb('2026-11-07T02:20:30.000Z', 140, 0), // 70.5 minutes after the last: rounded up to 71
      ],
      health: [],
    })
    const r = probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out])
    expect(r.code, r.stdout + r.stderr).toBe(0)
    expect(all(f.out, 'SELECT seq, admission FROM shadow_rows ORDER BY rowid').map(x => x.admission)).toEqual(['cli-deposit', 'cli-deposit', 'roster-shared', 'cli-deposit', 'cli-deposit', 'canvas-shared', 'canvas-shared'])
    expect(all(f.out, 'SELECT at, heartbeat, rounds, rows, hb_gap_min, hb_next_gap_min FROM shadow_pages ORDER BY rowid')).toEqual([
      { at: '2026-11-07T00:10:00.000Z', heartbeat: 1, rounds: 20, rows: 1, hb_gap_min: 10, hb_next_gap_min: 60 },
      { at: '2026-11-07T00:40:00.000Z', heartbeat: 0, rounds: null, rows: null, hb_gap_min: null, hb_next_gap_min: null },
      { at: '2026-11-07T01:10:00.000Z', heartbeat: 1, rounds: 120, rows: 6, hb_gap_min: 60, hb_next_gap_min: 71 },
      { at: '2026-11-07T02:20:30.000Z', heartbeat: 1, rounds: 140, rows: 0, hb_gap_min: 71, hb_next_gap_min: 1300 }, // to the window's end
    ])
    expect(r.json.tally).toMatchObject({ cli_identity_stored: 2, heartbeat_row_delta: 0 }) // rows 1 and 2
    // A heartbeat that under-counts its rows shows as a non-zero delta, recounted from the snapshot.
    const g = fixture({ rows: [row(2, 'stored', '2026-11-07T00:40:00.000Z'), row(3, 'stored', '2026-11-07T00:50:00.000Z')],
      pages: [hb('2026-11-07T00:10:00.000Z', 1, 0), hb('2026-11-07T01:10:00.000Z', 120, 1)], health: [] })
    const r2 = probe(['--a2a-shadow', g.source, '--cli-home', g.cliHome, '--window', WINDOW, '--out', g.out])
    expect(r2.code, r2.stdout + r2.stderr).toBe(0)
    expect(r2.json.tally).toMatchObject({ heartbeat_row_delta: -1 })
    expect(all(g.out, "SELECT n FROM shadow_tally WHERE name = 'heartbeat_row_delta'")).toEqual([{ n: -1 }])
  })

  it('p3: a malformed heartbeat page fails closed with no snapshot', () => {
    const base = { at: '2026-11-07T01:00:00.000Z', after: 'ep1:1', next: 'ep1:3', epoch: 'ep1', lost: 0, epochChanged: false, cursorAhead: false }
    for (const bad of [{ ...base, heartbeat: 1, rounds: 1, rows: 0 }, { ...base, heartbeat: true, rounds: -1, rows: 0 }, { ...base, heartbeat: true, rounds: 1 },
      { ...base, heartbeat: true, rounds: 1.5, rows: 0 }, { ...base, rounds: 3 }, { ...base, rows: 3 }]) {
      const f = fixture({ pages: [bad] })
      const r = probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out])
      expect(r.code, JSON.stringify(bad)).toBe(1)
      expect(existsSync(f.out)).toBe(false)
    }
  })

  it('flattens the records into a new snapshot and leaves the source byte-identical', () => {
    mkdirSync(join(repo, 'tmp'), { recursive: true })
    const f = fixture()
    const before = sha(f.source)
    const r = probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out])
    expect(r.code, r.stdout + r.stderr).toBe(0)
    expect(r.stdout.trim().split('\n')).toHaveLength(1)
    expect(r.json).toMatchObject({ mode: 'a2a-shadow-snapshot', handle: SOURCE_HANDLE, window: { from: '2026-11-07T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' },
      counts: { rows: 4, pages: 2, health: 1, seq_gaps: 2, triggers: 3, outbox: 1, tickets: 2, sent: 1 }, stored: { rows: 5, pages: 2, health: 1 } })
    expect(sha(f.source)).toBe(before)

    expect(all(f.out, 'SELECT kind, cap, oldest_at, newest_at, count, window_from FROM shadow_meta ORDER BY kind')).toEqual([
      { kind: 'health', cap: 200, oldest_at: '2026-11-07T02:00:00.000Z', newest_at: '2026-11-07T02:00:00.000Z', count: 1, window_from: '2026-11-07T00:00:00.000Z' },
      { kind: 'pages', cap: 1000, oldest_at: '2026-11-07T01:00:00.000Z', newest_at: '2026-11-07T02:00:00.000Z', count: 2, window_from: '2026-11-07T00:00:00.000Z' },
      { kind: 'rows', cap: 1000, oldest_at: '2026-11-06T23:59:00.000Z', newest_at: '2026-11-07T02:00:00.000Z', count: 5, window_from: '2026-11-07T00:00:00.000Z' },
    ])
    const rows = all(f.out, 'SELECT seq, outcome, proof, receipt_for, trigger_id FROM shadow_rows ORDER BY rowid')
    expect(rows).toEqual([
      { seq: 2, outcome: 'stored', proof: 'in-process', receipt_for: null, trigger_id: key('a2a', 'caller/0011223344556677', 't2') },
      { seq: 3, outcome: 'filtered:unverified', proof: 'cli-identity', receipt_for: null, trigger_id: key('a2a', 'caller/0011223344556677', 't3') },
      { seq: 6, outcome: 'filtered:receipt', proof: 'in-process', receipt_for: 'job-1', trigger_id: key('a2a', 'caller/0011223344556677', 't6') },
      { seq: null, outcome: 'unreadable', proof: 'in-process', receipt_for: null, trigger_id: null },
    ])
    expect(all(f.out, 'SELECT after, lost, loss FROM shadow_pages ORDER BY rowid')).toEqual([{ after: 'ep1:1', lost: 0, loss: 0 }, { after: 'ep1:3', lost: 2, loss: 1 }])
    expect(all(f.out, 'SELECT at, entry, state, code FROM shadow_health')).toEqual([{ at: '2026-11-07T02:00:00.000Z', entry: 'a2a', state: 'error', code: null }])
    expect(all(f.out, 'SELECT epoch, seq, covered FROM shadow_seq_gaps ORDER BY seq')).toEqual([{ epoch: 'ep1', seq: 4, covered: 1 }, { epoch: 'ep1', seq: 5, covered: 1 }])
    expect(all(f.out, 'SELECT source, human, filtered_code FROM shadow_triggers ORDER BY filtered_code, human')).toEqual([
      { source: 'a2a', human: 0, filtered_code: null }, { source: 'a2a', human: 1, filtered_code: null }, { source: 'a2a', human: 0, filtered_code: 'unverified' }])
    expect(all(f.out, 'SELECT id, channel_source, status, drop_reason FROM shadow_outbox')).toEqual([{ id: 'o1', channel_source: 'a2a', status: 'dropped', drop_reason: 'channelIgnored' }])
    expect(all(f.out, 'SELECT id, basis_source FROM shadow_tickets ORDER BY id')).toEqual([{ id: 'k1', basis_source: 'github' }, { id: 'k2', basis_source: null }])
    expect(all(f.out, 'SELECT handle, task_id, at, source_handle FROM shadow_sent')).toEqual([{ handle: 'other/1', task_id: 'x1', at: '2026-11-07T01:30:00.000Z', source_handle: SOURCE_HANDLE }])
    expect(readFileSync(f.out).toString('latin1')).not.toMatch(/SECRET/)
    expect(all(f.out, 'SELECT name, n FROM shadow_tally ORDER BY name')).toEqual([
      { name: 'cli_identity_stored', n: 0 }, { name: 'gaps_uncovered', n: 0 }, { name: 'heartbeat_row_delta', n: 0 }, { name: 'outbox_sent', n: 0 }, { name: 'source_sent', n: 0 }, { name: 'tickets_a2a', n: 0 }])
    expect(r.json.tally).toEqual({ outbox_sent: 0, source_sent: 0, tickets_a2a: 0, gaps_uncovered: 0, cli_identity_stored: 0, heartbeat_row_delta: 0 })

    // Rerunnable: the same inputs into another new file give the same tables.
    const again = join(f.dir, 'snap2.sqlite')
    expect(probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', again]).code).toBe(0)
    for (const t of ['shadow_meta', 'shadow_rows', 'shadow_pages', 'shadow_health', 'shadow_seq_gaps', 'shadow_triggers', 'shadow_outbox', 'shadow_tickets', 'shadow_sent']) {
      expect(all(again, `SELECT * FROM ${t} ORDER BY rowid`)).toEqual(all(f.out, `SELECT * FROM ${t} ORDER BY rowid`))
    }
  })

  it('never overwrites: an existing --out is refused with exit 1 and left as it was', () => {
    const f = fixture()
    writeFileSync(f.out, 'evidence')
    const r = probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out])
    expect(r.code).toBe(1)
    expect(r.json.error).toMatch(/already exists/)
    expect(readFileSync(f.out, 'utf8')).toBe('evidence')
  })

  it('usage errors exit 2 with one JSON object', () => {
    const f = fixture()
    for (const args of [
      ['--a2a-shadow', f.source, '--window', WINDOW, '--out', f.out],
      ['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--out', f.out],
      ['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', '2026-11-08..2026-11-07', '--out', f.out],
      ['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', '2026-11-07T00:00..2026-11-08', '--out', f.out],
      ['--a2a-shadow', '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out],
    ]) {
      const r = probe(args)
      expect(r.code, JSON.stringify(args)).toBe(2)
      expect(typeof r.json.error).toBe('string')
      expect(existsSync(f.out)).toBe(false)
    }
  })

  it('fails closed on a malformed record and leaves no snapshot behind', () => {
    for (const over of [{ rows: [row(1, 'kept', '2026-11-07T01:00:00.000Z')] }, { rows: { not: 'a list' } },
      { pages: [{ at: '2026-11-07T01:00:00.000Z', after: 'ep1:1', next: 'ep1:2', epoch: 'ep1', lost: 1.5, epochChanged: false, cursorAhead: false }] }]) {
      const f = fixture(over)
      const r = probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out])
      expect(r.code, r.stdout).toBe(1)
      expect(r.json.error).toMatch(/snapshot was not written/)
      expect(existsSync(f.out)).toBe(false)
    }
  })

  it('lookup columns: Trigger presence and filter code, seq records, health error, Trigger window', () => {
    const T = (task: string) => key('a2a', 'caller/0011223344556677', task)
    const f = fixture({
      rows: [
        row(3, 'duplicate', '2026-11-06T23:59:00.000Z'), // outside the window, same epoch:seq as the row below
        row(2, 'stored', '2026-11-07T01:00:00.000Z'),
        row(3, 'filtered:unverified', '2026-11-07T01:00:00.000Z', { proof: 'cli-identity' }),
        row(null, 'unreadable', '2026-11-07T01:00:00.000Z', { task_id: null }),
      ],
      pages: [
        { at: '2026-11-07T01:00:00.000Z', after: 'ep1:1', next: 'ep1:3', epoch: 'ep1', lost: 0, epochChanged: false, cursorAhead: false },
        { at: '2026-11-07T02:00:00.000Z', after: 'ep1:3', next: 'ep1:6', epoch: 'ep1', lost: 2, epochChanged: false, cursorAhead: false },
      ],
      // At the first page's at: an error of another entry and an a2a record that is not an error; neither is its health error.
      health: [
        { at: '2026-11-07T01:00:00.000Z', entry: 'a2a-deposit', state: 'error' },
        { at: '2026-11-07T01:00:00.000Z', entry: 'a2a', state: 'paused' },
        { at: '2026-11-07T02:00:00.000Z', entry: 'a2a', state: 'error' },
      ],
      // t2's Trigger is older than the window (a row in the window still finds it); t9 sits exactly on the window's end.
      triggerAt: { [T('t2')]: '2026-11-06T23:00:00.000Z', [T('t3')]: '2026-11-07T00:00:00.000Z', [T('t9')]: '2026-11-08T00:00:00.000Z' },
    })
    expect(probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out]).code).toBe(0)
    expect(all(f.out, 'SELECT seq, outcome, trigger_present, trigger_filtered_code, seq_records FROM shadow_rows ORDER BY rowid')).toEqual([
      { seq: 2, outcome: 'stored', trigger_present: 1, trigger_filtered_code: null, seq_records: 1 },
      { seq: 3, outcome: 'filtered:unverified', trigger_present: 1, trigger_filtered_code: 'unverified', seq_records: 2 },
      { seq: null, outcome: 'unreadable', trigger_present: 0, trigger_filtered_code: null, seq_records: null },
    ])
    expect(all(f.out, 'SELECT at, loss, health_error FROM shadow_pages ORDER BY rowid')).toEqual([
      { at: '2026-11-07T01:00:00.000Z', loss: 0, health_error: 0 }, { at: '2026-11-07T02:00:00.000Z', loss: 1, health_error: 1 }])
    expect(Object.fromEntries(all(f.out, 'SELECT id, in_window FROM shadow_triggers').map(r => [r.id, r.in_window])))
      .toEqual({ [T('t2')]: 0, [T('t3')]: 1, [T('t9')]: 0 })
    // The raw columns stay as they were: shadow_triggers.at is the stored value, not a recomputed one.
    expect(all(f.out, `SELECT at FROM shadow_triggers WHERE id = '${T('t2')}'`)).toEqual([{ at: '2026-11-06T23:00:00.000Z' }])
  })

  it('fails closed on a Trigger without a readable at', () => {
    const f = fixture({ triggerAt: { [key('a2a', 'caller/0011223344556677', 't2')]: 'yesterday' } })
    const r = probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out])
    expect(r.code).toBe(1)
    expect(r.json.error).toMatch(/no readable at/)
    expect(existsSync(f.out)).toBe(false)
  })

  it('shadow_tally: the zero-must-hold counts and the p3 counts, from the rows written into the snapshot', () => {
    const f = fixture({ rows: [
      row(2, 'stored', '2026-11-07T01:00:00.000Z'), row(3, 'filtered:unverified', '2026-11-07T01:00:00.000Z', { proof: 'cli-identity' }),
      row(6, 'filtered:receipt', '2026-11-07T02:00:00.000Z', { receipt_for: 'job-1' }),
      row(8, 'stored', '2026-11-07T03:00:00.000Z'), // seq 7 is missing and no page reported it: one uncovered gap
    ] })
    const db = new DatabaseSync(f.source)
    db.prepare('INSERT INTO outbox VALUES (?,?)').run('o3', JSON.stringify({ id: 'o3', channel: { source: 'a2a' }, text: 'x', status: 'sent' }))
    db.prepare('INSERT INTO outbox VALUES (?,?)').run('o4', JSON.stringify({ id: 'o4', channel: { source: 'a2a' }, text: 'x', status: 'pending' }))
    db.prepare('INSERT INTO ticket VALUES (?,?)').run('k3', JSON.stringify({ id: 'k3', mandate: { basis: { source: 'a2a', via: 'bot' } } }))
    db.close()
    // In the window: one send by the Source's own handle (next to the other handle's); one more by it outside the window.
    appendFileSync(join(f.cliHome, 'sent.1.jsonl'), `${JSON.stringify({ handle: SOURCE_HANDLE, at: Date.parse('2026-11-07T04:00:00Z'), task_id: 's1' })}\n${JSON.stringify({ handle: SOURCE_HANDLE, at: Date.parse('2026-11-06T04:00:00Z'), task_id: 's0' })}\n`)
    const r = probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out])
    expect(r.code, r.stdout).toBe(0)
    expect(r.json.tally).toEqual({ outbox_sent: 1, source_sent: 1, tickets_a2a: 1, gaps_uncovered: 1, cli_identity_stored: 0, heartbeat_row_delta: 0 })
    expect(all(f.out, 'SELECT name, n FROM shadow_tally ORDER BY name')).toEqual([
      { name: 'cli_identity_stored', n: 0 }, { name: 'gaps_uncovered', n: 1 }, { name: 'heartbeat_row_delta', n: 0 }, { name: 'outbox_sent', n: 1 }, { name: 'source_sent', n: 1 }, { name: 'tickets_a2a', n: 1 }])
    // The detail rows stay beside the counts for audit.
    expect(all(f.out, 'SELECT seq, covered FROM shadow_seq_gaps ORDER BY seq')).toEqual([{ seq: 4, covered: 1 }, { seq: 5, covered: 1 }, { seq: 7, covered: 0 }])
  })

  it('the flatten path re-counts the tally it wrote: a tampered insert fails the run', () => {
    const f = fixture()
    const sourceDb = new DatabaseSync(f.source, { readOnly: true })
    const real = new DatabaseSync(f.out)
    // Every statement passes through, except the tally insert, whose count is replaced after the fact.
    const snapshotDb = new Proxy(real, { get: (target, prop) => prop === 'prepare'
      ? (sql: string) => { const stmt = target.prepare(sql); return sql.startsWith('INSERT INTO shadow_tally') ? { run: (name: string) => stmt.run(name, 99) } : stmt }
      : (target as unknown as Record<string | symbol, unknown>)[prop] instanceof Function ? ((target as unknown as Record<string | symbol, (...a: unknown[]) => unknown>)[prop]).bind(target) : (target as unknown as Record<string | symbol, unknown>)[prop] })
    try {
      expect(() => flattenShadow({ sourceDb, cliHome: f.cliHome, window: parseWindow(WINDOW), snapshotDb })).toThrow(/shadow_tally \w+ is 99 but the snapshot holds 0/)
    } finally { real.close(); sourceDb.close() }
  })

  it('checkTally: exactly the TALLY rows, each equal to its re-count, or the run fails', () => {
    const make = (extra: string) => {
      mkdirSync(join(repo, 'tmp'), { recursive: true })
      const db = new DatabaseSync(join(mkdtempSync(join(repo, 'tmp', 'a2a-shadow-tally-')), 'snap.sqlite'))
      db.exec(`CREATE TABLE shadow_outbox (id TEXT, channel_source TEXT, status TEXT, drop_reason TEXT);
        CREATE TABLE shadow_sent (handle TEXT, task_id TEXT, at TEXT, source_handle TEXT);
        CREATE TABLE shadow_tickets (id TEXT, basis_source TEXT);
        CREATE TABLE shadow_seq_gaps (epoch TEXT, seq INTEGER, covered INTEGER);
        CREATE TABLE shadow_rows (outcome TEXT, proof TEXT, receipt_for TEXT, admission TEXT, task_id TEXT, at TEXT);
        CREATE TABLE shadow_pages (at TEXT, heartbeat INTEGER, rows INTEGER);
        CREATE TABLE shadow_tally (name TEXT PRIMARY KEY, n INTEGER NOT NULL);
        INSERT INTO shadow_outbox VALUES ('o1', 'a2a', 'sent', NULL);
        ${extra}`)
      return db
    }
    const four = (outbox: number) => `INSERT INTO shadow_tally VALUES ('outbox_sent', ${String(outbox)}), ('source_sent', 0), ('tickets_a2a', 0), ('gaps_uncovered', 0), ('cli_identity_stored', 0), ('heartbeat_row_delta', 0);`
    expect(() => checkTally(make(four(1)))).not.toThrow()
    expect(() => checkTally(make(four(0)))).toThrow(/outbox_sent is 0 but the snapshot holds 1/)
    expect(() => checkTally(make("INSERT INTO shadow_tally VALUES ('outbox_sent', 1), ('source_sent', 0), ('tickets_a2a', 0);"))).toThrow(/exactly/)
    expect(() => checkTally(make(`${four(1)} INSERT INTO shadow_tally VALUES ('outbox_sent_x', 0);`))).toThrow(/exactly/)
    expect(() => checkTally(make("INSERT INTO shadow_tally VALUES ('outbox_sentX', 1), ('source_sent', 0), ('tickets_a2a', 0), ('gaps_uncovered', 0), ('cli_identity_stored', 0), ('heartbeat_row_delta', 0);"))).toThrow(/exactly/)
    expect(() => checkTally(make("INSERT INTO shadow_tally VALUES ('outbox_sent', 1), ('source_sent', 0), ('tickets_a2a', 0), ('gaps_uncovered', 0);"))).toThrow(/exactly/)
    expect(Object.keys(TALLY).sort()).toEqual(['cli_identity_stored', 'gaps_uncovered', 'heartbeat_row_delta', 'outbox_sent', 'source_sent', 'tickets_a2a'])
  })

  it('A7b gaps: covered exactly by (after_seq, after_seq+lost] of a lost>0 page of the same epoch', () => {
    const r = (seq: number, epoch = 'e') => ({ epoch, seq })
    const page = (after: string, lost: number | null, epoch = 'e', epochChanged = false) => ({ after, lost, epoch, epochChanged, cursorAhead: false })
    // seq 4..9 missing, a reader at 3 told lost=6: all covered.
    expect(seqGaps([r(1), r(3), r(10)], [page('e:3', 6)]).filter(g => g.seq >= 4)).toEqual([4, 5, 6, 7, 8, 9].map(seq => ({ epoch: 'e', seq, covered: 1 })))
    // seq 2 also missing, never reported: uncovered.
    expect(seqGaps([r(1), r(3), r(10)], [page('e:3', 6)]).find(g => g.seq === 2)).toEqual({ epoch: 'e', seq: 2, covered: 0 })
    // An off-by-one interval would not do: a reader at 4 told lost=5 covers 5..9, not 4.
    expect(seqGaps([r(3), r(10)], [page('e:4', 5)]).map(g => g.covered)).toEqual([0, 1, 1, 1, 1, 1])
    // 'start' counts from 0; another epoch, an epoch change or lost null covers nothing.
    expect(seqGaps([r(1), r(4)], [page('start', 3)]).map(g => g.covered)).toEqual([1, 1])
    // A start read told lost=3 reported seq 1..3 gone, so seq 4 is not its loss.
    expect(seqGaps([r(1), r(5)], [page('start', 3)]).map(g => [g.seq, g.covered])).toEqual([[2, 1], [3, 1], [4, 0]])
    expect(seqGaps([r(1), r(4)], [page('x:1', 2, 'x')]).map(g => g.covered)).toEqual([0, 0])
    expect(seqGaps([r(1), r(4)], [page('e:1', 2, 'e', true), page('e:1', null)]).map(g => g.covered)).toEqual([0, 0])
    // Epochs are separate sequences.
    expect(seqGaps([r(1, 'a'), r(1, 'b'), r(3, 'b')], [])).toEqual([{ epoch: 'b', seq: 2, covered: 0 }])
    expect([isLoss({ lost: 0, cursorAhead: false, epochChanged: false }), isLoss({ lost: null, cursorAhead: false, epochChanged: false }),
      isLoss({ lost: 0, cursorAhead: true, epochChanged: false }), isLoss({ lost: 0, cursorAhead: false, epochChanged: true }), isLoss({ lost: 1, cursorAhead: false, epochChanged: false })])
      .toEqual([false, true, true, true, true])
  })

  it('window: strict ISO with a zone, normalised; from before to', () => {
    expect(parseWindow('2026-11-07T08:00:00+08:00..2026-11-08')).toEqual({ from: '2026-11-07T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' })
    for (const bad of ['2026-11-07', '2026-11-07..', '2026-02-30..2026-03-05', '2026-11-07 00:00Z..2026-11-08', '2026-11-08..2026-11-08']) expect(() => parseWindow(bad)).toThrow()
  })

  it('produces a snapshot only: neither script calls ygl-trees or a verify run/prepare/submit/archive step', () => {
    // Comments may name the verify steps (to say they are not called); code may not. `//` counts as a comment only after
    // whitespace, so a URL's `://` in a string stays code.
    const code = (file: string) => readFileSync(join(repo, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
    const VERIFY_STEP = /ygl-?trees|yglverify|['"`]verify['"`]\s*,\s*['"`](run|prepare|submit|archive)['"`]|\bverify[\s:]+(run|prepare|submit|archive)\b/
    for (const file of ['scripts/verify-probe.mjs', 'scripts/a2a-shadow-snapshot.mjs']) expect(code(file), file).not.toMatch(VERIFY_STEP)
    // The pattern does catch a call, so a clean result above means something.
    expect("spawnSync('ygl-trees', ['verify', 'run'])").toMatch(VERIFY_STEP)
    expect("run('x', 'node', [bin, 'verify', 'submit'])").toMatch(VERIFY_STEP)
    // The flattening module runs no command at all.
    expect(code('scripts/a2a-shadow-snapshot.mjs')).not.toMatch(/child_process|spawn|exec(File)?Sync/)
  })

  it('names its own identity: the commit and the sha256 of both collector scripts', () => {
    const f = fixture()
    const r = probe(['--a2a-shadow', f.source, '--cli-home', f.cliHome, '--window', WINDOW, '--out', f.out])
    expect(r.code).toBe(0)
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim()
    expect(r.json.collector).toEqual({ commit: head, clean: expect.any(Boolean), sha256: {
      'scripts/verify-probe.mjs': sha(join(repo, 'scripts/verify-probe.mjs')), 'scripts/a2a-shadow-snapshot.mjs': sha(join(repo, 'scripts/a2a-shadow-snapshot.mjs')) } })
  })
})
