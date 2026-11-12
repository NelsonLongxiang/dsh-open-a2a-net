// @vitest-environment node
/**
 * docs/design/superagent-root-team.md R1–R4 (step S2): a root team's members are other teams. The root router names a
 * child team; the host sends it the ticket as an A2A request from the root's identity; the child's receipts move the
 * root ticket — a question is asked of the root's requester and the answer goes back to the child in the same
 * conversation; a result is the root ticket's report; a refusal hands it back to the root router. A child takes as many
 * tickets at once as its slots. A child team on the same instance admits the root's identity.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formatReceipt } from '../../src/receipt.ts'

const bot = 'market/0123456789abcdef'
const DOCS = 'dsh/canvas/docs@0a1b2c3d', SALES = 'ext/canvas/sales@4e5f6a7b'

async function root(options: { slots?: number } = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const routes: Array<{ address: string; text: string; context?: string; task: string }> = []
  const told: string[] = []
  let n = 0
  const host = new SuperagentHost({
    canvasTeam: (name: string) => name === 'root' ? { local: ['session-r'], remote: [], children: [{ ref: DOCS, slots: options.slots ?? 3 }, { ref: SALES, slots: 1 }] } : undefined,
    home: mkdtempSync(join(tmpdir(), 'sa-root-')), logger: { info: () => {}, warn: () => {} }, interval: () => () => {},
    deliverToSession: (id: string, text: string) => { if (id === 'session-r') told.push(text); return true },
    homeUrl: () => 'http://127.0.0.1:1', sessionName: (id: string) => id, sessionLoaded: () => true, hostFingerprint: () => '0a1b2c3d',
    runCli: async (args: string[]) => {
      // As on the test host: a child's canvas address is never a sender let into the root identity's mailbox.
      if (args[0] === 'admission') return JSON.stringify({ admitted: false })
      if (args[0] === 'route') {
        const dash = args.indexOf('--'), ctx = args.indexOf('--context')
        const task = `direct-${String(++n).padStart(12, '0')}`
        routes.push({ address: args[1]!, text: args.slice(dash + 1).join(' '), ...(ctx >= 0 ? { context: args[ctx + 1]! } : {}), task })
        return JSON.stringify({ task_id: task })
      }
      return '{}'
    },
  } as never)
  expect(host.saveSettings({ canvas: 'root', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Take what the market sends.' }] }, () => true)).toMatchObject({ ok: true })
  const settle = async () => { for (let i = 0; i < 20; i++) { host.pass(); await new Promise(r => setTimeout(r, 5)) } }
  let m = 0
  const request = (text = '写一份季度报告。') => {
    const task = `wbe-${String(++m)}.a1`, context = `ctx-${String(m)}`
    host.engine.receive({ id: `req-${String(m)}`, source: 'a2a', threads: [{ source: 'a2a', id: context }], actor: { source: 'a2a', id: bot }, human: false, addressed: 'direct', at: new Date().toISOString(), text,
      channel: { source: 'a2a', thread: `a2a:${context}`, address: { caller: bot, task, context } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } } as never)
    host.pass()
    return { trigger: `req-${String(m)}`, task, context }
  }
  const accept = (triggerId: string, member: string) => routeItem(host, { trigger_id: triggerId, kind: 'accept', title: '季度报告', scope: '写一份季度报告', reason: '市场派工', rules: ['deps'], member } as never)
  /** A receipt from the child on a task this root sent it, as it lands in the root team's mailbox. */
  let r = 0
  const receipt = (task: string, from: string, summary: string, fields: Record<string, unknown>) => {
    const trigger = { id: `rcpt-${String(++r)}`, source: 'a2a', threads: [{ source: 'a2a', id: task }], actor: { source: 'a2a', id: from }, human: false, addressed: 'direct', at: new Date().toISOString(),
      text: formatReceipt(task, summary, fields as never), channel: { source: 'a2a', thread: `a2a:${task}`, address: { caller: from, task: `receipt-${task}` } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: `receipt-${task}`, receiptFor: task } }
    // As the A2A Source's intake does: the root's book first, then the engine (whose scope keeps a receipt out of judgement).
    host.root.received(trigger as never)
    host.engine.receive(trigger as never)
    host.pass()
  }
  return { host, routes, told, settle, request, accept, receipt }
}

