// @vitest-environment node
/**
 * superagent a2a Source, p3-source-explicit: the reply path (design P3-5 to P3-9) and the plan-P page records with the
 * hourly heartbeat (shadow acceptance v5.1 A15). The superagent side is a fake SourceContext; `a2a-net` is a stub that
 * answers like the real CLI (exit codes travel on the thrown error, as superagent's CliError keeps them). The real host
 * and CLI are in tests/mesh/a2a-watch-reply.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  ANSWERED_RECORD_CAP, createA2aKind, EXIT_GONE, EXIT_RECEIPT_CONFLICT, GONE_AFTER_MS, HEARTBEAT_MS, KV, KV_TTL_DAYS, LOOP_PREFIX, noteRound,
  pollMailbox, receiptOutcome, recordRows, SEND_FAILED_RECORD_CAP, sendReply, watch, type A2aConfig, type PageRecord, type RowRecord,
} from '../../src/superagent/a2a-watch.ts'
import { key, type Health, type OutboundMessage, type SourceContext, type TicketView } from '../../src/superagent/source-types.ts'

const OBSERVE: A2aConfig = { mode: 'observe', pollSeconds: 30, renewMinutes: 60 }
const REPLY: A2aConfig = { ...OBSERVE, mode: 'reply' }
const T0 = Date.parse('2026-11-07T10:00:00.000Z')

class CliExit extends Error { constructor(readonly exitCode: number) { super(`a2a-net exited ${String(exitCode)}`) } }

function fake(answer: (args: string[]) => string, config: A2aConfig = REPLY) {
  const state = new Map<string, unknown>()
  const reports: Array<[string, Health]> = []
  const runs: string[][] = []
  const tickets = new Map<string, TicketView>()
  let mode = config
  const commands = { withSignal: () => commands, run: async (program: string, args: string[]) => { runs.push([program, ...args]); return answer(args) } }
  const ctx: SourceContext = {
    commands, ready: Promise.resolve(), configured: () => true,
    config: <C extends Record<string, unknown>>() => mode as unknown as C,
    receive: async () => 'stored',
    state: { get: <V>(k: string) => state.get(k) as V | undefined, set: (k, v) => { if (v === undefined) state.delete(k); else state.set(k, v) } },
    threads: { describe: () => {} },
    tickets: { get: id => tickets.get(id) },
    report: (entry, h) => { reports.push([entry, h]) },
  }
  return { ctx, state, reports, runs, tickets, commands, setMode: (next: A2aConfig) => { mode = next } }
}
/** The CLI stub: `admission` answers linked (cli-deposit) unless told otherwise; receipt and route succeed. */
const cli = (over: { admission?: unknown; receipt?: () => string; route?: () => string } = {}) => (args: string[]) => {
  if (args[0] === 'admission') return JSON.stringify(over.admission ?? { caller: args[1], admitted: true, rule: 'cli-deposit' })
  if (args[0] === 'receipt') return over.receipt?.() ?? '{"delivered":true,"class":"sent"}'
  if (args[0] === 'route') return over.route?.() ?? '{"delivered":true,"class":"sent"}'
  throw new Error(`unexpected ${args.join(' ')}`)
}
const message = (over: Partial<OutboundMessage> = {}, address: Record<string, string> = { caller: 'dsh/aaaa1111', task: 'task-1', context: 'ctx-1' }): OutboundMessage =>
  ({ id: 'reply:0123', channel: { source: 'a2a', thread: 'a2a:ctx-1', address }, text: 'the PR is ready', kind: 'reply', ...over })
const at = (ms: number) => () => new Date(ms)

