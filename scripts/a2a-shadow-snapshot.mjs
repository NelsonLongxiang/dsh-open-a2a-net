/**
 * Flatten one superagent a2a Source's shadow-run records into a verify snapshot (p2 shadow acceptance; docs/validator.md).
 * Use: node scripts/verify-probe.mjs --a2a-shadow <superagent-db> --cli-home <dir> --window <from>..<to> --out <snapshot>.
 *
 * The source database is opened read-only with query_only on; the snapshot is a new file, never an overwrite. Each
 * snapshot table is a plain projection of stored records, plus the facts the acceptance needs computed the same way on
 * every rerun (trigger_id, loss, seq gaps). No text is copied: rows, pages and health keep metadata only. This produces
 * a snapshot, never a verdict — only `ygl-trees verify run` judges it.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** KV keys and record caps of src/superagent/a2a-watch.ts (the unit test pins them against the plugin's exports). */
export const KV = { rows: 'a2a-rows', pages: 'a2a-pages', healthLog: 'a2a-health-log' }
export const CAPS = { rows: 1000, pages: 1000, health: 200 }
const OUTCOMES = new Set(['stored', 'duplicate', 'filtered:unverified', 'filtered:unlinked', 'filtered:loop', 'filtered:receipt', 'duplicateCopy', 'unreadable'])
/** p3 (S36): the host admission rules that are an operator's link; src/superagent/a2a-watch.ts LINK_RULES (the unit test pins them). */
export const LINK_RULES = ['canvas-shared', 'remote-ref-samezone', 'remote-ref-foreign', 'remote-ref-cli', 'cli-deposit']
/** p3 (S27 L1): the Source's own task ids start with this. */
export const LOOP_PREFIX = 'a2a-'

/** superagent's `key(...)`: the first 32 hex of sha256 over the JSON array of the parts. */
export const key = (...values) => createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/
/** A real calendar day: Date.parse would roll 2026-02-30 over to March instead of refusing it. */
const calendar = p => {
  const m = ISO.exec(p)
  if (m === null || !Number.isFinite(Date.parse(p))) return false
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return day.getUTCMonth() === Number(m[2]) - 1 && day.getUTCDate() === Number(m[3])
}
/** `<from>..<to>`, each a date or a date-time with a zone; normalised to toISOString so stored `at` strings compare in order. */
export function parseWindow(text) {
  const parts = typeof text === 'string' ? text.split('..') : []
  if (parts.length !== 2 || !parts.every(calendar)) {
    throw new UsageError(`--window takes <from>..<to>, each a date or a date-time with a zone (got "${String(text)}")`)
  }
  const [from, to] = parts.map(p => new Date(p).toISOString())
  if (!(from < to)) throw new UsageError(`--window must end after it starts (got ${from}..${to})`)
  return { from, to }
}

export class UsageError extends Error {}

const isIso = v => typeof v === 'string' && Number.isFinite(Date.parse(v))
const text = v => typeof v === 'string' ? v : null
const fail = (what, i, why) => { throw new Error(`${what} record ${String(i)} is malformed (${why}); the snapshot was not written`) }

/** Read one KV list; an absent key is an empty list, anything but an array is an error (fail closed, never a guess). */
function kvList(db, name) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(name)
  if (row === undefined) return []
  const value = JSON.parse(String(row.value))
  if (!Array.isArray(value)) throw new Error(`kv ${name} is not a list; the snapshot was not written`)
  return value
}

