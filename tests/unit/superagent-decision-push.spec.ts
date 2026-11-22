// @vitest-environment node
/** T8 step 1: the router's and observer's decision cards go to the market on the roster's route (envelope v1). */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DECISION_CARD_HEADER, PUSH_TICK_MS, marketClean, decideAt, decidedOption, decisionCardText, finalRefusal, pushedSource } from '../../src/superagent/host/decision-push.ts'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'
import { problemText } from '../../src/superagent/host/health-reminders.ts'
import { formatFileRef } from '../../src/blob-store.ts'

const SHA = 'a'.repeat(64)
const bodyOf = (text: string) => JSON.parse(text.split('\n').slice(1).join('\n'))
/** Verify card.id and decide_at match cardId, then strip them so a random UUID containing digits like '4242' cannot false-positive a leak check. */
const envelopeWithoutCardId = (envelope: string, cardId: string): string => {
  const lines = envelope.split('\n')
  expect(lines).toHaveLength(2)
  expect(lines[0]).toBe(DECISION_CARD_HEADER)
  const body = JSON.parse(lines[1]!) as { decide_at: string; card: { id: string; [k: string]: unknown }; [k: string]: unknown }
  expect(body.card.id).toBe(cardId)
  expect(body.decide_at).toBe(decideAt(cardId))
  const { decide_at: _decideAt, card: { id: _id, ...restCard }, ...restBody } = body
  return `${lines[0]}\n${JSON.stringify({ ...restBody, card: restCard })}`
}

const card = (over: Record<string, unknown> = {}) => ({ id: 'd-1', question: '用哪个？', source: 'observer', by: 'session-o', at: '2026-11-20T00:00:00Z', level: 'P1', options: ['甲', '乙'], recommended: '甲', reason: 'r', ...over }) as never