describe('P3-6 · the receipt outcome follows how the ticket ended (S26; Q2 closed is abandoned)', () => {
  it('maps every upstream outcome, and an open ticket is completed', () => {
    const ended = (outcome: NonNullable<TicketView['ended']>['outcome'], by: 'executor' | 'human' = 'executor'): TicketView => ({ id: 't', ended: { at: 'x', by, outcome } })
    expect(receiptOutcome(undefined)).toBe('completed')
    expect(receiptOutcome({ id: 't' })).toBe('completed')
    expect(receiptOutcome(ended('completed'))).toBe('completed')
    expect(receiptOutcome(ended('merged'))).toBe('completed')
    expect(receiptOutcome(ended('dropped'))).toBe('rejected')
    expect(receiptOutcome(ended('closed'))).toBe('abandoned')
    expect(receiptOutcome(ended('closed', 'human'))).toBe('abandoned')
    expect(receiptOutcome(ended('stopped', 'human'))).toBe('abandoned')
    expect(receiptOutcome(ended('stopped', 'executor'))).toBe('failed')
  })
})

describe('P3-5 · the first message is the one formal receipt; later ones are new a2a- tasks in the same context', () => {
  it('rechecks the link first, then sends the receipt with the ticket outcome, and records the task only after it went out', async () => {
    const f = fake(cli())
    f.tickets.set('tk-1', { id: 'tk-1', ended: { at: 'x', by: 'executor', outcome: 'dropped' } })
    expect(await sendReply(f.ctx, f.commands, message({ ticketId: 'tk-1' }), at(T0))).toBe('sent')
    expect(f.runs).toEqual([
      ['a2a-net', 'admission', 'dsh/aaaa1111', '--json'],
      ['a2a-net', 'receipt', 'task-1', '--to', 'dsh/aaaa1111', '--outcome', 'rejected', '--json', '--exit-class', '--', 'the PR is ready'],
    ])
    expect(f.state.get(KV.answered)).toEqual({ 'task-1': new Date(T0).toISOString() })
    // The second message of the task is a new task: a2a-<key(message id)>, the original context, never a second receipt.
    expect(await sendReply(f.ctx, f.commands, message({ id: 'reply:4567', text: 'it was merged' }), at(T0 + 1000))).toBe('sent')
    expect(f.runs.at(-1)).toEqual(['a2a-net', 'route', 'dsh/aaaa1111', '--task', `${LOOP_PREFIX}${key('reply:4567')}`, '--context', 'ctx-1', '--json', '--exit-class', '--', 'it was merged'])
    expect(`${LOOP_PREFIX}${key('reply:4567')}`).toMatch(/^a2a-[0-9a-f]{32}$/)
    expect(f.reports).toEqual([])
  })

  it('an attention reply is an attention receipt with its question on its own task id, leaving the formal receipt for the result (market N2c); a task without a context uses the task', async () => {
    const f = fake(cli())
    // The engine's id for a reply to the ticket's open question (upstream Replies: key('attention-reply', attention.id)).
    f.tickets.set('tk-1', { id: 'tk-1', attention: { id: 'a1' } })
    await sendReply(f.ctx, f.commands, message({ id: key('attention-reply', 'a1'), ticketId: 'tk-1', text: 'which branch?' }), at(T0), { by: { seat: 'dsh/bbbb2222', name: '后端' } })
    expect(f.runs.at(-1)).toEqual(['a2a-net', 'receipt', 'task-1', '--to', 'dsh/aaaa1111', '--attention', '--question-id', 'a1', '--by', 'dsh/bbbb2222', '--by-name', '后端', '--json', '--exit-class', '--', 'which branch?'])
    // The question is not the task's formal receipt: the result that follows still is.
    expect((f.state.get(KV.answered) as Record<string, string> | undefined)?.['task-1']).toBeUndefined()
    f.tickets.set('tk-1', { id: 'tk-1' })
    await sendReply(f.ctx, f.commands, message({ id: 'result:1', ticketId: 'tk-1', text: 'main' }), at(T0))
    expect(f.runs.at(-1)!.slice(1, 7)).toEqual(['receipt', 'task-1', '--to', 'dsh/aaaa1111', '--outcome', 'completed'])
    // A task id with no room for a question id under 80 characters sends the question the older way.
    const long = fake(cli())
    const longTask = 'x'.repeat(70)
    long.tickets.set('tk-1', { id: 'tk-1', attention: { id: 'a1' } })
    await sendReply(long.ctx, long.commands, message({ id: key('attention-reply', 'a1'), ticketId: 'tk-1', text: 'q' }, { caller: 'dsh/aaaa1111', task: longTask }), at(T0))
    expect(long.runs.at(-1)).toEqual(['a2a-net', 'receipt', longTask, '--to', 'dsh/aaaa1111', '--attention', '--json', '--exit-class', '--', 'q'])
    // An id that only looks like one (the old prefix check) is not an attention reply.
    const p = fake(cli())
    p.tickets.set('tk-1', { id: 'tk-1', attention: { id: 'a1' } })
    await sendReply(p.ctx, p.commands, message({ id: 'attention-reply:a1', ticketId: 'tk-1' }), at(T0))
    expect(p.runs.at(-1)).toEqual(expect.arrayContaining(['--outcome', 'completed']))
    const g = fake(cli())
    await sendReply(g.ctx, g.commands, message({}, { caller: 'dsh/aaaa1111', task: 'task-2' }), at(T0))
    expect(g.runs.at(-1)).toContain('completed')
    await sendReply(g.ctx, g.commands, message({ id: 'reply:9' }, { caller: 'dsh/aaaa1111', task: 'task-2' }), at(T0))
    expect(g.runs.at(-1)!.slice(0, 7)).toEqual(['a2a-net', 'route', 'dsh/aaaa1111', '--task', `a2a-${key('reply:9')}`, '--context', 'task-2'])
  })

  it('market N1d: the question carries its answers and the recommended one as --options / --default', async () => {
    const f = fake(cli())
    f.tickets.set('tk-1', { id: 'tk-1', attention: { id: 'a1' } })
    await sendReply(f.ctx, f.commands, message({ id: key('attention-reply', 'a1'), ticketId: 'tk-1', text: '问候语用哪种风格？' }), at(T0), { choices: { options: ['正式', '口语', '俏皮'], recommended: '口语' } })
    const run = f.runs.at(-1)!
    expect(run.slice(run.indexOf('--options'), run.indexOf('--options') + 4)).toEqual(['--options', '正式|口语|俏皮', '--default', '口语'])
    // An answer with | cannot ride the switch; a recommendation that is not among the answers is not sent.
    const g = fake(cli())
    g.tickets.set('tk-1', { id: 'tk-1', attention: { id: 'a1' } })
    await sendReply(g.ctx, g.commands, message({ id: key('attention-reply', 'a1'), ticketId: 'tk-1', text: 'q' }), at(T0), { choices: { options: ['a|b', 'c'], recommended: 'z' } })
    const r2 = g.runs.at(-1)!
    expect(r2.slice(r2.indexOf('--options'), r2.indexOf('--options') + 2)).toEqual(['--options', 'c'])
    expect(r2).not.toContain('--default')
  })

  it('a caller from this host session is rechecked on the local face', async () => {
    const f = fake(cli())
    await sendReply(f.ctx, f.commands, message({}, { caller: 'dsh/01234567', task: 'task-1', ingress: 'local' }), at(T0))
    expect(f.runs[0]).toEqual(['a2a-net', 'admission', 'dsh/01234567', '--local', '--json'])
  })

  it('no link, no message (O1): the recheck refuses and nothing is sent', async () => {
    for (const admission of [{ caller: 'x', admitted: false }, { caller: 'x', admitted: true, rule: 'roster-shared' }, { caller: 'x', admitted: true, rule: 'local-exempt' }, { ok: false }]) {
      const f = fake(cli({ admission }))
      expect(await sendReply(f.ctx, f.commands, message(), at(T0)), JSON.stringify(admission)).toBe('gone')
      expect(f.runs.map(r => r[1])).toEqual(['admission'])
      expect(f.reports).toEqual([['a2a-reply', expect.objectContaining({ state: 'error', detail: expect.stringContaining('no longer linked'), values: { task: 'task-1' } })]])
      expect(f.state.get(KV.answered)).toBeUndefined()
    }
  })

  it('a receipt that is already there counts as sent and is recorded (v1.1 item 2); a class of gone is gone', async () => {
    const conflict = fake(cli({ receipt: () => { throw new CliExit(EXIT_RECEIPT_CONFLICT) } }))
    expect(await sendReply(conflict.ctx, conflict.commands, message(), at(T0))).toBe('sent')
    expect(conflict.state.get(KV.answered)).toEqual({ 'task-1': new Date(T0).toISOString() })
    expect(conflict.state.get(KV.sendFailed)).toEqual({})
    const gone = fake(cli({ receipt: () => { throw new CliExit(EXIT_GONE) } }))
    expect(await sendReply(gone.ctx, gone.commands, message(), at(T0))).toBe('gone')
    expect(gone.reports).toEqual([['a2a-reply', expect.objectContaining({ state: 'error', values: { task: 'task-1' } })]])
    expect(gone.state.get(KV.answered)).toBeUndefined()
    // Exit 5 on a follow-up route is not a receipt conflict: it retries.
    const routeConflict = fake(cli({ route: () => { throw new CliExit(EXIT_RECEIPT_CONFLICT) } }))
    routeConflict.state.set(KV.answered, { 'task-1': new Date(T0).toISOString() })
    await expect(sendReply(routeConflict.ctx, routeConflict.commands, message({ id: 'reply:2' }), at(T0))).rejects.toThrow('exited 5')
  })

  it('a task id the CLI cannot carry a receipt for is gone at once, never retried for a day', async () => {
    for (const task of ['has space', `t${'x'.repeat(72)}`, '-dash']) {
      const f = fake(cli())
      expect(await sendReply(f.ctx, f.commands, message({}, { caller: 'dsh/aaaa1111', task }), at(T0)), task).toBe('gone')
      expect(f.runs.map(r => r[1])).toEqual(['admission'])
    }
  })

  it('the Channel of a running kind sends through its context; reply needs reply mode', async () => {
    const f = fake(cli())
    let running: SourceContext | undefined
    const kind = createA2aKind(() => running, at(T0))
    await expect(kind.channel.send({ commands: f.commands }, message())).rejects.toThrow('not running yet')
    running = f.ctx
    expect(await kind.channel.send({ commands: f.commands }, message())).toBe('sent')
    f.setMode(OBSERVE)
    await expect(kind.channel.send({ commands: f.commands }, message({ id: 'reply:x' }))).rejects.toThrow('not in reply mode')
  })
})

