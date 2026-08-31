/**
 * Persisted session-node join intent (`<dsh-home>/a2a/joined.json`). A join
 * is a user gesture over a durable session, but the node it mounts lives and
 * dies with the session's Agent instance — page reloads and host restarts
 * dispose Agents, which silently dropped every join. The store keeps the
 * intent across those lifecycles: the plugin remounts the node whenever the
 * session's Agent comes back, until the user leaves (the only intent
 * remover; disposal alone never unpersists).
 * @module @nelsonlongxiang/dsh-open-a2a-net/joined-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Hard cap on remembered join intents. Ids of deleted sessions linger
 * harmlessly (no Agent ever comes back for them); the cap bounds the file,
 * keeping the most recent intents (peer-store's bound rationale).
 */
export const JOIN_CAP = 64

/** The persisted intent document (whole-file read/write, small by design). */
export interface JoinedSnapshot {
  readonly sessions: readonly string[]
}

/**
 * Bounded set of session ids whose user joined them to the A2A network,
 * with whole-file persistence. Pure of any registry knowledge: callers ask
 * {@link has} when an Agent appears and record {@link add} / {@link remove}
 * on the join and leave operations.
 */
export class JoinedSessions {
  /** Session ids, most recently joined first. */
  private ids: string[] = []

  /**
   * @param path - persistence file (`<dsh-home>/a2a/joined.json`); empty = no persistence.
   */
  constructor(private readonly path: string) {
    this.restore()
  }

  /**
   * Whether the session's join intent is remembered.
   * @param id - the session id to check.
   * @returns whether the intent is present.
   */
  has(id: string): boolean {
    return this.ids.includes(id)
  }

  /**
   * Every remembered join intent, most recently joined first.
   * @returns the remembered session ids.
   */
  list(): readonly string[] {
    return [...this.ids]
  }

  /**
   * Remember one join intent, most-recent first, bounded by {@link JOIN_CAP}
   * (the oldest intent beyond the cap is forgotten).
   * @param id - the joined session id.
   */
  add(id: string): void {
    this.ids = [id, ...this.ids.filter(entry => entry !== id)].slice(0, JOIN_CAP)
    this.persist()
  }

  /**
   * Forget one join intent (the leave operation; a no-op when absent).
   * @param id - the session id whose intent is removed.
   */
  remove(id: string): void {
    if (!this.has(id)) return
    this.ids = this.ids.filter(entry => entry !== id)
    this.persist()
  }

  /**
   * F7 (wake-intent self-heal): re-read the persisted snapshot into memory.
   * A boot-time transient (e.g. the workspace registry briefly reporting a
   * session archived) can prune the in-memory intent while the file still
   * holds it — the file is the durable source of the user's gesture, so the
   * reload restores memory to match it. Callers use this as a one-shot
   * fallback when a wake finds no in-memory match.
   */
  reload(): void {
    this.restore()
  }

  /** Load a persisted snapshot on construction, if present. */
  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as JoinedSnapshot | null
      const sessions = snapshot?.sessions
      if (!Array.isArray(sessions)) return
      this.ids = sessions.filter((entry): entry is string => typeof entry === 'string' && entry !== '').slice(0, JOIN_CAP)
    } catch {
      // A corrupt store is not fatal: the user re-joins; nothing else is lost.
    }
  }

  /** Persist the intent set (no-op when no path was configured). */
  private persist(): void {
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const snapshot: JoinedSnapshot = { sessions: [...this.ids] }
      writeFileSync(this.path, JSON.stringify(snapshot), { mode: 0o600 })
    } catch {
      // An unwritable home must not break joining; the intent degrades to memory-only.
    }
  }
}
