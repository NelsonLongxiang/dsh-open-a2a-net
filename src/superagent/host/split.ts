/**
 * docs/design/superagent-split.md: which tickets are split parents, their children, and the parents being split right now
 * (by the request they come from, before the engine names the ticket). Persisted beside the executor's state.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export interface SplitRecord { readonly children: readonly string[]; readonly asked: string; readonly at: string; failed?: true }

export class SplitBook {
  private parents: Record<string, SplitRecord>
  private childOf = new Map<string, string>()
  /** Requests being split right now: their ticket must not launch on a member. */
  private readonly splitting = new Set<string>()

  constructor(private readonly path: string) {
    this.parents = {}
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as { parents?: Record<string, SplitRecord> }
        this.parents = raw.parents ?? {}
      }
    } catch { this.parents = {} }
    this.index()
  }

  private index(): void {
    this.childOf = new Map()
    for (const [parent, record] of Object.entries(this.parents)) for (const child of record.children) this.childOf.set(child, parent)
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify({ parents: this.parents }), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.path) } finally { rmSync(temporary, { force: true }) }
  }

  beginFor(triggerId: string): void { this.splitting.add(triggerId) }
  endFor(triggerId: string): void { this.splitting.delete(triggerId) }
  isSplitting(triggerId: string): boolean { return this.splitting.has(triggerId) }

  record(parent: string, children: readonly string[], asked: string, at: string): void {
    this.parents[parent] = { children: [...children], asked, at }
    this.index()
    this.save()
  }
  markFailed(parent: string): void {
    const record = this.parents[parent]
    if (record === undefined || record.failed) return
    this.parents[parent] = { ...record, failed: true }
    this.save()
  }

  isParent(ticketId: string): boolean { return this.parents[ticketId] !== undefined }
  parentOf(ticketId: string): string | undefined { return this.childOf.get(ticketId) }
  children(parent: string): readonly string[] { return this.parents[parent]?.children ?? [] }
  failed(parent: string): boolean { return this.parents[parent]?.failed === true }
  parentIds(): string[] { return Object.keys(this.parents) }
}