describe('acceptance run 3 · a held receipt: the host keeps the formal receipt for a later message', () => {
  it('a held message goes out as a follow-up and leaves the task unanswered; the next unheld one is the receipt', async () => {
    const f = fake(cli())
    expect(await sendReply(f.ctx, f.commands, message({ id: 'reply:q', text: 'which case?' }), at(T0), { holdReceipt: true })).toBe('sent')
    expect(f.runs.at(-1)).toEqual(['a2a-net', 'route', 'dsh/aaaa1111', '--task', `${LOOP_PREFIX}${key('reply:q')}`, '--context', 'ctx-1', '--json', '--exit-class', '--', 'which case?'])
    expect(f.state.get(KV.answered)).toBeUndefined()
    expect(await sendReply(f.ctx, f.commands, message({ id: 'reply:r', text: 'done' }), at(T0 + 1000))).toBe('sent')
    expect(f.runs.at(-1)).toEqual(['a2a-net', 'receipt', 'task-1', '--to', 'dsh/aaaa1111', '--outcome', 'completed', '--json', '--exit-class', '--', 'done'])
    expect(f.state.get(KV.answered)).toEqual({ 'task-1': new Date(T0 + 1000).toISOString() })
  })
})

describe('P3-8 · failures retry until 24 hours, then the message is gone with a health record', () => {
  it('keeps the first failure time, throws until GONE_AFTER_MS, then reports and clears', async () => {
    const f = fake(cli({ receipt: () => { throw new CliExit(1) } }))
    await expect(sendReply(f.ctx, f.commands, message(), at(T0))).rejects.toThrow('exited 1')
    expect(f.state.get(KV.sendFailed)).toEqual({ 'reply:0123': new Date(T0).toISOString() })
    await expect(sendReply(f.ctx, f.commands, message(), at(T0 + GONE_AFTER_MS - 1))).rejects.toThrow('exited 1')
    expect(f.state.get(KV.sendFailed)).toEqual({ 'reply:0123': new Date(T0).toISOString() })
    expect(f.reports).toEqual([])
    expect(await sendReply(f.ctx, f.commands, message(), at(T0 + GONE_AFTER_MS))).toBe('gone')
    expect(f.reports).toEqual([['a2a-reply', expect.objectContaining({ state: 'error', detail: expect.stringContaining('24 hours'), values: { task: 'task-1' } })]])
    expect(f.state.get(KV.sendFailed)).toEqual({})
    // The health record keeps the task id, never the free text.
    expect(f.state.get(KV.healthLog)).toEqual([expect.objectContaining({ entry: 'a2a-reply', values: { task: 'task-1' } })])
  })

  it('a failed recheck counts as a failure too, and a later success clears the record', async () => {
    let down = true
    const f = fake(args => { if (args[0] === 'admission' && down) throw new CliExit(1); return cli()(args) })
    await expect(sendReply(f.ctx, f.commands, message(), at(T0))).rejects.toThrow()
    expect(Object.keys(f.state.get(KV.sendFailed) as object)).toEqual(['reply:0123'])
    down = false
    expect(await sendReply(f.ctx, f.commands, message(), at(T0 + 60_000))).toBe('sent')
    expect(f.state.get(KV.sendFailed)).toEqual({})
  })

  it('both records are bounded: older than KV_TTL_DAYS goes, then the oldest beyond the cap', async () => {
    const f = fake(cli())
    const old = new Date(T0 - (KV_TTL_DAYS + 1) * 86_400_000).toISOString()
    const many = Object.fromEntries(Array.from({ length: ANSWERED_RECORD_CAP }, (_, i) => [`t-${String(i)}`, new Date(T0 - 1000 + i).toISOString()]))
    f.state.set(KV.answered, { stale: old, ...many })
    await sendReply(f.ctx, f.commands, message({}, { caller: 'dsh/aaaa1111', task: 'fresh' }), at(T0 + 10_000))
    const answered = f.state.get(KV.answered) as Record<string, string>
    expect(Object.keys(answered)).toHaveLength(ANSWERED_RECORD_CAP)
    expect(answered.stale).toBeUndefined()
    expect(answered['t-0']).toBeUndefined()
    expect(answered.fresh).toBeDefined()
    const g = fake(cli({ receipt: () => { throw new CliExit(1) } }))
    g.state.set(KV.sendFailed, { stale: old, ...Object.fromEntries(Array.from({ length: SEND_FAILED_RECORD_CAP }, (_, i) => [`m-${String(i)}`, new Date(T0 - 1000 + i).toISOString()])) })
    await expect(sendReply(g.ctx, g.commands, message(), at(T0))).rejects.toThrow()
    const failed = g.state.get(KV.sendFailed) as Record<string, string>
    expect(Object.keys(failed)).toHaveLength(SEND_FAILED_RECORD_CAP)
    expect(failed.stale).toBeUndefined()
    expect(failed['reply:0123']).toBe(new Date(T0).toISOString())
  })
})

