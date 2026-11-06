/**
 * Persisted async-task ledger (`<dsh-home>/a2a/tasks.json`). The receipt
 * contract makes the target answer a fire-and-forget route with a message
 * starting `[A2A receipt] task <task_id> <outcome summary>`, but the caller
 * had no book to reconcile against — pending tasks were unqueryable and a
 * restart forgot them all. The ledger keeps one record per routed task that
 * is still owed a reply, correlates the receipt by its task id, and persists
 * so a node restart does not orphan the reconciliation.
 *
 * Three-tier book (v0.5.29): the owed book holds only unsettled rows —
 * `pending`, or `dead` once a row sits past {@link TASK_STALE_TTL_MS} (swept
 * lazily on every entry point, never timer-driven — this host restarts too
 * often for in-memory timers). Dead rows exit the owed view and disarm the
 * async nudge via {@link TaskLedger.isPending}, yet still settle on a late
 * receipt. Every settled row leaves the owed book for the bounded archive,
 * so resolution history stops being silently evicted by the {@link TASK_CAP}
 * slice (the evidence-loss defect behind the "the ledger keeps growing"
 * illusion: settlements vanished while debts piled up).
 * @module @nelsonlongxiang/dsh-open-a2a-net/task-ledger
 */

import type { TaskAuthorization, SettlementReason } from './task-auth.ts'
import { existsSync, readFileSync } from 'node:fs'
import { writeTaskLedger } from './task-ledger-persistence.ts'
import { safeObservationCode } from './nudge-observability.ts'
import { parseTaskDelivery, TASK_DELIVERY_CAP, TASK_DELIVERY_RETENTION_MS, type TaskDelivery } from './task-delivery.ts'
import { parseReminder, REMINDER_LONG_MS, type ReminderState } from './reconciliation-state.ts'
import { parseReceipt, RECEIPT_DISPOSITIONS, RECEIPT_OUTCOMES, type ReceiptDisposition, type ReceiptOutcomeV2 } from './receipt.ts'
import { classifyConservationBlock, ConservationCounters, type ConservationVerdict } from './ledger-conservation.ts'
import { CALLER_ENDED_PREFIX, TASK_CAP, ARCHIVE_CAP, SUMMARY_CAP, TASK_STALE_TTL_MS, ARCHIVE_ENDS, ECHO_SUMMARY, ROUTING_FACT_CAP, SETTLEMENT_ID_CAP, SETTLEMENT_REFUSAL_CAP, withSender, withAuth, routingOf, birthFacts, withRouting, withSettledBy, parseRefusal, archivedEndedBy, WITHDRAWAL_RESULTS, isWithdrawalResult } from './task-ledger-rows.ts'
import type { TaskRecord, ArchivedRecord, Sender, OutboundBirth, TaskLedgerOptions, ReceiptResolvedInfo, TaskLedgerSnapshot, SettlementRefusalRecord, SettlementJudge, AbandonResult, CancelledResult, ArchiveEnd } from './task-ledger-rows.ts'
export * from './task-ledger-rows.ts'


/**
 * Bounded outbound-task ledger with whole-file persistence. Pure of any
 * routing knowledge: callers {@link track} a task when a route leaves it
 * owed a receipt and feed every inbound/relayed message through
 * {@link resolveFromMessage} for correlation.
 */
