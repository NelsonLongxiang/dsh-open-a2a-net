/**
 * superagent, asking for review (docs/design/superagent-pr-follow.md, D5–D7).
 *
 * With a reviewer set, each pull request a ticket opened gets one review request at its head; a new head asks again. The
 * reviewer's formal receipt is the verdict, advice to the person who merges: it reaches the ticket as a note and the team
 * page. Nothing here merges. The request names only the repository's pull request and its commit, never ticket content.
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
  verdict?: { readonly pass: boolean; readonly text: string; readonly at: string }
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

  constructor(private readonly d: ReviewRequestsDeps) {
    let stored: Record<string, ReviewRecord> = {}
    try { if (existsSync(d.path)) stored = JSON.parse(readFileSync(d.path, 'utf8')) as Record<string, ReviewRecord> } catch { /* start empty */ }
    this.records = stored
  }

  private save(): void {
    mkdirSync(dirname(this.d.path), { recursive: true })
    const temporary = `${this.d.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.records), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.d.path) } finally { rmSync(temporary, { force: true }) }
  }

  list(): readonly ReviewRecord[] { return Object.values(this.records) }

  /** An open pull request was read at `head`. A failure of the ask throws, and the next read tries again. */
  async opened(thread: string, head: string, url: string, ticketId: string): Promise<void> {
    const reviewer = this.d.reviewer()
    if (reviewer === undefined || this.asking.has(thread) || this.records[thread]?.head === head) return
    this.asking.add(thread)
    try {
      const task = await this.d.ask(reviewer, `[评审请求] ${url} @ ${head}。请在这个提交上评审，结论用回执给出：PASS 或 FAIL，并写上提交号。`)
      if (task === undefined) { this.d.logger.warn('superagent: the reviewer %s is not linked; no review request was sent', reviewer); return }
      this.records[thread] = { thread, ticketId, head, task, reviewer, at: new Date().toISOString() }
      this.save()
    } finally { this.asking.delete(thread) }
  }

  /** A mailbox row: the reviewer's receipt on the task of a request that is still the latest is its verdict. */
  received(trigger: Trigger): void {
    const receiptFor = trigger.meta.receiptFor
    if (typeof receiptFor !== 'string') return
    const record = Object.values(this.records).find(r => r.task === receiptFor && r.verdict === undefined)
    if (record === undefined || trigger.actor.id !== record.reviewer) return
    if (typeof trigger.meta.proof !== 'string' || !TRUSTED_PROOFS.has(trigger.meta.proof)) return
    const short = record.head.slice(0, 7)
    // The verdict must name the commit it was given on: a bare PASS could be about anything.
    const pass = /\bPASS\b/.test(trigger.text) && trigger.text.includes(short)
    record.verdict = { pass, text: clip(trigger.text, 500), at: trigger.at }
    this.save()
    this.d.note(record.ticketId, `评审结论（${short}）：${pass ? 'PASS' : '未通过'}。${clip(trigger.text, 500)}（仅供合并人参考，成员和宿主都不合并。）`)
  }
}
