// @vitest-environment node
/**
 * docs/design/superagent-split.md: the router splits a request into parts only when the request asks for them; the parent
 * only coordinates; parts send no formal receipt; when every part ends the requester gets one result with the parts.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const bot = 'market/0123456789abcdef'
const TEXT = '[ops] 写一段问候语。请分成两项、由总工拆单分给两个成员：甲 列出三种中文问候语；乙 从中挑一种并说明理由。'

async function team() {
  const { SuperagentHost, END_RECEIPT_GRACE_MS } = await import('../../src/superagent/host/index.ts')
  let clock = Date.parse('2026-11-11T17:00:00.000Z')
  const calls: string[][] = []
  const host = new SuperagentHost({ canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a', 'session-b'], remote: [] } : undefined,
    home: mkdtempSync(join(tmpdir(), 'sa-split-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
    homeUrl: () => 'http://127.0.0.1:1', now: () => new Date(clock).toISOString(), sessionName: (id: string) => id,
    runCli: async (args: string[]) => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' } } as never)
  expect(host.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Do what the market dispatches.' }] }, () => true)).toMatchObject({ ok: true })
  const settle = async () => { for (let i = 0; i < 20; i++) { host.pass(); await new Promise(r => setTimeout(r, 5)) } }
  const receive = (n: string, text = TEXT) => {
    const task = `direct-${n.padStart(12, '0')}`
    host.engine.receive({ id: n, source: 'a2a', threads: [{ source: 'a2a', id: `ctx-${n}` }], actor: { source: 'a2a', id: bot }, human: false, addressed: 'direct', at: new Date(clock).toISOString(), text,
      channel: { source: 'a2a', thread: `a2a:ctx-${n}`, address: { caller: bot, task, context: `ctx-${n}` } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } } as never)
    host.pass()
    return task
  }
  return { host, calls, settle, receive, advance: (ms: number) => { clock += ms }, END_RECEIPT_GRACE_MS }
}

const parts = [{ title: '甲：三种问候语', scope: '列出三种中文问候语' }, { title: '乙：挑一种', scope: '从中挑一种并说明理由' }]

describe('the router splits a request only when it asks for parts', () => {
  it('a split whose asked words are not in the request is refused, and nothing is accepted', async () => {
    const { splitRequest } = await import('../../src/superagent/host/tools.ts')
    const t = await team()
    t.receive('1')
    const out = splitRequest(t.host, { trigger_id: '1', title: '问候语', scope: '问候语', reason: 'r', rules: ['deps'], asked: '请分成三个阶段', parts })
    expect(out).toMatchObject({ ok: false, code: 'not-asked' })
    expect(t.host.store.tickets.list()).toHaveLength(0)
    expect(splitRequest(t.host, { trigger_id: '1', title: 't', scope: 's', reason: 'r', asked: '请分成两项', parts: [parts[0]] })).toMatchObject({ ok: false, code: 'parts' })
    await t.host.stop()
  })

  it('the parent coordinates, each part runs on a member, parts send no receipt, and the requester gets one combined result', async () => {
    const { splitRequest } = await import('../../src/superagent/host/tools.ts')
    const t = await team()
    const task = t.receive('2')
    const out = splitRequest(t.host, { trigger_id: '2', title: '问候语（两项）', scope: '写一段问候语', reason: '需求要求分成两项', rules: ['deps'], asked: '请分成两项、由总工拆单分给两个成员', parts })
    expect(out).toMatchObject({ ok: true })
    const parent = out.ticket_id as string, children = out.parts as string[]
    expect(children).toHaveLength(2)
    await t.settle()
    // The parent is held from members; the parts are on the two members.
    const bound = t.host.executor.list().map(b => b.ticketId)
    expect(bound).not.toContain(parent)
    expect(bound.sort()).toEqual([...children].sort())
    expect(t.host.splitView(parent)!.tickets.map(x => x.title)).toEqual(['甲：三种问候语', '乙：挑一种'])
    // Parts finish; nothing is receipted for them on their own.
    const memberOf = (ticket: string) => t.host.executor.list().find(b => b.ticketId === ticket)!.member
    expect(t.host.report(memberOf(children[0]!), { state: 'ready', summary: '你好／您好／嗨' }, children[0])).toMatchObject({ ok: true })
    await t.settle(); t.advance(t.END_RECEIPT_GRACE_MS + 1_000); await t.settle()
    const formal = () => t.calls.filter(a => a[0] === 'receipt' && a[1] === task && !a.includes('--acknowledged') && !a.includes('--progress'))
    expect(formal()).toEqual([])
    expect(t.host.report(memberOf(children[1]!), { state: 'ready', summary: '选「您好」：正式又亲切' }, children[1])).toMatchObject({ ok: true })
    await t.settle(); t.advance(t.END_RECEIPT_GRACE_MS + 1_000); await t.settle(); await t.settle()
    expect(t.host.store.tickets.get(parent)?.ended?.outcome).toBe('completed')
    expect(formal()).toHaveLength(1)
    const receipt = formal()[0]!
    expect(receipt[receipt.indexOf('--outcome') + 1]).toBe('completed')
    const tickets = JSON.parse(receipt[receipt.indexOf('--tickets') + 1]!) as Array<{ title: string; state: string; outcome: string }>
    expect(tickets.map(x => [x.title, x.state, x.outcome])).toEqual([['甲：三种问候语', 'ended', 'completed'], ['乙：挑一种', 'ended', 'completed']])
    expect(receipt.at(-1)).toContain('全部子项完成')
    await t.host.stop()
  })

  it('a part that does not complete makes the whole a failure, part by part', async () => {
    const { splitRequest } = await import('../../src/superagent/host/tools.ts')
    const t = await team()
    const task = t.receive('3')
    const out = splitRequest(t.host, { trigger_id: '3', title: '问候语（两项）', scope: 's', reason: 'r', rules: ['deps'], asked: '请分成两项', parts })
    const parent = out.ticket_id as string, children = out.parts as string[]
    await t.settle()
    const memberOf = (ticket: string) => t.host.executor.list().find(b => b.ticketId === ticket)!.member
    t.host.report(memberOf(children[0]!), { state: 'ready', summary: '完成' }, children[0])
    t.host.engine.stopTicket(children[1]!, 'owner stop')
    await t.settle(); t.advance(t.END_RECEIPT_GRACE_MS + 1_000); await t.settle(); await t.settle()
    expect(t.host.store.tickets.get(parent)?.ended).toBeDefined()
    const receipt = t.calls.find(a => a[0] === 'receipt' && a[1] === task && !a.includes('--acknowledged') && !a.includes('--progress'))!
    expect(receipt[receipt.indexOf('--outcome') + 1]).toBe('failed')
    expect(receipt.at(-1)).toContain('部分完成')
    await t.host.stop()
  })

  it('an answer to a part\'s question goes to that part, not to the parent', async () => {
    const { splitRequest } = await import('../../src/superagent/host/tools.ts')
    const t = await team()
    t.receive('4')
    const out = splitRequest(t.host, { trigger_id: '4', title: '问候语（两项）', scope: 's', reason: 'r', rules: ['deps'], asked: '请分成两项', parts })
    const parent = out.ticket_id as string, children = out.parts as string[]
    await t.settle()
    const memberOf = (ticket: string) => t.host.executor.list().find(b => b.ticketId === ticket)!.member
    expect(t.host.report(memberOf(children[1]!), { state: 'waiting', summary: '等选择', question: '用正式还是口语？', decision: { level: 'P1', options: ['正式', '口语'], recommended: '口语' } }, children[1])).toMatchObject({ ok: true })
    await t.settle()
    // The requester answers on a new task in the same context.
    t.host.engine.receive({ id: '4b', source: 'a2a', threads: [{ source: 'a2a', id: 'ctx-4' }], actor: { source: 'a2a', id: bot }, human: false, addressed: 'direct', at: new Date().toISOString(), text: '口语。',
      channel: { source: 'a2a', thread: 'a2a:ctx-4', address: { caller: bot, task: 'direct-00000000004b', context: 'ctx-4' } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: 'direct-00000000004b' } } as never)
    await t.settle()
    const inputs = (id: string) => t.host.store.tickets.get(id)!.inputs.filter(i => i.kind === 'trigger').map(i => (i as { triggerId: string }).triggerId)
    expect(inputs(children[1]!)).toContain('4b')
    expect(inputs(children[0]!)).not.toContain('4b')
    expect(t.host.executor.list().map(b => b.ticketId)).not.toContain(parent)
    await t.host.stop()
  })
})
