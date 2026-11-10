/**
 * superagent: GitHub issues as a source of requests (docs/design/superagent-github-issues.md).
 *
 * A round reads each listed repository's recently updated issues and recent issue comments with `gh api`. A new issue that
 * counts (G2) and every comment on an issue the source has seen become Triggers on that issue's thread; the gate decides
 * who is a person (G3, G4). Replies on an issue's thread go back as comments (G5). Issues that existed before a repository
 * was listed are not news. What was seen is kept per repository.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/github-issues
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Engine, Trigger } from '../upstream/dsh-superagent/src/core/index.ts'
import { GITHUB_SOURCE, PR_POLL_MAX_MS, PR_POLL_MS, type GhRun } from './pr-follow.ts'
import type { GithubIntake } from './policy.ts'

/** The label, or the mention, that addresses an issue to the team (G2). */
export const ISSUE_LABEL = 'superagent', ISSUE_MENTION = '@superagent'
/** The prefix of a reply posted on an issue (G5). */
export const REPLY_PREFIX = '[superagent] '
const TEXT_CAP = 8_000, SEEN_CAP = 2_000

interface GhUser { readonly login?: string; readonly type?: string }
interface GhIssue { readonly number: number; readonly title?: string; readonly body?: string | null; readonly user?: GhUser | null; readonly created_at?: string; readonly pull_request?: unknown; readonly labels?: ReadonlyArray<{ readonly name?: string } | string> }
interface GhIssueComment { readonly id: number; readonly body?: string | null; readonly user?: GhUser | null; readonly created_at?: string; readonly issue_url?: string }

/** Per repository: when it was first read, and the issues and comments already seen. */
interface RepoSeen { readonly since: string; issues: number[]; comments: number[]; /** Issues that arrived after the repository was listed: only their comments are follow-ups. */ taken?: number[] }

export interface IssueSourceDeps {
  readonly path: string
  readonly settings: () => { readonly on: boolean; readonly intake: GithubIntake | undefined }
  readonly engine: () => Engine
  readonly gh: GhRun
  /** GitHub logins that are persons (settings `allowed.github`); matched without regard to case, as GitHub does. */
  readonly allowed: () => readonly string[]
  readonly paused: () => boolean
  readonly now?: () => number
  readonly logger: { warn(format: string, ...args: unknown[]): void }
}

/** Whether an issue is addressed to the team (G2). */
export function issueAddressed(issue: Pick<GhIssue, 'title' | 'body' | 'labels'>, intake: GithubIntake['intake']): boolean {
  if (intake === 'all') return true
  const labels = (issue.labels ?? []).map(label => (typeof label === 'string' ? label : label.name ?? '').toLowerCase())
  if (labels.includes(ISSUE_LABEL)) return true
  return new RegExp(`(^|[^A-Za-z0-9_-])${ISSUE_MENTION}(?![A-Za-z0-9_-])`, 'i').test(`${issue.title ?? ''}\n${issue.body ?? ''}`)
}

/** An issue's thread id: `owner/name#number`, the same shape the pull request follower uses. */
export const issueThread = (repo: string, number: number): string => `${repo}#${String(number)}`

export class IssueSource {
  private seen: Record<string, RepoSeen>
  private running = false
  private nextAt = 0
  private failures = 0
  private problemText: string | undefined

  constructor(private readonly d: IssueSourceDeps) {
    this.seen = this.load()
  }

  private load(): Record<string, RepoSeen> {
    try { return existsSync(this.d.path) ? JSON.parse(readFileSync(this.d.path, 'utf8')) as Record<string, RepoSeen> : {} } catch { return {} }
  }

  private save(): void {
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.seen), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  private now(): number { return this.d.now?.() ?? Date.now() }

  /** Why the last round failed, for the team page. */
  get problem(): string | undefined { return this.problemText }

  /** From the host's pass: at most one round at a time, only when one is due and the source is on. */
  tick(): void {
    const { on, intake } = this.d.settings()
    if (!on || intake === undefined || intake.repos.length === 0 || this.running || this.now() < this.nextAt || this.d.paused()) return
    this.running = true
    void this.round(intake).finally(() => {
      this.running = false
      this.nextAt = this.now() + Math.min(PR_POLL_MS * 2 ** this.failures, PR_POLL_MAX_MS)
    })
  }

  /** One round over every listed repository; exported for tests through {@link IssueSource.tick}'s promise-free twin. */
  async round(intake: GithubIntake): Promise<void> {
    let failed: string | undefined
    for (const repo of intake.repos) {
      try { await this.readRepo(repo, intake.intake) } catch (error) { failed = `${repo}: ${String(error).slice(0, 200)}`; this.d.logger.warn('superagent: reading issues of %s failed: %s', repo, String(error)) }
    }
    if (failed === undefined) { this.failures = 0; this.problemText = undefined } else { this.failures += 1; this.problemText = failed }
  }

  private async api<T>(path: string): Promise<T> { return JSON.parse(await this.d.gh(['api', path])) as T }

