// @vitest-environment node
/**
 * #921: with member profiles set, the split's coordinating parent is accepted without a member (it is held from members);
 * the member guard still applies to an ordinary accept and to a part that names an unknown member.
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
  expect(host.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Do what the market dispatches.' }], profiles: { 'session-a': { role: '列举' }, 'session-b': { role: '挑选' } } }, () => true)).toMatchObject({ ok: true })
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

const parts = [{ title: '甲：三种问候语', scope: '列出三种中文问候语', member: 'session-a' }, { title: '乙：挑一种', scope: '从中挑一种并说明理由', member: 'session-b' }]
const asked = '请分成两项、由总工拆单分给两个成员'

describe('#921 split with profiled members', () => {
  it('the parent is accepted without a member, the parts go to the named members, and the parent stays held', async () => {
    const { splitRequest } = await import('../../src/superagent/host/tools.ts')
    const t = await team()
    expect(t.host.membersProfiled()).toBe(true)
    t.receive('1')
    const out = splitRequest(t.host, { trigger_id: '1', title: '问候语（两项）', scope: '写一段问候语', reason: '需求要求分成两项', rules: ['deps'], asked, parts })
    expect(out, JSON.stringify(out)).toMatchObject({ ok: true })
    const parent = out.ticket_id as string, children = out.parts as string[]
    expect(children).toHaveLength(2)
    await t.settle()
    const bound = t.host.executor.list()
    expect(bound.map(b => b.ticketId)).not.toContain(parent)
    expect(bound.filter(b => children.includes(b.ticketId)).map(b => b.member).sort()).toEqual(['session-a', 'session-b'])
    await t.host.stop()
  })

  it('a part naming an unknown member is still refused, and nothing is accepted', async () => {
    const { splitRequest } = await import('../../src/superagent/host/tools.ts')
    const t = await team()
    t.receive('2')
    const out = splitRequest(t.host, { trigger_id: '2', title: 't', scope: 's', reason: 'r', rules: ['deps'], asked, parts: [parts[0], { title: '乙', scope: 's', member: 'session-nobody' }] })
    expect(out).toMatchObject({ ok: false, code: 'member' })
    expect(t.host.store.tickets.list()).toHaveLength(0)
    await t.host.stop()
  })

  it('an ordinary accept without a member is still refused when members are profiled', async () => {
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const t = await team()
    t.receive('3')
    const out = routeItem(t.host, { trigger_id: '3', kind: 'accept', title: 't', scope: 's', reason: 'r', rules: ['deps'] } as never)
    expect(out).toMatchObject({ ok: false, code: 'member' })
    expect(t.host.store.tickets.list()).toHaveLength(0)
    await t.host.stop()
  })
})
