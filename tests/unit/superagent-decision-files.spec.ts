// @vitest-environment node
/** docs/design/superagent-decision-cards.md C8: files on a card, from its proposer, and with the owner's decision. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DecisionSpec } from '../../src/superagent/host/decisions.ts'

const spec = (level: DecisionSpec['level'] = 'P2'): DecisionSpec => ({ level, options: ['甲', '乙'], recommended: '甲' })
const sha = (c: string): string => c.repeat(64)
const ref = (c: string, name = 'a.txt'): string => `[A2A file] v1 sha256=${sha(c)} size=3 name=${name} from=http://127.0.0.1:3084`

async function team(stage: boolean = true) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem, registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const staged: Array<[string, readonly string[], string]> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-cardfiles-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
    ...(stage ? { stageFiles: (id: string, paths: readonly string[], canvas: string) => { staged.push([id, paths, canvas]); return { ok: true as const, files: paths.map((p, i) => ({ sha256: sha(String(i + 1)), size: 3, name: p, ref: ref(String(i + 1), p) })) } } } : {}),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const call = async (name: string, as: string, args: Record<string, unknown>) => await registered.get(name)!.execute(args, { agent: { id: as }, signal: new AbortController().signal })
  const openTicket = async (): Promise<string> => {
    const asked = h.request('做事') as { triggerId: string }
    h.pass()
    const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '做事', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
    await vi.waitFor(() => { expect(h.executor.bindingOf('session-m')?.ticketId).toBe(ticket) })
    return ticket
  }
  const candidates = () => sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent candidate]')).map(([, t]) => t)
  return { h, sent, staged, call, openTicket, candidates }
}

describe('files a proposer puts on a card', () => {
  it('the router\'s files are staged from its workspace for the team, shown on the card, and only those can be downloaded', async () => {
    const m = await team()
    const out = await m.call('superagent_decision_propose', 'session-r', { question: '用哪份方案？', options: ['甲', '乙'], recommended: '甲', reason: '理由', files: ['plan-a.md', 'plan-b.md'] })
    expect(out).toMatchObject({ ok: true })
    expect(m.staged).toEqual([['session-r', ['plan-a.md', 'plan-b.md'], 'team']])
    const [card] = m.h.decisionCards()
    expect(card!.files!.map(f => f.name)).toEqual(['plan-a.md', 'plan-b.md'])
    expect(m.h.decisionFile(card!.id, sha('1'))).toMatchObject({ name: 'plan-a.md' })
    expect(m.h.decisionFile(card!.id, sha('9'))).toBeUndefined()
    expect(m.h.decisionFile('d-unknown', sha('1'))).toBeUndefined()
    await m.h.stop()
  })
  it('a member\'s question carries its files onto the ticket\'s card; files without a question are refused', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'progress', summary: 's', files: ['x.log'] })).toMatchObject({ ok: false, code: 'files' })
    expect(m.staged).toHaveLength(0)
    expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'waiting', summary: 's', question: '哪个日志对？', options: ['甲', '乙'], recommended: '甲', level: 'P3', files: ['x.log'] })).toMatchObject({ ok: true })
    const [card] = m.h.decisionCards()
    expect(card).toMatchObject({ source: 'ticket', ticketId: ticket, files: [expect.objectContaining({ name: 'x.log' })] })
    await m.h.stop()
  })
  it('more than 16 files, or a host that cannot stage, is refused before anything is raised', async () => {
    const m = await team()
    expect(m.h.stageCardFiles('session-r', Array.from({ length: 17 }, (_, i) => `f${String(i)}`))).toMatchObject({ ok: false, code: 'files' })
    expect(m.h.stageCardFiles('session-r', [])).toEqual({ ok: true, files: [] })
    await m.h.stop()
    const n = await team(false)
    expect(await n.call('superagent_decision_propose', 'session-r', { question: '要吗？', options: ['甲', '乙'], recommended: '甲', reason: '理由', files: ['a'] })).toMatchObject({ ok: false, code: 'files' })
    expect(n.h.decisionCards()).toHaveLength(0)
    await n.h.stop()
  })
})

describe('files the owner decides with', () => {
  it('go to the router below the decision, and stay on the decided card for download', async () => {
    const m = await team()
    const raised = m.h.proposeDecision('router', 'session-r', '要不要升级依赖？', spec()) as { id: string }
    expect(m.h.decide(raised.id, 'choose', '乙', '见附件', [ref('a', 'spec.pdf')])).toMatchObject({ ok: true })
    m.h.pass()
    await vi.waitFor(() => { expect(m.candidates().some(t => t.includes('决定：乙') && t.includes('说明：见附件') && t.includes(`sha256=${sha('a')}`))).toBe(true) })
    expect(m.h.decisionFile(raised.id, sha('a'))).toMatchObject({ name: 'spec.pdf' })
    await m.h.stop()
  })
  it('go back to the member\'s ticket with the answer', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    m.h.report('session-m', { state: 'waiting', summary: '要定', question: '用哪个？', decision: spec('P3') }, ticket)
    const [card] = m.h.decisionCards()
    expect(m.h.decide(card!.id, 'approve', undefined, undefined, [ref('b')])).toMatchObject({ ok: true, ticket_id: ticket })
    const input = m.h.store.tickets.get(ticket)!.inputs.filter(i => i.kind === 'trigger').map(i => m.h.store.triggers.get((i as { triggerId: string }).triggerId)?.text ?? '').join('\n')
    expect(input).toContain(`sha256=${sha('b')}`)
    await m.h.stop()
  })
  it('must be reference lines, at most 16; a refused decision decides nothing', async () => {
    const m = await team()
    const raised = m.h.proposeDecision('router', 'session-r', '要吗？', spec()) as { id: string }
    expect(m.h.decide(raised.id, 'approve', undefined, undefined, ['/etc/passwd'])).toMatchObject({ ok: false, code: 'files' })
    expect(m.h.decide(raised.id, 'approve', undefined, undefined, Array.from({ length: 17 }, () => ref('c')))).toMatchObject({ ok: false, code: 'files' })
    expect(m.h.decisionCards()).toHaveLength(1)
    await m.h.stop()
  })
})
