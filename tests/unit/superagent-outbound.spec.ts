// @vitest-environment node
/** docs/design/superagent-outbound-requests.md O1–O5: asking another team on a card the owner or an approver decides. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { approverCheck, OUTBOUND_APPROVE, OUTBOUND_DECLINE, OutboundRequests, ownAddresses, type OutboundContext } from '../../src/superagent/host/outbound.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/superagent/host/policy.ts'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'

const quiet = { warn: () => {} }
const now = () => '2026-11-11T12:00:00.000Z'
const book = (ask = vi.fn(async () => 'direct-out000001' as string | undefined), note = vi.fn()) => ({ out: new OutboundRequests({ path: join(mkdtempSync(join(tmpdir(), 'sa-out-')), 'outbound.json'), ask, note, logger: quiet, now }), ask, note })
const ctx = (over: Partial<OutboundContext> = {}): OutboundContext => ({ role: 'member', ticket: { open: true, holder: 'session-m', title: '调研' }, a2aOn: true, own: ['dsh/canvas/team', 'dsh/aaaaaaaa'], ...over })
const ask = { ticket_id: 't1', address: 'dsh/canvas/other', text: '请帮忙看一下接口', why: '工单需要对方的数据' }

describe('asking (O1, O2)', () => {
  it('a member asks on the ticket it holds, to another team; the card names the address and the exact text', () => {
    const r = book().out.check('session-m', ask, ctx())
    expect(r).toMatchObject({ ok: true, ticketId: 't1', address: 'dsh/canvas/other', text: '请帮忙看一下接口', reason: '工单需要对方的数据' })
    expect((r as { question: string }).question).toContain('dsh/canvas/other')
    expect((r as { question: string }).question).toContain('请帮忙看一下接口')
  })
  it('refuses: no team, A2A off, no open ticket, not the holder, a bad or own address, no text, too many', () => {
    const { out } = book()
    expect(out.check('x', ask, ctx({ role: undefined }))).toMatchObject({ code: 'not-team' })
    expect(out.check('session-m', ask, ctx({ a2aOn: false }))).toMatchObject({ code: 'a2a-off' })
    expect(out.check('session-m', ask, ctx({ ticket: undefined }))).toMatchObject({ code: 'ticket' })
    expect(out.check('session-m', ask, ctx({ ticket: { open: false, title: 't' } }))).toMatchObject({ code: 'ticket' })
    expect(out.check('session-x', ask, ctx())).toMatchObject({ code: 'not-yours' })
    expect(out.check('session-r', ask, ctx({ role: 'router' }))).toMatchObject({ ok: true })
    expect(out.check('session-m', { ...ask, address: 'not an address' }, ctx())).toMatchObject({ code: 'address' })
    expect(out.check('session-m', { ...ask, address: 'dsh/canvas/team@0123abcd' }, ctx())).toMatchObject({ code: 'own' })
    expect(out.check('session-m', { ...ask, address: 'dsh/aaaaaaaa' }, ctx())).toMatchObject({ code: 'own' })
    expect(out.check('session-m', { ...ask, text: ' ' }, ctx())).toMatchObject({ code: 'text' })
    for (const n of ['1', '2', '3']) out.waiting(`c${n}`, 't1', 'dsh/canvas/other', 'x', 'session-m')
    expect(out.check('session-m', ask, ctx())).toMatchObject({ code: 'too-many' })
  })
  it('the team\'s own addresses are its canvas and its sessions\' handles', () => {
    expect(ownAddresses(id => `dsh/${id.slice(8, 16)}`, 'team', ['session-aaaaaaaa', undefined, 'session-bbbbbbbb'])).toEqual(['dsh/canvas/team', 'dsh/aaaaaaaa', 'dsh/bbbbbbbb'])
    expect(ownAddresses(undefined, 'team', ['session-aaaaaaaa'])).toEqual([])
  })
})

describe('deciding and sending (O3, O4)', () => {
  it('an approver decides others\' outbound cards with a reason; nobody else, nothing else', () => {
    const card = { source: 'outbound', by: 'session-m' }
    expect(approverCheck({ approvers: ['session-o'], role: 'observer', card, session: 'session-o', reason: '对方是合作团队' })).toEqual({ ok: true, reason: '对方是合作团队' })
    expect(approverCheck({ approvers: [], role: 'observer', card, session: 'session-o', reason: 'r' })).toMatchObject({ code: 'not-approver' })
    expect(approverCheck({ approvers: ['session-r'], role: 'router', card, session: 'session-r', reason: 'r' })).toMatchObject({ code: 'not-approver' })
    expect(approverCheck({ approvers: ['session-o'], role: 'observer', card: { source: 'tool', by: 'member:gitbash' }, session: 'session-o', reason: 'r' })).toMatchObject({ code: 'card' })
    expect(approverCheck({ approvers: ['session-m'], role: 'member', card, session: 'session-m', reason: 'r' })).toMatchObject({ code: 'own' })
    expect(approverCheck({ approvers: ['session-o'], role: 'observer', card, session: 'session-o', reason: ' ' })).toMatchObject({ code: 'reason' })
  })
  it('approved: the exact text goes out under a header; declined: nothing goes out; unreachable: the ticket is told', async () => {
    const sent = book()
    sent.out.waiting('c1', 't1', 'dsh/canvas/other', '原文', 'session-m')
    expect(await sent.out.decided('c1', true, 'team', () => '调研')).toBe('direct-out000001')
    expect(sent.ask).toHaveBeenCalledWith('dsh/canvas/other', '[来自 superagent 团队 team 的请求 · 工单「调研」]\n原文')
    expect(sent.out.list()[0]).toMatchObject({ state: 'sent', task: 'direct-out000001' })
    expect(await sent.out.decided('c1', true, 'team', () => '调研')).toBeUndefined()
    const declined = book()
    declined.out.waiting('c2', 't1', 'dsh/canvas/other', '原文', 'session-m')
    await declined.out.decided('c2', false, 'team', () => '调研')
    expect(declined.ask).not.toHaveBeenCalled()
    expect(declined.out.list()[0]!.state).toBe('declined')
    expect(declined.note.mock.calls[0]![1]).toContain('未获批准')
    const lost = book(vi.fn(async () => undefined))
    lost.out.waiting('c3', 't1', 'dsh/canvas/other', '原文', 'session-m')
    await lost.out.decided('c3', true, 'team', () => '调研')
    expect(lost.out.list()[0]!.state).toBe('failed')
    expect(lost.note.mock.calls[0]![1]).toContain('没能发出')
  })
})

describe('the answer (O5)', () => {
  it('the other team\'s receipt with a trusted proof reaches the ticket as a note; an untrusted one does not', async () => {
    const { out, note } = book()
    out.waiting('c1', 't1', 'dsh/canvas/other', '原文', 'session-m')
    await out.decided('c1', true, 'team', () => '调研')
    note.mockClear()
    const receipt = (proof: string) => ({ id: 'r', source: 'a2a', threads: [], actor: { source: 'a2a', id: 'dsh/canvas/other' }, human: false, at: now(), text: '[A2A receipt] task direct-out000001 数据在附件里', meta: { receiptFor: 'direct-out000001', proof } }) as never
    out.received(receipt('unbound'))
    expect(note).not.toHaveBeenCalled()
    out.received(receipt('cli-identity'))
    expect(note).toHaveBeenCalledWith('t1', expect.stringContaining('数据在附件里'))
    expect(out.list()[0]).toMatchObject({ state: 'answered' })
  })
})

describe('approvers in the settings (O3)', () => {
  it('lists session ids, at most ten; an empty list clears it; changing it needs the owner', () => {
    expect(parseSettings({ approvers: ['session-0123abcd-ef'] }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { approvers: ['session-0123abcd-ef'] } })
    expect(parseSettings({ approvers: ['dsh/0123abcd'] }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    const set = parseSettings({ approvers: ['session-0123abcd-ef'] }, DEFAULT_SETTINGS) as { settings: typeof DEFAULT_SETTINGS }
    expect((parseSettings({ approvers: [] }, set.settings) as { settings: { approvers?: unknown } }).settings.approvers).toBeUndefined()
    expect(touchesRules({ approvers: [] })).toBe(true)
  })
})

describe('the whole way, on a team (O1–O5)', () => {
  it('a member asks, a non-approver and the asker cannot decide, an approver approves, it is sent, the receipt comes back', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const calls: string[][] = []
    const presets: Record<string, string> = { 'session-o': 'superagent-observer' }
    const h = new SuperagentHost({
      canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', 'session-o'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-out-host-')), logger: { info: () => {}, warn: () => {} },
      deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id], handleOf: (id: string) => `dsh/${id}`, homeUrl: () => 'http://127.0.0.1:1',
      runCli: async (args: string[]) => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : args[0] === 'route' ? JSON.stringify({ task_id: 'direct-out000002' }) : '{}' },
    } as never)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, approvers: ['session-o'] }, () => true)).toMatchObject({ ok: true })
    h.start()
    const asked = h.request('需要对方团队的数据') as { triggerId: string }
    h.pass()
    const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '数据', scope: 's', reason: 'r', member: 'session-m' } as never) as { ticket_id: string }).ticket_id
    await vi.waitFor(() => { expect(h.executor.list().find(b => b.ticketId === ticket)?.member).toBeDefined() })
    const holder = h.executor.list().find(b => b.ticketId === ticket)!.member
    expect(h.requestOutbound(holder, { ticket_id: ticket, address: 'dsh/canvas/team', text: 'x', why: 'w' })).toMatchObject({ code: 'own' })
    const raised = h.requestOutbound(holder, { ticket_id: ticket, address: 'dsh/canvas/other', text: '请给我们接口数据', why: '工单要用' }) as { ok: boolean; card_id: string }
    expect(raised.ok).toBe(true)
    expect(h.decisionCards().find(c => c.id === raised.card_id)).toMatchObject({ source: 'outbound', level: 'P0' })
    const other = holder === 'session-m' ? 'session-o' : 'session-m'
    // The asker is no approver of its own card; a session not on the list is none at all.
    expect(h.approverDecide(holder, raised.card_id, OUTBOUND_APPROVE, '我自己批')).toMatchObject({ ok: false })
    if (other === 'session-m') expect(h.approverDecide('session-m', raised.card_id, OUTBOUND_APPROVE, 'r')).toMatchObject({ code: 'not-approver' })
    if (holder === 'session-o') { await h.stop(); return }
    expect(h.approverDecide('session-o', raised.card_id, OUTBOUND_APPROVE, '对方是合作团队')).toMatchObject({ ok: true, approved: true })
    await vi.waitFor(() => { expect(calls.some(a => a[0] === 'route' && a[1] === 'dsh/canvas/other')).toBe(true) })
    const route = calls.find(a => a[0] === 'route')!
    expect(route.at(-1)).toContain('请给我们接口数据')
    expect(route.at(-1)).toContain('[来自 superagent 团队 team 的请求')
    await vi.waitFor(() => { expect((h.state().outbound as Array<{ state: string }>)[0]!.state).toBe('sent') })
    expect(h.approverDecide('session-o', raised.card_id, OUTBOUND_DECLINE, 'r')).toMatchObject({ ok: false })
    await h.stop()
  })
})
