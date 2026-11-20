// @vitest-environment node
/** T8 step 1: the router's and observer's decision cards go to the market on the roster's route (envelope v1). */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DECISION_CARD_HEADER, decideAt, decidedOption, decisionCardText, finalRefusal, pushedSource } from '../../src/superagent/host/decision-push.ts'

const card = (over: Record<string, unknown> = {}) => ({ id: 'd-1', question: '用哪个？', source: 'observer', by: 'session-o', at: '2026-11-20T00:00:00Z', level: 'P1', options: ['甲', '乙'], recommended: '甲', reason: 'r', ...over }) as never

describe('T8: the envelope', () => {
  it('first line exactly the header, then one JSON object with metadata only', () => {
    const out = decisionCardText('created', 1, 'dsh/canvas/ops', card({ files: [{ name: 'a.md', size: 3, sha256: 'x'.repeat(64), path: '/secret/a.md', ref: 'r' }] }))
    expect(out.ok).toBe(true)
    const [first, ...rest] = (out as { text: string }).text.split('\n')
    expect(first).toBe(DECISION_CARD_HEADER)
    const body = JSON.parse(rest.join('\n'))
    expect(body).toMatchObject({ event: 'created', rev: 1, decide_at: '/__dsh_a2a_nexus/?tab=team&view=decisions&card=d-1', card: { id: 'd-1', team: 'dsh/canvas/ops', proposer_kind: 'observer', level: 'P1', options: ['甲', '乙'], recommended: '甲', reason: 'r', created_at: '2026-11-20T00:00:00Z' } })
    expect(body.card.files).toEqual([{ name: 'a.md', size: 3, sha256: 'x'.repeat(64) }])
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
    expect(JSON.parse((out as { text: string }).text.split('\n').slice(1).join('\n')).card).toMatchObject({ decided_at: '2026-11-20T01:00:00Z', decided_option: '乙' })
  })
  it('the refusals that would repeat are final; a transport failure is not', () => {
    for (const e of ['HTTP 400', 'HTTP 401', 'HTTP 403', 'HTTP 429 too-many-waiting', 'decision-card-invalid']) expect(finalRefusal(new Error(e))).toBe(true)
    expect(finalRefusal(new Error('ECONNREFUSED'))).toBe(false)
  })
})

describe('T8: on the host', () => {
  async function team(home = mkdtempSync(join(tmpdir(), 'sa-push-')), send?: (ref: string, text: string) => void) {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const sent: Array<[string, string]> = []
    const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-o': 'superagent-observer' }
    const h = new SuperagentHost({
      canvasTeam: (name: string) => name === 'ops' ? { local: ['session-r', 'session-m', 'session-o'], remote: [{ ref: 'market/abcdef0123456789@deadbeef', slots: 1 }] } : undefined, home, logger: { info: () => {}, warn: () => {} },
      deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
      handleOf: (id: string) => `dsh/${id.slice(8, 16)}`, memberDeclares: (_ref: string, cap: string) => cap === 'teamRoster', hostFingerprint: () => 'abcdef0123456789',
      rosterSend: async (ref: string, text: string) => { send?.(ref, text); sent.push([ref, text]) },
    } as never)
    expect(h.saveSettings({ canvas: 'ops', router: 'session-r' }, () => true, id => presets[id])).toMatchObject({ ok: true })
    const bodies = () => sent.map(([, t]) => JSON.parse(t.split('\n').slice(1).join('\n')) as { event: string; rev: number; card: { id: string; team: string; proposer_kind: string } })
    return { h, sent, bodies, home }
  }

  it('the router\'s and observer\'s cards go — raised, then decided, with growing revisions; others never go', async () => {
    const m = await team()
    const spec = { level: 'P2' as const, options: ['甲', '乙'], recommended: '甲' }
    const observerCard = m.h.proposeDecision('observer', 'session-o', '观察者的问题', spec, '理由') as { id: string }
    m.h.proposeDecision('router', 'session-r', '总工的问题', spec, '理由')
    await m.h.decisionPush.tick()
    expect(m.bodies().map(b => [b.event, b.rev, b.card.proposer_kind, b.card.team])).toEqual([['created', 1, 'observer', 'dsh/canvas/ops'], ['created', 1, 'router', 'dsh/canvas/ops']])
    expect(m.sent.every(([ref, text]) => ref === 'market/abcdef0123456789@deadbeef' && text.startsWith(`${DECISION_CARD_HEADER}\n`))).toBe(true)
    expect(m.h.decide(observerCard.id, 'choose', '乙')).toMatchObject({ ok: true })
    await m.h.decisionPush.tick()
    expect(m.bodies().at(-1)).toMatchObject({ event: 'decided', rev: 2, card: { id: observerCard.id, decided_option: '乙' } })
    expect(m.h.decisionPush.pending()).toEqual([])
    await m.h.stop()
  })

  it('a transport failure keeps the event for the next tick; a final refusal drops it; the outbox survives a restart', async () => {
    let mode: 'down' | 'refuse' | 'up' = 'down'
    const home = mkdtempSync(join(tmpdir(), 'sa-push-retry-'))
    const m = await team(home, () => { if (mode === 'down') throw new Error('ECONNREFUSED'); if (mode === 'refuse') throw new Error('HTTP 403 team not bound') })
    const spec = { level: 'P2' as const, options: ['甲', '乙'], recommended: '甲' }
    m.h.proposeDecision('observer', 'session-o', '问题一', spec, 'r')
    await m.h.decisionPush.tick()
    expect(m.h.decisionPush.pending()).toHaveLength(1)
    await m.h.stop()
    // Restart: the event is still waiting, and its revision is kept.
    const n = await team(home, () => { if (mode === 'refuse') throw new Error('HTTP 403 team not bound') })
    mode = 'up'
    await n.h.decisionPush.tick()
    expect(n.bodies().map(b => [b.event, b.rev])).toEqual([['created', 1]])
    mode = 'refuse'
    n.h.proposeDecision('observer', 'session-o', '问题二', spec, 'r')
    await n.h.decisionPush.tick()
    expect(n.h.decisionPush.pending()).toEqual([])
    await n.h.stop()
  })
})