describe('T8: the envelope', () => {
  it('first line exactly the header, then one JSON object with metadata only', () => {
    const out = decisionCardText('created', 1, 'dsh/canvas/ops', card({ files: [{ name: 'a.md', size: 3, sha256: SHA, path: '/secret/a.md', ref: 'r' }] }))
    expect(out.ok).toBe(true)
    const [first, ...rest] = (out as { text: string }).text.split('\n')
    expect(first).toBe(DECISION_CARD_HEADER)
    const body = JSON.parse(rest.join('\n'))
    expect(body).toMatchObject({ event: 'created', rev: 1, decide_at: '/__dsh_a2a_nexus/?tab=team&view=decisions&card=d-1', card: { id: 'd-1', team: 'dsh/canvas/ops', proposer_kind: 'observer', level: 'P1', options: ['甲', '乙'], recommended: '甲', reason: 'r', created_at: '2026-11-20T00:00:00Z' } })
    expect(body.card.files).toEqual([{ name: 'a.md', size: 3, sha256: SHA }])
    expect(JSON.stringify(body)).not.toContain('/secret')
  })
  it('only the router\'s and the observer\'s own cards go; a member\'s question on a ticket and the host\'s own cards never', () => {
    expect(pushedSource('router')).toBe(true)
    expect(pushedSource('observer')).toBe(true)
    for (const source of ['ticket', 'health', 'tool', 'outbound', 'staffing', 'sender']) expect(pushedSource(source as never)).toBe(false)
  })
  it('the card id is encoded in decide_at (a colon would be refused there)', () => {
    expect(decideAt('ticket:1')).toBe('/__dsh_a2a_nexus/?tab=team&view=decisions&card=ticket%3A1')
  })
  it('the market\'s limits: nothing half-formed is sent', () => {
    expect(decisionCardText('created', 1, 't', card({ id: 'bad id' })).ok).toBe(false)
    expect(decisionCardText('created', 1, 't', card({ options: ['甲'] })).ok).toBe(false)
    expect(decisionCardText('created', 1, 't', card({ options: ['甲', '甲'] })).ok).toBe(false)
    expect(decisionCardText('created', 1, 't', card({ question: 'x'.repeat(2001) })).ok).toBe(false)
    expect(decisionCardText('created', 1, 't', card({ files: Array.from({ length: 17 }, (_, i) => ({ name: String(i), size: 1, sha256: 'x' })) })).ok).toBe(false)
  })
  it('a decided card names the chosen option, read from the stored decision', () => {
    expect(decidedOption('决定：乙\n说明：好', ['甲', '乙'])).toBe('乙')
    expect(decidedOption('说明：只写了话', ['甲', '乙'])).toBe('')
    const out = decisionCardText('decided', 2, 't', card({ decided: { at: '2026-11-20T01:00:00Z', text: '决定：乙' } }))
    expect(bodyOf((out as { text: string }).text).card).toMatchObject({ decided_at: '2026-11-20T01:00:00Z', decided_option: '乙' })
  })
  it('#766 review 1: a decision in words only goes as decided_option null, never an empty string', () => {
    const out = decisionCardText('decided', 2, 't', card({ decided: { at: '2026-11-20T01:00:00Z', text: '说明：只写了话' } }))
    expect(out.ok).toBe(true)
    expect(bodyOf((out as { text: string }).text).card.decided_option).toBeNull()
  })
  it('#766 review 2: a reason or a file name over the market\'s limit is cut and sent; the rest of its limits stop the card here', () => {
    const long = decisionCardText('created', 1, 't', card({ reason: '理'.repeat(2500), files: [{ name: 'n'.repeat(300) + '.md', size: 1, sha256: SHA }] }))
    expect(long.ok).toBe(true)
    const c = bodyOf((long as { text: string }).text).card
    expect(c.reason).toHaveLength(2000)
    expect(c.reason.endsWith('…')).toBe(true)
    expect(c.files[0].name).toHaveLength(200)
    const no = (over: Record<string, unknown>, event: 'created' | 'decided' = 'created') => decisionCardText(event, 1, 't', card(over)).ok
    expect(no({ options: ['甲', '乙'.repeat(301)], recommended: '甲' })).toBe(false)
    expect(no({ options: ['甲', ' '], recommended: '甲' })).toBe(false)
    expect(no({ recommended: '丙' })).toBe(false)
    expect(no({ recommended: undefined })).toBe(false)
    expect(no({ level: 'P9' })).toBe(false)
    expect(no({ question: '   ' })).toBe(false)
    expect(no({ at: 'yesterday' })).toBe(false)
    expect(no({ files: [{ name: 'a', size: 1, sha256: 'x'.repeat(64) }] })).toBe(false)
    expect(no({ files: [{ name: 'a', size: -1, sha256: SHA }] })).toBe(false)
    expect(no({}, 'decided'), 'a decided event without a decision').toBe(false)
  })
  it('#766 follow-up: options are compared as the market cleans them — a direction control never makes two options distinct', () => {
    expect(marketClean('\u202e甲\u200e ')).toBe('甲')
    expect(decisionCardText('created', 1, 't', card({ options: ['甲', '\u202e甲'], recommended: '甲' }))).toEqual({ ok: false, why: 'options must be 2..6 and distinct' })
    expect(decisionCardText('created', 1, 't', card({ options: ['甲', '\u2066\u2069'], recommended: '甲' })).ok).toBe(false)
    expect(decisionCardText('created', 1, 't', card({ recommended: '\u200e甲' })).ok).toBe(true)
    expect(decisionCardText('created', 1, 't', card({ question: '\u202e\u0001 ' })).ok).toBe(false)
  })
  it('#766 follow-up: a cut never splits an emoji', () => {
    const out = decisionCardText('created', 1, 't', card({ reason: '😀'.repeat(1500), files: [{ name: '😀'.repeat(150), size: 1, sha256: SHA }] }))
    const c = bodyOf((out as { text: string }).text).card
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const text of [c.reason as string, c.files[0].name as string]) {
      expect(lone.test(text)).toBe(false)
      expect(text.endsWith('…')).toBe(true)
    }
    expect((c.reason as string).length).toBeLessThanOrEqual(2000)
    expect((c.files[0].name as string).length).toBeLessThanOrEqual(200)
  })
  it('#766 review N12: a body over 32KB is never sent', () => {
    // Real text with control characters between (each one is six bytes of JSON) stays inside every field limit.
    const wide = (head: string, n: number) => head + '\u0001'.repeat(n - 1)
    const options = ['甲', '乙', '丙', '丁', '戊', '己'].map(h => wide(h, 300))
    const files = Array.from({ length: 16 }, (_, i) => ({ name: wide(String.fromCharCode(97 + i), 200), size: 1, sha256: SHA }))
    const out = decisionCardText('created', 1, 't', card({ question: wide('问', 2000), reason: wide('理', 2000), options, recommended: options[0], files }))
    expect(out).toEqual({ ok: false, why: 'body over 32KB' })
  })
  it('the refusals that would repeat are final; a transport failure is not', () => {
    for (const e of ['HTTP 400', 'HTTP 401', 'HTTP 403', 'HTTP 429 too-many-waiting', 'decision-card-invalid']) expect(finalRefusal(new Error(e))).toBe(true)
    expect(finalRefusal(new Error('ECONNREFUSED'))).toBe(false)
  })
  it('a status code decides when the error carries one; a bare number in the text never does', () => {
    expect(finalRefusal(Object.assign(new Error('x'), { statusCode: 403 }))).toBe(true)
    expect(finalRefusal(Object.assign(new Error('HTTP 400'), { statusCode: 503 }))).toBe(false)
    expect(finalRefusal(new Error('socket closed after 400 bytes'))).toBe(false)
    expect(finalRefusal(new Error('delivery failed on every candidate: A2A HTTP 401: {"error":"untrusted-origin"}'))).toBe(true)
  })
})

