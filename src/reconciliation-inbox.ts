/** A single host-owned reconciliation slot per live session. Never a task delivery or receipt. */
import { createHash } from 'node:crypto'
import { MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TaskRecord } from './task-ledger.ts'
import { FollowupAcceptanceUnknown, hostEventCount, hostInserted } from './followup-admission.ts'

export interface ReconciliationScope {
  kind: 'reminder' | 'notice'
  taskIds: readonly string[]
  /** Derived from the persisted reminder reservations, not wall-clock randomness. */
  requestId: string
}
export const reconciliationDue = (row: TaskRecord): boolean => row.status === 'pending' && row.receiptExpected !== false && row.answeredAt === undefined && (row.direction === 'inbound' || row.peer === 'local') && !row.brief?.startsWith('[A2A receipt]')
const scopeMarker = '\n[A2A reconciliation scope] '
const taskKey = (id: string): string => createHash('sha256').update(id).digest('hex').slice(0, 32)
const textOf = (message: UserMessage): string | undefined => message.content.length === 1 && message.content[0]?.type === 'text' ? message.content[0].text : undefined
const isNotice = (text: string): boolean => text.startsWith('[A2A reconciliation reminder]') || text.startsWith('[A2A reconciliation notice]')

export class ReconciliationInbox {
  private readonly sending = new Set<string>()
  constructor(private readonly d: { sender: string; rows: () => readonly TaskRecord[]; taint: (agent: Agent) => void }) {}
  private prefix(agent: Agent): string { return 'a2a-reconciliation-' + taskKey(this.d.sender + ':' + String(agent.id)) + '-' }
  private pending(agent: Agent): readonly UserMessage[] {
    if (!agent.inbox || !Array.isArray(agent.inbox.nextTurn) || !Array.isArray(agent.inbox.nextStep)) throw Object.assign(Error('reconciliation requires a readable host inbox'), { code: 'REMINDER_INBOX_UNAVAILABLE' })
    return [...agent.inbox.nextTurn, ...agent.inbox.nextStep]
  }
  private ours(agent: Agent, message: UserMessage): boolean {
    const source = message.source
    if (source?.kind !== 'a2a-relay' || source.senderSessionId !== this.d.sender || source.taskId !== undefined) return false
    const text = textOf(message)
    return text !== undefined && isNotice(text) && (String(message.id).startsWith(this.prefix(agent)) || String(message.id).startsWith('a2a-followup-'))
  }
  /** Drop only this implementation's stale queued summaries, never legacy messages, tasks or claimed input. */
  available(agent: Agent): boolean {
    if (this.sending.has(String(agent.id))) return false
    const id = String(agent.id)
    this.sending.add(id)
    try {
      const pending = this.pending(agent)
      const live = new Set(this.d.rows().filter(reconciliationDue).map(row => taskKey(row.taskId)))
      for (const message of pending) {
        if (!this.ours(agent, message) || !String(message.id).startsWith(this.prefix(agent))) continue
        const text = textOf(message)!, at = text.lastIndexOf(scopeMarker)
        if (at < 0) continue // Unknown metadata blocks, rather than granting permission to append or erase it.
        let scope: { v?: unknown; k?: unknown; t?: unknown }
        try { scope = JSON.parse(text.slice(at + scopeMarker.length)) } catch { continue }
        if (scope?.v !== 1 || !['reminder', 'notice'].includes(String(scope.k)) || !Array.isArray(scope.t) || scope.t.length < 1 || scope.t.length > 8 || scope.t.some(key => typeof key !== 'string' || !/^[a-f0-9]{32}$/.test(key))) continue
        if (scope.t.every(key => live.has(key))) continue
        // One of the summary's debts ended or was answered: invalidate the summary, not the debt.
        if (typeof agent.inbox.remove !== 'function') throw Object.assign(Error('host inbox cannot invalidate a stale reconciliation summary'), { code: 'REMINDER_REMOVE_UNAVAILABLE' })
        agent.inbox.remove(message.id)
      }
      return !this.pending(agent).some(message => this.ours(agent, message))
    } finally { this.sending.delete(id) }
  }
  send(agent: Agent, text: string, scope: ReconciliationScope): boolean {
    if (!scope.taskIds.length || scope.taskIds.length > 8 || !scope.requestId) throw Error('invalid reconciliation scope')
    if (agent.status !== 'idle' || !isNotice(text) || !this.available(agent)) return false
    if (typeof agent.followup !== 'function') throw Error('reconciliation requires Agent.followup')
    const id = String(agent.id), taskKeys = [...new Set(scope.taskIds.map(taskKey))]
    const messageId = MessageId(this.prefix(agent) + taskKey(scope.kind + ':' + scope.requestId))
    const body = text + scopeMarker + JSON.stringify({ v: 1, k: scope.kind, t: taskKeys })
    if (Buffer.byteLength(body) > 4096) throw Error('reconciliation summary exceeds its byte cap')
    const message: UserMessage = { id: messageId, role: 'user', content: [{ type: 'text', text: body }], source: { kind: 'a2a-relay', form: 'relay', senderSessionId: this.d.sender } }
    const session = agent.session, floor = hostEventCount(agent)
    this.sending.add(id)
    try {
      this.d.taint(agent)
      // A taint observer may settle a task or enqueue input reentrantly. Recheck at the actual insertion boundary.
      const live = new Set(this.d.rows().filter(reconciliationDue).map(row => row.taskId))
      if (agent.session !== session || String(agent.id) !== id || agent.status !== 'idle' || scope.taskIds.some(taskId => !live.has(taskId)) || this.pending(agent).some(item => this.ours(agent, item))) return false
      try { agent.followup(message) } catch {
        // A throw after durable insertion must retain the occupied slot, including across plugin restart.
        if (agent.session === session && hostInserted(agent, id, String(messageId), floor)) return true
        throw new FollowupAcceptanceUnknown()
      }
      return true
    } finally { this.sending.delete(id) }
  }
}
