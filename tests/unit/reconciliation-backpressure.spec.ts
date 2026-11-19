import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { TaskLedger } from '../../src/task-ledger.ts'
import { ReconciliationReminders } from '../../src/reconciliation-reminders.ts'
import { ReconciliationInbox } from '../../src/reconciliation-inbox.ts'
import { REMINDER_MIN_MS, REMINDER_LONG_MS } from '../../src/reconciliation-state.ts'

function fixture() {
  let now = 1_000_000
  const ledger = new TaskLedger(join(mkdtempSync(join(tmpdir(), 'reminder-cap-')), 'tasks.json'), { now: () => now, staleTtlMs: 10 * 86400000 })
  const target: any = { id: 'target', status: 'idle', session: { id: 'target', events: [] }, inbox: { nextTurn: [], nextStep: [] } }
  const sender: any = { id: 'sender', status: 'idle', session: { id: 'sender', events: [] }, inbox: { nextTurn: [], nextStep: [] } }
  for (const agent of [target, sender]) {
    agent.followup = (message: any) => agent.inbox.nextTurn.push(message)
    agent.inbox.remove = (id: string) => { for (const name of ['nextTurn', 'nextStep']) { const index = agent.inbox[name].findIndex((m: any) => m.id === id); if (index >= 0) { agent.inbox[name].splice(index, 1); return true } }; return false }
  }
  let controller: ReconciliationReminders
  const delivery = new ReconciliationInbox({ rows: () => ledger.list(), sender: 'beta', taint: () => {}, invalidated: (kind, ids) => kind === 'blocked' ? controller.releaseBlockedNotice(ids) : undefined })
  controller = new ReconciliationReminders({ ledger, agents: () => [target, sender], resolve: () => target, sender: () => sender,
    available: agent => delivery.available(agent as any), followup: (agent, text, scope) => delivery.send(agent as any, text, scope), now: () => now, warn: vi.fn() })
  ledger.track('job', 'beta/aaaaaaaa', 'local', undefined, 'original', { kind: 'session', id: 'alpha/bbbbbbbb' })
  return { ledger, target, sender, controller, delivery, advance: (ms: number) => { now += ms } }
}