describe('T8: on the host', () => {
  const T0 = Date.parse('2026-11-20T08:00:00Z')
  async function team(o: { home?: string; send?: (ref: string, text: string) => void; push?: boolean; clock?: { ms: number }; intervals?: Array<{ ms: number; disposed: boolean }> } = {}) {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const home = o.home ?? mkdtempSync(join(tmpdir(), 'sa-push-'))
    const clock = o.clock ?? { ms: T0 }
    const sent: Array<[string, string]> = []
    const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-o': 'superagent-observer' }
    const h = new SuperagentHost({
      canvasTeam: (name: string) => name === 'ops' ? { local: ['session-r', 'session-m', 'session-o'], remote: [{ ref: 'market/abcdef0123456789@deadbeef', slots: 1 }, { ref: 'plain/0123456789abcdef@cafebabe', slots: 1 }] } : undefined, home, logger: { info: () => {}, warn: () => {} },
      deliverToSession: () => true, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id], sessionLoaded: () => true, bootSettled: () => true,
      interval: (_fn: () => void, ms: number) => { const t = { ms, disposed: false }; o.intervals?.push(t); return () => { t.disposed = true } },
      now: () => new Date(clock.ms).toISOString(),
      handleOf: (id: string) => `dsh/${id.slice(8, 16)}`, memberDeclares: (ref: string, cap: string) => cap === 'teamRoster' && ref.startsWith('market/'), hostFingerprint: () => 'abcdef0123456789',
      rosterSend: async (ref: string, text: string) => { o.send?.(ref, text); sent.push([ref, text]) },
    } as never)
    expect(h.saveSettings({ canvas: 'ops', router: 'session-r', ...(o.push !== false ? { decisionPush: true } : {}) }, () => true, id => presets[id])).toMatchObject({ ok: true })
    const bodies = () => sent.map(([, t]) => bodyOf(t) as { event: string; rev: number; card: { id: string; team: string; proposer_kind: string; decided_option?: string | null } })
    const refusedProblems = () => h.health().filter(p => p.code === 'decision-push-refused')
    return { h, sent, bodies, home, clock, refusedProblems }
  }
  const spec = { level: 'P2' as const, options: ['甲', '乙'], recommended: '甲' }

  it('the router\'s and observer\'s cards go — raised, then decided, with growing revisions; others never go; only to a teamRoster member', async () => {
    const m = await team()
    const observerCard = m.h.proposeDecision('observer', 'session-o', '观察者的问题', spec, '理由') as { id: string }
    m.h.proposeDecision('router', 'session-r', '总工的问题', spec, '理由')
    await m.h.decisionPush.tick()
    expect(m.bodies().map(b => [b.event, b.card.proposer_kind, b.card.team])).toEqual([['created', 'observer', 'dsh/canvas/ops'], ['created', 'router', 'dsh/canvas/ops']])
    // N6: the remote that does not declare teamRoster never gets a card.
    expect(m.sent.every(([ref, text]) => ref === 'market/abcdef0123456789@deadbeef' && text.startsWith(`${DECISION_CARD_HEADER}\n`))).toBe(true)
    const first = m.bodies()[0]!.rev
    expect(m.h.decide(observerCard.id, 'choose', '乙')).toMatchObject({ ok: true })
    await m.h.decisionPush.tick()
    expect(m.bodies().at(-1)).toMatchObject({ event: 'decided', card: { id: observerCard.id, decided_option: '乙' } })
    expect(m.bodies().at(-1)!.rev).toBeGreaterThan(first)
    expect(m.h.decisionPush.pending()).toEqual([])
    await m.h.stop()
  })

  it('#771 review: the owner\'s files on a decision never leave the host — the decided envelope names none of them', async () => {
    const m = await team()
    const OWNER_SHA = 'f'.repeat(64)
    const c = m.h.proposeDecision('observer', 'session-o', '问题', spec, '理由') as { id: string }
    const ref = formatFileRef({ sha256: OWNER_SHA, size: 4242, name: 'OWNER-SECRET-合同.pdf', from: 'http://127.0.0.1:1' })
    expect(m.h.decide(c.id, 'choose', '乙', '附上合同', [ref])).toMatchObject({ ok: true })
    await m.h.decisionPush.tick()
    const decided = m.sent.map(([, t]) => t).find(t => bodyOf(t).event === 'decided')!
    expect(decided).toBeDefined()
    const checked = envelopeWithoutCardId(decided, c.id)
    for (const leak of [OWNER_SHA, 'OWNER-SECRET', encodeURIComponent('OWNER-SECRET-合同.pdf'), '4242', '附上合同', '127.0.0.1']) expect(checked, leak).not.toContain(leak)
    // The proposer's own files (none on this card) are the only files the envelope may carry.
    expect(bodyOf(decided).card.files).toEqual([])
    await m.h.stop()
  })

  it('#771 review regression: a card id containing 4242 never false-positives the owner-file leak check', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-push-4242-'))
    const FIXED_ID = 'd-00004242-0000-4000-8000-000000000000'
    const OWNER_SHA = 'f'.repeat(64)
    mkdirSync(join(home, 'superagent'), { recursive: true })
    writeFileSync(join(home, 'superagent', 'decisions.json'), JSON.stringify([
      { id: FIXED_ID, question: '问题', reason: '理由', source: 'observer', by: 'session-o', at: new Date(T0).toISOString(), ...spec },
    ]))
    const m = await team({ home })
    const ref = formatFileRef({ sha256: OWNER_SHA, size: 4242, name: 'OWNER-SECRET-合同.pdf', from: 'http://127.0.0.1:1' })
    expect(m.h.decide(FIXED_ID, 'choose', '乙', '附上合同', [ref])).toMatchObject({ ok: true })
    await m.h.decisionPush.tick()
    const decided = m.sent.map(([, t]) => t).find(t => bodyOf(t).event === 'decided')!
    expect(decided).toBeDefined()
    expect(decided).toContain(FIXED_ID)
    const checked = envelopeWithoutCardId(decided, FIXED_ID)
    for (const leak of [OWNER_SHA, 'OWNER-SECRET', encodeURIComponent('OWNER-SECRET-合同.pdf'), '4242', '附上合同', '127.0.0.1']) expect(checked, leak).not.toContain(leak)
    expect(bodyOf(decided).card.files).toEqual([])
    await m.h.stop()
  })

  it('N7: a withdrawn card goes as dropped', async () => {
    const m = await team()
    const c = m.h.proposeDecision('observer', 'session-o', '问题', spec, 'r') as { id: string }
    ;(m.h as unknown as { decisions: { withdraw: (id: string) => void } }).decisions.withdraw(c.id)
    await m.h.decisionPush.tick()
    expect(m.bodies().map(b => [b.event, b.card.id])).toEqual([['created', c.id], ['dropped', c.id]])
    await m.h.stop()
  })

  it('#766 review 5: off by default — nothing is queued, kept on disk or sent; turning it on is a rule change', async () => {
    const m = await team({ push: false })
    m.h.proposeDecision('observer', 'session-o', '问题', spec, 'r')
    await m.h.decisionPush.tick()
    expect(m.sent).toEqual([])
    expect(m.h.decisionPush.pending()).toEqual([])
    expect(existsSync(join(m.home, 'superagent', 'decision-push.json'))).toBe(false)
    expect(touchesRules({ decisionPush: true })).toBe(true)
    expect(m.h.saveSettings({ decisionPush: 'on' } as never, () => true)).toMatchObject({ ok: false })
    await m.h.stop()
  })

  it('#766 follow-up (P2): turning the push off drops what waits and what was refused; nothing old goes out when it is turned on again', async () => {
    let refuse = true
    const m = await team({ send: () => { if (refuse) throw Object.assign(new Error('A2A HTTP 400'), { statusCode: 400 }) } })
    m.h.proposeDecision('observer', 'session-o', '被拒的', spec, 'r')
    await m.h.decisionPush.tick()
    expect(m.refusedProblems()).toHaveLength(1)
    refuse = false
    m.sent.length = 0
    m.h.proposeDecision('observer', 'session-o', '排着的', spec, 'r')
    expect(m.h.decisionPush.pending()).toHaveLength(1)
    expect(m.h.saveSettings({ decisionPush: false }, () => true)).toMatchObject({ ok: true })
    await m.h.decisionPush.tick()
    expect(m.sent).toEqual([])
    expect(m.h.decisionPush.pending()).toEqual([])
    expect(m.refusedProblems()).toEqual([])
    expect(m.h.saveSettings({ decisionPush: true }, () => true)).toMatchObject({ ok: true })
    await m.h.decisionPush.tick()
    expect(m.sent).toEqual([])
    expect(m.refusedProblems()).toEqual([])
    await m.h.stop()
  })

  it('#767 review (R11): what turning the push off drops is dropped on disk too — a restart reads back nothing to send', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-push-off-'))
    const m = await team({ home, send: () => { throw new Error('ECONNREFUSED') } })
    m.h.proposeDecision('observer', 'session-o', '排着的', spec, 'r')
    await m.h.decisionPush.tick()
    expect(m.h.decisionPush.pending()).toHaveLength(1)
    expect(m.h.saveSettings({ decisionPush: false }, () => true)).toMatchObject({ ok: true })
    await m.h.decisionPush.tick()
    await m.h.stop()
    const n = await team({ home })
    expect(n.h.decisionPush.pending()).toEqual([])
    await n.h.decisionPush.tick()
    expect(n.sent).toEqual([])
    expect(n.refusedProblems()).toEqual([])
    await n.h.stop()
  })

  it('a transport failure keeps the event for the next tick; the outbox survives a restart', async () => {
    let mode: 'down' | 'up' = 'down'
    const home = mkdtempSync(join(tmpdir(), 'sa-push-retry-'))
    const m = await team({ home, send: () => { if (mode === 'down') throw new Error('ECONNREFUSED') } })
    m.h.proposeDecision('observer', 'session-o', '问题一', spec, 'r')
    await m.h.decisionPush.tick()
    expect(m.h.decisionPush.pending()).toHaveLength(1)
    expect(m.refusedProblems()).toEqual([])
    await m.h.stop()
    const n = await team({ home })
    mode = 'up'
    await n.h.decisionPush.tick()
    expect(n.bodies().map(b => b.event)).toEqual(['created'])
    await n.h.stop()
  })

  it('#766 review 3: a market refusal is a health problem for the observer, once per card, cleared when the card later goes through', async () => {
    let refuse = true
    const m = await team({ send: () => { if (refuse) throw Object.assign(new Error('A2A HTTP 400: decision-card-invalid'), { statusCode: 400 }) } })
    const c = m.h.proposeDecision('observer', 'session-o', '问题', spec, 'r') as { id: string }
    await m.h.decisionPush.tick()
    expect(m.h.decisionPush.pending()).toEqual([])
    expect(m.refusedProblems()).toMatchObject([{ code: 'decision-push-refused', title: `ops/${c.id}` }])
    expect(problemText(m.refusedProblems()[0] as never)).toContain('没有推到市场')
    refuse = false
    expect(m.h.decide(c.id, 'choose', '乙')).toMatchObject({ ok: true })
    await m.h.decisionPush.tick()
    expect(m.refusedProblems()).toEqual([])
    await m.h.stop()
  })

  it('#766 review 2+3: a card this host cannot shape for the market is a problem too; it clears once the host no longer holds the card', async () => {
    const m = await team()
    const c = m.h.proposeDecision('observer', 'session-o', '问题', spec, 'r') as { id: string }
    const book = (m.h as unknown as { decisions: { get: (id: string) => unknown; decide: (...a: unknown[]) => void } }).decisions
    // A decided event whose decision carries no time: refused here, never sent.
    const real = book.get.bind(book)
    vi.spyOn(book, 'get').mockImplementation((id: string) => { const card = real(id) as Record<string, unknown> | undefined; return card === undefined ? card : { ...card, decided: { at: 'not-a-time', text: '决定：乙' } } })
    m.h.decisionPush.noted('decided', book.get(c.id) as never)
    expect(m.refusedProblems()).toMatchObject([{ code: 'decision-push-refused', detail: 'a decided event with no decision time' }])
    vi.spyOn(book, 'get').mockReturnValue(undefined)
    expect(m.refusedProblems()).toEqual([])
    await m.h.stop()
  })

  it('#766 review 4 (N5): revisions never go back — a restart reads them, and a lost state file starts from the clock', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-push-rev-'))
    const clock = { ms: T0 }
    const m = await team({ home, clock })
    const c = m.h.proposeDecision('observer', 'session-o', '问题', spec, 'r') as { id: string }
    await m.h.decisionPush.tick()
    const created = m.bodies()[0]!.rev
    await m.h.stop()
    // Same clock after a restart: the stored revision is read, so the next one is higher (N5).
    const n = await team({ home, clock })
    expect(n.h.decide(c.id, 'choose', '乙')).toMatchObject({ ok: true })
    await n.h.decisionPush.tick()
    expect(n.bodies()[0]!.rev).toBeGreaterThan(created)
    const decided = n.bodies()[0]!.rev
    await n.h.stop()
    // The state file is lost; a second later the next event is still newer than anything the market holds.
    expect(existsSync(join(home, 'superagent', 'decision-push.json'))).toBe(true)
    rmSync(join(home, 'superagent', 'decision-push.json'))
    clock.ms += 1000
    const k = await team({ home, clock })
    k.h.decisionPush.noted('dropped', (k.h as unknown as { decisions: { get: (id: string) => unknown } }).decisions.get(c.id) as never)
    await k.h.decisionPush.tick()
    expect(k.bodies()[0]!.rev).toBeGreaterThan(decided)
    await k.h.stop()
  })

  it('N8: stopping the host stops the push timer', async () => {
    const intervals: Array<{ ms: number; disposed: boolean }> = []
    const m = await team({ intervals })
    m.h.start()
    const push = intervals.filter(t => t.ms === PUSH_TICK_MS)
    expect(push.length).toBeGreaterThan(0)
    await m.h.stop()
    expect(push.every(t => t.disposed)).toBe(true)
  })

  it('#772: the decision\'s own text never reaches the envelope — no 决定：/说明： lines, no file reference, no from= address', async () => {
    const m = await team()
    const c = m.h.proposeDecision('observer', 'session-o', '问题', spec, '理由') as { id: string }
    const ref = formatFileRef({ sha256: 'e'.repeat(64), size: 77, name: 'owner-only.pdf', from: 'http://host.invalid:1' })
    expect(m.h.decide(c.id, 'choose', '乙', 'NOTE-TEXT 只给团队看', [ref])).toMatchObject({ ok: true })
    await m.h.decisionPush.tick()
    const decided = m.sent.map(([, t]) => t).find(t => bodyOf(t).event === 'decided')!
    for (const leak of ['决定：', '说明：', 'NOTE-TEXT', '[A2A file]', 'from=', 'host.invalid', 'owner-only', 'e'.repeat(64)]) expect(decided, leak).not.toContain(leak)
    expect(bodyOf(decided).card).toMatchObject({ decided_option: '乙', files: [] })
    await m.h.stop()
  })
})