function checkRows(rows) {
  rows.forEach((r, i) => {
    if (r === null || typeof r !== 'object') fail(KV.rows, i, 'not an object')
    if (typeof r.epoch !== 'string' || !isIso(r.at) || !OUTCOMES.has(r.outcome)) fail(KV.rows, i, 'epoch, at or outcome')
    if (!(r.seq === null || Number.isInteger(r.seq))) fail(KV.rows, i, 'seq')
  })
}
function checkPages(pages) {
  pages.forEach((p, i) => {
    if (p === null || typeof p !== 'object') fail(KV.pages, i, 'not an object')
    if (!isIso(p.at) || typeof p.after !== 'string' || typeof p.next !== 'string' || typeof p.epoch !== 'string') fail(KV.pages, i, 'at, after, next or epoch')
    if (!(p.lost === null || Number.isInteger(p.lost)) || typeof p.epochChanged !== 'boolean' || typeof p.cursorAhead !== 'boolean') fail(KV.pages, i, 'lost, epochChanged or cursorAhead')
    // Plan P (p3): a heartbeat page carries whole, non-negative counts; any other page carries none.
    if (p.heartbeat !== undefined && (p.heartbeat !== true || !(Number.isInteger(p.rounds) && p.rounds >= 0) || !(Number.isInteger(p.rows) && p.rows >= 0))) fail(KV.pages, i, 'heartbeat, rounds or rows')
    if (p.heartbeat === undefined && (p.rounds !== undefined || p.rows !== undefined)) fail(KV.pages, i, 'rounds or rows without heartbeat')
  })
}
function checkHealth(log) {
  log.forEach((h, i) => {
    if (h === null || typeof h !== 'object' || !isIso(h.at) || typeof h.entry !== 'string' || typeof h.state !== 'string') fail(KV.healthLog, i, 'at, entry or state')
  })
}

/** A7: the round reported a loss the Source had to surface. */
export const isLoss = p => p.lost === null || p.lost > 0 || p.cursorAhead || p.epochChanged

/**
 * A7b: within one epoch, every seq missing between the window's first and last row, and whether a lost>0 page of that
 * epoch reported it — the host's lost is oldest_seq - after_seq - 1, so the pushed-out seqs are (after_seq, after_seq+lost].
 */
export function seqGaps(rows, pages) {
  const intervals = []
  for (const p of pages) {
    if (!(Number.isInteger(p.lost) && p.lost > 0) || p.epochChanged) continue
    const afterSeq = p.after === 'start' ? 0 : p.after.startsWith(`${p.epoch}:`) ? Number(p.after.slice(p.epoch.length + 1)) : NaN
    if (Number.isInteger(afterSeq)) intervals.push({ epoch: p.epoch, low: afterSeq, high: afterSeq + p.lost })
  }
  const byEpoch = new Map()
  for (const r of rows) {
    if (r.seq === null) continue
    const seqs = byEpoch.get(r.epoch) ?? new Set()
    seqs.add(r.seq); byEpoch.set(r.epoch, seqs)
  }
  const gaps = []
  for (const [epoch, seqs] of [...byEpoch].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const sorted = [...seqs].sort((a, b) => a - b)
    for (let seq = sorted[0] + 1; seq < sorted.at(-1); seq++) {
      if (seqs.has(seq)) continue
      const covered = intervals.some(iv => iv.epoch === epoch && seq > iv.low && seq <= iv.high)
      gaps.push({ epoch, seq, covered: covered ? 1 : 0 })
    }
  }
  return gaps
}

/** The Source identity's handle and its journaled routes (sent.1.jsonl then sent.jsonl); torn lines are skipped like the CLI does. */
function readSent(cliHome) {
  const identity = JSON.parse(readFileSync(join(cliHome, 'cli.json'), 'utf8'))
  if (typeof identity?.handle !== 'string' || identity.handle === '') throw new Error('cli.json under --cli-home has no handle')
  const sent = []
  for (const file of ['sent.1.jsonl', 'sent.jsonl']) {
    let lines = []
    try { lines = readFileSync(join(cliHome, file), 'utf8').split('\n') } catch (error) { if (error?.code === 'ENOENT') continue; throw error }
    for (const line of lines) {
      if (line === '') continue
      let r
      try { r = JSON.parse(line) } catch { continue }
      if (typeof r?.at === 'number' && Number.isFinite(r.at)) sent.push({ handle: text(r.handle), task_id: text(r.task_id), at: new Date(r.at).toISOString() })
    }
  }
  return { handle: identity.handle, sent }
}