describe('reconciliation reminder queue backpressure', () => {
  it('does not append after backoff while the previous reminder is still unconsumed', () => {
    const f = fixture()
    f.controller.scan()
    f.advance(REMINDER_MIN_MS); f.controller.scan()
    f.advance(600000); f.controller.scan()
    f.advance(REMINDER_LONG_MS); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    expect(f.ledger.reminderState('job')?.attempts).toBe(1)
    expect(f.ledger.find('job')?.answeredAt).toBeUndefined()
    expect(f.ledger.archive()).toEqual([])
  })
  it('does not business-nudge an answered task whose receipt is undelivered; it gets #708\'s one delivery-blocked notice', () => {
    const f = fixture()
    expect(f.ledger.markAnswered('job', 'beta/aaaaaaaa')).toBe(true)
    f.controller.scan()
    const texts = (): string[] => f.target.inbox.nextTurn.map((m: any) => String(m.content?.[0]?.text))
    expect(texts().some(t => t.startsWith('[A2A reconciliation reminder]'))).toBe(false)
    expect(texts().filter(t => t.startsWith('[A2A receipt delivery blocked]'))).toHaveLength(1)
    expect(f.ledger.reminderState('job')?.attempts ?? 0).toBe(0)
    expect(f.ledger.reminderState('job')?.deliveryNoticeAt).toBeDefined()
    expect(f.ledger.find('job')?.status).toBe('pending')
    expect(f.ledger.find('job')?.receiptDelivery).toBe('receipt-undelivered')
    // Once per debt: later scans add nothing, whether or not the notice was consumed.
    f.advance(REMINDER_LONG_MS); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    f.target.inbox.nextTurn.shift(); f.advance(REMINDER_LONG_MS); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(0)
  })
  it('a delivery-blocked notice waits while another reconciliation summary is unconsumed, then goes out once (#709 + #708)', () => {
    const f = fixture()
    f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    expect(f.ledger.markAnswered('job', 'beta/aaaaaaaa')).toBe(true)
    // The queued reminder's debt was answered: the scan invalidates it, and the blocked notice takes the one slot.
    f.advance(REMINDER_MIN_MS); f.controller.scan()
    const texts = f.target.inbox.nextTurn.map((m: any) => String(m.content?.[0]?.text))
    expect(texts.filter(t => t.startsWith('[A2A reconciliation reminder]'))).toHaveLength(0)
    expect(texts.filter(t => t.startsWith('[A2A receipt delivery blocked]'))).toHaveLength(1)
  })
  it('only consumes the one queued summary before a later reminder can be admitted', () => {
    const f = fixture(); f.controller.scan()
    const first = f.target.inbox.nextTurn.shift()
    expect(first.source).toEqual({ kind: 'a2a-relay', form: 'relay', senderSessionId: 'beta' })
    expect(first.source.taskId).toBeUndefined()
    f.advance(REMINDER_MIN_MS); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    expect(f.target.inbox.nextTurn[0].id).not.toBe(first.id)
    expect(f.ledger.reminderState('job')?.attempts).toBe(2)
  })
  it('survives plugin/agent reattachment from the durable inbox without adding a new entry', () => {
    const f = fixture(); f.controller.scan()
    const pending = JSON.parse(JSON.stringify(f.target.inbox.nextTurn))
    f.target.inbox.nextTurn = pending
    const restarted = new ReconciliationInbox({ sender: 'beta', rows: () => f.ledger.list(), taint: () => {} })
    expect(restarted.available(f.target)).toBe(false)
    expect(restarted.send(f.target, '[A2A reconciliation notice] still owed', { kind: 'notice', taskIds: ['job'], requestId: 'other' })).toBe(false)
    expect(f.target.inbox.nextTurn).toEqual(pending)
  })
  it('reminders and sender notices share one slot regardless of task or content', () => {
    const f = fixture(); f.controller.scan()
    f.ledger.track('job-2', 'beta/aaaaaaaa', 'local')
    expect(f.delivery.send(f.target, '[A2A reconciliation notice] other task', { kind: 'notice', taskIds: ['job-2'], requestId: 'warning' })).toBe(false)
    f.advance(24 * 3600000); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    expect(f.ledger.reminderState('job-2')).toBeUndefined()
    // While target holds its reminder, the sender can get one notice, but never a second.
    f.target.inbox.nextTurn.shift(); f.controller.scan()
    f.target.inbox.nextTurn.shift(); f.advance(REMINDER_MIN_MS); f.controller.scan()
    f.target.inbox.nextTurn.shift(); f.advance(600000); f.controller.scan()
    f.advance(1800000); f.controller.scan()
    expect(f.sender.inbox.nextTurn).toHaveLength(1)
    expect(f.sender.inbox.nextTurn[0].content[0].text).toContain('[A2A reconciliation notice]')
    f.controller.scan(); expect(f.sender.inbox.nextTurn).toHaveLength(1)
  })
  for (const end of ['receipt', 'cancel', 'abandon', 'expiry', 'answered'] as const) it('invalidates only the queued summary on ' + end, () => {
    const f = fixture(); f.controller.scan()
    const taskInput = { id: 'original-business', role: 'user', content: [{ type: 'text', text: 'do the original job' }], source: { kind: 'a2a-relay', taskId: 'job' } }
    f.target.inbox.nextTurn.push(taskInput)
    if (end === 'receipt') f.ledger.resolveFromMessage('[A2A receipt] task job completed')
    else if (end === 'cancel') f.ledger.cancel('job')
    else if (end === 'abandon') f.ledger.abandon('job')
    else if (end === 'expiry') f.advance(11 * 86400000)
    else f.ledger.markAnswered('job', 'beta/aaaaaaaa')
    const before = JSON.stringify({ rows: f.ledger.list(), archive: f.ledger.archive() })
    f.controller.scan()
    expect(f.target.inbox.nextTurn).toEqual([taskInput])
    expect(JSON.stringify({ rows: f.ledger.list(), archive: f.ledger.archive() })).toBe(before)
  })
  it('invalidates a mixed stale summary without settling the remaining debt', () => {
    const f = fixture(); f.ledger.track('second', 'beta/aaaaaaaa', 'local'); f.controller.scan()
    expect(f.target.inbox.nextTurn[0].content[0].text).toContain('task second')
    f.ledger.markAnswered('job', 'beta/aaaaaaaa'); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(0)
    f.advance(REMINDER_MIN_MS); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    expect(f.target.inbox.nextTurn[0].content[0].text).toContain('task second')
    expect(f.target.inbox.nextTurn[0].content[0].text).not.toContain('task job;')
    expect(f.ledger.list()).toHaveLength(2)
  })
  it('keeps a reminder admitted before a throw and cannot duplicate it after a restart', () => {
    const f = fixture()
    f.target.followup = (message: any) => { f.target.inbox.nextTurn.push(message); throw Error('after insert') }
    f.controller.scan(); f.advance(REMINDER_MIN_MS); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    expect(f.ledger.reminderState('job')).toMatchObject({ attempts: 1, deliveredCount: 1, lastResult: 'delivered' })
    const restarted = new ReconciliationInbox({ sender: 'beta', rows: () => f.ledger.list(), taint: () => {} })
    expect(restarted.available(f.target)).toBe(false)
  })
  it('fails closed when the inbox cannot be inspected; no attempts or task state are spent', () => {
    const f = fixture(); const followup = vi.fn(); f.target.followup = followup
    Object.defineProperty(f.target, 'inbox', { get() { throw Error('unreadable inbox') } })
    expect(() => f.controller.scan()).not.toThrow()
    expect(followup).not.toHaveBeenCalled()
    expect(f.ledger.reminderState('job')).toBeUndefined()
    expect(f.controller.diagnostics.lastError).toBeDefined()
  })
  it('blocks behind legacy summaries without silently erasing them', () => {
    const f = fixture()
    const old = { id: 'a2a-followup-legacy', role: 'user', content: [{ type: 'text', text: '[A2A reconciliation reminder] old task' }], source: { kind: 'a2a-relay', form: 'relay', senderSessionId: 'beta' } }
    f.target.inbox.nextTurn.push(old); f.controller.scan(); f.advance(REMINDER_LONG_MS); f.controller.scan()
    expect(f.target.inbox.nextTurn).toEqual([old]); expect(f.ledger.reminderState('job')).toBeUndefined()
  })
  it('never mistakes a peer task quoting a reminder for an owned summary', () => {
    const f = fixture()
    const foreign = { id: 'a2a-followup-foreign', role: 'user', content: [{ type: 'text', text: '[A2A reconciliation reminder] peer quote' }], source: { kind: 'a2a-relay', form: 'relay', senderSessionId: 'beta', taskId: 'work' } }
    f.target.inbox.nextTurn.push(foreign); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(2); expect(f.target.inbox.nextTurn[0]).toBe(foreign)
    f.ledger.markAnswered('job', 'beta/aaaaaaaa'); f.controller.scan()
    expect(f.target.inbox.nextTurn).toEqual([foreign])
  })
  it('does not wake or change counters when a second capacity check refuses admission', () => {
    const f = fixture()
    const reserve = f.ledger.saveReminders.bind(f.ledger)
    vi.spyOn(f.ledger, 'saveReminders').mockImplementation((updates, session) => {
      reserve(updates, session)
      if (updates[0]?.state?.lastResult === 'reserved') f.target.inbox.nextTurn.push({ id: 'a2a-followup-raced', role: 'user', content: [{ type: 'text', text: '[A2A reconciliation notice] race' }], source: { kind: 'a2a-relay', form: 'relay', senderSessionId: 'beta' } })
    })
    f.controller.scan()
    expect(f.ledger.reminderState('job')).toBeUndefined()
    expect(f.ledger.reminderSessionAt('target')).toBeUndefined()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
  })
  it('cannot reenter the same slot from taint or stale-summary removal observers', () => {
    const f = fixture(); const taint = vi.fn(() => {
      expect(inbox.send(f.target, '[A2A reconciliation notice] recursive', { kind: 'notice', taskIds: ['job'], requestId: 'inner' })).toBe(false)
    })
    const inbox = new ReconciliationInbox({ sender: 'beta', rows: () => f.ledger.list(), taint })
    expect(inbox.send(f.target, '[A2A reconciliation reminder] outer', { kind: 'reminder', taskIds: ['job'], requestId: 'outer' })).toBe(true)
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    f.ledger.markAnswered('job', 'beta/aaaaaaaa')
    const remove = f.target.inbox.remove
    f.target.inbox.remove = (id: string) => { expect(inbox.available(f.target)).toBe(false); return remove(id) }
    expect(inbox.available(f.target)).toBe(true)
    expect(f.target.inbox.nextTurn).toHaveLength(0)
  })
  it('rechecks answered debt after taint before inserting a new summary', () => {
    const f = fixture(); const followup = vi.spyOn(f.target, 'followup')
    const inbox = new ReconciliationInbox({ sender: 'beta', rows: () => f.ledger.list(), taint: () => { f.ledger.markAnswered('job', 'beta/aaaaaaaa') } })
    expect(inbox.send(f.target, '[A2A reconciliation reminder] stale', { kind: 'reminder', taskIds: ['job'], requestId: 'stale' })).toBe(false)
    expect(followup).not.toHaveBeenCalled()
    expect(f.ledger.find('job')?.status).toBe('pending')
  })

  it('backpressure does not consume a failed-before-insert slot forever', () => {
    const f = fixture(); const accept = f.target.followup; let first = true
    f.target.followup = (message: any) => { if (first) { first = false; throw Error('before insert') }; accept(message) }
    f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(0)
    expect(f.ledger.reminderState('job')).toMatchObject({ attempts: 1, deliveredCount: 0, lastResult: 'unknown' })
    f.advance(REMINDER_MIN_MS); f.controller.scan()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    expect(f.ledger.reminderState('job')).toMatchObject({ attempts: 2, deliveredCount: 1 })
  })
  it('malformed metadata blocks without erasing, settling or falling back to steer', () => {
    const f = fixture(); f.controller.scan()
    const original = f.target.inbox.nextTurn[0]
    original.content[0].text = original.content[0].text.slice(0, original.content[0].text.lastIndexOf('\n[A2A reconciliation scope] ')) + '\n[A2A reconciliation scope] {broken'
    f.ledger.markAnswered('job', 'beta/aaaaaaaa'); f.controller.scan()
    expect(f.target.inbox.nextTurn).toEqual([original])
    expect(f.controller.diagnostics.blockedSessions).toBe(1)
    expect(f.controller.diagnostics.answeredReceiptDebt).toBe(1)
  })
  it.each([{ kind: ['reminder'] }, { kind: ['notice'] }, { kind: {} }, { kind: null }, { kind: false }, { kind: 0 }])('keeps a corrupted kind $kind queued and blocks new summaries', ({ kind }) => {
    const f = fixture(); f.controller.scan()
    const original = f.target.inbox.nextTurn[0]
    const marker = '\n[A2A reconciliation scope] '
    const at = original.content[0].text.lastIndexOf(marker)
    const scope = JSON.parse(original.content[0].text.slice(at + marker.length))
    scope.k = kind
    original.content[0].text = original.content[0].text.slice(0, at + marker.length) + JSON.stringify(scope)
    const remove = vi.spyOn(f.target.inbox, 'remove'), followup = vi.spyOn(f.target, 'followup')
    f.ledger.markAnswered('job', 'beta/aaaaaaaa')
    f.ledger.track('live-job', 'beta/aaaaaaaa', 'local')
    f.advance(REMINDER_MIN_MS)
    const rows = JSON.stringify({ tasks: f.ledger.list(), archive: f.ledger.archive(), reminder: f.ledger.reminderState('job') })
    expect(f.delivery.available(f.target)).toBe(false)
    f.controller.scan()
    expect(f.target.inbox.nextTurn).toEqual([original])
    expect(remove).not.toHaveBeenCalled()
    expect(followup).not.toHaveBeenCalled()
    expect(f.ledger.reminderState('live-job')).toBeUndefined()
    expect(f.controller.diagnostics.blockedSessions).toBe(1)
    expect(JSON.stringify({ tasks: f.ledger.list(), archive: f.ledger.archive(), reminder: f.ledger.reminderState('job') })).toBe(rows)
  })
  it.each(['reminder', 'notice'] as const)('still invalidates a valid primitive %s scope without settling its debt', kind => {
    const f = fixture()
    expect(f.delivery.send(f.target, '[A2A reconciliation ' + kind + '] valid', { kind, taskIds: ['job'], requestId: 'valid-kind' })).toBe(true)
    const remove = vi.spyOn(f.target.inbox, 'remove')
    f.ledger.markAnswered('job', 'beta/aaaaaaaa')
    expect(f.delivery.available(f.target)).toBe(true)
    expect(f.target.inbox.nextTurn).toEqual([])
    expect(remove).toHaveBeenCalledTimes(1)
    expect(f.ledger.find('job')).toMatchObject({ status: 'pending', receiptDelivery: 'receipt-undelivered' })
    expect(f.ledger.archive()).toEqual([])
  })
  it('a removal write failure does not free the slot or mutate debt', () => {
    const f = fixture(); f.controller.scan(); f.ledger.markAnswered('job', 'beta/aaaaaaaa')
    f.target.inbox.remove = () => { throw Object.assign(Error('read only session log'), { code: 'EACCES' }) }
    expect(() => f.controller.scan()).not.toThrow()
    expect(f.target.inbox.nextTurn).toHaveLength(1)
    expect(f.controller.diagnostics.inboxUnavailable).toBe(1)
    expect(f.ledger.find('job')?.receiptDelivery).toBe('receipt-undelivered')
    expect(f.ledger.archive()).toEqual([])
  })
  it('keeps stable slot identity across text changes but scopes it to the exact session', () => {
    const f = fixture()
    const scope = { kind: 'reminder' as const, taskIds: ['job'], requestId: 'persisted-reservation' }
    expect(f.delivery.send(f.target, '[A2A reconciliation reminder] first', scope)).toBe(true)
    const first = f.target.inbox.nextTurn.shift()
    expect(f.delivery.send(f.target, '[A2A reconciliation reminder] second', scope)).toBe(true)
    expect(f.target.inbox.nextTurn[0].id).toBe(first.id)
    expect(f.delivery.send(f.sender, '[A2A reconciliation reminder] other session', scope)).toBe(true)
    expect(f.sender.inbox.nextTurn[0].id).not.toBe(first.id)
  })
  it('bounds the summary after adding durable scope metadata', () => {
    const f = fixture()
    expect(() => f.delivery.send(f.target, '[A2A reconciliation reminder] ' + 'x'.repeat(4096), { kind: 'reminder', taskIds: ['job'], requestId: 'oversized' })).toThrow('byte cap')
    expect(f.target.inbox.nextTurn).toHaveLength(0)
    expect(f.ledger.reminderState('job')).toBeUndefined()
  })
  it.each(['busy', 'replacement'] as const)('cannot insert after a taint observer makes the target %s', change => {
    const f = fixture(); const send = vi.spyOn(f.target, 'followup')
    const inbox = new ReconciliationInbox({ sender: 'beta', rows: () => f.ledger.list(), taint: () => {
      if (change === 'busy') f.target.status = 'running'
      else f.target.session = { id: 'other', events: [] }
    } })
    expect(inbox.send(f.target, '[A2A reconciliation reminder] raced', { kind: 'reminder', taskIds: ['job'], requestId: 'raced' })).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('rolls back a reservation if a newly unreadable inbox prevents any send', () => {
    const f = fixture(), save = f.ledger.saveReminders.bind(f.ledger), originalInbox = f.target.inbox
    vi.spyOn(f.ledger, 'saveReminders').mockImplementation((updates, session) => {
      save(updates, session)
      if (updates[0]?.state?.lastResult === 'reserved') Object.defineProperty(f.target, 'inbox', { configurable: true, get() { throw Error('inbox replaced after reserve') } })
    })
    f.controller.scan()
    expect(f.ledger.reminderState('job')).toBeUndefined()
    expect(f.ledger.reminderSessionAt('target')).toBeUndefined()
    expect(originalInbox.nextTurn).toHaveLength(0)
  })


  describe('#709 review: blocked-notice lifecycle', () => {
    const blockedTexts = (f: ReturnType<typeof fixture>): string[] => f.target.inbox.nextTurn.map((m: any) => String(m.content?.[0]?.text)).filter((t: string) => t.startsWith('[A2A receipt delivery blocked]'))

    it('R1: an inbox that fails after the notice is reserved inserts nothing; the reservation is rolled back and a later scan sends it once', () => {
      const f = fixture()
      expect(f.ledger.markAnswered('job', 'beta/aaaaaaaa')).toBe(true)
      const queue = f.target.inbox.nextTurn
      // Break the inbox exactly when the blocked-notice reservation is written (before the inbox is asked to insert).
      const save = f.ledger.saveReminders.bind(f.ledger)
      const spy = vi.spyOn(f.ledger, 'saveReminders').mockImplementation((updates: any, session?: any) => {
        const out = save(updates, session)
        if (updates.some((u: any) => u.state?.deliveryNoticeAt !== undefined)) f.target.inbox.nextTurn = undefined
        return out
      })
      const followup = vi.spyOn(f.target, 'followup')
      f.controller.scan()
      spy.mockRestore()
      expect(followup).not.toHaveBeenCalled()
      expect(f.ledger.reminderState('job')?.deliveryNoticeAt).toBeUndefined()
      f.target.inbox.nextTurn = queue
      f.advance(REMINDER_LONG_MS); f.controller.scan()
      expect(blockedTexts(f)).toHaveLength(1)
      expect(f.ledger.reminderState('job')?.deliveryNoticeAt).toBeDefined()
      f.advance(REMINDER_LONG_MS); f.controller.scan()
      expect(blockedTexts(f)).toHaveLength(1)
    })

    it('R1 control: a followup that throws after inserting keeps one notice and the marker; no duplicate later', () => {
      const f = fixture()
      expect(f.ledger.markAnswered('job', 'beta/aaaaaaaa')).toBe(true)
      const original = f.target.followup
      f.target.followup = (message: any) => { original(message); throw Error('reply lost after insertion') }
      f.controller.scan()
      f.target.followup = original
      expect(blockedTexts(f)).toHaveLength(1)
      expect(f.ledger.reminderState('job')?.deliveryNoticeAt).toBeDefined()
      f.advance(REMINDER_LONG_MS); f.controller.scan()
      expect(blockedTexts(f)).toHaveLength(1)
    })

    it('R2: when one debt of a two-debt blocked notice settles, the other is told again in a new notice', () => {
      const f = fixture()
      f.ledger.track('job2', 'beta/aaaaaaaa', 'local', undefined, 'second', { kind: 'session', id: 'alpha/bbbbbbbb' })
      expect(f.ledger.markAnswered('job', 'beta/aaaaaaaa')).toBe(true)
      expect(f.ledger.markAnswered('job2', 'beta/aaaaaaaa')).toBe(true)
      f.controller.scan()
      expect(blockedTexts(f)).toHaveLength(1)
      expect(blockedTexts(f)[0]).toContain('job2')
      // Only the first debt ends; the queued two-debt notice is stale and is removed unconsumed.
      f.ledger.cancel('job', 'settled elsewhere')
      f.advance(REMINDER_LONG_MS); f.controller.scan()
      const texts = blockedTexts(f)
      expect(texts).toHaveLength(1)
      expect(texts[0]).toContain('job2')
      expect(texts[0]).not.toContain('task job;')
      expect(f.ledger.find('job2')?.status).toBe('pending')
      expect(f.ledger.reminderState('job2')?.attempts ?? 0).toBe(0)
      // Consumed now: nothing more for it.
      f.target.inbox.nextTurn.length = 0
      f.advance(REMINDER_LONG_MS); f.controller.scan()
      expect(blockedTexts(f)).toHaveLength(0)
    })

    const twoBlocked = () => {
      const f = fixture()
      f.ledger.track('job2', 'beta/aaaaaaaa', 'local', undefined, 'second', { kind: 'session', id: 'alpha/bbbbbbbb' })
      expect(f.ledger.markAnswered('job', 'beta/aaaaaaaa')).toBe(true)
      expect(f.ledger.markAnswered('job2', 'beta/aaaaaaaa')).toBe(true)
      f.controller.scan()
      expect(blockedTexts(f)).toHaveLength(1)
      f.ledger.cancel('job', 'settled elsewhere')
      return f
    }

    it('R2 persistence: a failed marker release leaves the stale notice queued; a later scan replaces it and the survivor is told', () => {
      const f = twoBlocked()
      const save = f.ledger.saveReminders.bind(f.ledger)
      // The store refuses every marker release for the whole scan (it recovers before the next one).
      let failed = false
      const spy = vi.spyOn(f.ledger, 'saveReminders').mockImplementation((updates: any, session?: any) => {
        if (updates.some((u: any) => u.taskId === 'job2' && u.state?.deliveryNoticeAt === undefined)) { failed = true; throw Object.assign(Error('disk full'), { code: 'EACCES' }) }
        return save(updates, session)
      })
      f.advance(REMINDER_LONG_MS); f.controller.scan()
      spy.mockRestore()
      expect(failed).toBe(true)
      // Nothing removed, nothing released: the old two-debt notice is still the one queued item.
      expect(blockedTexts(f)).toHaveLength(1)
      expect(blockedTexts(f)[0]).toContain('task job;')
      expect(f.ledger.reminderState('job2')?.deliveryNoticeAt).toBeDefined()
      f.advance(REMINDER_LONG_MS); f.controller.scan()
      expect(blockedTexts(f)).toHaveLength(1)
      expect(blockedTexts(f)[0]).toContain('job2')
      expect(blockedTexts(f)[0]).not.toContain('task job;')
    })

    it('R2 persistence: a refused removal restores the released markers; the queued notice stays the only one', () => {
      const f = twoBlocked()
      const remove = f.target.inbox.remove
      f.target.inbox.remove = () => false
      f.advance(REMINDER_LONG_MS); f.controller.scan()
      f.target.inbox.remove = remove
      expect(blockedTexts(f)).toHaveLength(1)
      expect(f.ledger.reminderState('job2')?.deliveryNoticeAt).toBeDefined()
    })
  })
})
