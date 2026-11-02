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

/** `owner/repo#n` — the pointer form (GitHub's own owner and repo character sets). */
export const TASK_REF = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})#([1-9]\d{0,9})$/

/** One pointer's state on GitHub, or undefined when it cannot be known right now. */
export type GithubProbe = (ref: string) => Promise<TaskState | undefined>

/** Map one issues-API body to a state; undefined for anything that does not look like one. */
export function stateOf(body: unknown): TaskState | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const b = body as { state?: unknown; state_reason?: unknown; pull_request?: { merged_at?: unknown } | null }
  if (b.state === 'open') return 'open'
  if (b.state !== 'closed') return undefined
  if (b.pull_request !== undefined && b.pull_request !== null && typeof b.pull_request.merged_at === 'string') return 'merged'
  if (b.state_reason === 'not_planned') return 'declined'
  return 'closed'
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
        return stateOf(await res.json())
      }
      return stateOf(JSON.parse(await gh(path)))
    } catch {
      return undefined
    }
  }
}