export class TaskLedger {
  /** Owed-book rows, most recently tracked first; settled rows leave here. */
  private tasks: TaskRecord[] = []
  /** Settled rows, most recently resolved first; bounded by the archive cap. */
  private archived: ArchivedRecord[] = []
  /** #114 S4: refused / would-be-refused settlements, newest first. */
  private refusals: SettlementRefusalRecord[] = []
  /** #114 S4: every refusal ever noted (monotonic; survives the ring's bound). */
  private refusalsTotal = 0
  /** gh#154: lifetime conservation counters (persisted; never reset by cap trims or restarts) and the durable damage marker — the machinery lives in src/ledger-conservation.ts (R-mod); the ledger's seams delegate. */
  private readonly counters = new ConservationCounters()
  private readonly staleTtlMs: number
  private readonly archiveCap: number
  /** Injectable clock (option `now`). */
  private readonly now: () => number
  private readonly warn: (message: string) => void
  /** Last successful commit, for rollback when a mutation cannot persist. */
  private committed = ''
  private deliveries: TaskDelivery[] = []
  private deliveryRestoreError = false
  markConsumed(taskId:string, consumed:boolean): void {
    const row=this.tasks.find(r=>r.taskId===taskId);if(!row||row.consumed===true||row.consumed===consumed)return
    row.consumed=consumed;this.persist()
  }
  deliveryFor(taskId: string): TaskDelivery | undefined {
    if(this.deliveryRestoreError)throw Error('task delivery correspondence is corrupt; automatic re-delivery refused')
    const row=this.deliveries.find(r=>r.taskId===taskId);return row?{...row}:undefined
  }
  deliveryByMessage(sessionId:string,messageId:string): TaskDelivery | undefined {
    if(this.deliveryRestoreError)throw Error('task delivery correspondence is corrupt')
    const row=this.deliveries.find(r=>r.sessionId===sessionId&&r.messageId===messageId);return row?{...row}:undefined
  }
  reserveDelivery(record: TaskDelivery): TaskDelivery {
    const parsed=parseTaskDelivery(record);if(!parsed)throw Error('invalid task delivery correspondence')
    const old=this.deliveryFor(record.taskId)
    if(old) {
      if(old.sessionId!==record.sessionId||old.fingerprint!==record.fingerprint)throw Error('task delivery identity conflict')
      return old
    }
    this.deliveries=this.deliveries.filter(row=>this.tasks.some(t=>t.taskId===row.taskId)||this.now()-row.createdAt<=TASK_DELIVERY_RETENTION_MS)
    if(this.deliveries.length>=TASK_DELIVERY_CAP)throw Error('task delivery correspondence capacity reached; refusing untracked delivery')
    this.deliveries.push(parsed);this.persist();return {...parsed}
  }
  updateDelivery(taskId:string, state:TaskDelivery['state']): void {
    const row=this.deliveries.find(r=>r.taskId===taskId);if(!row)throw Error('unknown task delivery correspondence')
    row.state=state
    if(state==='claimed'){const task=this.tasks.find(r=>r.taskId===taskId);if(task)task.consumed=true}
    this.persist()
  }
  private reminderRecoveryPending = false
  private reminders: Record<string, ReminderState> = Object.create(null)
  private reminderSessions: Record<string, number> = Object.create(null)
  reminderSessionAt(id: string): number | undefined { return Object.hasOwn(this.reminderSessions,id) ? this.reminderSessions[id] : undefined }
  reminderState(taskId: string): ReminderState | undefined { const r=Object.hasOwn(this.reminders,taskId) ? this.reminders[taskId] : undefined; return r ? {...r} : undefined }
  /** Atomic observation update; no task status, answer, or conservation mutation. */
  saveReminders(updates: readonly {taskId:string; state:ReminderState|undefined}[], session?: {id:string; at:number|undefined}): void {
    // Validate all input before touching either observation table.
    if(session&&(session.id.length<1||session.id.length>256||(session.at!==undefined&&(!Number.isSafeInteger(session.at)||session.at<0))))throw Error('invalid reminder session throttle')
    for(const update of updates)if(update.state&&!parseReminder(update.state))throw Error('invalid reminder state')
    this.reminders=Object.assign(Object.create(null),Object.fromEntries(Object.entries(this.reminders).filter(([id])=>this.tasks.some(row=>row.taskId===id&&row.status==='pending'))))
    if(session) {
      if(session.at===undefined)delete this.reminderSessions[session.id]
      else if(session.id.length<=256&&Number.isSafeInteger(session.at)&&session.at>=0)this.reminderSessions[session.id]=session.at
      else throw Error('invalid reminder session throttle')
      this.reminderSessions=Object.fromEntries(Object.entries(this.reminderSessions).sort((a,b)=>b[1]-a[1]).slice(0,TASK_CAP))
    }
    for(const update of updates) {
      const row=this.tasks.find(r=>r.taskId===update.taskId&&r.status==='pending')
      if(!row)continue
      if(update.state) { const parsed=parseReminder(update.state); if(!parsed)throw Error('invalid reminder state'); this.reminders[update.taskId]=parsed }
      else delete this.reminders[update.taskId]
    }
    this.persist()
  }
  private admittedFailure: {at:number;code:string}|undefined
  private admittedFailures=0
  noteAdmittedBookkeepingFailure(error:unknown):void {this.admittedFailures++;this.admittedFailure={at:this.now(),code:safeObservationCode(error,'LEDGER_WRITE_FAILED')}}
  orphanDelivery(taskId:string):boolean {
    const row=this.deliveryFor(taskId)
    return row?.taskExpected===true&&(row.state==='enqueued'||row.state==='claimed')&&!this.tasks.some(r=>r.taskId===taskId)&&!this.archived.some(r=>r.taskId===taskId)
  }
  deliveryBookkeepingState():{orphaned:number;failures:number;lastError?:{at:number;code:string}} {
    return {orphaned:this.deliveries.filter(r=>r.taskExpected===true&&(r.state==='enqueued'||r.state==='claimed')&&!this.tasks.some(t=>t.taskId===r.taskId)&&!this.archived.some(t=>t.taskId===r.taskId)).length,failures:this.admittedFailures,...(this.admittedFailure?{lastError:{...this.admittedFailure}}:{})}
  }
  private writeFailure: { at: number; code: string } | undefined
  /** Diagnostic-only; never implies that a failed mutation committed. No paths or payloads exposed. */
  persistenceState(): { ok: boolean; lastError?: { at: number; code: string } } {
    return this.writeFailure ? { ok: false, lastError: { ...this.writeFailure } } : { ok: true }
  }

  /**
   * @param path - persistence file (`<dsh-home>/a2a/tasks.json`); empty = no persistence.
   * @param options - TTL/capacity overrides; defaults come from the exported constants.
   */
  constructor(private readonly path: string, options?: TaskLedgerOptions) {
    this.staleTtlMs = options?.staleTtlMs ?? TASK_STALE_TTL_MS
    this.archiveCap = options?.archiveCap ?? ARCHIVE_CAP
    this.now = options?.now ?? (() => Date.now())
    this.warn = options?.warn ?? console.warn
    this.restore()
    this.committed = JSON.stringify(this.snapshot())
    if(this.reminderRecoveryPending) {
      // Save the recovery deadline once: repeated restarts must not postpone it forever.
      try { this.persist() } catch { /* diagnostics/last committed debt survive; no send on failure */ }
    }
  }

  /**
   * Every unsettled task (pending + dead-lettered), most recently tracked first.
   * Sweeping runs first, so an overdue pending row reports as dead here.
   * @returns the owed-book records.
   */
  list(): readonly TaskRecord[] {
    try { this.sweep(this.now()) } catch {
      // sweep already restored the last commit and recorded the write error. Read faces stay available.
    }
    return [...this.tasks]
  }

  /** #275: old forwarded canvas debts cannot be safely upgraded by inventing receiver authority. */
  settlementEnforceBlockers(): string[] {
    return this.list().filter(row => row.direction === 'outbound' && row.forwarded === true && row.receiptExpected !== false && row.team.includes('/canvas/') && (row.deliveredTo === row.team || (row.deliveredTo === undefined && (row.receiverMembers === undefined || row.receiverMembers.length === 0)))).map(row => row.taskId)
  }

  /**
   * The settled archive, most recently resolved first. Rows land here the
   * moment their receipt correlates and stay until the archive cap evicts
   * the oldest — receipts keep correlating against them, so a repeat or a
   * delayed duplicate refreshes instead of resolving nothing.
   * @returns the archived records.
   */

  archive(): readonly ArchivedRecord[] {
    return [...this.archived]
  }

