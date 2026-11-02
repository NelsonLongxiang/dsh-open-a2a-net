/**
 * GitHub check for node task pointers (docs/design/node-identity.md §6, §8-8; slice N6).
 *
 * - Credentials are the host's own: `GITHUB_TOKEN` in the environment, else
 *   an existing `gh` login. The plugin stores none.
 * - One call per pointer: the issues endpoint answers for issues AND pull
 *   requests (`pull_request.merged_at` says whether a PR merged).
 * - Anything that is not a clean answer — no credential, offline, rate
 *   limited, a malformed body — is `undefined`: the state is UNKNOWN, never
 *   guessed, and an unknown state never triggers a reminder.
 * @module @nelsonlongxiang/dsh-open-a2a-net/node-github
 */

import { execFile } from 'node:child_process'

export type TaskState = 'open' | 'merged' | 'closed' | 'declined'

/** `owner/repo#n` — the pointer form (GitHub's own owner and repo character sets; `.` and `..` are no repo). */
export const TASK_REF = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/(?!\.\.?#)([A-Za-z0-9._-]{1,100})#([1-9]\d{0,9})$/

/** One pointer's state on GitHub, and when it finished (merged_at / closed_at), if it did. */
export interface TaskFact { readonly state: TaskState; readonly finishedAt?: string }

/** One pointer's fact on GitHub, or undefined when it cannot be known right now. */
export type GithubProbe = (ref: string) => Promise<TaskFact | undefined>

/** Map one issues-API body to a fact; undefined for anything that does not look like one. */
export function factOf(body: unknown): TaskFact | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const b = body as { state?: unknown; state_reason?: unknown; closed_at?: unknown; pull_request?: { merged_at?: unknown } | null }
  if (b.state === 'open') return { state: 'open' }
  if (b.state !== 'closed') return undefined
  const closedAt = typeof b.closed_at === 'string' ? { finishedAt: b.closed_at } : {}
  if (b.pull_request !== undefined && b.pull_request !== null && typeof b.pull_request.merged_at === 'string') return { state: 'merged', finishedAt: b.pull_request.merged_at }
  if (b.state_reason === 'not_planned') return { state: 'declined', ...closedAt }
  return { state: 'closed', ...closedAt }
}

/** Just the state of {@link factOf}. */
export function stateOf(body: unknown): TaskState | undefined {
  return factOf(body)?.state
}

export interface GithubProbeDeps {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly fetch?: typeof globalThis.fetch
  /** Runs `gh api <path>` and resolves its stdout; rejects when gh is missing, logged out or fails. */
  readonly gh?: (path: string) => Promise<string>
  readonly timeoutMs?: number
}

const ghApi = (timeoutMs: number) => (path: string): Promise<string> => new Promise((resolve, reject) => {
  execFile('gh', ['api', path], { timeout: timeoutMs, maxBuffer: 1 << 20 }, (error, stdout) => {
    if (error !== null) reject(error)
    else resolve(stdout)
  })
})

/** The production probe: token first, then `gh`, else unknown. Never throws. */
export function githubProbe(d: GithubProbeDeps = {}): GithubProbe {
  const env = d.env ?? process.env
  const timeoutMs = d.timeoutMs ?? 10_000
  const doFetch = d.fetch ?? globalThis.fetch
  const gh = d.gh ?? ghApi(timeoutMs)
  return async (ref) => {
    const m = TASK_REF.exec(ref)
    if (m === null) return undefined
    const path = `repos/${m[1] as string}/${m[2] as string}/issues/${m[3] as string}`
    const token = env.GITHUB_TOKEN ?? ''
    try {
      if (token !== '') {
        const res = await doFetch(`https://api.github.com/${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) return undefined
        return factOf(await res.json())
      }
      return factOf(JSON.parse(await gh(path)))
    } catch {
      return undefined
    }
  }
}
