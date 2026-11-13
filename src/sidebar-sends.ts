/**
 * Requests a person sent from a session's right-bar team tab to a team on another instance (design M9), and what came
 * back for them. The request goes out as the session, so every gate of a2a_route applies; its receipts are the
 * person's, not the session's: they settle the ledger as any receipt does and land here for the tab to show, instead
 * of entering the session as a new message that wakes its model (owner ruling 2026-11-13).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseReceipt } from './receipt.ts'

/** One step back from the team: an acknowledgement, progress, a question, or the result. */
export interface SidebarReturn {
  readonly at: string
  readonly from: string
  readonly disposition: string
  readonly outcome?: string
  readonly summary: string
  readonly question?: string
  /** False when this host's settlement judge refused the receipt (it named the task, but its sender is not on the task's chain). */
  readonly settled: boolean
}

export interface SidebarSend {
  readonly taskId: string
  readonly session: string
  /** The session's team: the address the request went out as, and so the address its receipts come back to. */
  readonly sender: string
  readonly address: string
  readonly brief: string
  readonly at: string
  readonly returns: SidebarReturn[]
  /** Set by the result receipt; until then the request is open. */
  ended?: true
}

const KEEP = 50
const KEEP_MS = 7 * 24 * 3600_000
const RETURNS = 20

/** The task a receipt id answers: its own id, or the base of a `progress-<task>-<n>` / `attention-<task>-<q>` id. */
function baseTaskIds(id: string): string[] {
  const out = [id]
  for (const prefix of ['progress-', 'attention-']) {
    if (!id.startsWith(prefix)) continue
    const rest = id.slice(prefix.length), cut = rest.lastIndexOf('-')
    if (cut > 0) out.push(rest.slice(0, cut))
  }
  return out
}

export class SidebarSends {
  private rows: SidebarSend[] = []

  constructor(private readonly file: string | undefined, private readonly now: () => number = Date.now) {
    if (file !== undefined && existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as { sends?: unknown }
        if (Array.isArray(data.sends)) this.rows = (data.sends as SidebarSend[]).filter(row => typeof row?.taskId === 'string' && typeof row.sender === 'string')
      } catch { this.rows = [] }
    }
  }

  /** Book one request that went out; the oldest and the expired fall off. */
  register(send: { taskId: string; session: string; sender: string; address: string; text: string }): void {
    if (send.taskId === '') return
    this.prune()
    this.rows = [...this.rows.filter(row => row.taskId !== send.taskId), { taskId: send.taskId, session: send.session, sender: send.sender, address: send.address, brief: send.text.slice(0, 200), at: new Date(this.now()).toISOString(), returns: [] }].slice(-KEEP)
    this.save()
  }

  /**
   * Take a receipt addressed to `team` when it answers a request sent from the tab as that team; false leaves the message
   * to its ordinary delivery. Only a receipt is taken: anything else the team sends reaches the session as before.
   */
  take(team: string, message: string, from: string, settled: boolean): boolean {
    const parsed = parseReceipt(message)
    if (parsed === null || parsed.taskId === '') return false
    const ids = baseTaskIds(parsed.taskId)
    const row = this.rows.find(entry => entry.sender === team && ids.includes(entry.taskId))
    if (row === undefined) return false
    const envelope = parsed.envelope
    const disposition = envelope?.disposition ?? 'result'
    const summary = (envelope?.progress?.summary ?? parsed.summary).trim().slice(0, 1000)
    row.returns.push({ at: new Date(this.now()).toISOString(), from: from.slice(0, 200), disposition, ...(envelope?.outcome !== undefined ? { outcome: envelope.outcome } : {}), summary, ...(envelope?.question !== undefined ? { question: envelope.question.text.slice(0, 500) } : {}), settled })
    if (row.returns.length > RETURNS) row.returns.splice(0, row.returns.length - RETURNS)
    if (disposition === 'result' && settled) row.ended = true
    this.save()
    return true
  }

  /** The tab's view: one session's requests, newest first. */
  of(session: string): readonly SidebarSend[] {
    return this.rows.filter(row => row.session === session).slice().reverse()
  }

  private prune(): void {
    const floor = this.now() - KEEP_MS
    this.rows = this.rows.filter(row => Date.parse(row.at) >= floor)
  }

  private save(): void {
    if (this.file === undefined) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify({ sends: this.rows }), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch { /* a lost write costs the tab its history, never a delivery */ }
  }
}