  /**
   * Remember one outbound task owed a receipt, most-recent first, bounded by
   * {@link TASK_CAP} over the owed book only (settled rows live in the
   * archive, never silently evicted). A task id is caller-born and
   * single-use: a known id in either tier keeps its first record verbatim.
   * @param taskId - the correlation key the receipt echoes.
   * @param team - the team the route addressed.
   * @param peer - the candidate that accepted the delivery ('local' or URL).
   * @param contextId - the delivery's conversation id, kept for follow-up routes (empty omits it).
   */
  /**
   * Fix ② (ghost-debt stop): register one delivered async dispatch whose
   * callback address could not be resolved — the row stays VISIBLE (the
   * ledger is honest) but carries receiptExpected:false, so neither the
   * owed book nor the settleable bucket ever counts it. Reconciliation is
   * via context_id follow-ups (the dispatch reply already says so).
   * Idempotent by task id like {@link track}.
   */
  trackReceiptless(taskId: string, team: string, peer: string, contextId?: string, brief?: string, sender?: Sender, birth?: OutboundBirth): void {
    if (taskId === '') return
    this.sweep(this.now())
    if (this.tasks.some(entry => entry.taskId === taskId)) return
    if (this.archived.some(entry => entry.taskId === taskId)) return
    this.counters.trackedTotal += 1
    this.tasks = [{
      taskId,
      team,
      peer,
      startedAt: this.now(),
      direction: 'outbound' as const,
      receiptExpected: false,
      ...(contextId !== undefined && contextId !== '' ? { contextId } : {}),
      ...(brief !== undefined && brief !== '' ? { brief } : {}),
      ...(sender !== undefined ? { sender } : {}),
      ...birthFacts(peer, birth, team, sender, this.now(), this.warn),
      status: 'pending' as const,
    }, ...this.tasks]
    this.trimOwed()
    this.persist()
  }

  track(taskId: string, team: string, peer: string, contextId?: string, brief?: string, sender?: Sender, birth?: OutboundBirth): void {
    if (taskId === '') return
    this.sweep(this.now())
    if (this.tasks.some(entry => entry.taskId === taskId)) return
    if (this.archived.some(entry => entry.taskId === taskId)) return
    this.counters.trackedTotal += 1
    this.tasks = [{
      taskId,
      team,
      peer,
      startedAt: this.now(),
      direction: 'outbound' as const,
      ...(contextId !== undefined && contextId !== '' ? { contextId } : {}),
      ...(brief !== undefined && brief !== '' ? { brief } : {}),
      ...(sender !== undefined ? { sender } : {}),
      ...birthFacts(peer, birth, team, sender, this.now(), this.warn),
      status: 'pending' as const,
    }, ...this.tasks]
    this.trimOwed()
    this.persist()
  }

  /**
   * F2' (receipt-settlement): remember one INBOUND delivery owed a receipt —
   * this node is the settlement debtor here: the caller waits for a receipt
   * only this target can produce. Before this row type existed, inbound
   * deliveries were born ledger-less, so the async nudge's isPending gate
   * no-op'd for exactly the deliveries that stall (08-30 evidence: zero
   * ledger records for latched activations). Idempotent by task id like
   * {@link track}.
   * @param taskId - the correlation key the caller's task was born with.
   * @param team - the team the delivery addressed (this node's).
   * @param from - the caller's receipt target (label or callback address).
   * @param contextId - the delivery's conversation id, kept for follow-up routes (empty omits it).
   */
  trackInbound(taskId: string, team: string, from: string, contextId?: string, receiptExpected?: boolean, brief?: string, auth?: TaskAuthorization, deliveredTo?: string, receiverSessionId?: string, consumed?: boolean): void {
    if (taskId === '') return
    this.sweep(this.now())
    if (this.tasks.some(entry => entry.taskId === taskId)) return
    if (this.archived.some(entry => entry.taskId === taskId)) return
    this.counters.trackedTotal += 1
    this.tasks = [{
      taskId,
      team,
      peer: `local:${from}`,
      startedAt: this.now(),
      direction: 'inbound' as const,
      ...(typeof consumed==='boolean'?{consumed}:{}),
      ...(receiverSessionId ? { receiverSessionId } : {}),
      ...(receiptExpected === false ? { receiptExpected: false } : {}),
      ...(contextId !== undefined && contextId !== '' ? { contextId } : {}),
      ...(brief !== undefined && brief !== '' ? { brief } : {}),
      // #114 S2: frozen at birth; a replayed id never reaches here (first record wins above).
      ...(auth !== undefined ? { auth } : {}),
      ...(deliveredTo !== undefined && deliveredTo !== '' ? { deliveredTo: deliveredTo.slice(0, ROUTING_FACT_CAP) } : {}),
      status: 'pending' as const,
    }, ...this.tasks]
    this.trimOwed()
    this.persist()
  }

  /** Record an answer only from the local member that actually received this row; never settle or change counters. */
  markAnswered(taskId: string, target: string): boolean {
    const row = this.tasks.find(entry => entry.taskId === taskId)
    if (row === undefined || !(row.direction === 'inbound' || row.peer === 'local') || (row.deliveredTo ?? row.team) !== target || row.answeredAt !== undefined) return false
    row.answeredAt = this.now()
    row.receiptDelivery='receipt-undelivered'
    this.persist()
    return true
  }

  /**
   * v0.5.23 (async-stall): whether a tracked task still owes its receipt.
   * The async nudge consults this — a resolved or dead-lettered task
   * disarms its retry (re-steering a session that could not start a turn
   * past its own stale window is noise, not recovery).
   * @param taskId - the correlation key the receipt echoes.
   * @returns true when the task is tracked pending inside its TTL.
   */
  isPending(taskId: string): boolean {
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (record === undefined || record.status !== 'pending') return false
    return this.now() - record.startedAt <= this.staleTtlMs
  }

  /**
   * Caller-side give-up (work-order P1a): clears one owed row into the
   * archive under a `caller-abandoned` outcome so waiters stop occupying the
   * remote budget and the three-tier book stays honest about who ended it.
   * NOT cooperative cancellation — the remote may still be working. A late
   * receipt against an abandoned row lands as orphan metadata
   * ({@link ArchivedRecord.lateReceiptAt}) without rewriting the decision.
   * Idempotent and total per the consumer contract: repeat calls and unknown
   * ids return stable structured outcomes, never throw.
   * @param taskId - the correlation key to abandon.
   * @param reason - optional short cause, folded into the archived summary.
   * @returns `{outcome:'cleared'}` when a pending/dead row was settled now,
   * `'already-terminal'` when the archive already held the task's end,
   * `'unknown'` when neither tier ever saw the id.
   */
  abandon(taskId: string, reason?: string): AbandonResult {
    if (taskId === '') return { outcome: 'unknown', taskId }
    this.sweep(this.now())
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (record !== undefined) {
      this.tasks = this.tasks.filter(entry => entry.taskId !== taskId)
      const resolvedAt = this.now()
      const cause = reason === undefined || reason === '' ? '' : `: ${reason.slice(0, SUMMARY_CAP - 'caller-abandoned:'.length)}`
      this.archiveSettled({
        taskId: record.taskId,
        team: record.team,
        peer: record.peer,
        startedAt: record.startedAt,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
        ...(record.brief !== undefined ? { brief: record.brief } : {}),
        resolvedAt,
        summary: `caller-abandoned${cause}`,
        outcome: 'abandoned',
        endedBy: 'abandoned',
        ...(record.direction !== undefined ? { direction: record.direction } : {}),
        ...(record.receiptExpected === false ? { receiptExpected: false as const } : {}),
        ...(record.sender !== undefined ? { sender: record.sender } : {}),
        ...(record.auth !== undefined ? { auth: record.auth } : {}),
        ...routingOf(record),
      })
      this.persist()
      return { outcome: 'cleared', taskId, archivedAt: resolvedAt }
    }
    const settled = this.archived.find(entry => entry.taskId === taskId)
    if (settled === undefined) return { outcome: 'unknown', taskId }
    return { outcome: 'already-terminal', taskId, archivedAt: settled.resolvedAt }
  }

