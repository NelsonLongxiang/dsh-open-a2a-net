/**
 * Inbound task bodies, kept for the session they were delivered to (market request 2026-11-14; owner 「两个都开工」).
 *
 * A delivery to a busy session is steered in (until the host's queue takes sourced prompts, #356). When that steer is never
 * consumed, the ledger keeps only the task's brief, so the session could see the title but not the text. This store keeps
 * each inbound session delivery's text, so that:
 * - the idle reconciliation pass (#351) can redeliver it once, as a sourced followup, when the row is still unconsumed and
 *   the session is idle; and
 * - `a2a_task_read { task_id }` lets the receiving session — and only it — read the text again.
 *
 * Bounded: at most {@link TASK_BODY_MAX} characters per body (longer ones are kept clipped and say so), at most
 * {@link TASK_BODIES_MAX} bodies, each for {@link TASK_BODY_TTL_MS}; the oldest go first. The file is the host user's
 * (mode 0600), written tmp + rename. A body is peer content: whoever reads it reads text from outside this host.
 * @module @nelsonlongxiang/dsh-open-a2a-net/task-bodies
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Whether a delivery's text may be redelivered: only one the host's queue does not hold. A delivery that went into the
 * session's queue (a tracked correspondence, reserved/enqueued/claimed) is handed over by the queue itself — redelivering it
 * would give the session the task twice. An untracked delivery (a steer) or a failed one is the one whose text was lost.
 */
export function redeliverable(delivery: { readonly state: string } | undefined): boolean {
  return delivery === undefined || delivery.state === 'failed'
}

export const TASK_BODY_MAX = 64 * 1024
export const TASK_BODIES_MAX = 512
export const TASK_BODY_TTL_MS = 72 * 60 * 60 * 1000

export interface TaskBody {
  readonly taskId: string
  /** The session id it was delivered to: the only reader. */
  readonly receiver: string
  /** Who sent it (the caller as admitted). */
  readonly from: string
  readonly text: string
  readonly truncated: boolean
  readonly at: number
  readonly expiresAt: number
  /** When the idle pass redelivered it (once). */
  readonly redeliveredAt?: number
}

export class TaskBodies {
  private bodies: TaskBody[] = []

  /** @param path - the store file ('' = memory only, for tests). */
  constructor(private readonly path: string, private readonly now: () => number = () => Date.now()) {
    if (path === '' || !existsSync(path)) return
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { bodies?: unknown }
      if (Array.isArray(raw.bodies)) this.bodies = raw.bodies.filter((b): b is TaskBody => {
        const r = b as Partial<TaskBody> | null
        return r !== null && typeof r === 'object' && typeof r.taskId === 'string' && typeof r.receiver === 'string' && r.receiver !== '' && typeof r.from === 'string' && typeof r.text === 'string' && typeof r.truncated === 'boolean' && Number.isSafeInteger(r.at) && Number.isSafeInteger(r.expiresAt)
      })
    } catch { this.bodies = [] /* unreadable: nothing is served from it */ }
  }

  /** Keep a delivery's text for its receiver (a repeat of the same task id replaces it). */
  keep(taskId: string, receiver: string, from: string, text: string): void {
    if (taskId === '' || receiver === '') return
    const at = this.now()
    const body: TaskBody = { taskId, receiver, from, text: text.slice(0, TASK_BODY_MAX), truncated: text.length > TASK_BODY_MAX, at, expiresAt: at + TASK_BODY_TTL_MS }
    this.bodies = [...this.live().filter(b => b.taskId !== taskId), body].slice(-TASK_BODIES_MAX)
    this.persist()
  }

  /** The body of `taskId` if `receiver` is the session it was delivered to (anyone else: undefined, as for a missing one). */
  read(taskId: string, receiver: string): TaskBody | undefined {
    return this.live().find(b => b.taskId === taskId && b.receiver === receiver)
  }

  /** The body to redeliver to `receiver` once, or undefined (none, someone else's, or already redelivered). */
  forRedelivery(taskId: string, receiver: string): TaskBody | undefined {
    const body = this.read(taskId, receiver)
    return body === undefined || body.redeliveredAt !== undefined ? undefined : body
  }

  markRedelivered(taskId: string): void {
    const at = this.now()
    this.bodies = this.bodies.map(b => b.taskId === taskId ? { ...b, redeliveredAt: at } : b)
    this.persist()
  }

  private live(): TaskBody[] { const at = this.now(); return this.bodies.filter(b => b.expiresAt > at) }

  private persist(): void {
    this.bodies = this.live()
    if (this.path === '') return
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`
    try { writeFileSync(tmp, JSON.stringify({ bodies: this.bodies }), { mode: 0o600, flag: 'wx' }); renameSync(tmp, this.path) } finally { rmSync(tmp, { force: true }) }
  }
}
