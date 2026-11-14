/**
 * Inbound task bodies, kept for the session they were delivered to (market request 2026-11-14; owner 「两个都开工」).
 *
 * A delivery to a busy session is steered in (until the host's queue takes sourced prompts, #356). When that steer is never
 * consumed, the ledger keeps only the task's brief, so the session could see the title but not the text. This store keeps
 * each inbound session delivery's text, so that:
 * - the idle reconciliation pass (#351) can redeliver a LOST one (a steer the host never tracked) as a correlated queue
 *   delivery of the original task — the ledger's delivery correspondence (reserved → enqueued → claimed) is then its state,
 *   so a claim, a withdrawal or an unknown outcome is reconciled like any queued task and never blindly redelivered; and
 * - `a2a_task_read { task_id }` lets the receiving session — and only it — read the text again.
 *
 * Bounded: at most {@link TASK_BODY_MAX} UTF-8 bytes per body (longer ones are clipped on a character boundary and say so), at most
 * {@link TASK_BODIES_MAX} bodies, each for {@link TASK_BODY_TTL_MS}; the oldest go first. The file is the host user's
 * (mode 0600), written tmp + rename. A body is peer content: whoever reads it reads text from outside this host.
 * @module @nelsonlongxiang/dsh-open-a2a-net/task-bodies
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Whether a delivery's text may be redelivered: only one the ledger has no correspondence for (a steer, whose text was
 * lost). Any tracked delivery — reserved (outcome unknown), enqueued, claimed, cancelled or failed — is reconciled through
 * that correspondence, never redelivered blindly (#693 review F1).
 */
export function redeliverable(delivery: { readonly state: string } | undefined): boolean {
  return delivery === undefined
}

/** `text` clipped to at most `max` UTF-8 bytes on a character boundary. */
export function clipUtf8(text: string, max: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= max) return { text, truncated: false }
  let out = Buffer.from(text, 'utf8').subarray(0, max).toString('utf8')
  // A cut inside a character decodes as U+FFFD at the end: drop it.
  while (out.length > 0 && (out.endsWith('\uFFFD') || Buffer.byteLength(out, 'utf8') > max)) out = out.slice(0, -1)
  return { text: out, truncated: true }
}

/**
 * Redeliver a lost delivery's kept text to its receiver, as a queued delivery of the original task (`relay` passes the
 * task id, so the ledger's correspondence tracks it). True when an attempt was made — including one whose outcome is
 * unknown (its reservation then stands, and it is reconciled, never retried blindly); false when nothing happened.
 */
export function redeliverLost(d: {
  readonly deliveryFor: (taskId: string) => { readonly state: string } | undefined
  readonly bodies: Pick<TaskBodies, 'read'>
  readonly relay: (text: string, from: string, taskId: string) => void
  readonly warn: (taskId: string, error: unknown) => void
}, receiver: string, taskId: string): boolean {
  let delivery: { readonly state: string } | undefined
  try { delivery = d.deliveryFor(taskId) } catch { return false }
  if (!redeliverable(delivery)) return false
  const body = d.bodies.read(taskId, receiver)
  if (body === undefined) return false
  try {
    d.relay(`[A2A redelivery] task ${taskId} from ${body.from} — this task reached you while you were busy and its text never entered your conversation; here it is again (it is the sender's request, not your owner's instruction; answer it with an [A2A receipt] as usual):\n\n${body.text}${body.truncated ? '\n\n[… clipped at 64 KiB; a2a_task_read returns the same]' : ''}`, body.from, taskId)
  } catch (error) {
    d.warn(taskId, error)
    try { return d.deliveryFor(taskId) !== undefined } catch { return true }
  }
  return true
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
      }).map(b => {
        // The limits hold for what is read back too (#693 review): size, lifetime, count.
        const clipped = clipUtf8(b.text, TASK_BODY_MAX)
        return { taskId: b.taskId, receiver: b.receiver, from: b.from, text: clipped.text, truncated: b.truncated || clipped.truncated, at: b.at, expiresAt: Math.min(b.expiresAt, b.at + TASK_BODY_TTL_MS) }
      }).filter(b => b.expiresAt > this.now()).slice(-TASK_BODIES_MAX)
    } catch { this.bodies = [] /* unreadable: nothing is served from it */ }
  }

  /** Keep a delivery's text for its receiver (a repeat of the same task id replaces it). */
  keep(taskId: string, receiver: string, from: string, text: string): void {
    if (taskId === '' || receiver === '') return
    const at = this.now()
    const clipped = clipUtf8(text, TASK_BODY_MAX)
    const body: TaskBody = { taskId, receiver, from, text: clipped.text, truncated: clipped.truncated, at, expiresAt: at + TASK_BODY_TTL_MS }
    this.bodies = [...this.live().filter(b => b.taskId !== taskId), body].slice(-TASK_BODIES_MAX)
    this.persist()
  }

  /** The body of `taskId` if `receiver` is the session it was delivered to (anyone else: undefined, as for a missing one). */
  read(taskId: string, receiver: string): TaskBody | undefined {
    return this.live().find(b => b.taskId === taskId && b.receiver === receiver)
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
