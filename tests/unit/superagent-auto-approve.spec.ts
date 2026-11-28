// @vitest-environment node
/** #888 v3 D5 phase one: the host takes the recommendation of an eligible router or observer card on the owner's setting. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AUTO_APPROVE_DEFAULT, DEFAULT_SETTINGS, armAutoApprove, parseSettings, parseStoredSettings } from '../../src/superagent/host/policy.ts'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'
import type { DecisionSpec } from '../../src/superagent/host/decisions.ts'

const T0 = Date.parse('2026-11-24T10:00:00Z')
const MIN = 60_000
const on = (over: Record<string, unknown> = {}) => ({ enabled: true, levels: ['P3'], sources: ['router', 'observer'], afterMinutes: 30, perHour: 10, ...over })
const p3 = (over: Partial<DecisionSpec> = {}): DecisionSpec => ({ level: 'P3', options: ['甲', '乙'], recommended: '甲', ...over })

async function team(deliver: (id: string, text: string) => boolean = () => true, home = mkdtempSync(join(tmpdir(), 'sa-auto-'))) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const clock = { t: T0 }
  const sent: Array<[string, string]> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', 'session-o'], remote: [] } : undefined, home, logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return deliver(id, text) }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
    now: () => new Date(clock.t).toISOString(),
  } as never)
  return { h, clock, sent, home }
}
const book = (h: unknown) => (h as { decisions: { get(id: string): Record<string, any> | undefined; autoApproveRecord(id: string, at: string, m: number, d: string): boolean } }).decisions
const notes = (sent: Array<[string, string]>) => sent.filter(([, t]) => t.startsWith('[superagent decision]'))

describe('D5 settings', () => {
  it('parses with the owner\'s defaults, refuses what is out of range or not yet supported, and ignores a requested armedAt', () => {
    const ok = parseSettings({ autoApprove: { enabled: true, armedAt: '2000-01-01T00:00:00Z' } }, DEFAULT_SETTINGS)
    expect(ok).toMatchObject({ ok: true, settings: { autoApprove: { ...AUTO_APPROVE_DEFAULT, enabled: true } } })
    expect((ok as { settings: { autoApprove: Record<string, unknown> } }).settings.autoApprove).not.toHaveProperty('armedAt')
    for (const bad of [{ levels: ['P1'] }, { levels: ['P3', 'P3'] }, { sources: ['ticket', 'ticket'] }, { sources: ['health'] }, { afterMinutes: 14 }, { afterMinutes: 30.5 }, { perHour: 61 }, { enabled: 'yes' }])
      expect(parseSettings({ autoApprove: on(bad) }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ autoApprove: null }, { ...DEFAULT_SETTINGS, autoApprove: on() as never })).toMatchObject({ ok: true })
    expect((parseSettings({ autoApprove: null }, { ...DEFAULT_SETTINGS, autoApprove: on() as never }) as { settings: object }).settings).not.toHaveProperty('autoApprove')
  })
  it('is an owner-only field', () => {
    expect(touchesRules({ autoApprove: { enabled: true } })).toBe(true)
  })
  it('armAutoApprove: turning on and every widening restamp; tightening keeps; off drops the stamp', () => {
    const base = { ...on(), armedAt: '2026-11-24T09:00:00.000Z' } as never
    const now = '2026-11-24T10:00:00.000Z'
    expect(armAutoApprove(undefined, on() as never, now)).toMatchObject({ armedAt: now })
    expect(armAutoApprove({ ...(base as object), enabled: false } as never, on() as never, now)).toMatchObject({ armedAt: now })
    for (const wider of [{ levels: ['P2', 'P3'] }, { afterMinutes: 15 }, { perHour: 11 }]) expect(armAutoApprove(base, on(wider) as never, now)).toMatchObject({ armedAt: now })
    expect(armAutoApprove({ ...(base as object), sources: ['router'] } as never, on() as never, now)).toMatchObject({ armedAt: now })
    for (const tighter of [{ sources: ['router'] }, { afterMinutes: 60 }, { perHour: 5 }, {}]) expect(armAutoApprove(base, on(tighter) as never, now)).toMatchObject({ armedAt: '2026-11-24T09:00:00.000Z' })
    expect(armAutoApprove(base, on({ enabled: false }) as never, now)).not.toHaveProperty('armedAt')
  })
  it('the stored stamp is restored; switched on without a valid stamp loads switched off', () => {
    expect(parseStoredSettings({ autoApprove: { ...on(), armedAt: '2026-11-24T09:00:00.000Z' } })).toMatchObject({ ok: true, settings: { autoApprove: { enabled: true, armedAt: '2026-11-24T09:00:00.000Z' } } })
    expect(parseStoredSettings({ autoApprove: on() })).toMatchObject({ ok: true, settings: { autoApprove: { enabled: false } } })
    expect(parseStoredSettings({ autoApprove: { ...on(), armedAt: 'not a time' } })).toMatchObject({ ok: true, settings: { autoApprove: { enabled: false } } })
  })
})

describe('D5 on the host', () => {
  it('the host stamps armedAt on save (a requested one is ignored) and a backlog waits from it', async () => {
    const m = await team()
    expect(m.h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    const old = (m.h.proposeDecision('router', 'session-r', '旧卡', p3()) as { id: string }).id
    m.clock.t = T0 + 120 * MIN
    expect(m.h.saveSettings({ autoApprove: { ...on(), armedAt: '2000-01-01T00:00:00Z' } }, () => true)).toMatchObject({ ok: true })
    expect(m.h.settings.autoApprove?.armedAt).toBe(new Date(T0 + 120 * MIN).toISOString())
    m.h.pass()
    expect(book(m.h).get(old)!.decided).toBeUndefined()
    m.clock.t = T0 + 150 * MIN
    m.h.pass()
    expect(book(m.h).get(old)!.decided.text.split('\n')[0]).toBe('决定：甲')
    await m.h.stop()
  })
  it('takes an eligible card after the wait: record, decision, host note; no request, no ticket, not the owner\'s word', async () => {
    const m = await team()
    expect(m.h.saveSettings({ canvas: 'team', router: 'session-r', autoApprove: on() }, () => true)).toMatchObject({ ok: true })
    const request = vi.spyOn(m.h, 'request')
    const id = (m.h.proposeDecision('router', 'session-r', '要不要升级？', p3()) as { id: string }).id
    m.clock.t = T0 + 29 * MIN; m.h.pass()
    expect(book(m.h).get(id)!.decided).toBeUndefined()
    m.clock.t = T0 + 30 * MIN; m.h.pass()
    const card = book(m.h).get(id)!
    expect(card.autoApproved).toMatchObject({ by: 'host', rule: 'auto-approve', minutes: 30, deliveredAt: expect.any(String) })
    expect(card.decided.at).toBe(card.autoApproved.at)
    expect(card.decided.text.split('\n')[0]).toBe('决定：甲')
    expect(request).not.toHaveBeenCalled()
    expect(m.h.store.tickets.list()).toHaveLength(0)
    const [[to, text]] = notes(m.sent)
    expect(to).toBe('session-r')
    expect(text).toContain('非属主本人')
    expect(text).toContain(card.autoApproved.deliveryId)
    // Still on the panel for the owner, who may decide again: that is the owner's own decision.
    expect(m.h.decisionCards().map(c => c.id)).toContain(id)
    expect(m.h.decide(id, 'choose', '乙')).toMatchObject({ ok: true })
    expect(request).toHaveBeenCalledTimes(1)
    m.h.pass()
    expect(notes(m.sent)).toHaveLength(1)
    await m.h.stop()
  })
  it('an automatic decision is not final: the same question may be asked again', async () => {
    const m = await team()
    m.h.saveSettings({ canvas: 'team', router: 'session-r', autoApprove: on() }, () => true)
    m.h.proposeDecision('router', 'session-r', '同一个问题', p3())
    m.clock.t = T0 + 30 * MIN; m.h.pass()
    expect(m.h.proposeDecision('router', 'session-r', '同一个问题', p3())).toMatchObject({ ok: true })
    await m.h.stop()
  })
  it('skips what is not eligible: a level or source not listed, P0/P1, an input on any option, while paused, while off', async () => {
    const m = await team()
    m.h.saveSettings({ canvas: 'team', router: 'session-r', autoApprove: on({ sources: ['router'] }) }, () => true)
    const ids = [
      (m.h.proposeDecision('router', 'session-r', 'P2 卡', p3({ level: 'P2' })) as { id: string }).id,
      (m.h.proposeDecision('router', 'session-r', 'P1 卡', p3({ level: 'P1' })) as { id: string }).id,
      (m.h.proposeDecision('observer', 'session-o', '观察者卡', p3()) as { id: string }).id,
      (m.h.proposeDecision('router', 'session-r', '要填写', p3({ inputs: { 乙: { kind: 'text', prompt: 'p' } } })) as { id: string }).id,
    ]
    m.clock.t = T0 + 999 * MIN; m.h.pass()
    for (const id of ids) expect(book(m.h).get(id)!.decided).toBeUndefined()
    const ok = (m.h.proposeDecision('router', 'session-r', '可以批', p3()) as { id: string }).id
    m.h.saveSettings({ paused: true }, () => true)
    m.clock.t += 999 * MIN; m.h.pass()
    expect(book(m.h).get(ok)!.decided).toBeUndefined()
    m.h.saveSettings({ paused: false, autoApprove: on({ enabled: false, sources: ['router'] }) }, () => true)
    m.h.pass()
    expect(book(m.h).get(ok)!.decided).toBeUndefined()
    await m.h.stop()
  })
  it('the hourly cap holds', async () => {
    const m = await team()
    m.h.saveSettings({ canvas: 'team', router: 'session-r', autoApprove: on({ perHour: 1 }) }, () => true)
    const a = (m.h.proposeDecision('router', 'session-r', '一', p3()) as { id: string }).id
    const b = (m.h.proposeDecision('router', 'session-r', '二', p3()) as { id: string }).id
    m.clock.t = T0 + 30 * MIN; m.h.pass(); m.h.pass()
    expect([book(m.h).get(a)!.decided, book(m.h).get(b)!.decided].filter(Boolean)).toHaveLength(1)
    m.clock.t = T0 + 91 * MIN; m.h.pass()
    expect(book(m.h).get(b)!.decided).toBeDefined()
    await m.h.stop()
  })
  it('a note that could not be delivered is sent again with the same delivery id, once', async () => {
    let up = false
    const m = await team(() => up)
    m.h.saveSettings({ canvas: 'team', router: 'session-r', autoApprove: on() }, () => true)
    const id = (m.h.proposeDecision('router', 'session-r', '投递', p3()) as { id: string }).id
    m.clock.t = T0 + 30 * MIN; m.h.pass()
    expect(book(m.h).get(id)!.autoApproved.deliveredAt).toBeUndefined()
    up = true; m.h.pass(); m.h.pass()
    const all = notes(m.sent)
    expect(all).toHaveLength(2)
    expect(all[0]![1]).toBe(all[1]![1])
    expect(book(m.h).get(id)!.autoApproved.deliveredAt).toBeDefined()
    await m.h.stop()
  })
  it('a record written before a stop is decided and told after the restart', async () => {
    const m = await team()
    m.h.saveSettings({ canvas: 'team', router: 'session-r', autoApprove: on() }, () => true)
    const id = (m.h.proposeDecision('router', 'session-r', '重启', p3()) as { id: string }).id
    expect(book(m.h).autoApproveRecord(id, new Date(T0 + 30 * MIN).toISOString(), 30, 'auto-fixed')).toBe(true)
    await m.h.stop()
    const n = await team(() => true, m.home)
    n.h.pass()
    expect(book(n.h).get(id)!.decided.text.split('\n')[0]).toBe('决定：甲')
    expect(notes(n.sent)[0]![1]).toContain('auto-fixed')
    await n.h.stop()
  })
})

describe('#894 review follow-up', () => {
  it('B2: the owner deciding in the same millisecond is the owner\'s decision: it leaves the panel and is final', async () => {
    const m = await team()
    m.h.saveSettings({ canvas: 'team', router: 'session-r', autoApprove: on() }, () => true)
    const id = (m.h.proposeDecision('router', 'session-r', '同毫秒', p3()) as { id: string }).id
    m.clock.t = T0 + 30 * MIN; m.h.pass()
    expect(m.h.decisionCards().map(c => c.id)).toContain(id)
    expect(m.h.decide(id, 'choose', '乙')).toMatchObject({ ok: true })
    expect(book(m.h).get(id)!.decided.at).toBe(book(m.h).get(id)!.autoApproved.at)
    expect(m.h.decisionCards().map(c => c.id)).not.toContain(id)
    expect(m.h.proposeDecision('router', 'session-r', '同毫秒', p3())).toMatchObject({ ok: false, code: 'decided' })
    await m.h.stop()
  })
  it('N1: an automatically taken card leaves the panel after a day', async () => {
    const m = await team()
    m.h.saveSettings({ canvas: 'team', router: 'session-r', autoApprove: on() }, () => true)
    const id = (m.h.proposeDecision('router', 'session-r', '过期', p3()) as { id: string }).id
    m.clock.t = T0 + 30 * MIN; m.h.pass()
    m.clock.t = T0 + 30 * MIN + 24 * 60 * MIN - 1
    expect(m.h.decisionCards().map(c => c.id)).toContain(id)
    m.clock.t = T0 + 30 * MIN + 24 * 60 * MIN + 1
    expect(m.h.decisionCards().map(c => c.id)).not.toContain(id)
    await m.h.stop()
  })
  it('N2: levels and sources are kept in one order', () => {
    expect(parseSettings({ autoApprove: on({ levels: ['P3', 'P2'], sources: ['observer', 'router'] }) }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { autoApprove: { levels: ['P2', 'P3'], sources: ['router', 'observer'] } } })
  })
})
