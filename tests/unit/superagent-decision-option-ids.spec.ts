// @vitest-environment node
/** #923: decision-card options have stable ids; deciding takes the text, the id or the number; options may run to 1,000 characters and reach the market cut to its v1 limit. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { optionIds, parseDecision, resolveOption, type DecisionSpec } from '../../src/superagent/host/decisions.ts'
import { decidedOption, decisionCardText, PUSH_OPTION_MAX } from '../../src/superagent/host/decision-push.ts'

const spec = (level: DecisionSpec['level'] = 'P1'): DecisionSpec => ({ level, options: ['甲', '乙', '丙'], recommended: '乙' })

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const sent: Array<[string, string]> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-optid-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const candidates = () => sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent candidate]')).map(([, t]) => t)
  return { h, candidates }
}

describe('#923 an option by text, id or number', () => {
  const options = ['甲', '乙', '丙']
  it('resolves the exact text first, then o<N>, then the 1-based number', () => {
    expect(resolveOption(options, '乙')).toBe('乙')
    expect(resolveOption(options, ' 乙 ')).toBe('乙')
    expect(resolveOption(options, 'o3')).toBe('丙')
    expect(resolveOption(options, 'O1')).toBe('甲')
    expect(resolveOption(options, '2')).toBe('乙')
    expect(resolveOption(options, 2)).toBe('乙')
    // An option whose text is a number is taken as text before it is taken as a position.
    expect(resolveOption(['3', '1'], '1')).toBe('1')
  })
  it('names nothing outside the card', () => {
    for (const value of ['0', 'o0', '4', 'o4', 4, 0, -1, 1.5, '丁', '', null, undefined, {}]) expect(resolveOption(options, value), String(value)).toBeUndefined()
  })
  it('lists the ids and the recommendation\'s', () => {
    expect(optionIds({ options, recommended: '丙' })).toEqual({ optionIds: ['o1', 'o2', 'o3'], recommendedId: 'o3' })
    expect(optionIds({ options, recommended: '' })).toEqual({ optionIds: ['o1', 'o2', 'o3'] })
  })
})

describe('#923 the owner decides by id or number', () => {
  it('o2 and 2 choose the second option; the decision reads 决定：<its text>', async () => {
    const m = await team()
    const a = m.h.proposeDecision('router', 'session-r', '问 a', spec()) as { id: string }
    expect(m.h.decide(a.id, 'choose', 'o2')).toMatchObject({ ok: true })
    const b = m.h.proposeDecision('router', 'session-r', '问 b', spec()) as { id: string }
    expect(m.h.decide(b.id, 'choose', '3')).toMatchObject({ ok: true })
    m.h.pass()
    await vi.waitFor(() => {
      expect(m.candidates().some(t => t.includes('问 a') && t.includes('决定：乙'))).toBe(true)
      expect(m.candidates().some(t => t.includes('问 b') && t.includes('决定：丙'))).toBe(true)
    })
    await m.h.stop()
  })
  it('refuses an id or number not on the card, and says how to name one', async () => {
    const m = await team()
    const { id } = m.h.proposeDecision('router', 'session-r', '问', spec()) as { id: string }
    for (const bad of ['o4', '4', '0']) expect(m.h.decide(id, 'choose', bad)).toMatchObject({ ok: false, code: 'choice', error: expect.stringContaining('o1..o3') })
    expect(m.h.decisionCards()).toHaveLength(1)
    await m.h.stop()
  })
})

describe('#923 long options', () => {
  it('a card takes options up to 1,000 characters, not more', () => {
    const long = '长'.repeat(1000)
    expect(parseDecision({ options: [long, '乙'], recommended: long })).toMatchObject({ options: [long, '乙'] })
    expect(parseDecision({ options: [long + '长', '乙'], recommended: '乙' })).toContain('1000')
  })
  it('the market gets them cut to its limit, with the recommendation and the decision mapped by position', () => {
    const a = '甲'.repeat(600), b = '乙'.repeat(600)
    const base = { id: 'd-1', question: '用哪个？', source: 'observer', by: 'session-o', at: '2026-11-20T00:00:00Z', level: 'P1', options: [a, b], recommended: b, reason: 'r' }
    const created = decisionCardText('created', 1, 't', base as never)
    expect(created.ok, JSON.stringify(created)).toBe(true)
    const card = JSON.parse((created as { text: string }).text.split('\n').slice(1).join('\n')).card
    expect(card.options.every((o: string) => o.length <= PUSH_OPTION_MAX && o.endsWith('…'))).toBe(true)
    expect(card.recommended).toBe(card.options[1])
    const decided = decisionCardText('decided', 2, 't', { ...base, decided: { at: '2026-11-20T01:00:00Z', text: `决定：${a}` } } as never)
    expect(JSON.parse((decided as { text: string }).text.split('\n').slice(1).join('\n')).card.decided_option).toBe(card.options[0])
  })
  it('two long options that differ only after the cut are refused, not sent alike', () => {
    const head = '同'.repeat(400)
    const out = decisionCardText('created', 1, 't', { id: 'd-2', question: 'q', source: 'router', by: 'r', at: '2026-11-20T00:00:00Z', level: 'P1', options: [head + '甲', head + '乙'], recommended: head + '甲' } as never)
    expect(out).toMatchObject({ ok: false, why: expect.stringContaining('distinct') })
  })
})

describe('#935 review B1: a decided option that holds line breaks', () => {
  it('reads the whole option from the decision, longest first, old one-line decisions as before', () => {
    expect(decidedOption('决定：甲\n乙', ['甲', '甲\n乙'])).toBe('甲\n乙')
    expect(decidedOption('决定：甲\n说明：想清楚了', ['甲', '甲\n乙'])).toBe('甲')
    expect(decidedOption('决定：乙', ['甲', '乙'])).toBe('乙')
    expect(decidedOption('说明：都不要', ['甲', '乙'])).toBe('')
  })
  it('end to end: a long multi-line option decided by id reaches the market as its cut text, not null', async () => {
    const m = await team()
    const long = `第一行${'长'.repeat(400)}\n第二行${'续'.repeat(100)}`
    const raised = m.h.proposeDecision('router', 'session-r', '选哪个？', { level: 'P1', options: [long, '乙'], recommended: long }) as { id: string }
    expect(m.h.decide(raised.id, 'choose', 'o1')).toMatchObject({ ok: true })
    const stored = m.h.decisions.get(raised.id)!
    const body = (event: 'created' | 'decided') => JSON.parse((decisionCardText(event, 1, 't', stored as never) as { text: string }).text.split('\n').slice(1).join('\n')).card
    const sent = body('created').options[0]
    expect(sent.length).toBeLessThanOrEqual(PUSH_OPTION_MAX)
    expect(body('decided').decided_option).toBe(sent)
    await m.h.stop()
  })
})
