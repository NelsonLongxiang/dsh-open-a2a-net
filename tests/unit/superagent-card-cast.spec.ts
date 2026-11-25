// @vitest-environment node
/** Observer phase 2 (T5-A): the observer casts a card into its own team's sessions; the a2a side checks who may. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function team(o: { observerCast?: boolean; service?: boolean; queue?: boolean; home?: string; clock?: { ms: number } } = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-o': 'superagent-observer' }
  const casts: Array<{ sessionId: string; templateId: string; reason: string; basis?: string }> = []
  const sent: Array<[string, string]> = []
  const withdrawn: Array<{ sessionId: string; id: string }> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', 'session-o'], remote: [] } : undefined, home: o.home ?? mkdtempSync(join(tmpdir(), 'sa-cast-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
    ...(o.clock !== undefined ? { now: () => new Date(o.clock!.ms).toISOString() } : {}),
    ...(o.queue === true ? { castQueue: () => ({
      list: (f: { sessionId?: string }) => ({ ok: true, items: [{ id: 'q1', session_id: 'session-m', state: 'waiting', basis: 'none: a' }, { id: 'q2', session_id: 'session-elsewhere', state: 'waiting', basis: 'none: b' }].filter(r => f.sessionId === undefined || r.session_id === f.sessionId) }),
      withdraw: (i: { sessionId: string; id: string }) => { withdrawn.push(i); return { ok: true, withdrawn: i.id === 'q1' && i.sessionId === 'session-m' } },
    }) } : {}),
    ...(o.service === false ? {} : { castCard: (input: { sessionId: string; templateId: string; reason: string }) => { casts.push(input); return input.templateId === 'dup' ? { ok: false, code: 'already-queued', error: 'x' } : { ok: true, queued: 1 } } }),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', ...(o.observerCast === true ? { observerCast: true } : {}) }, () => true, id => presets[id])).toMatchObject({ ok: true })
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const cast = async (as: string, args: Record<string, unknown>) => await registered.get('a2a_card_cast')!.execute(args, { agent: { id: as }, signal: new AbortController().signal })
  const queue = async (as: string, args: Record<string, unknown>) => await registered.get('a2a_card_queue')!.execute(args, { agent: { id: as }, signal: new AbortController().signal })
  return { h, cast, queue, casts, sent, withdrawn }
}

describe('T5-A: a2a_card_cast', () => {
  it('a plain member (or the router) is refused, whatever it passes; nothing reaches the plugin', async () => {
    const m = await team({ observerCast: true })
    expect(await m.cast('session-m', { session_id: 'session-r', template_id: 't', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: false, code: 'not-observer' })
    expect(await m.cast('session-r', { session_id: 'session-m', template_id: 't', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: false, code: 'not-observer' })
    expect(m.casts).toEqual([])
    await m.h.stop()
  })
  it('is off until the owner turns observerCast on', async () => {
    const m = await team()
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 't', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: false, code: 'off' })
    expect(m.casts).toEqual([])
    expect(m.h.saveSettings({ observerCast: 'yes' } as never, () => true)).toMatchObject({ ok: false })
    await m.h.stop()
  })
  it('casts only into another session of the observer\'s own team, and wakes it', async () => {
    const m = await team({ observerCast: true })
    expect(await m.cast('session-o', { session_id: 'session-elsewhere', template_id: 't', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: false, code: 'not-in-team' })
    expect(await m.cast('session-o', { session_id: 'session-o', template_id: 't', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: false, code: 'not-in-team' })
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: '', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: false, code: 'template' })
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 'atelier-action-review', reason: '卡在验收', basis: 'none: test' })).toEqual({ ok: true, mode: 'insert', queued: 1, woken: true, wake: 'sent', basis: 'none: test' })
    expect(m.casts).toEqual([{ sessionId: 'session-m', templateId: 'atelier-action-review', reason: '卡在验收', basis: 'none: test' }])
    expect(m.sent.some(([id, text]) => id === 'session-m' && text.startsWith('[superagent card]'))).toBe(true)
    // The plugin's refusal comes back as is, and no wake follows it.
    const woken = m.sent.length
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 'dup', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: false, code: 'already-queued' })
    expect(m.sent.length).toBe(woken)
    await m.h.stop()
  })
  it('without the plugin\'s cast service it answers available: false', async () => {
    const m = await team({ observerCast: true, service: false })
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 't', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: true, available: false })
    await m.h.stop()
  })
  it('#764 review: per target, 3 casts an hour (4th refused before the plugin), one wake per 15 minutes, kept across a restart', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-cast-limit-'))
    const clock = { ms: Date.parse('2026-11-20T00:00:00Z') }
    const m = await team({ observerCast: true, home, clock })
    const wakes = () => m.sent.filter(([id, t]) => id === 'session-m' && t.startsWith('[superagent card]')).length
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 'a', reason: 'r', basis: 'none: test' })).toEqual({ ok: true, mode: 'insert', queued: 1, woken: true, wake: 'sent', basis: 'none: test' })
    clock.ms += 5 * 60_000
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 'b', reason: 'r', basis: 'none: test' })).toEqual({ ok: true, mode: 'insert', queued: 1, woken: false, wake: 'none', basis: 'none: test' })
    expect(wakes()).toBe(1)
    await m.h.stop()
    // Restart: the counts carry on.
    const n = await team({ observerCast: true, home, clock })
    clock.ms += 5 * 60_000
    expect(await n.cast('session-o', { session_id: 'session-m', template_id: 'c', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: true, woken: false })
    clock.ms += 5 * 60_000
    expect(await n.cast('session-o', { session_id: 'session-m', template_id: 'd', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: false, code: 'rate-limited' })
    expect(n.casts.map(c => c.templateId)).toEqual(['c'])
    // Another target has its own budget; and after the hour the first target casts (and wakes) again.
    expect(await n.cast('session-o', { session_id: 'session-r', template_id: 'e', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: true, woken: true })
    clock.ms += 61 * 60_000
    expect(await n.cast('session-o', { session_id: 'session-m', template_id: 'f', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: true, woken: true })
    await n.h.stop()
  })

  it('#902 S1: every cast names its basis — a ticket of this team, an event, or none with a sentence', async () => {
    const m = await team({ observerCast: true })
    ;(m.h as unknown as { store: { tickets: { list: () => Array<{ id: string }> } } }).store.tickets.list = () => [{ id: 'abcdef0123456789' }, { id: 'abcdef01ffffffff' }, { id: '99887766aabbccdd' }]
    const go = (basis: string) => m.cast('session-o', { session_id: 'session-m', template_id: `t-${basis.length}-${Math.random()}`, reason: 'r', basis })
    expect(await go('')).toMatchObject({ ok: false, code: 'basis' })
    expect(await go('because')).toMatchObject({ ok: false, code: 'basis' })
    expect(await go('ticket:nope-not-ours')).toMatchObject({ ok: false, code: 'basis' })
    expect(await go('ticket:abcdef01')).toMatchObject({ ok: false, code: 'basis' }) // two tickets start so
    expect(await go(`none: ${'x'.repeat(200)}`)).toMatchObject({ ok: false, code: 'basis' })
    expect(await go('ticket: 99887766')).toMatchObject({ ok: true, basis: 'ticket:99887766aabbccdd' })
    // #907 review B1: an event basis names a trigger this team recorded; an unknown one is refused.
    ;(m.h as unknown as { store: { triggers: { get: (id: string) => unknown } } }).store.triggers.get = (id: string) => (id === 'ev-42' ? { id } : undefined)
    expect(await go('event:ev-unknown')).toMatchObject({ ok: false, code: 'basis' })
    expect(await go('event:ev-42')).toMatchObject({ ok: true, basis: 'event:ev-42' })
    expect(await go('none:\n浏览中发现卡在验收')).toMatchObject({ ok: true, basis: 'none: 浏览中发现卡在验收' })
    expect(m.casts.map(c => c.basis)).toEqual(['ticket:99887766aabbccdd', 'event:ev-42', 'none: 浏览中发现卡在验收'])
    await m.h.stop()
  })
  it('#902 S1: a2a_card_queue lists only this team\'s rows and withdraws only through the observer', async () => {
    const m = await team({ observerCast: true, queue: true })
    expect(await m.queue('session-m', {})).toMatchObject({ ok: false, code: 'not-observer' })
    const all = await m.queue('session-o', {})
    expect(all).toEqual({ ok: true, items: [{ id: 'q1', session_id: 'session-m', state: 'waiting', basis: 'none: a', legacy: true }], releases: [] })
    expect(await m.queue('session-o', { session_id: 'session-elsewhere' })).toMatchObject({ ok: false, code: 'not-in-team' })
    expect(await m.queue('session-o', { action: 'withdraw', session_id: 'session-m' })).toMatchObject({ ok: false, code: 'input' })
    // #907 review B2: a row from before origins is the owner's to withdraw, not the observer's.
    expect(await m.queue('session-o', { action: 'withdraw', session_id: 'session-m', id: 'q1' })).toMatchObject({ ok: false, code: 'legacy' })
    expect(m.h.ownerCastQueue({ action: 'withdraw', session_id: 'session-m', id: 'q1' })).toEqual({ ok: true, withdrawn: true })
    expect(m.withdrawn).toEqual([{ sessionId: 'session-m', id: 'q1' }])
    await m.h.stop()
    const old = await team({ observerCast: true })
    expect(await old.queue('session-o', {})).toMatchObject({ ok: true, available: false })
    await old.h.stop()
  })
})