describe('a root team\'s members are teams', () => {
  it('the router names a child team; the host sends it the ticket as an A2A request', async () => {
    const t = await root()
    const req = t.request()
    expect(t.accept(req.trigger, '子团队 docs（dsh@0a1b2c3d）')).toMatchObject({ ok: true, decision: 'accept' })
    await t.settle()
    expect(t.routes).toHaveLength(1)
    expect(t.routes[0]).toMatchObject({ address: DOCS })
    expect(t.routes[0]!.text).toContain('季度报告')
    expect(t.routes[0]!.context).toBeUndefined()
    await t.host.stop()
  })

  it('a child takes as many tickets at once as its slots', async () => {
    const t = await root({ slots: 2 })
    for (let i = 0; i < 3; i++) t.accept(t.request().trigger, DOCS)
    await t.settle()
    expect(t.routes.filter(x => x.address === DOCS)).toHaveLength(2)
    await t.host.stop()
  })

  it('the router\'s card says the members are teams', async () => {
    const t = await root()
    t.request()
    await t.settle()
    expect(t.told.some(x => x.includes('This team is a root') && x.includes('子团队 docs'))).toBe(true)
    await t.host.stop()
  })
})

describe('the child\'s receipts move the root ticket', () => {
  it('acknowledged, then completed: the root ticket is ready with the child\'s summary', async () => {
    const t = await root()
    const out = t.accept(t.request().trigger, DOCS)
    await t.settle()
    const sent = t.routes[0]!.task
    t.receipt(sent, 'dsh/canvas/docs', '收到', { disposition: 'acknowledged' })
    t.receipt(sent, 'dsh/canvas/docs', '报告已写好', { outcome: 'completed' })
    await t.settle()
    const ticket = t.host.store.tickets.get(out.ticket_id as string)!
    const last = [...ticket.assignments].reverse().find(a => a.report !== undefined)!.report!
    expect(last.state).toBe('ready')
    expect(last.summary).toContain('报告已写好')
    await t.host.stop()
  })

  it('a question goes to the root\'s requester with the child\'s options; the answer goes back to the child in the same conversation', async () => {
    const t = await root()
    const req = t.request()
    const out = t.accept(req.trigger, DOCS)
    await t.settle()
    const sent = t.routes[0]!.task
    t.receipt(sent, 'dsh/canvas/docs', '用哪个季度？', { disposition: 'attention', question: { id: 'q1', text: '用哪个季度？', options: ['Q3', 'Q4'], default: 'Q4' } })
    await t.settle()
    const ticket = t.host.store.tickets.get(out.ticket_id as string)!
    expect(ticket.attention?.question).toContain('用哪个季度')
    expect(t.host.choicesOf(ticket.id)).toEqual({ options: ['Q3', 'Q4'], recommended: 'Q4' })
    // The requester answers on a new task in its conversation: the light path attaches it, the executor passes it on.
    t.host.engine.receive({ id: 'answer-1', source: 'a2a', threads: [{ source: 'a2a', id: req.context }], actor: { source: 'a2a', id: bot }, human: false, addressed: 'direct', at: new Date().toISOString(), text: 'Q4',
      channel: { source: 'a2a', thread: `a2a:${req.context}`, address: { caller: bot, task: 'wbe-answer.a1', context: req.context } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: 'wbe-answer.a1' } } as never)
    await t.settle()
    const forwarded = t.routes.find(x => x.context === sent)
    expect(forwarded?.address).toBe(DOCS)
    expect(forwarded?.text).toContain('Q4')
    expect(t.host.store.tickets.get(ticket.id)!.attention).toBeUndefined()
    await t.host.stop()
  })

  it('a child that does not take it hands the ticket back to the root router, which can name another child', async () => {
    const t = await root()
    const out = t.accept(t.request().trigger, DOCS)
    await t.settle()
    t.receipt(t.routes[0]!.task, 'dsh/canvas/docs', '不在我们范围', { outcome: 'rejected' })
    await t.settle()
    const ticketId = out.ticket_id as string
    const last = [...t.host.store.tickets.get(ticketId)!.assignments].reverse().find(a => a.report !== undefined)!.report!
    expect(last.state).toBe('blocked')
    expect(t.told.some(x => x.includes(ticketId) && x.includes('superagent_assign'))).toBe(true)
    expect(t.host.assignTicket(ticketId, SALES)).toMatchObject({ ok: true })
    await t.settle()
    expect(t.routes.at(-1)?.address).toBe(SALES)
    await t.host.stop()
  })

  it('a child\'s progress step is the root ticket\'s progress (S5): its requester sees it through the root\'s own steps', async () => {
    const t = await root()
    const out = t.accept(t.request().trigger, DOCS)
    await t.settle()
    t.receipt(t.routes[0]!.task, 'dsh/canvas/docs', '正在汇总三季度数据', { disposition: 'progress', progress: { n: 1, state: 'working', summary: '正在汇总三季度数据', at: new Date().toISOString() } })
    await t.settle()
    const last = [...t.host.store.tickets.get(out.ticket_id as string)!.assignments].reverse().find(a => a.report !== undefined)!.report!
    expect(last.state).toBe('progress')
    expect(last.summary).toContain('正在汇总三季度数据')
    await t.host.stop()
  })

  it('a root\'s children are its identity\'s standing sender scope, and it declares what it takes (S5)', async () => {
    const t = await root()
    expect(t.host.childAuthorizes(DOCS)).toBe(true)
    expect(t.host.childAuthorizes('dsh/canvas/docs')).toBe(true)
    expect(t.host.childAuthorizes('dsh/canvas/other')).toBe(false)
    await t.host.stop()
  })

  it('a failed result fails the root ticket; a receipt for a task the root never sent changes nothing', async () => {
    const t = await root()
    const out = t.accept(t.request().trigger, DOCS)
    await t.settle()
    t.receipt('direct-999999999999', 'dsh/canvas/docs', 'stray', { outcome: 'completed' })
    t.receipt(t.routes[0]!.task, 'dsh/canvas/docs', '数据源坏了', { outcome: 'failed' })
    await t.settle()
    const last = [...t.host.store.tickets.get(out.ticket_id as string)!.assignments].reverse().find(a => a.report !== undefined)!.report!
    expect(last.state).toBe('failed')
    expect(last.summary).toContain('数据源坏了')
    await t.host.stop()
  })
})