  /**
   * Cooperative cancellation (work-order P1b): ends one owed row like
   * {@link abandon} but marks it `caller-cancelled` so downstream tooling
   * tells "stopped waiting" from "ordered a stop". Implemented standalone
   * (not via a shared endTask core) deliberately: abandon() is already
   * reviewed semantics on this stack — touching it would ripple re-review;
   * the ~20 duplicated lines buy a frozen reviewed surface.
   * Cross-node targets degrade honestly: no reachable lane ⇒ no notify —
   * the route layer reads team/contextId from here for its best-effort
   * steer, which is the documented boundary until origin-auth lands.
   */
  recordWithdrawalResult(taskId: string, result: import('./task-ledger-rows.ts').WithdrawalResult): void {
    if(!(WITHDRAWAL_RESULTS as readonly string[]).includes(result))throw Error('invalid withdrawal result')
    const row=this.archived.find(entry=>entry.taskId===taskId&&entry.endedBy==='cancelled')
    if(!row||row.withdrawalResult===result)return
    this.archived=this.archived.map(entry=>entry===row?{...entry,withdrawalResult:result}:entry)
    this.persist()
  }

  cancel(taskId: string, reason?: string): CancelledResult {
    if (taskId === '') return { outcome: 'unknown', taskId }
    this.sweep(this.now())
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (record !== undefined) {
      this.tasks = this.tasks.filter(entry => entry.taskId !== taskId)
      const resolvedAt = this.now()
      const cause = reason === undefined || reason === '' ? '' : `: ${reason.slice(0, SUMMARY_CAP - 'caller-cancelled:'.length)}`
      this.archiveSettled({
        taskId: record.taskId,
        team: record.team,
        peer: record.peer,
        startedAt: record.startedAt,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
        ...(record.brief !== undefined ? { brief: record.brief } : {}),
        resolvedAt,
        summary: `caller-cancelled${cause}`,
        outcome: 'abandoned',
        endedBy: 'cancelled',
        ...(record.direction !== undefined ? { direction: record.direction } : {}),
        ...(record.receiptExpected === false ? { receiptExpected: false as const } : {}),
        ...(record.sender !== undefined ? { sender: record.sender } : {}),
        ...(record.auth !== undefined ? { auth: record.auth } : {}),
        ...routingOf(record),
      })
      this.persist()
      return {
        outcome: 'cleared',
        taskId,
        archivedAt: resolvedAt,
        team: record.team,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
      }
    }
    const settled = this.archived.find(entry => entry.taskId === taskId)
    if (settled === undefined) return { outcome: 'unknown', taskId }
    return { outcome: 'already-terminal', taskId, archivedAt: settled.resolvedAt }
  }

