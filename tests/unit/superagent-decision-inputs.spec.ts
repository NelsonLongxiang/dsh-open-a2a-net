// @vitest-environment node
/** #888 v3 phase one (D1–D3): options that need the owner to fill something in. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DecisionPush } from '../../src/superagent/host/decision-push.ts'
import { inputFor, needsInput, parseDecision, recommendedNeedsInput, type DecisionSpec } from '../../src/superagent/host/decisions.ts'

const sha = (c: string): string => c.repeat(64)
const ref = (c: string): string => `[A2A file] v1 sha256=${sha(c)} size=3 name=a.txt from=http://127.0.0.1:3084`
const base = { options: ['甲', '乙'], recommended: '甲', level: 'P3' }
const withInputs = (inputs: unknown, over: Record<string, unknown> = {}) => parseDecision({ ...base, ...over, inputs })

async function team(extra: Record<string, unknown> = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem, registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-inputs-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, ...extra,
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
  const raise = (inputs: DecisionSpec['inputs'], level: DecisionSpec['level'] = 'P3', recommended = '甲') =>
    (h.proposeDecision('router', 'session-r', `问题 ${Math.random()}`, { level, options: ['甲', '乙'], recommended, ...(inputs !== undefined ? { inputs } : {}) }) as { id: string }).id
  return { h, call, openTicket, raise }
}

describe('D1: inputs on a card are checked, and the flags are derived', () => {
  it('a valid input is kept; {} and absent mean none', () => {
    expect(withInputs({ 乙: { kind: 'text', prompt: ' 写原因 ' } })).toMatchObject({ inputs: { 乙: { kind: 'text', prompt: '写原因' } } })
    expect(withInputs({})).not.toHaveProperty('inputs')
    expect(withInputs(undefined)).not.toHaveProperty('inputs')
  })
  it('refuses arrays, non-objects, prototype keys, unknown options, bad kinds and bad prompts', () => {
    expect(typeof withInputs([])).toBe('string')
    expect(typeof withInputs('x')).toBe('string')
    expect(typeof withInputs(JSON.parse('{"__proto__":{"kind":"text","prompt":"p"}}'))).toBe('string')
    expect(typeof withInputs({ 丙: { kind: 'text', prompt: 'p' } })).toBe('string')
    expect(typeof withInputs({ 乙: { kind: 'image', prompt: 'p' } })).toBe('string')
    expect(typeof withInputs({ 乙: { kind: 'text', prompt: '  ' } })).toBe('string')
    expect(typeof withInputs({ 乙: { kind: 'text', prompt: 'x'.repeat(301) } })).toBe('string')
    expect(typeof withInputs({ 乙: { kind: 'text', prompt: 'a\nb' } })).toBe('string')
    expect(typeof withInputs({ 乙: { kind: 'text', prompt: 'a\tb' } })).toBe('object')
    expect(typeof withInputs({ 乙: [] })).toBe('string')
    // An option may itself be called constructor: it still cannot be an inputs key.
    expect(typeof parseDecision({ options: ['constructor', '乙'], recommended: '乙', inputs: { constructor: { kind: 'text', prompt: 'p' } } })).toBe('string')
  })
  it('needsInput and recommendedNeedsInput are derived from inputs alone', () => {
    const card = withInputs({ 乙: { kind: 'file', prompt: 'p' } }) as DecisionSpec
    expect(needsInput(card)).toBe(true)
    expect(recommendedNeedsInput(card)).toBe(false)
    expect(recommendedNeedsInput({ ...card, recommended: '乙' })).toBe(true)
    expect(needsInput({})).toBe(false)
  })
})

describe('D2: who may put inputs on a card', () => {
  it('host-fixed cards refuse inputs; the router may set them', async () => {
    const m = await team()
    const book = (m.h as unknown as { decisions: { propose(i: unknown): { ok: boolean; code?: string } } }).decisions
    expect(book.propose({ source: 'health', by: 'health', question: 'q', at: '2026-11-24T00:00:00Z', spec: { level: 'P2', options: ['甲', '乙'], recommended: '甲', inputs: { 乙: { kind: 'text', prompt: 'p' } } } })).toMatchObject({ ok: false, code: 'inputs' })
    expect(await m.call('superagent_decision_propose', 'session-r', { question: '选哪个？', options: ['甲', '乙'], recommended: '甲', reason: 'r', inputs: { 乙: { kind: 'text', prompt: '写原因' } } })).toMatchObject({ ok: true })
    expect(m.h.decisionCards()[0]).toMatchObject({ inputs: { 乙: { kind: 'text', prompt: '写原因' } } })
    expect(m.h.decisionCards()[0]).not.toHaveProperty('needsInput')
    await m.h.stop()
  })
  it('a member: inputs need a question, malformed inputs are refused, valid ones reach the ticket card', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'progress', summary: 's', inputs: { 乙: { kind: 'text', prompt: 'p' } } })).toMatchObject({ ok: false, code: 'inputs' })
    expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'waiting', summary: 's', question: '要哪个？', ...base, inputs: { 丙: { kind: 'text', prompt: 'p' } } })).toMatchObject({ ok: false, code: 'decision' })
    expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'waiting', summary: 's', question: '要哪个？', ...base, inputs: { 乙: { kind: 'file', prompt: '附合同' } } })).toMatchObject({ ok: true })
    expect(m.h.decisionCards().find(c => c.source === 'ticket')).toMatchObject({ ticketId: ticket, inputs: { 乙: { kind: 'file', prompt: '附合同' } } })
    await m.h.stop()
  })
})

describe('D3: an option that needs input is chosen only with it', () => {
  it('text needs words; file needs a file; text+file needs both', async () => {
    const m = await team()
    const t = m.raise({ 乙: { kind: 'text', prompt: '写原因' } })
    expect(m.h.decide(t, 'choose', '乙')).toMatchObject({ ok: false, code: 'needs-input' })
    expect(m.h.decide(t, 'choose', '乙', '   ')).toMatchObject({ ok: false, code: 'needs-input' })
    const f = m.raise({ 乙: { kind: 'file', prompt: '附件' } })
    expect(m.h.decide(f, 'choose', '乙', '只写字')).toMatchObject({ ok: false, code: 'needs-input' })
    expect(m.h.decide(f, 'choose', '乙', undefined, [ref('a')])).toMatchObject({ ok: true })
    const b = m.raise({ 乙: { kind: 'text+file', prompt: '都要' } })
    expect(m.h.decide(b, 'choose', '乙', '原因')).toMatchObject({ ok: false, code: 'needs-input' })
    expect(m.h.decide(b, 'choose', '乙', undefined, [ref('b')])).toMatchObject({ ok: false, code: 'needs-input' })
    expect(m.h.decide(b, 'choose', '乙', '原因', [ref('b')])).toMatchObject({ ok: true })
    expect(m.h.decide(t, 'choose', '甲')).toMatchObject({ ok: true })
    await m.h.stop()
  })
  it('the decided text keeps 决定：<option> as its first line', async () => {
    const m = await team()
    const t = m.raise({ 乙: { kind: 'text', prompt: '写原因' } })
    expect(m.h.decide(t, 'choose', '乙', '因为便宜')).toMatchObject({ ok: true })
    const text = (m.h as unknown as { decisions: { get(id: string): { decided?: { text: string } } | undefined } }).decisions.get(t)!.decided!.text
    expect(text.split('\n')[0]).toBe('决定：乙')
    expect(text).toContain('因为便宜')
    await m.h.stop()
  })
  it('one click: refused when the recommendation needs input, even with words; P1 still says needs-choice first', async () => {
    const m = await team()
    const r = m.raise({ 甲: { kind: 'text', prompt: 'p' } })
    expect(m.h.decide(r, 'approve', undefined, '写了')).toMatchObject({ ok: false, code: 'needs-input' })
    const p1 = m.raise({ 甲: { kind: 'text', prompt: 'p' } }, 'P1')
    expect(m.h.decide(p1, 'approve')).toMatchObject({ ok: false, code: 'needs-choice' })
    const other = m.raise({ 乙: { kind: 'text', prompt: 'p' } })
    expect(m.h.decide(other, 'approve')).toMatchObject({ ok: true })
    await m.h.stop()
  })
  it('the owner\'s own free-text decision (no option) stays open on a card with inputs', async () => {
    const m = await team()
    const t = m.raise({ 乙: { kind: 'text', prompt: 'p' } })
    expect(m.h.decide(t, 'choose', undefined, '都不选，改做丙')).toMatchObject({ ok: true })
    await m.h.stop()
  })
  it('an approver cannot choose an option that needs input', async () => {
    const m = await team()
    const t = m.raise({ 乙: { kind: 'text', prompt: 'p' } })
    expect(m.h.approverDecide('session-m', t, '乙', '理由')).toMatchObject({ ok: false, code: 'needs-input' })
    await m.h.stop()
  })
  it('words over 20 000 characters are refused', async () => {
    const m = await team()
    const t = m.raise(undefined)
    expect(m.h.decide(t, 'choose', '乙', 'x'.repeat(20_001))).toMatchObject({ ok: false, code: 'text' })
    await m.h.stop()
  })
  it('a file input must still be on the file channel', async () => {
    const m = await team({ blobExists: (s: string) => s === sha('a') })
    const f = m.raise({ 乙: { kind: 'file', prompt: '附件' } })
    expect(m.h.decide(f, 'choose', '乙', undefined, [ref('f')])).toMatchObject({ ok: false, code: 'needs-input' })
    expect(m.h.decide(f, 'choose', '乙', undefined, [ref('a')])).toMatchObject({ ok: true })
    await m.h.stop()
  })
  it('the workbench plain-text answer is refused for a question with inputs; the question stays open', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'waiting', summary: 's', question: '要哪个？', ...base, inputs: { 乙: { kind: 'text', prompt: 'p' } } })).toMatchObject({ ok: true })
    expect(m.h.answer(ticket, '选乙')).toMatchObject({ ok: false, code: 'needs-input' })
    expect(m.h.store.tickets.get(ticket)!.attention).toBeDefined()
    await m.h.stop()
  })
  it('#929: a question with inputs names its card, and an option answers it with the owner\'s words', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'waiting', summary: 's', question: '要哪个？', ...base, inputs: { 乙: { kind: 'text', prompt: 'p' } } })).toMatchObject({ ok: true })
    const refused = m.h.answer(ticket, '选乙') as { ok: boolean; code?: string; card?: string; options?: string[] }
    expect(refused).toMatchObject({ ok: false, code: 'needs-input' })
    expect(typeof refused.card).toBe('string')
    expect(refused.options).toContain('乙')
    // The option alone is not enough for an option that needs words; the card stays open.
    expect(m.h.answer(ticket, '', '乙')).toMatchObject({ ok: false, code: 'needs-input' })
    expect(m.h.answer(ticket, '写错了', '丁')).toMatchObject({ ok: false, code: 'choice' })
    expect(m.h.decisions.get(refused.card!)!.decided).toBeUndefined()
    expect(m.h.answer(ticket, '因为乙更稳', '乙')).toMatchObject({ ok: true, card: refused.card })
    expect(m.h.decisions.get(refused.card!)!.decided!.text).toContain('说明：因为乙更稳')
    await m.h.stop()
  })
  it('#929 owner repro: on a question card where one option needs input, every option can be chosen in the user scope', async () => {
    // One team per scenario: the helper binds the member to one ticket at a time.
    const ask = async () => {
      const m = await team()
      const ticket = await m.openTicket()
      expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'waiting', summary: 's', question: '要哪个？', ...base, inputs: { 乙: { kind: 'text', prompt: 'p' } } })).toMatchObject({ ok: true })
      return { m, ticket, card: (m.h.answer(ticket, 'x') as { card: string }).card }
    }
    // The option that needs no input: before #929 deciding the card failed with the decision-page refusal all the same.
    const a = await ask()
    expect(a.m.h.decide(a.card, 'choose', '甲')).toMatchObject({ ok: true, ticket_id: a.ticket })
    expect(a.m.h.decisions.get(a.card)!.decided!.text).toContain('决定：甲')
    await a.m.h.stop()
    // The option that needs words, by user decide (the words as the note) ...
    const b = await ask()
    expect(b.m.h.decide(b.card, 'choose', '乙', '改两处')).toMatchObject({ ok: true, ticket_id: b.ticket })
    await b.m.h.stop()
    // ... and by user answer --option.
    const c = await ask()
    expect(c.m.h.answer(c.ticket, '', '甲')).toMatchObject({ ok: true, card: c.card })
    await c.m.h.stop()
  })
})

describe('D2: remote members, Pi or DSH', () => {
  const KEY_B = 'MCowBQYDK2VwAyEA' + 'B'.repeat(44)
  it('a malformed question, inputs included, refuses the whole report; inputs need a question; a valid one goes on', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const remote = [{ ref: 'dsh/bbbbbbbb@12345678', key: KEY_B, url: 'http://127.0.0.1:9' }]
    const h = new SuperagentHost({ canvasTeam: (name: string) => name === 'team' ? { local: ['session-r'], remote } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-inputs-remote-')),
      logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {} } as never)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    const report = (r: Record<string, unknown>) => h.remoteEvent('report', 'dsh/bbbbbbbb', KEY_B, { state: 'waiting', summary: 's', ...r })
    expect(report({ question: '哪个？' })).toMatchObject({ ok: false, code: 'decision' })
    expect(report({ question: '哪个？', ...base, inputs: { 丙: { kind: 'text', prompt: 'p' } } })).toMatchObject({ ok: false, code: 'decision' })
    expect(report({ inputs: { 乙: { kind: 'text', prompt: 'p' } } })).toMatchObject({ ok: false, code: 'inputs' })
    expect(report({ question: '哪个？', ...base, inputs: { 乙: { kind: 'text', prompt: 'p' } } })).toMatchObject({ ok: false, code: 'not-assigned' })
    void h.stop()
  })
})

describe('D4: a card with inputs is not pushed to the market in phase one', () => {
  it('skipped without a refusal (no false health problem); a card without inputs still queues', () => {
    let kept: { pending: unknown[]; refused: Record<string, unknown> } = { pending: [], refused: {} }
    const push = new DecisionPush({ on: () => true, team: () => ({ canvas: 'team', address: 'dsh/canvas/team' }), remotes: () => [], declares: () => false, send: async () => {}, hostFingerprint: () => undefined,
      holds: () => true, load: () => undefined, save: k => { kept = JSON.parse(JSON.stringify(k)) }, nowMs: () => 1_700_000_000_000, logger: { warn: () => {}, info: () => {} } })
    const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, question: '用哪个？', source: 'observer', by: 'session-o', at: '2026-11-24T00:00:00Z', level: 'P2', options: ['甲', '乙'], recommended: '甲', reason: 'r', ...extra }) as never
    push.noted('created', card('d-in', { inputs: { 乙: { kind: 'text', prompt: 'p' } } }))
    expect(kept.pending).toHaveLength(0)
    expect(kept.refused).toEqual({})
    push.noted('created', card('d-plain'))
    expect(kept.pending).toHaveLength(1)
    expect(kept.refused).toEqual({})
  })
})

describe('D4: a ticket question with inputs stays on this host', () => {
  it('state() marks the question; choicesOf offers no options to a remote requester', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'waiting', summary: 's', question: '要哪个？', ...base, inputs: { 乙: { kind: 'text', prompt: 'p' } } })).toMatchObject({ ok: true })
    const row = ((m.h.state() as { tickets: Array<{ id: string; attention?: { needsInput?: boolean } }> }).tickets).find(t => t.id === ticket)!
    expect(row.attention).toMatchObject({ question: '要哪个？', needsInput: true })
    expect(m.h.choicesOf(ticket)).toBeUndefined()
    await m.h.stop()
  })
  it('a plain question is unchanged: no flag, choices offered', async () => {
    const m = await team()
    const ticket = await m.openTicket()
    expect(await m.call('a2a_ticket_report', 'session-m', { ticket_id: ticket, state: 'waiting', summary: 's', question: '要哪个？', ...base })).toMatchObject({ ok: true })
    const row = ((m.h.state() as { tickets: Array<{ id: string; attention?: { needsInput?: boolean } }> }).tickets).find(t => t.id === ticket)!
    expect(row.attention).not.toHaveProperty('needsInput')
    expect(m.h.choicesOf(ticket)).toEqual({ options: ['甲', '乙'], recommended: '甲' })
    await m.h.stop()
  })
})

describe('#892 review follow-up: inputs read only as own keys of a plain object', () => {
  it('R02: a Date or a Map as inputs refuses the whole card (not read as "no inputs")', () => {
    expect(typeof withInputs(new Date())).toBe('string')
    expect(typeof withInputs(new Map([['乙', { kind: 'text', prompt: 'p' }]]))).toBe('string')
    // A null-prototype object is still a plain record.
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { 乙: { kind: 'text', prompt: 'p' } })
    expect(withInputs(bare)).toMatchObject({ inputs: { 乙: { kind: 'text', prompt: 'p' } } })
  })
  it('R08/R09: a recommended option called constructor is not taken for an inherited input', () => {
    const card = parseDecision({ options: ['constructor', '乙'], recommended: 'constructor', level: 'P3', inputs: { 乙: { kind: 'text', prompt: 'p' } } }) as DecisionSpec
    expect(needsInput(card)).toBe(true)
    expect(recommendedNeedsInput(card)).toBe(false)
    expect(inputFor(card, 'constructor')).toBeUndefined()
    expect(inputFor(card, 'toString')).toBeUndefined()
    expect(inputFor(card, '乙')).toEqual({ kind: 'text', prompt: 'p' })
  })
  it('R08/R09 on the host: such a card is still one click and its constructor option needs no words', async () => {
    const m = await team()
    const spec = parseDecision({ options: ['constructor', '乙'], recommended: 'constructor', level: 'P3', inputs: { 乙: { kind: 'text', prompt: 'p' } } }) as DecisionSpec
    const a = (m.h.proposeDecision('router', 'session-r', '一键？', spec) as { id: string }).id
    expect(m.h.decide(a, 'approve')).toMatchObject({ ok: true })
    const b = (m.h.proposeDecision('router', 'session-r', '选项？', spec) as { id: string }).id
    expect(m.h.decide(b, 'choose', 'constructor')).toMatchObject({ ok: true })
    await m.h.stop()
  })
})