describe('plan P · pages for rows or a loss, and one heartbeat an hour with the counts since the last (v5.1 A15)', () => {
  const header = (ms: number): Omit<PageRecord, 'heartbeat' | 'rounds' | 'rows'> => ({ at: new Date(ms).toISOString(), after: 'e1:0', next: 'e1:0', epoch: 'e1', lost: 0, epochChanged: false, cursorAhead: false })
  const pages = (f: ReturnType<typeof fake>) => (f.state.get(KV.pages) as PageRecord[] | undefined) ?? []
  const empty = (next = 'e1:0') => JSON.stringify({ epoch: 'e1', after: 'start', next, mail: [], lost: 0, epochChanged: false })

  it('an empty read records nothing until a heartbeat is due; the heartbeat counts rounds and row records', () => {
    const f = fake(() => '')
    expect(noteRound(f.ctx, header(T0), false)).toBe(true) // none yet: the first is due
    expect(pages(f)).toEqual([{ ...header(T0), heartbeat: true, rounds: 1, rows: 0 }])
    const row = (seq: number): RowRecord => ({ epoch: 'e1', seq, task_id: 't', from: 'x', outcome: 'stored', at: header(T0).at, proof: null, receipt_for: null, dup: null, admission: null })
    for (let i = 1; i < 120; i += 1) expect(noteRound(f.ctx, header(T0 + i * 30_000), false)).toBe(false)
    expect(recordRows(f.ctx, [row(1), row(2)])).toBe(2)
    expect(recordRows(f.ctx, [row(1)])).toBe(0) // a replay is not counted twice
    expect(noteRound(f.ctx, header(T0 + HEARTBEAT_MS - 1), false)).toBe(false)
    expect(noteRound(f.ctx, header(T0 + HEARTBEAT_MS), false)).toBe(true)
    expect(pages(f).at(-1)).toEqual({ ...header(T0 + HEARTBEAT_MS), heartbeat: true, rounds: 121, rows: 2 })
    expect(pages(f)).toHaveLength(2)
    expect(f.state.get(KV.heartbeat)).toEqual({ last: header(T0 + HEARTBEAT_MS).at, rounds: 0, rows: 0 })
  })

  it('a start forces a heartbeat on its first round', () => {
    const f = fake(() => '')
    noteRound(f.ctx, header(T0), false)
    expect(noteRound(f.ctx, header(T0 + 60_000), true)).toBe(true)
    expect(pages(f).at(-1)).toMatchObject({ heartbeat: true, rounds: 1 })
  })

  it('empty reads write no page; reads with rows do; the loop forces the first heartbeat', async () => {
    let now = T0
    const f = fake(() => empty(), OBSERVE)
    await pollMailbox(f.ctx, new AbortController().signal, () => new Date(now), true)
    now += 30_000
    await pollMailbox(f.ctx, new AbortController().signal, () => new Date(now))
    expect(pages(f).map(p => [p.at, p.heartbeat ?? false])).toEqual([[new Date(T0).toISOString(), true]])
    const g = fake(args => args[0] === 'publish' ? '' : empty(), OBSERVE)
    const stop = new AbortController()
    const run = watch(g.ctx, stop.signal, () => new Date(T0))
    await new Promise(r => setTimeout(r, 10)); stop.abort(); await run
    expect(pages(g)).toEqual([expect.objectContaining({ heartbeat: true, rounds: 1, rows: 0 })])
  })

  it('an interrupted round counts the rows it recorded toward the next heartbeat, and the replay adds none', async () => {
    const mail = [1, 2].map(seq => ({ at: T0, from: 'dsh/aaaa1111', text: 'x', seq, task_id: `t-${String(seq)}`, proof: 'origin-claim', admission: 'canvas-shared' }))
    const f = fake(() => JSON.stringify({ epoch: 'e1', after: 'start', next: 'e1:2', mail, lost: 0, epochChanged: false }), OBSERVE)
    const stop = new AbortController()
    const receive = f.ctx.receive
    f.ctx.receive = async t => { const r = await receive(t); stop.abort(); return r }
    await expect(pollMailbox(f.ctx, stop.signal, at(T0))).rejects.toThrow()
    expect(f.state.get(KV.heartbeat)).toEqual({ last: null, rounds: 0, rows: 1 })
    f.ctx.receive = receive
    await pollMailbox(f.ctx, new AbortController().signal, at(T0 + 30_000))
    expect(pages(f).filter(p => p.heartbeat)).toEqual([expect.objectContaining({ rounds: 1, rows: 2 })])
  })
})