const SCHEMA = `
CREATE TABLE shadow_meta (kind TEXT PRIMARY KEY, cap INTEGER NOT NULL, oldest_at TEXT, newest_at TEXT, count INTEGER NOT NULL, window_from TEXT NOT NULL, window_to TEXT NOT NULL);
CREATE TABLE shadow_rows (epoch TEXT NOT NULL, seq INTEGER, task_id TEXT, from_handle TEXT, outcome TEXT NOT NULL, at TEXT NOT NULL, proof TEXT, receipt_for TEXT, dup TEXT, trigger_id TEXT,
  trigger_present INTEGER NOT NULL, trigger_filtered_code TEXT, seq_records INTEGER, admission TEXT);
CREATE TABLE shadow_pages (at TEXT NOT NULL, after TEXT NOT NULL, next TEXT NOT NULL, epoch TEXT NOT NULL, lost INTEGER, epoch_changed INTEGER NOT NULL, cursor_ahead INTEGER NOT NULL, loss INTEGER NOT NULL,
  health_error INTEGER NOT NULL, heartbeat INTEGER NOT NULL, rounds INTEGER, rows INTEGER, hb_gap_min INTEGER, hb_next_gap_min INTEGER);
CREATE TABLE shadow_health (at TEXT NOT NULL, entry TEXT NOT NULL, state TEXT NOT NULL, code TEXT);
CREATE TABLE shadow_seq_gaps (epoch TEXT NOT NULL, seq INTEGER NOT NULL, covered INTEGER NOT NULL);
CREATE TABLE shadow_triggers (id TEXT PRIMARY KEY, source TEXT NOT NULL, human INTEGER, filtered_code TEXT, at TEXT, in_window INTEGER NOT NULL);
CREATE TABLE shadow_outbox (id TEXT PRIMARY KEY, channel_source TEXT, status TEXT, drop_reason TEXT);
CREATE TABLE shadow_tickets (id TEXT PRIMARY KEY, basis_source TEXT);
CREATE TABLE shadow_sent (handle TEXT, task_id TEXT, at TEXT NOT NULL, source_handle TEXT NOT NULL);
CREATE TABLE shadow_tally (name TEXT PRIMARY KEY, n INTEGER NOT NULL);
`

/**
 * shadow_tally: the zero-must-hold counts, one fixed row each. A verify scan of an empty table is NEEDS-MATERIAL by
 * design, and in a healthy run these detail tables are empty, so each count is its own always-present row. The SQL
 * re-counts the detail tables as written into the snapshot; checkTally fails the run on any difference or missing row.
 */
export const TALLY = {
  outbox_sent: "SELECT COUNT(*) AS n FROM shadow_outbox WHERE status = 'sent'",
  source_sent: 'SELECT COUNT(*) AS n FROM shadow_sent WHERE handle = source_handle',
  tickets_a2a: "SELECT COUNT(*) AS n FROM shadow_tickets WHERE basis_source = 'a2a'",
  gaps_uncovered: 'SELECT COUNT(*) AS n FROM shadow_seq_gaps WHERE covered = 0',
  // p3 A14: linked cli-identity requests that were taken in (a count to be at least 1, kept here so it is never an empty scan).
  cli_identity_stored: `SELECT COUNT(*) AS n FROM shadow_rows WHERE outcome = 'stored' AND proof = 'cli-identity' AND receipt_for IS NULL
    AND admission IN (${LINK_RULES.map(r => `'${r}'`).join(', ')}) AND (task_id IS NULL OR task_id NOT LIKE '${LOOP_PREFIX}%')`,
  // p3 A15: the heartbeats' row counts after the first heartbeat, against the row records in (first, last] (must be 0).
  heartbeat_row_delta: `SELECT COALESCE((SELECT SUM(rows) FROM shadow_pages WHERE heartbeat = 1 AND at > (SELECT MIN(at) FROM shadow_pages WHERE heartbeat = 1)), 0)
    - (SELECT COUNT(*) FROM shadow_rows WHERE at > (SELECT MIN(at) FROM shadow_pages WHERE heartbeat = 1) AND at <= (SELECT MAX(at) FROM shadow_pages WHERE heartbeat = 1)) AS n`,
}
/** Whole minutes from `a` to `b`, rounded up, so a gap a few seconds over a bound never reads as within it. */
const minutesUp = (a, b) => Math.ceil((Date.parse(b) - Date.parse(a)) / 60_000)

