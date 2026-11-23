/**
 * superagent, asking for review (docs/design/superagent-pr-follow.md, D5–D7).
 *
 * With a reviewer set, each pull request a ticket opened gets one review request at its head; a new head asks again. The
 * reviewer's formal receipt is the verdict, advice to the person who merges: it reaches the ticket as a note and the team
 * page. Nothing here merges. The request names only the repository's pull request and its commit, never ticket content.
 *
 * #874: a verdict is checked only from one structured line in the receipt text, `verdict: PASS|FAIL head: <full commit>`,
 * whose commit must be the requested head in full; the receipt's request binding (receiptFor) ties it to the ticket. Any
 * other form is kept as a reference note, never a pass. A request is recorded before it is sent, so a restart between the
 * send and its record finds it and marks it unknown instead of asking again.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/review-requests
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { TRUSTED_PROOFS } from '../a2a-watch.ts'
import type { Trigger } from '../upstream/dsh-superagent/src/core/index.ts'

export interface ReviewRecord {
  readonly thread: string
  readonly ticketId: string
  readonly head: string
  readonly task: string
  readonly reviewer: string
  readonly at: string
  /** `asking`: recorded before the send, the outcome not yet known; `unknown`: found still asking after a restart. */
  state?: 'asking' | 'unknown'
  verdict?: ReviewVerdict
}

/**
 * `verified`: one structured line names the requested head in full; `pass` is its PASS. `reference`: no structured line,
 * the text is kept as a reference only. `unverified`: structured lines that disagree, or a commit other than the full head.
 * Only a verified PASS has `pass: true`.
 */
export interface ReviewVerdict {
  readonly pass: boolean
  readonly checked: 'verified' | 'reference' | 'unverified'
  readonly reason?: string
  readonly text: string
  readonly at: string
}

/** The structured verdict line, one per receipt: `verdict: PASS head: <full commit>` (backticks around it are allowed). */
const VERDICT_LINE = /^[ \t>*_`-]*verdict:[ \t]*(PASS|FAIL)[ \t]+head:[ \t]*([0-9a-f]{7,64})[ \t`*_]*$/gimu

/** Read a receipt's verdict about `head`. Exported for tests. */
export function readVerdict(text: string, head: string): { readonly pass: boolean; readonly checked: ReviewVerdict['checked']; readonly reason?: string } {
  const lines = [...text.matchAll(VERDICT_LINE)].map(m => ({ verdict: m[1]!.toUpperCase(), head: m[2]!.toLowerCase() }))
  if (lines.length === 0) return { pass: false, checked: 'reference', reason: '没有结构化结论行（verdict: PASS|FAIL head: <完整提交>）' }
  const first = lines[0]!
  if (lines.some(line => line.verdict !== first.verdict || line.head !== first.head)) return { pass: false, checked: 'unverified', reason: '结构化结论行互相矛盾' }
  if (first.head !== head.toLowerCase()) return { pass: false, checked: 'unverified', reason: `结论行的提交 ${first.head} 不是请求的完整提交` }
  return { pass: first.verdict === 'PASS', checked: 'verified' }
}