describe('a child team on the same instance', () => {
  it('admits the root\'s identity: on its bot list with a rule that takes its requests, once', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const child = new SuperagentHost({ canvasTeam: (name: string) => name === 'docs' ? { local: ['session-c', 'session-w'], remote: [] } : undefined,
      home: mkdtempSync(join(tmpdir(), 'sa-child-')), logger: { info: () => {}, warn: () => {} }, interval: () => () => {}, deliverToSession: () => true, homeUrl: () => 'http://127.0.0.1:1', runCli: async () => '{}' } as never)
    expect(child.saveSettings({ canvas: 'docs', router: 'session-c', sources: { a2a: true } }, () => true)).toMatchObject({ ok: true })
    child.admitRequester('root/0123456789abcdef')
    child.admitRequester('root/0123456789abcdef')
    expect(child.settings.bots.a2a).toEqual(['root/0123456789abcdef'])
    expect(child.settings.rules.filter(rule => rule.name === 'root-dispatch')).toHaveLength(1)
    child.admitRequester('not a handle')
    expect(child.settings.bots.a2a).toHaveLength(1)
    // S5: the card lists the root identities it admits; a plain bot is not one.
    expect(child.admittedRoots()).toEqual(['root/0123456789abcdef'].filter(h => h.startsWith('superagent-team/')))
    child.admitRequester('superagent-team/0123456789abcdef')
    expect(child.admittedRoots()).toEqual(['superagent-team/0123456789abcdef'])
    await child.stop()
  })
})