  private async readRepo(repo: string, intake: GithubIntake['intake']): Promise<void> {
    const known = this.seen[repo]
    const issues = (await this.api<GhIssue[]>(`repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=50`)).filter(i => i.pull_request === undefined)
    if (known === undefined) {
      // A repository just listed: what is already there is not news (G2).
      this.seen[repo] = { since: new Date(this.now()).toISOString(), issues: issues.map(i => i.number).slice(0, SEEN_CAP), comments: [] }
      this.save()
      return
    }
    const comments = await this.api<GhIssueComment[]>(`repos/${repo}/issues/comments?since=${encodeURIComponent(known.since)}&sort=created&direction=asc&per_page=100`)
    const seenIssues = new Set(known.issues), seenComments = new Set(known.comments), taken = new Set(known.taken ?? [])
    let changed = false
    for (const issue of [...issues].sort((a, b) => a.number - b.number)) {
      if (seenIssues.has(issue.number)) continue
      seenIssues.add(issue.number); known.issues.push(issue.number); (known.taken ??= []).push(issue.number); changed = true
      // Every new issue is recorded; the gate refuses what is not addressed or not from a listed person (G2, G3).
      this.d.engine().receive(this.issueTrigger(repo, issue, issueAddressed(issue, intake)))
    }
    for (const comment of comments) {
      if (seenComments.has(comment.id)) continue
      const number = Number(/\/issues\/(\d+)$/.exec(comment.issue_url ?? '')?.[1])
      if (!Number.isSafeInteger(number)) continue
      seenComments.add(comment.id); known.comments.push(comment.id); changed = true
      // Only issues the source took in carry follow-ups (G4); the pull request follower reads pull requests.
      if (!taken.has(number) && !(known.taken ?? []).includes(number) || comment.user?.type === 'Bot' || (comment.body ?? '').startsWith(REPLY_PREFIX)) continue
      this.d.engine().receive(this.commentTrigger(repo, number, comment))
    }
    if (changed) {
      known.issues = known.issues.slice(-SEEN_CAP); known.comments = known.comments.slice(-SEEN_CAP); known.taken = (known.taken ?? []).slice(-SEEN_CAP)
      this.save()
    }
  }

  /** A login as the allowed list spells it, when it is on the list. */
  private person(login: string): string { return this.d.allowed().find(a => a.toLowerCase() === login.toLowerCase()) ?? login }

  private issueTrigger(repo: string, issue: GhIssue, addressed: boolean): Trigger {
    const login = this.person(issue.user?.login ?? 'unknown'), thread = issueThread(repo, issue.number)
    return {
      id: `gh-issue-${repo}-${String(issue.number)}`, source: GITHUB_SOURCE, threads: [{ source: GITHUB_SOURCE, id: thread }],
      actor: { source: GITHUB_SOURCE, id: login }, human: issue.user?.type !== 'Bot', ...(addressed ? { addressed: 'mention' as const } : {}),
      at: new Date(issue.created_at ?? this.now()).toISOString(), text: `[GitHub issue ${thread} by ${login}] ${issue.title ?? ''}\n\n${issue.body ?? ''}`.slice(0, TEXT_CAP),
      channel: { source: GITHUB_SOURCE, thread, address: { repo, issue: String(issue.number) } }, meta: { issue: true },
    }
  }

  private commentTrigger(repo: string, number: number, comment: GhIssueComment): Trigger {
    const login = this.person(comment.user?.login ?? 'unknown'), thread = issueThread(repo, number)
    return {
      id: `gh-issue-comment-${String(comment.id)}`, source: GITHUB_SOURCE, threads: [{ source: GITHUB_SOURCE, id: thread }],
      actor: { source: GITHUB_SOURCE, id: login }, human: true,
      at: new Date(comment.created_at ?? this.now()).toISOString(), text: `[GitHub comment on ${thread} by ${login}] ${comment.body ?? ''}`.slice(0, TEXT_CAP),
      channel: { source: GITHUB_SOURCE, thread, address: { repo, issue: String(number) } }, meta: { issue: true },
    }
  }

  /**
   * Post a reply on its issue (G5).
   * @param address - the channel's address: `{ repo, issue }`.
   * @param text - the reply.
   * @returns sent, or gone when the address names no issue.
   */
  async send(address: Record<string, string>, text: string): Promise<'sent' | 'gone'> {
    const repo = address.repo ?? '', issue = address.issue ?? ''
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/.test(repo) || !/^\d{1,9}$/.test(issue)) return 'gone'
    await this.d.gh(['issue', 'comment', issue, '--repo', repo, '--body', `${REPLY_PREFIX}${text}`.slice(0, 60_000)])
    return 'sent'
  }

  /**
   * The logins with push access to the listed repositories (G6).
   * @param repos - the repositories.
   * @returns the logins, sorted.
   */
  async collaborators(repos: readonly string[]): Promise<string[]> {
    const logins = new Set<string>()
    for (const repo of repos) {
      const rows = await this.api<Array<{ login?: string; type?: string }>>(`repos/${repo}/collaborators?permission=push&per_page=100`)
      for (const row of rows) if (typeof row.login === 'string' && row.type !== 'Bot') logins.add(row.login)
    }
    return [...logins].sort()
  }
}