  /**
   * Correlate one message against the ledger: a receipt (message starting
   * `[A2A receipt] task <id> …`) settles its task into the archive, keeping
   * the outcome summary; a repeat or late receipt refreshes that archived
   * record with the latest outcome. A dead-lettered row revives through this
   * same path when a revived target finally answers.
   * @param message - the inbound or relayed message text.
   * @param only - gh#141: settle the named row only when it passes this test;
   *   with a test, a row that fails it or is already archived correlates nothing.
   * @returns what the receipt settled, or `undefined` when the message
   *   correlated nothing.
   */
  resolveFromMessage(message: string, judge?: SettlementJudge, only?: (record: TaskRecord) => boolean): ReceiptResolvedInfo | undefined {
    const parsed = parseReceipt(message)
    if (parsed === null) return undefined
    const taskId = parsed.taskId
    const summary = parsed.summary.trim().slice(0, SUMMARY_CAP)    // Controlled vocabulary only: a foreign outcome string never lands here.
    const envelopeOutcome =
      parsed.envelope?.outcome !== undefined ? (parsed.envelope.outcome as ReceiptOutcomeV2) : undefined
    const elapsedMs = parsed.envelope?.elapsedMs
    const disposition = parsed.envelope?.disposition
    this.sweep(this.now())
    const record = this.tasks.find(entry => entry.taskId === taskId)
    if (only !== undefined && (record === undefined || !only(record))) return undefined
    if (record !== undefined) {
      // #114 S4: judge the settler before the row moves; enforce keeps a refused row owed.
      const verdict = judge?.check(record, false)
      if (verdict !== undefined && !verdict.ok) {
        this.noteRefusal(taskId, judge!, verdict.reason, message)
        if (judge!.enforce) { this.persist(); return undefined }
      }
      this.tasks = this.tasks.filter(entry => entry.taskId !== taskId)
      this.archiveSettled({
        taskId: record.taskId,
        team: record.team,
        peer: record.peer,
        startedAt: record.startedAt,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
        ...(record.brief !== undefined ? { brief: record.brief } : {}),
        resolvedAt: this.now(),
        ...(summary !== '' ? { summary } : {}),
        ...(envelopeOutcome !== undefined ? { outcome: envelopeOutcome } : {}),
        ...(disposition !== undefined ? { disposition } : {}),
        ...(elapsedMs !== undefined ? { elapsedMs } : {}),
        endedBy: 'receipt',
        ...(record.direction !== undefined ? { direction: record.direction } : {}),
        ...(record.receiptExpected === false ? { receiptExpected: false as const } : {}),
        ...(record.sender !== undefined ? { sender: record.sender } : {}),
        ...(record.auth !== undefined ? { auth: record.auth } : {}),
        ...routingOf(record),
        ...(verdict !== undefined ? { settledBy: { caller: judge!.settler.caller.slice(0, SETTLEMENT_ID_CAP), chain_role: verdict.ok ? verdict.role : 'off-chain' } } : {}),
      })
      this.persist()
      return {
        taskId,
        team: record.team,
        peer: record.peer,
        // A dead row still lives in the tasks array (the sweep only flips
        // status): its receipt is a revival — the late marker's first form.
        ...(record.status === 'dead' ? { late: true } : {}),
        ...(envelopeOutcome !== undefined ? { outcome: envelopeOutcome } : {}),
        ...(disposition !== undefined ? { disposition } : {}),
        ...(summary !== '' ? { summary } : {}),
      }
    }
    const settled = this.archived.find(entry => entry.taskId === taskId)
    if (settled === undefined) return undefined
    // #114 S4 (review of PR #140 P2-3): a late receipt is judged too. Under
    // enforce, an off-chain one only marks that an answer came late — it
    // never rewrites the settled summary or outcome.
    const lateVerdict = judge?.check(settled, false)
    if (lateVerdict !== undefined && !lateVerdict.ok) {
      this.noteRefusal(taskId, judge!, lateVerdict.reason, message)
      if (judge!.enforce) {
        this.archived = [{ ...settled, lateReceiptAt: this.now() }, ...this.archived.filter(entry => entry.taskId !== taskId)]
        this.persist()
        return undefined
      }
    }
    // Orphan isolation: a receipt for an explicitly abandoned row must not
    // rewrite the abandonment outcome — the caller stopped waiting by choice.
    // Record that the target did answer later; keep the decision verbatim and
    // pin the projected verdict to 'abandoned'.
    // gh#31: the recorded end wins; the summary prefix only decides legacy
    // rows (a receipt-settled row's summary is the peer's own text).
    const callerEnded = settled.endedBy !== undefined
      ? settled.endedBy === 'abandoned' || settled.endedBy === 'cancelled'
      : CALLER_ENDED_PREFIX.test(settled.summary ?? '')
    this.archived = [
      {
        ...settled,
        ...(callerEnded
          ? { lateReceiptAt: this.now(), outcome: 'abandoned' as const }
          : {
              resolvedAt: this.now(),
              ...(summary !== '' ? { summary } : {}),
              ...(envelopeOutcome !== undefined ? { outcome: envelopeOutcome } : {}),
              ...(disposition !== undefined ? { disposition } : {}),
            }),
      },
      ...this.archived.filter(entry => entry.taskId !== taskId),
    ]
    this.persist()
    return {
      taskId,
      team: settled.team,
      peer: settled.peer,
      ...(envelopeOutcome !== undefined ? { outcome: envelopeOutcome } : {}),
      ...(disposition !== undefined ? { disposition } : {}),
      ...(summary !== '' ? { summary } : {}),
      // The late marker's second form: the caller had already moved on
      // (abandonment recorded verbatim). A HEALTHY row's duplicate refresh
      // is neither dead-lettered nor abandoned — it carries no marker.
      ...(callerEnded ? { late: true } : {}),
    }
  }

  /**
   * F5 (settlement integrity): settle pending rows by CONTENT ECHO — an
   * inbound message that references `task <id>` of a pending row counts as
   * the peer demonstrably responding to that task, even when the formal
   * `[A2A receipt]` envelope never rode the reply (the 08-30 shape: content
   * answered, formality lost). The receipt envelope keeps precedence: this
   * runs only when {@link resolveFromMessage} correlated nothing. Echo-
   * settled rows archive with a marker summary so the audit trail shows
   * they were echoes, not envelopes.
   * @param message - the inbound message text.
   * @returns the task ids this message settled (usually none or one).
   */
  resolveEcho(message: string, judge?: SettlementJudge): string[] {
    const settled: string[] = []
    let refused = false
    this.sweep(this.now())
    for (const record of [...this.tasks]) {
      if (record.status !== 'pending') continue
      if (!message.includes(`task ${record.taskId}`)) continue
      // #114 S4: an echo is weak evidence — only an on-chain settler's echo counts under enforce.
      const verdict = judge?.check(record, true)
      if (verdict !== undefined && !verdict.ok) {
        this.noteRefusal(record.taskId, judge!, verdict.reason, message)
        refused = true
        if (judge!.enforce) continue
      }
      this.tasks = this.tasks.filter(entry => entry.taskId !== record.taskId)
      this.archiveSettled({
        taskId: record.taskId,
        team: record.team,
        peer: record.peer,
        startedAt: record.startedAt,
        ...(record.contextId !== undefined ? { contextId: record.contextId } : {}),
        resolvedAt: this.now(),
        summary: ECHO_SUMMARY,
        endedBy: 'echo',
        ...(record.direction !== undefined ? { direction: record.direction } : {}),
        ...(record.receiptExpected === false ? { receiptExpected: false as const } : {}),
        ...(record.sender !== undefined ? { sender: record.sender } : {}),
        ...(record.auth !== undefined ? { auth: record.auth } : {}),
        ...routingOf(record),
        ...(verdict !== undefined ? { settledBy: { caller: judge!.settler.caller.slice(0, SETTLEMENT_ID_CAP), chain_role: verdict.ok ? verdict.role : 'off-chain' } } : {}),
      })
      settled.push(record.taskId)
    }
    if (settled.length > 0 || refused) this.persist()
    return settled
  }

  /** #114 S4: the owed row for a task id, if any (read-only; for the settlement gate). */
  find(taskId: string): TaskRecord | undefined {
    return this.tasks.find(entry => entry.taskId === taskId)
  }

  /** #114 S4: refused / would-be-refused settlements, newest first. */
  settlementRefusals(): readonly SettlementRefusalRecord[] {
    return [...this.refusals]
  }

  /** #114 S4: every refusal ever noted, including those folded or pushed out of the ring. */
  settlementRefusalsTotal(): number {
    return this.refusalsTotal
  }

