/**
 * superagent: changes to a team's rules (docs/design/superagent-router-owner-asks.md, D8–D10b).
 *
 * A session proposes the whole new text of a rule set it owns; the owner's next typed message lets it apply. This file keeps
 * the proposals, each rule set's revision and its last change. It decides nothing about who may propose: the tools do.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/rule-changes
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** A rule set: the team's rules, the dispatch rules, or one member's profile. */
export type RuleScope = 'team' | 'dispatch' | `member:${string}`
export const memberScope = (member: string): RuleScope => `member:${member}`

export interface RuleProposal {
  readonly id: string
  readonly scope: RuleScope
  readonly by: string
  readonly at: string
  readonly atMs: number
  readonly reason: string
  /** The revision this proposal was written against. */
  readonly base: number
  readonly value: unknown
}

export interface RuleChange { readonly at: string; readonly by: string; readonly reason?: string; readonly message?: string }

interface Stored {
  revisions: Record<string, number>
  pending: Record<string, RuleProposal>
  last: Record<string, RuleChange>
  /** The Trigger filed for a person's message, so one message opens one request. */
  requests: Record<string, string>
}

const REQUESTS_KEPT = 200

export class RuleChanges {
  private state: Stored

  constructor(private readonly path: string) {
    const empty: Stored = { revisions: {}, pending: {}, last: {}, requests: {} }
    try { this.state = existsSync(path) ? { ...empty, ...JSON.parse(readFileSync(path, 'utf8')) as Partial<Stored> } : empty } catch { this.state = empty }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.path) } finally { rmSync(temporary, { force: true }) }
  }

  revision(scope: RuleScope): number { return this.state.revisions[scope] ?? 0 }
  pending(scope: RuleScope): RuleProposal | undefined { return this.state.pending[scope] }

  propose(scope: RuleScope, by: string, value: unknown, reason: string, now = Date.now()): RuleProposal {
    const proposal: RuleProposal = { id: randomUUID(), scope, by, at: new Date(now).toISOString(), atMs: now, reason, base: this.revision(scope), value }
    this.state.pending[scope] = proposal
    this.save()
    return proposal
  }

  /** The rule set changed: its revision moves, and a pending proposal stays so it can say it went stale. */
  changed(scope: RuleScope, change: RuleChange): void {
    this.state.revisions[scope] = this.revision(scope) + 1
    this.state.last[scope] = change
    this.save()
  }

  /** An applied proposal is gone. */
  applied(scope: RuleScope, change: RuleChange): void {
    Reflect.deleteProperty(this.state.pending, scope)
    this.changed(scope, change)
  }

  requestOf(messageId: string): string | undefined { return this.state.requests[messageId] }
  recordRequest(messageId: string, triggerId: string): void {
    this.state.requests[messageId] = triggerId
    const keys = Object.keys(this.state.requests)
    for (const key of keys.slice(0, Math.max(0, keys.length - REQUESTS_KEPT))) Reflect.deleteProperty(this.state.requests, key)
    this.save()
  }

  /** For the team page. */
  view(): { revisions: Record<string, number>; pending: Record<string, RuleProposal>; last: Record<string, RuleChange> } {
    return { revisions: { ...this.state.revisions }, pending: { ...this.state.pending }, last: { ...this.state.last } }
  }
}