export interface ReviewRequestsDeps {
  readonly path: string
  readonly reviewer: () => string | undefined
  readonly ask: (address: string, text: string) => Promise<string | undefined>
  readonly note: (ticketId: string, text: string) => void
  readonly logger: { warn(format: string, ...args: unknown[]): void }
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max)}…`)

export class ReviewRequests {
  /** The latest request per pull request: a new head replaces it, so a late verdict on the old head matches nothing. */
  private records: Record<string, ReviewRecord>
  private readonly asking = new Set<string>()
  /** Notes found at start, given on the first call after it: the host builds this before the engine that takes notes. */
  private startNotes: Array<[string, string]> = []

  constructor(private readonly d: ReviewRequestsDeps) {
    let stored: Record<string, ReviewRecord> = {}
    try { if (existsSync(d.path)) stored = JSON.parse(readFileSync(d.path, 'utf8')) as Record<string, ReviewRecord> } catch { /* start empty */ }
    this.records = stored
    // Still asking at start: the process stopped between the send and its record. Whether it went out is unknown; asking
    // again could ask twice, so it is marked and the ticket told once. A new head asks again as usual.
    const unknown = Object.values(stored).filter(r => r.state === 'asking')
    for (const r of unknown) r.state = 'unknown'
    if (unknown.length > 0) {
      this.save()
      for (const r of unknown) this.startNotes.push([r.ticketId, `评审请求是否已发给 ${r.reviewer} 未知（发送途中重启，提交 ${r.head.slice(0, 7)}）：不自动重发，以免重复派单。请核对评审人一侧，或推新提交重新请求。`])
    }
  }

  private save(): void {
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.records), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  list(): readonly ReviewRecord[] { return Object.values(this.records) }

  private flushStartNotes(): void {
    const notes = this.startNotes
    this.startNotes = []
    for (const [ticketId, text] of notes) this.d.note(ticketId, text)
  }

  /** An open pull request was read at `head`. A failure of the ask throws, and the next read tries again. */
  async opened(thread: string, head: string, url: string, ticketId: string): Promise<void> {
    this.flushStartNotes()
    const reviewer = this.d.reviewer()
    if (reviewer === undefined || this.asking.has(thread) || this.records[thread]?.head === head) return
    this.asking.add(thread)
    const before = this.records[thread]
    const restore = (): void => { if (before === undefined) delete this.records[thread]; else this.records[thread] = before; this.save() }
    try {
      // Recorded before the send: a restart before the task id is kept finds it (see the constructor).
      this.records[thread] = { thread, ticketId, head, task: '', reviewer, at: new Date().toISOString(), state: 'asking' }
      this.save()
      let task: string | undefined
      // A thrown send is tried again on a later read, as before: the record goes back to what it was.
      try { task = await this.d.ask(reviewer, `[评审请求] ${url} @ ${head}。请在这个提交上评审，结论用回执给出：PASS 或 FAIL，并写上提交号。`) } catch (error) { restore(); throw error }
      if (task === undefined) { restore(); this.d.logger.warn('superagent: the reviewer %s is not linked; no review request was sent', reviewer); return }
      this.records[thread] = { thread, ticketId, head, task, reviewer, at: this.records[thread]!.at }
      this.save()
    } finally { this.asking.delete(thread) }
  }

  /** A mailbox row: the reviewer's receipt on the task of a request that is still the latest is its verdict. */
  received(trigger: Trigger): void {
    this.flushStartNotes()
    const receiptFor = trigger.meta.receiptFor
    if (typeof receiptFor !== 'string') return
    const record = Object.values(this.records).find(r => r.task !== '' && r.task === receiptFor && r.verdict === undefined)
    if (record === undefined || trigger.actor.id !== record.reviewer) return
    if (typeof trigger.meta.proof !== 'string' || !TRUSTED_PROOFS.has(trigger.meta.proof)) return
    const short = record.head.slice(0, 7)
    // The verdict must name the commit it was given on, in full, in its structured line; free text is a reference only.
    const read = readVerdict(trigger.text, record.head)
    record.verdict = { pass: read.pass, checked: read.checked, ...(read.reason !== undefined ? { reason: read.reason } : {}), text: clip(trigger.text, 500), at: trigger.at }
    this.save()
    const label = read.checked === 'verified' ? `已核对完整提交 ${record.head}` : `参考，未核验：${read.reason ?? ''}`
    this.d.note(record.ticketId, `评审结论（${short}，${label}）：${read.checked === 'verified' ? (read.pass ? 'PASS' : '未通过') : '不计为通过'}。${clip(trigger.text, 500)}（仅供合并人参考，成员和宿主都不合并。）`)
  }
}