  /**
   * Record one refused / would-be-refused settlement in the bounded ring
   * (persisted by the caller). A repeat of the same (task, settler, reason)
   * folds into its entry and moves it to the head, so one row's flood cannot
   * push other evidence out.
   */
  private noteRefusal(taskId: string, judge: SettlementJudge, reason: SettlementReason, message: string): void {
    const head = (message.split('\n')[0] ?? '').slice(0, SUMMARY_CAP)
    const id = taskId.slice(0, SETTLEMENT_ID_CAP)
    const settler = { ...judge.settler, caller: judge.settler.caller.slice(0, SETTLEMENT_ID_CAP) }
    const same = (r: SettlementRefusalRecord): boolean => r.taskId === id && r.settler.caller === settler.caller && r.reason === reason && r.enforced === judge.enforce
    const prior = this.refusals.find(same)
    this.refusalsTotal += 1
    this.refusals = [{ taskId: id, at: this.now(), settler, reason, head, enforced: judge.enforce, count: (prior?.count ?? 0) + 1 }, ...this.refusals.filter(r => !same(r))].slice(0, SETTLEMENT_REFUSAL_CAP)
  }

  /**
   * Move one settled record to the archive head, trimming at the cap.
   * gh#154: every arrival and every cap-trimmed row is counted — the trim
   * itself stays exactly as it was, only visible now.
   */
  private archiveSettled(record: ArchivedRecord): void {
    const next = [record, ...this.archived]
    const kept = next.slice(0, this.archiveCap)
    this.counters.archiveTrimmed += next.length - kept.length
    if (record.endedBy !== undefined) this.counters.archivedByEnd[record.endedBy] += 1
    this.archived = kept
  }

  /**
   * gh#154 conservation verdict — duplicates first, then the count identity
   * (a duplicated row can still make the counts balance; the Harness²
   * assert_identity lesson). The counters module answers the count half.
   */
  conservation(): ConservationVerdict {
    const seen = new Set<string>()
    const duplicateTaskIds: string[] = []
    for (const row of [...this.tasks, ...this.archived]) {
      if (seen.has(row.taskId)) duplicateTaskIds.push(row.taskId)
      else seen.add(row.taskId)
    }
    return this.counters.verdict(this.tasks.length, this.archived.length, duplicateTaskIds)
  }

  /**
   * gh#86 (chief order direct-4f596524): when the owed book exceeds
   * TASK_CAP, the overflow rows go to the ARCHIVE as evicted - visible
   * for audit, never silently dropped. The review seat's recommendation,
   * chief-endorsed: the silent cap slice lost the oldest pending rows
   * with no trace. L8 criterion: zero silently-dropped.
   */
  private trimOwed(): void {
    if (this.tasks.length <= TASK_CAP) return
    const overflow = this.tasks.slice(TASK_CAP)
    this.tasks = this.tasks.slice(0, TASK_CAP)
    const now = this.now()
    for (const row of overflow) {
      this.archiveSettled({
        taskId: row.taskId,
        team: row.team,
        peer: row.peer,
        startedAt: row.startedAt,
        ...(row.contextId !== undefined ? { contextId: row.contextId } : {}),
        resolvedAt: now,
        ...(row.brief !== undefined ? { brief: row.brief } : {}),
        endedBy: 'evicted' as const,
        ...(row.direction !== undefined ? { direction: row.direction } : {}),
        ...(row.sender !== undefined ? { sender: row.sender } : {}),
        ...(row.auth !== undefined ? { auth: row.auth } : {}),
        ...routingOf(row),
      })
    }
  }

  /** Lazy dead-letter sweep: overdue pending rows flip status, at most once. */
  private sweep(now: number): void {
    let changed = false
    for (const entry of this.tasks) {
      if (entry.status === 'pending' && now - entry.startedAt > this.staleTtlMs) {
        entry.status = 'dead'
        entry.deadAt = now
        // F5 layer-3: stamp WHY the row aged — a fire-and-forget row
        // (receiptExpected:false) expiring is expected bookkeeping; a
        // receipt-owed row expiring means the settlement chain failed for
        // that delivery and deserves supervision attention.
        entry.reason = entry.receiptExpected === false ? 'fire-forget' : 'unconsumed'
        changed = true
      }
    }
    if (changed) this.persist()
  }