/** Re-count each tally from the snapshot's own detail tables; exactly the TALLY names, each equal, or the run fails. */
export function checkTally(snapshotDb) {
  const rows = snapshotDb.prepare('SELECT name, n FROM shadow_tally ORDER BY name').all()
  const names = Object.keys(TALLY)
  if (rows.length !== names.length || !names.every(name => rows.some(r => r.name === name))) {
    throw new Error(`shadow_tally must hold exactly ${names.join(', ')}; the snapshot was not written`)
  }
  for (const r of rows) {
    const recount = Number(snapshotDb.prepare(TALLY[r.name]).get().n)
    if (recount !== Number(r.n)) throw new Error(`shadow_tally ${r.name} is ${String(r.n)} but the snapshot holds ${String(recount)}; the snapshot was not written`)
  }
}

/**
 * Read the superagent database and the Source identity's home, and write the snapshot tables into `snapshotDb`.
 * Window-bounded: rows, pages, health and sent (by `at`, from inclusive, to exclusive). Whole-store: the a2a Triggers,
 * the a2a outbox and every Ticket's basis source (they carry no window time of their own, so the check covers more, not less).
 *
 * Lookup columns (appended; the raw columns stay as they are). The verify predicate reads one table and sql-pair only
 * compares equal key sets, so containment, counts and the window are worked out here, the same way on every rerun:
 * - shadow_rows.trigger_present: 1 when the whole trigger table (any source, no window) has id = trigger_id, else 0.
 * - shadow_rows.trigger_filtered_code: that Trigger's disposition $.filtered.code; null without a Trigger or unfiltered.
 * - shadow_rows.seq_records: records with the same epoch and seq in the whole a2a-rows list (no window); null when seq is.
 * - shadow_pages.health_error: 1 when the whole a2a-health-log (no window) has a record with the same at, entry 'a2a' and
 *   state 'error', else 0.
 * - shadow_triggers.in_window: 1 when trigger.at lies in --window (from inclusive, to exclusive), else 0.
 * - shadow_pages.heartbeat / rounds / rows (p3 plan P): the heartbeat page's own fields; 0 / null / null otherwise.
 * - shadow_pages.hb_gap_min: for a heartbeat, the whole minutes (rounded up) since the previous heartbeat in the window, or
 *   since the window's start for the first one; hb_next_gap_min: to the next heartbeat, or to the window's end for the last.
 *   Null on other pages. A15 reads both, so a silence at either edge of the window shows.
 */
