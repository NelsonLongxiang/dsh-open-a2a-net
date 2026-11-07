/**
 * superagent design v4, PR-B: durable Repositories for the vendored engine.
 *
 * The engine's Repositories port, with the semantics of upstream's MemoryRepositories (cloned rows, snapshot rollback,
 * tickets newest first) and one JSON document on disk, written atomically after every outermost unit of work. The
 * Outbox's queued messages live in the same document, so a decision and the reply it queued commit together.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/store
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { latestAssignment, type Decision, type OutboundMessage, type ReplyStatus, type Repositories, type Thread, type Ticket, type Trigger, type TriggerDisposition } from '../upstream/dsh-superagent/src/core/index.ts'

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value))

/** One queued Channel message and what became of it. */
export interface StoredMessage { readonly message: OutboundMessage; status: ReplyStatus; readonly queuedAt: string; sentAt?: string; droppedAt?: string; reason?: string }

/** The on-disk document. Arrays keep insertion order (tickets are listed newest first by reversing it). */
interface Snapshot {
  readonly v: 1
  readonly triggers: Trigger[]
  readonly dispositions: [string, TriggerDisposition][]
  readonly threads: Thread[]
  readonly tickets: Ticket[]
  readonly decisions: Decision[]
  readonly outbox: StoredMessage[]
}

export class JsonRepositories implements Repositories {
  private triggerRows = new Map<string, Trigger>()
  private dispositionRows = new Map<string, TriggerDisposition>()
  private threadRows = new Map<string, Thread>()
  private ticketRows = new Map<string, Ticket>()
  private decisionRows = new Map<string, Decision>()
  private outboxRows = new Map<string, StoredMessage>()
  private depth = 0
  /** Why the file could not be loaded; the store then refuses every write rather than overwrite what it could not read. */
  readonly loadError: string | undefined

  /** @param path - the JSON document; '' keeps the store in memory (tests). */
  constructor(private readonly path: string) {
    this.loadError = this.load()
  }

  private maps(): Map<string, unknown>[] {
    return [this.triggerRows, this.dispositionRows, this.threadRows, this.ticketRows, this.decisionRows, this.outboxRows]
  }

  private load(): string | undefined {
    if (this.path === '' || !existsSync(this.path)) return undefined
    try {
      const doc = JSON.parse(readFileSync(this.path, 'utf8')) as Snapshot
      if (doc?.v !== 1 || !Array.isArray(doc.triggers) || !Array.isArray(doc.dispositions) || !Array.isArray(doc.threads)
        || !Array.isArray(doc.tickets) || !Array.isArray(doc.decisions) || !Array.isArray(doc.outbox)) throw Error('not a v1 superagent store')
      for (const row of doc.triggers) this.triggerRows.set(row.id, row)
      for (const [id, row] of doc.dispositions) this.dispositionRows.set(id, row)
      for (const row of doc.threads) this.threadRows.set(row.key, row)
      for (const row of doc.tickets) this.ticketRows.set(row.id, row)
      for (const row of doc.decisions) this.decisionRows.set(row.id, row)
      for (const row of doc.outbox) this.outboxRows.set(row.message.id, row)
      return undefined
    } catch (error) {
      for (const map of this.maps()) map.clear()
      return `superagent store unreadable (${String(error)}); refusing writes until it is repaired`
    }
  }

  private persist(): void {
    if (this.path === '') return
    const doc: Snapshot = {
      v: 1,
      triggers: [...this.triggerRows.values()],
      dispositions: [...this.dispositionRows.entries()],
      threads: [...this.threadRows.values()],
      tickets: [...this.ticketRows.values()],
      decisions: [...this.decisionRows.values()],
      outbox: [...this.outboxRows.values()],
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp-${randomUUID()}`
    try {
      writeFileSync(temporary, JSON.stringify(doc), { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.path)
    } finally { rmSync(temporary, { force: true }) }
  }

  /** A unit of work: rolled back in memory when it throws, written to disk once the outermost one succeeds. */
  atomic<T>(work: () => T): T {
    if (this.loadError !== undefined) throw Error(this.loadError)
    const snapshot = this.maps().map(map => new Map(map))
    this.depth++
    try {
      const out = work()
      if (this.depth === 1) this.persist()
      return out
    } catch (error) {
      this.maps().forEach((map, index) => { map.clear(); for (const [id, value] of snapshot[index]!) map.set(id, value) })
      throw error
    } finally { this.depth-- }
  }

  readonly triggers = {
    get: (id: string): Trigger | undefined => clone(this.triggerRows.get(id)),
    save: (trigger: Trigger): void => { this.triggerRows.set(trigger.id, clone(trigger)) },
    disposition: (id: string): TriggerDisposition | undefined => clone(this.dispositionRows.get(id)),
    saveDisposition: (id: string, value: TriggerDisposition): void => { this.dispositionRows.set(id, clone(value)) },
  }
  readonly threads = {
    get: (key: string): Thread | undefined => clone(this.threadRows.get(key)),
    save: (thread: Thread): void => { this.threadRows.set(thread.key, clone(thread)) },
    list: (): Thread[] => [...this.threadRows.values()].map(clone),
    active: (): Thread[] => this.threads.list().filter(thread => thread.pending.length > 0 || thread.evaluating !== undefined),
  }
  readonly tickets = {
    get: (id: string): Ticket | undefined => clone(this.ticketRows.get(id)),
    save: (ticket: Ticket): void => { this.ticketRows.set(ticket.id, clone(ticket)) },
    /** Newest first, as upstream's stores order them. */
    list: (): Ticket[] => [...this.ticketRows.values()].reverse().map(clone),
    open: (): Ticket[] => this.tickets.list().filter(ticket => !ticket.ended),
    active: (): Ticket[] => this.tickets.list().filter(ticket => ticket.undelivered.length > 0 || ['pending', 'running'].includes(latestAssignment(ticket)?.state ?? '')),
  }
  readonly decisions = {
    get: (id: string): Decision | undefined => clone(this.decisionRows.get(id)),
    save: (decision: Decision): void => { this.decisionRows.set(decision.id, clone(decision)) },
    byThread: (key: string): Decision[] => [...this.decisionRows.values()].filter(decision => decision.threadKey === key).map(clone),
    list: (): Decision[] => [...this.decisionRows.values()].map(clone),
  }
  /** The Outbox's rows (not part of the engine's Repositories port). */
  readonly messages = {
    get: (id: string): StoredMessage | undefined => clone(this.outboxRows.get(id)),
    save: (row: StoredMessage): void => { this.outboxRows.set(row.message.id, clone(row)) },
    list: (): StoredMessage[] => [...this.outboxRows.values()].map(clone),
  }
}
