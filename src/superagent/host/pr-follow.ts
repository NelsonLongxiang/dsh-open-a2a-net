/**
 * superagent, a ticket follows its pull request (docs/design/superagent-pr-follow.md, D1–D4).
 *
 * The engine already ends a ticket with the threads it follows; this file is the small GitHub side it needs. The host reads
 * the pull requests its open tickets follow with the `gh` its operator logged in (the plugin stores no token): a merge or a
 * close is `threadClosed`, and a new comment or review is a Trigger on that thread, so it fans out to the ticket.
 * A failed read is retried with a backoff and shown on the team page; it never ends a ticket.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/pr-follow
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Engine, Ticket, Trigger } from '../upstream/dsh-superagent/src/core/index.ts'

export const GITHUB_SOURCE = 'github'
/** How often the followed pull requests are read, and the longest a failing read backs off to. */
export const PR_POLL_MS = 60_000
export const PR_POLL_MAX_MS = 15 * 60_000
/** How many seen comment ids a pull request keeps. */
const SEEN_CAP = 2000
const TEXT_CAP = 4000

export type GhRun = (args: string[]) => Promise<string>

/** `gh` as the operator set it up on this host. */
export const defaultGh: GhRun = args => new Promise((resolve, reject) => {
  execFile('gh', args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => { if (error) reject(error); else resolve(stdout) })
})

/** A pull request URL's repository and number, and the id of its thread; undefined for anything else. */
export function parsePullRequest(url: string): { repo: string; number: number; id: string } | undefined {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(url.trim())
  if (match === null) return undefined
  return { repo: match[1]!, number: Number(match[2]), id: `${match[1]!}#${match[2]!}` }
}

interface GhUser { readonly login?: string; readonly type?: string }
interface GhComment { readonly id: number; readonly user?: GhUser | null; readonly body?: string | null; readonly created_at?: string; readonly submitted_at?: string; readonly state?: string }

export interface PrFollowDeps {
  readonly path: string
  readonly tickets: () => readonly Ticket[]
  readonly engine: () => Engine
  readonly gh: GhRun
  /** GitHub logins whose comments are a person's (settings `allowed.github`). */
  readonly allowed: () => readonly string[]
  readonly paused: () => boolean
  readonly logger: { warn(format: string, ...args: unknown[]): void }
}

export class PrFollower {
  private seen: Record<string, string[]>
  private running = false
  private nextAt = 0
  private failures = 0
  private problemText: string | undefined

  constructor(private readonly d: PrFollowDeps) {
    this.seen = this.load()
  }

  private load(): Record<string, string[]> {
    try { return existsSync(this.d.path) ? JSON.parse(readFileSync(this.d.path, 'utf8')) as Record<string, string[]> : {} } catch { return {} }
  }

  private save(): void {
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.seen), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  /** Why the last read failed, for the team page. */
  get problem(): string | undefined { return this.problemText }

  /** The open tickets' followed pull requests, as thread ids. */
  private followed(): string[] {
    const prefix = `${GITHUB_SOURCE}:`
    return [...new Set(this.d.tickets().filter(t => !t.ended).flatMap(t => (t.follows ?? []).filter(f => !f.closed && f.thread.startsWith(prefix)).map(f => f.thread.slice(prefix.length))))]
  }

  /** From the host's pass: at most one round at a time, only when one is due. */
  tick(now = Date.now()): void {
    if (this.running || now < this.nextAt || this.d.paused()) return
    this.running = true
    void this.round().finally(() => {
      this.running = false
      const wait = Math.min(PR_POLL_MS * 2 ** this.failures, PR_POLL_MAX_MS)
      this.nextAt = Date.now() + wait
    })
  }

  private async round(): Promise<void> {
    let failed: string | undefined
    for (const id of this.followed()) {
      try { await this.readThread(id) } catch (error) { failed = `${id}: ${String(error).slice(0, 200)}`; this.d.logger.warn('superagent: reading pull request %s failed: %s', id, String(error)) }
    }
    if (failed === undefined) { this.failures = 0; this.problemText = undefined } else { this.failures += 1; this.problemText = failed }
  }

  private async api<T>(path: string): Promise<T> { return JSON.parse(await this.d.gh(['api', path])) as T }

  private async readThread(id: string): Promise<void> {
    const hash = id.lastIndexOf('#')
    const repo = id.slice(0, hash), number = id.slice(hash + 1)
    const pull = await this.api<{ state?: string; merged?: boolean; merged_at?: string | null; closed_at?: string | null }>(`repos/${repo}/pulls/${number}`)
    const [issue, reviews, inline] = await Promise.all([
      this.api<GhComment[]>(`repos/${repo}/issues/${number}/comments?per_page=100`),
      this.api<GhComment[]>(`repos/${repo}/pulls/${number}/reviews?per_page=100`),
      this.api<GhComment[]>(`repos/${repo}/pulls/${number}/comments?per_page=100`),
    ])
    const all = [...issue.map(c => ({ c, kind: 'comment' })), ...reviews.map(c => ({ c, kind: 'review' })), ...inline.map(c => ({ c, kind: 'review comment' }))]
    const key = (kind: string, c: GhComment): string => `${kind}:${String(c.id)}`
    const before = this.seen[id]
    if (before === undefined) {
      // What was said before the ticket followed the pull request is not news to its member.
      this.seen[id] = all.map(({ c, kind }) => key(kind, c)).slice(-SEEN_CAP)
      this.save()
    } else {
      const known = new Set(before)
      const fresh = all.filter(({ c, kind }) => !known.has(key(kind, c))).sort((a, b) => (a.c.submitted_at ?? a.c.created_at ?? '').localeCompare(b.c.submitted_at ?? b.c.created_at ?? ''))
      for (const { c, kind } of fresh) {
        const text = this.textOf(kind, c)
        if (text !== undefined) this.d.engine().receive(this.trigger(id, kind, c, text))
        before.push(key(kind, c))
      }
      if (fresh.length > 0) { this.seen[id] = before.slice(-SEEN_CAP); this.save() }
    }
    if (pull.state === 'closed') {
      this.d.engine().threadClosed({ source: GITHUB_SOURCE, id }, pull.merged === true ? 'merged' : 'closed', pull.merged_at ?? pull.closed_at ?? new Date().toISOString())
    }
  }

  /** A review with no words says only its verdict; one that merely groups inline comments says nothing. */
  private textOf(kind: string, c: GhComment): string | undefined {
    const body = (c.body ?? '').trim()
    if (kind === 'review' && body === '' && c.state !== 'APPROVED' && c.state !== 'CHANGES_REQUESTED') return undefined
    const verdict = kind === 'review' && c.state !== undefined ? ` (${c.state.toLowerCase()})` : ''
    return `[GitHub ${kind}${verdict} by ${c.user?.login ?? 'unknown'}] ${body}`.slice(0, TEXT_CAP)
  }

  private trigger(id: string, kind: string, c: GhComment, text: string): Trigger {
    const login = c.user?.login ?? 'unknown'
    const named = c.user?.type === 'Bot' ? undefined : this.d.allowed().find(a => a.toLowerCase() === login.toLowerCase())
    return {
      id: `gh-${kind.replace(' ', '-')}-${String(c.id)}`, source: GITHUB_SOURCE, threads: [{ source: GITHUB_SOURCE, id }],
      actor: { source: GITHUB_SOURCE, id: named ?? login }, human: named !== undefined, at: new Date(c.submitted_at ?? c.created_at ?? Date.now()).toISOString(), text, meta: {},
    }
  }
}
