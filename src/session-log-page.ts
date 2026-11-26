/**
 * Read one page of a session's transcript from the host's session log (#951 S1). The log files and the generation rule are
 * the ones session-log reads; this adds a cursor and a small cache of parsed transcripts keyed by file, size and mtime.
 * @module @nelsonlongxiang/dsh-open-a2a-net/session-log-page
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { decodeSessionLog, pageTranscript, parseTranscriptEntries, TRANSCRIPT_MAX_FILE_BYTES, type TranscriptEntry, type TranscriptPage } from './session-transcript.ts'

/** A session id as the user routes take it: no path characters, hex with hyphens allowed (real ids are session-<uuid>). */
export const SESSION_ID_SHAPE = /^session-[0-9a-f][0-9a-f-]{7,63}$/i

const CACHE_MAX = 4
const CACHE_DECODED_MAX = 16 * 1024 * 1024

/**
 * The newest-generation log file of a session.
 * @param roots - the session roots (the host's sessions trees).
 * @param id - a session id that already passed SESSION_ID_SHAPE.
 * @returns the path, or undefined when the session has no log.
 */
export function findSessionLogPath(roots: readonly string[], id: string): string | undefined {
  for (const sessionsRoot of roots) {
    for (const entry of readdirSync(sessionsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(sessionsRoot, entry.name, id)
      if (!existsSync(candidate)) continue
      const files = readdirSync(candidate).filter(name => name.startsWith('session.') && (name.endsWith('.jsonl.zstd') || name.endsWith('.jsonl')))
      // session.v{N}.jsonl[.zstd]: read the highest generation, zstd first at the same one.
      const generation = (name: string): number => Number(name.match(/\.v(\d+)\./)?.[1] ?? 0)
      const rank = (name: string): number => generation(name) * 2 + (name.endsWith('.zstd') ? 1 : 0)
      files.sort((a, b) => rank(b) - rank(a))
      return files[0] === undefined ? undefined : join(candidate, files[0])
    }
  }
  return undefined
}

/** Parsed transcripts of the files read lately, so paging back through one session does not decode it again each page. */
export class TranscriptCache {
  private readonly rows = new Map<string, readonly TranscriptEntry[]>()

  /**
   * @param path - the log file.
   * @param size - its size now.
   * @param mtimeMs - its mtime now.
   * @param parse - parses the file when no row matches (a changed size or mtime is a different key, so a grown log is parsed again).
   * @returns the whole transcript.
   */
  entries(path: string, size: number, mtimeMs: number, parse: () => { entries: readonly TranscriptEntry[]; decodedBytes: number }): readonly TranscriptEntry[] {
    const key = `${path}|${String(size)}|${String(mtimeMs)}`
    const hit = this.rows.get(key)
    if (hit !== undefined) { this.rows.delete(key); this.rows.set(key, hit); return hit }
    const parsed = parse()
    if (parsed.decodedBytes <= CACHE_DECODED_MAX) {
      for (const stale of [...this.rows.keys()].filter(k => k.startsWith(path + '|'))) this.rows.delete(stale)
      this.rows.set(key, parsed.entries)
      while (this.rows.size > CACHE_MAX) this.rows.delete(this.rows.keys().next().value as string)
    }
    return parsed.entries
  }
}

export type SessionPageResult = ({ ok: true; id: string } & TranscriptPage) | { ok: false; code: 'no-log' | 'too-large' | 'unreadable'; error: string }

/**
 * Read one page of a session's transcript.
 * @param on - the session roots and the cache.
 * @param id - the session (SESSION_ID_SHAPE already checked).
 * @param page - cursor, page size and per-entry text cap.
 * @returns the page, or why there is none.
 */
export function readSessionPage(on: { roots: () => readonly string[]; cache: TranscriptCache }, id: string, page: { before?: number; limit?: number; entryCap?: number }): SessionPageResult {
  try {
    const path = findSessionLogPath(on.roots(), id)
    if (path === undefined) return { ok: false, code: 'no-log', error: 'no log artifact for this session' }
    const stat = statSync(path)
    if (stat.size > TRANSCRIPT_MAX_FILE_BYTES) return { ok: false, code: 'too-large', error: 'session log exceeds the size cap' }
    const entries = on.cache.entries(path, stat.size, stat.mtimeMs, () => {
      const text = decodeSessionLog(readFileSync(path))
      return { entries: parseTranscriptEntries(text), decodedBytes: text.length }
    })
    return { ok: true, id, ...pageTranscript(entries, page) }
  } catch (error) {
    return { ok: false, code: 'unreadable', error: `transcript failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}