export function flattenShadow({ sourceDb, cliHome, window, snapshotDb }) {
  const inWindow = at => at >= window.from && at < window.to
  const at = v => new Date(v).toISOString()
  const rowsAll = kvList(sourceDb, KV.rows); checkRows(rowsAll)
  const pagesAll = kvList(sourceDb, KV.pages); checkPages(pagesAll)
  const healthAll = kvList(sourceDb, KV.healthLog); checkHealth(healthAll)
  const rows = rowsAll.filter(r => inWindow(at(r.at)))
  const pages = pagesAll.filter(p => inWindow(at(p.at)))
  const health = healthAll.filter(h => inWindow(at(h.at)))
  const triggers = sourceDb.prepare(`SELECT t.id AS id, t.value ->> '$.source' AS source, t.value -> '$.human' AS human, t.at AS at,
    d.value ->> '$.filtered.code' AS filtered_code FROM trigger t LEFT JOIN disposition d ON d.id = t.id WHERE t.value ->> '$.source' = 'a2a' ORDER BY t.id`).all()
  const outbox = sourceDb.prepare(`SELECT id, value ->> '$.channel.source' AS channel_source, value ->> '$.status' AS status,
    value ->> '$.dropped.reason' AS drop_reason FROM outbox WHERE value ->> '$.channel.source' = 'a2a' ORDER BY id`).all()
  const tickets = sourceDb.prepare(`SELECT id, value ->> '$.mandate.basis.source' AS basis_source FROM ticket ORDER BY id`).all()
  const { handle, sent: sentAll } = readSent(cliHome)
  const sent = sentAll.filter(s => inWindow(s.at))
  const gaps = seqGaps(rows, pages)
  const beats = pages.filter(p => p.heartbeat === true).map(p => at(p.at)).sort()
  const beatGaps = new Map(beats.map((b, i) => [b, { prev: minutesUp(i === 0 ? window.from : beats[i - 1], b), next: minutesUp(b, i === beats.length - 1 ? window.to : beats[i + 1]) }]))
  const linked = new Set(LINK_RULES)
  const rowAt = r => at(r.at)
  const tally = {
    outbox_sent: outbox.filter(o => o.status === 'sent').length,
    source_sent: sent.filter(s => s.handle === handle).length,
    tickets_a2a: tickets.filter(t => t.basis_source === 'a2a').length,
    gaps_uncovered: gaps.filter(g => g.covered === 0).length,
    cli_identity_stored: rows.filter(r => r.outcome === 'stored' && r.proof === 'cli-identity' && (r.receipt_for ?? null) === null && linked.has(r.admission) &&
      !(typeof r.task_id === 'string' && r.task_id.startsWith(LOOP_PREFIX))).length,
    heartbeat_row_delta: beats.length === 0 ? 0
      : pages.filter(p => p.heartbeat === true && at(p.at) > beats[0]).reduce((sum, p) => sum + p.rows, 0) - rows.filter(r => rowAt(r) > beats[0] && rowAt(r) <= beats.at(-1)).length,
  }
  // trigger.id is the table's primary key (superagent store.ts:72), so a trigger_id finds at most one Trigger.
  const lookup = sourceDb.prepare(`SELECT d.value ->> '$.filtered.code' AS code FROM trigger t LEFT JOIN disposition d ON d.id = t.id WHERE t.id = ?`)
  const seqCount = new Map()
  for (const r of rowsAll) if (r.seq !== null) seqCount.set(`${r.epoch}:${String(r.seq)}`, (seqCount.get(`${r.epoch}:${String(r.seq)}`) ?? 0) + 1)
  const healthErrors = new Set(healthAll.filter(h => h.entry === 'a2a' && h.state === 'error').map(h => at(h.at)))
  const triggerAt = t => {
    if (!isIso(t.at)) throw new Error(`trigger ${String(t.id)} has no readable at; the snapshot was not written`)
    return at(t.at)
  }

  snapshotDb.exec(SCHEMA)
  const insert = (table, columns, list) => {
    const stmt = snapshotDb.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    for (const item of list) stmt.run(...columns.map(c => item[c] ?? null))
  }
  const meta = (kind, cap, list) => ({ kind, cap, count: list.length, window_from: window.from, window_to: window.to,
    oldest_at: list.length ? at(list[0].at) : null, newest_at: list.length ? at(list.at(-1).at) : null })
  snapshotDb.exec('BEGIN')
  try {
    insert('shadow_meta', ['kind', 'cap', 'oldest_at', 'newest_at', 'count', 'window_from', 'window_to'],
      [meta('rows', CAPS.rows, rowsAll), meta('pages', CAPS.pages, pagesAll), meta('health', CAPS.health, healthAll)])
    insert('shadow_rows', ['epoch', 'seq', 'task_id', 'from_handle', 'outcome', 'at', 'proof', 'receipt_for', 'dup', 'trigger_id',
      'trigger_present', 'trigger_filtered_code', 'seq_records', 'admission'], rows.map(r => {
      const triggerId = typeof r.task_id === 'string' && typeof r.from === 'string' ? key('a2a', r.from, r.task_id) : null
      const found = triggerId === null ? undefined : lookup.get(triggerId)
      return {
        epoch: r.epoch, seq: r.seq, task_id: text(r.task_id), from_handle: text(r.from), outcome: r.outcome, at: at(r.at),
        proof: text(r.proof), receipt_for: text(r.receipt_for), dup: text(r.dup), trigger_id: triggerId,
        trigger_present: found === undefined ? 0 : 1, trigger_filtered_code: found === undefined ? null : text(found.code),
        seq_records: r.seq === null ? null : seqCount.get(`${r.epoch}:${String(r.seq)}`), admission: text(r.admission),
      }
    }))
    insert('shadow_pages', ['at', 'after', 'next', 'epoch', 'lost', 'epoch_changed', 'cursor_ahead', 'loss', 'health_error', 'heartbeat', 'rounds', 'rows', 'hb_gap_min', 'hb_next_gap_min'], pages.map(p => {
      const beat = p.heartbeat === true ? beatGaps.get(at(p.at)) : undefined
      return {
        at: at(p.at), after: p.after, next: p.next, epoch: p.epoch, lost: p.lost, epoch_changed: p.epochChanged ? 1 : 0,
        cursor_ahead: p.cursorAhead ? 1 : 0, loss: isLoss(p) ? 1 : 0, health_error: healthErrors.has(at(p.at)) ? 1 : 0,
        heartbeat: beat === undefined ? 0 : 1, rounds: beat === undefined ? null : p.rounds, rows: beat === undefined ? null : p.rows,
        hb_gap_min: beat?.prev ?? null, hb_next_gap_min: beat?.next ?? null,
      }
    }))
    insert('shadow_health', ['at', 'entry', 'state', 'code'], health.map(h => ({ at: at(h.at), entry: h.entry, state: h.state, code: text(h.code) })))
    insert('shadow_seq_gaps', ['epoch', 'seq', 'covered'], gaps)
    insert('shadow_triggers', ['id', 'source', 'human', 'filtered_code', 'at', 'in_window'], triggers.map(t => ({ ...t,
      human: t.human === 'true' ? 1 : t.human === 'false' ? 0 : null, in_window: inWindow(triggerAt(t)) ? 1 : 0 })))
    insert('shadow_outbox', ['id', 'channel_source', 'status', 'drop_reason'], outbox)
    insert('shadow_tickets', ['id', 'basis_source'], tickets)
    insert('shadow_sent', ['handle', 'task_id', 'at', 'source_handle'], sent.map(s => ({ ...s, source_handle: handle })))
    // From the same rows just written above, never a second read of the source.
    insert('shadow_tally', ['name', 'n'], Object.entries(tally).map(([name, n]) => ({ name, n })))
    snapshotDb.exec('COMMIT')
  } catch (error) { snapshotDb.exec('ROLLBACK'); throw error }
  checkTally(snapshotDb)
  return {
    window, handle,
    counts: { rows: rows.length, pages: pages.length, health: health.length, seq_gaps: gaps.length, triggers: triggers.length,
      outbox: outbox.length, tickets: tickets.length, sent: sent.length },
    tally,
    stored: { rows: rowsAll.length, pages: pagesAll.length, health: healthAll.length },
  }
}

/** Open the source read-only (query_only on), write a new snapshot file, and return the summary. Refuses an existing --out. */
export async function collectA2aShadow({ sourcePath, cliHome, window, out }) {
  const { DatabaseSync } = await import('node:sqlite')
  if (!existsSync(sourcePath)) throw new Error('the superagent database given to --a2a-shadow does not exist')
  if (!existsSync(join(cliHome, 'cli.json'))) throw new Error('--cli-home holds no cli.json')
  if (existsSync(out)) throw new Error('the snapshot already exists; choose a new --out')
  const sourceDb = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    sourceDb.exec('PRAGMA query_only = ON')
    const snapshotDb = new DatabaseSync(out)
    try { return flattenShadow({ sourceDb, cliHome, window, snapshotDb }) } catch (error) {
      // This run created the file; a failed run leaves none behind, so the rerun is not refused.
      snapshotDb.close(); rmSync(out, { force: true }); throw error
    } finally { if (snapshotDb.isOpen) snapshotDb.close() }
  } finally { sourceDb.close() }
}