  /** Load a persisted snapshot on construction, if present. */
  private restore(): void {
    if (this.path === '' || !existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<TaskLedgerSnapshot> | null
      // gh#154 review r3: a non-object OR ARRAY top level, and a missing or
      // non-array required `tasks` member, are malformed snapshots — never a
      // healthy empty ledger (an array is typeof 'object'; absence of the
      // one required member is damage, not an empty legacy snapshot).
      if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Array.isArray(snapshot.tasks)) {
        this.counters.damaged = 'snapshot-shape-invalid'
        return
      }
      // The optional archive array: present-but-not-an-array stamps damage —
      // but the REQUIRED tasks rows still load (review r4 P1: an early return
      // here would drop parseable owed rows wholesale on the next persist).
      if (snapshot.archived !== undefined && !Array.isArray(snapshot.archived)) {
        this.counters.damaged = 'snapshot-shape-invalid'
      }
      if(snapshot.reconciliationReminders && typeof snapshot.reconciliationReminders==='object') {
        for(const [id,raw] of Object.entries(snapshot.reconciliationReminders).slice(0,TASK_CAP)) {
          const parsed=parseReminder(raw)
          if(parsed)this.reminders[id]=parsed
          else this.reminderRecoveryPending=true
        }
      }
      if(snapshot.reconciliationSessions && typeof snapshot.reconciliationSessions==='object') {
        this.reminderSessions=Object.fromEntries(Object.entries(snapshot.reconciliationSessions).filter(([id,at])=>id.length>0&&id.length<=256&&Number.isSafeInteger(at)&&at>=0).slice(0,TASK_CAP))
      }
      if(snapshot.taskDeliveryRestoreError===true)this.deliveryRestoreError=true
      if(snapshot.taskDeliveries!==undefined) {
        if(!Array.isArray(snapshot.taskDeliveries)||snapshot.taskDeliveries.length>TASK_DELIVERY_CAP)this.deliveryRestoreError=true
        else {
          const seen=new Set<string>()
          for(const raw of snapshot.taskDeliveries) {const parsed=parseTaskDelivery(raw);if(!parsed||seen.has(parsed.taskId)||this.deliveries.some(row=>row.sessionId===parsed.sessionId&&row.messageId===parsed.messageId)){this.deliveryRestoreError=true;break}seen.add(parsed.taskId);this.deliveries.push(parsed)}
        }
      }
      const entries = snapshot.tasks
      const restored: TaskRecord[] = []
      if (Array.isArray(entries)) {
        for (const raw of entries) {
          // Unparsed on purpose: the legacy shape carries a 'resolved' status
          // and inline outcome fields that TaskRecord no longer declares.
          const entry = raw as Record<string, unknown> | null
          if (typeof entry?.taskId !== 'string' || entry.taskId === '') {
            // gh#154 review r3: a malformed row never vanishes into a balanced
            // baseline — the parseable rows still load, the verdict refuses.
            this.counters.damaged = this.counters.damaged ?? 'row-shape-invalid'
            continue
          }
          // Legacy two-state files carried resolved rows inline; they migrate
          // into the archive so pre-upgrade outcomes survive the upgrade.
          if (entry.status === 'resolved') {
            this.archived.push({
              taskId: entry.taskId,
              team: typeof entry.team === 'string' ? entry.team : '',
              peer: typeof entry.peer === 'string' ? entry.peer : '',
              startedAt: typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : this.now(),
              ...(typeof entry.contextId === 'string' && entry.contextId !== '' ? { contextId: entry.contextId } : {}),
              ...(typeof entry.brief === 'string' && entry.brief !== '' ? { brief: entry.brief } : {}),
              resolvedAt: typeof entry.resolvedAt === 'number' && Number.isFinite(entry.resolvedAt) ? entry.resolvedAt : this.now(),
              ...(typeof entry.summary === 'string' && entry.summary !== '' ? { summary: entry.summary } : {}),
              ...(typeof entry.outcome === 'string' && (RECEIPT_OUTCOMES as readonly string[]).includes(entry.outcome) ? { outcome: entry.outcome as ReceiptOutcomeV2 } : {}),
              ...(typeof entry.lateReceiptAt === 'number' && Number.isFinite(entry.lateReceiptAt) ? { lateReceiptAt: entry.lateReceiptAt } : {}),
              ...(typeof entry.endedBy === 'string' && ARCHIVE_ENDS.includes(entry.endedBy) ? { endedBy: entry.endedBy as ArchiveEnd } : {}),
              ...(entry.direction === 'inbound' || entry.direction === 'outbound' ? { direction: entry.direction } : {}),
              ...(entry.receiptExpected === false ? { receiptExpected: false as const } : {}),
              ...withSender(entry.sender, entry.direction),
              ...withAuth(entry.auth, entry, this.now()),
            ...withRouting(entry as Record<string, unknown>, this.warn),
              ...withSettledBy((entry as { settledBy?: unknown }).settledBy),
            ...(isWithdrawalResult(entry.withdrawalResult)?{withdrawalResult:entry.withdrawalResult}:{}),
            })
            continue
          }
          restored.push({
            taskId: entry.taskId,
            team: typeof entry.team === 'string' ? entry.team : '',
            peer: typeof entry.peer === 'string' ? entry.peer : '',
            startedAt: typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : this.now(),
            ...(typeof entry.contextId === 'string' && entry.contextId !== '' ? { contextId: entry.contextId } : {}),
            ...(typeof entry.brief === 'string' && entry.brief !== '' ? { brief: entry.brief } : {}),
            // gh#31: both sides round-trip — /state omits direction only when
            // it is unknown, so a restored outbound row must not lose it.
            ...(entry.direction === 'inbound' || entry.direction === 'outbound' ? { direction: entry.direction } : {}),
            ...(entry.receiptExpected === false ? { receiptExpected: false } : {}),
            // #114 S3: a malformed sender is dropped whole; the row survives.
            ...withSender(entry.sender, entry.direction),
            ...withAuth(entry.auth, entry, this.now()),
            ...withRouting(entry as Record<string, unknown>, this.warn),
            ...(typeof entry.receiverSessionId==='string'&&entry.receiverSessionId.length>0&&entry.receiverSessionId.length<=256?{receiverSessionId:entry.receiverSessionId}:{}),
            ...(typeof entry.consumed==='boolean'?{consumed:entry.consumed}:{}),
            status: entry.status === 'dead' ? 'dead' : 'pending',
            ...(entry.status === 'dead'
              ? {
                  deadAt: typeof entry.deadAt === 'number' && Number.isFinite(entry.deadAt) ? entry.deadAt : this.now(),
                  ...(entry.reason === 'fire-forget' || entry.reason === 'unconsumed' ? { reason: entry.reason } : {}),
                }
              : {}),
          })
        }
      }
      const legacyArchive = snapshot?.archived
      if (Array.isArray(legacyArchive)) {
        for (const raw of legacyArchive) {
          const entry = raw as Partial<ArchivedRecord> | null
          if (typeof entry?.taskId !== 'string' || entry.taskId === '') {
            // gh#154 review r3: same refusal for a malformed archived row.
            this.counters.damaged = this.counters.damaged ?? 'row-shape-invalid'
            continue
          }
          if (this.archived.some(existing => existing.taskId === entry.taskId)) continue
          this.archived.push({
            taskId: entry.taskId,
            team: typeof entry.team === 'string' ? entry.team : '',
            peer: typeof entry.peer === 'string' ? entry.peer : '',
            startedAt: typeof entry.startedAt === 'number' && Number.isFinite(entry.startedAt) ? entry.startedAt : this.now(),
            ...(typeof entry.contextId === 'string' && entry.contextId !== '' ? { contextId: entry.contextId } : {}),
            ...(typeof entry.brief === 'string' && entry.brief !== '' ? { brief: entry.brief } : {}),
            resolvedAt: typeof entry.resolvedAt === 'number' && Number.isFinite(entry.resolvedAt) ? entry.resolvedAt : this.now(),
            ...(typeof entry.summary === 'string' && entry.summary !== '' ? { summary: entry.summary } : {}),
            ...(typeof entry.outcome === 'string' && (RECEIPT_OUTCOMES as readonly string[]).includes(entry.outcome) ? { outcome: entry.outcome as ReceiptOutcomeV2 } : {}),
              ...(typeof entry.disposition === 'string' && (RECEIPT_DISPOSITIONS as readonly string[]).includes(entry.disposition) ? { disposition: entry.disposition as ReceiptDisposition } : {}),
            ...(typeof entry.lateReceiptAt === 'number' && Number.isFinite(entry.lateReceiptAt) ? { lateReceiptAt: entry.lateReceiptAt } : {}),
            ...(typeof entry.endedBy === 'string' && ARCHIVE_ENDS.includes(entry.endedBy) ? { endedBy: entry.endedBy as ArchiveEnd } : {}),
            ...(entry.direction === 'inbound' || entry.direction === 'outbound' ? { direction: entry.direction } : {}),
            ...(entry.receiptExpected === false ? { receiptExpected: false as const } : {}),
            ...withSender(entry.sender, entry.direction),
            ...withAuth(entry.auth, entry, this.now()),
            ...withRouting(entry as Record<string, unknown>, this.warn),
            ...withSettledBy((entry as { settledBy?: unknown }).settledBy),
            ...(isWithdrawalResult(entry.withdrawalResult)?{withdrawalResult:entry.withdrawalResult}:{}),
          })
        }
      }
      // gh#154: the load path's cap cuts are COUNTED, never silent. Rows this
      // snapshot carried beyond the caps leave the live view but remain in the
      // identity through restoreTrimmed.
      this.tasks = restored.slice(0, TASK_CAP)
      if(this.reminderRecoveryPending) {
        const recoveredAt=this.now()
        for(const row of this.tasks) {
          if(row.status!=='pending'||!Object.hasOwn(snapshot.reconciliationReminders??{},row.taskId)||this.reminders[row.taskId])continue
          this.reminders[row.taskId]={version:1,targetId:row.receiverSessionId??'unresolved-metadata-reset',attempts:3,deliveredCount:0,lastAttemptAt:recoveredAt,nextAt:recoveredAt+REMINDER_LONG_MS,requestId:'metadata-reset',lastResult:'unknown',diagnostic:'metadata-reset'}
        }
      }
      this.counters.restoreTrimmed += Math.max(0, restored.length - this.tasks.length)
      this.counters.restoreTrimmed += Math.max(0, this.archived.length - this.archiveCap)
      this.archived = this.archived.slice(0, this.archiveCap)
      // gh#154: restore the lifetime counters through the conservation
      // module's classifier - absent block = pre-#154 legacy bootstrap
      // (kept rows + this load's cuts, endedBy via the legacy classifier);
      // present-but-invalid (partial/negative/fractional/null body/
      // unbounded trim) = damage: counters zero, verdict refuses conserved;
      // valid = counters as persisted, a persisted damage marker riding
      // along (review r2: it outlives the restart).
      const classified = classifyConservationBlock(snapshot.conservation)
      if (classified.kind === 'legacy') {
        this.counters.legacyBootstrap(this.tasks.length, this.archived, this.counters.restoreTrimmed, archivedEndedBy)
      } else if (classified.kind === 'valid') {
        this.counters.loadFrom(classified.snapshot, this.tasks.length, this.archived.length)
      } else {
        this.counters.damaged = classified.reason
      }
      const refusals = (snapshot as { settlementRefusals?: unknown } | null)?.settlementRefusals
      if (Array.isArray(refusals)) this.refusals = refusals.map(parseRefusal).filter((r): r is SettlementRefusalRecord => r !== undefined).slice(0, SETTLEMENT_REFUSAL_CAP)
      const total = (snapshot as { settlementRefusalsTotal?: unknown } | null)?.settlementRefusalsTotal
      this.refusalsTotal = Math.max(typeof total === 'number' && Number.isInteger(total) && total >= 0 ? total : 0, this.refusals.reduce((n, r) => n + r.count, 0))
    } catch {
      // A corrupt ledger is not fatal: routing never depends on it; the
      // reconciliation simply starts fresh. gh#154 review P1: a fresh start
      // is NOT a conserved state — the unreadable history may have held work.
      this.counters.damaged = 'snapshot-unreadable'
    }
  }

  /** Persist the ledger (no-op when no path was configured). */
  private persist(): void {
    if (this.path === '') return
    const bytes = JSON.stringify(this.snapshot())
    try {
      writeTaskLedger(this.path, bytes)
      this.committed = bytes
      this.writeFailure = undefined
    } catch (error) {
      const becameUnavailable=this.writeFailure===undefined
      this.writeFailure = { at: this.now(), code:safeObservationCode(error,'LEDGER_WRITE_FAILED') }
      const previous = JSON.parse(this.committed) as TaskLedgerSnapshot
      this.reminders = Object.assign(Object.create(null), previous.reconciliationReminders ?? {})
      this.reminderSessions = previous.reconciliationSessions ?? Object.create(null)
      this.deliveryRestoreError = previous.taskDeliveryRestoreError===true
      this.deliveries = previous.taskDeliveries ? previous.taskDeliveries.map(r=>({...r})) : []
      this.tasks = [...previous.tasks]
      this.archived = [...previous.archived ?? []]
      this.refusals = [...previous.settlementRefusals ?? []]
      this.refusalsTotal = previous.settlementRefusalsTotal ?? 0
      Object.assign(this.counters, new ConservationCounters(), previous.conservation ?? {})
      if(becameUnavailable)try{this.warn('a2a: ledgerPersistence FAILED at='+this.writeFailure.at+' code='+this.writeFailure.code)}catch{/* diagnostic only */}
      throw error
    }
  }

  private snapshot(): TaskLedgerSnapshot {
    return {
        tasks: this.tasks.map(task => ({ ...task })),
        ...(this.deliveryRestoreError?{taskDeliveryRestoreError:true as const}:{}),
        ...(this.deliveries.length ? {taskDeliveries:this.deliveries.map(row=>({...row}))} : {}),
        ...(Object.keys(this.reminderSessions).length ? { reconciliationSessions: {...this.reminderSessions} } : {}),
        ...(Object.keys(this.reminders).length ? { reconciliationReminders: Object.fromEntries(Object.entries(this.reminders).filter(([id])=>this.tasks.some(row=>row.taskId===id&&row.status==='pending'))) } : {}),
        ...(this.archived.length > 0 ? { archived: this.archived.map(entry => ({ ...entry })) } : {}),
        ...(this.refusals.length > 0 ? { settlementRefusals: this.refusals.map(entry => ({ ...entry, settler: { ...entry.settler } })) } : {}),
        ...(this.refusalsTotal > 0 ? { settlementRefusalsTotal: this.refusalsTotal } : {}),
        // gh#154: the conservation counters ride every snapshot once any work
        // has been tracked (zero-work ledgers stay byte-identical to before).
        // A damage marker rides too — review r2: it must survive restarts.
        ...(this.counters.trackedTotal > 0 || this.counters.damaged !== undefined ? { conservation: this.counters.toSnapshot() } : {}),
    }
  }
}
