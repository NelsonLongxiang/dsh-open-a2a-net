// @vitest-environment node
/** #902 S3: the observer's cast modes — queue (next turn, no wake), trigger (only while idle) and release (on a condition). */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type Ticket = { id: string; ended?: { outcome: string }; delivery?: unknown; attention?: unknown; assignments: Array<{ id: string; state: string; report?: { state: string } }> }

async function team(o: { home?: string; clock: { ms: number }; busy: Record<string, boolean | undefined>; tickets?: Ticket[]; noBusy?: boolean }) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-o': 'superagent-observer' }
  const casts: Array<{ sessionId: string; templateId: string; mode?: string }> = []
  const sent: Array<[string, string]> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', 'session-o'], remote: [] } : undefined, home: o.home ?? mkdtempSync(join(tmpdir(), 'sa-rel-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
    now: () => new Date(o.clock.ms).toISOString(),
    ...(o.noBusy === true ? {} : { sessionBusy: (id: string) => o.busy[id] }),
    castCapabilities: () => ({ modes: ['insert', 'queue'], origin: true, confirmedDelivery: true }),
    castCard: (input: { sessionId: string; templateId: string; mode?: string }) => { casts.push(input); return { ok: true, queued: 1, id: `c${String(casts.length)}` } },
    castQueue: () => ({ list: () => ({ ok: true, items: [] }), withdraw: () => ({ ok: true, withdrawn: false }) }),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', observerCast: true }, () => true, id => presets[id])).toMatchObject({ ok: true })
  const tickets = o.tickets ?? []
  const store = (h as unknown as { store: { tickets: { list: () => Ticket[]; get: (id: string) => Ticket | undefined } } }).store
  store.tickets.list = () => tickets
  store.tickets.get = (id: string) => tickets.find(t => t.id === id)
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const run = (name: string) => async (args: Record<string, unknown>) => await registered.get(name)!.execute(args, { agent: { id: 'session-o' }, signal: new AbortController().signal })
  const wakes = (id: string) => sent.filter(([s, t]) => s === id && t.startsWith('[superagent card]')).length
  return { h, cast: run('a2a_card_cast'), queue: run('a2a_card_queue'), casts, wakes }
}

const base = { session_id: 'session-m', template_id: 't', reason: 'r', basis: 'none: test' }

describe('#902 S3: cast modes', () => {
  it('queue: handed to the plugin as queue, and the target is not woken', async () => {
    const m = await team({ clock: { ms: Date.parse('2026-11-25T00:00:00Z') }, busy: { 'session-m': true } })
    expect(await m.cast({ ...base, mode: 'queue' })).toMatchObject({ ok: true, mode: 'queue', woken: false })
    expect(m.casts.at(-1)).toMatchObject({ sessionId: 'session-m', mode: 'queue' })
    expect(m.wakes('session-m')).toBe(0)
    expect(await m.cast({ ...base, mode: 'later' })).toMatchObject({ ok: false, code: 'mode' })
    await m.h.stop()
  })
  it('trigger: only into an idle member, never the router, at most once per 30 minutes; it wakes', async () => {
    const clock = { ms: Date.parse('2026-11-25T00:00:00Z') }
    const busy: Record<string, boolean | undefined> = { 'session-m': true, 'session-r': false }
    const m = await team({ clock, busy })
    expect(await m.cast({ ...base, session_id: 'session-r', mode: 'trigger' })).toMatchObject({ ok: false, code: 'trigger-router' })
    expect(await m.cast({ ...base, mode: 'trigger' })).toMatchObject({ ok: false, code: 'busy' })
    busy['session-m'] = undefined
    expect(await m.cast({ ...base, mode: 'trigger' })).toMatchObject({ ok: false, code: 'busy' }) // not live here: not idle either
    expect(m.casts).toEqual([])
    busy['session-m'] = false
    expect(await m.cast({ ...base, mode: 'trigger' })).toMatchObject({ ok: true, mode: 'trigger', woken: true })
    expect(m.casts.at(-1)).toMatchObject({ mode: 'queue' })
    expect(m.wakes('session-m')).toBe(1)
    clock.ms += 20 * 60_000
    expect(await m.cast({ ...base, mode: 'trigger' })).toMatchObject({ ok: false, code: 'trigger-limited' })
    clock.ms += 11 * 60_000
    expect(await m.cast({ ...base, mode: 'trigger' })).toMatchObject({ ok: true, woken: true })
    await m.h.stop()
  })
  it('trigger on a host that cannot tell idle answers available: false', async () => {
    const m = await team({ clock: { ms: Date.parse('2026-11-25T00:00:00Z') }, busy: {}, noBusy: true })
    expect(await m.cast({ ...base, mode: 'trigger' })).toMatchObject({ ok: true, available: false })
    expect(m.casts).toEqual([])
    await m.h.stop()
  })
})

describe('#902 S3: releases', () => {
  it('checks the cast and the condition when armed; nothing reaches the plugin until it fires', async () => {
    const m = await team({ clock: { ms: Date.parse('2026-11-25T00:00:00Z') }, busy: {}, tickets: [{ id: 'aaaabbbbccccdddd', assignments: [] }] })
    const arm = (extra: Record<string, unknown>) => m.cast({ ...base, mode: 'release', ...extra })
    expect(await arm({ when: 'soon' })).toMatchObject({ ok: false, code: 'when' })
    expect(await arm({ when: 'idle:5' })).toMatchObject({ ok: false, code: 'when' })
    expect(await arm({ when: 'ticket:zzzz0000 idle' })).toMatchObject({ ok: false, code: 'when' })
    expect(await arm({ when: 'ticket:aaaabbbb sleeping' })).toMatchObject({ ok: false, code: 'when' })
    expect(await arm({ when: 'at:2026-11-25T00:01:00Z' })).toMatchObject({ ok: false, code: 'when' })
    expect(await arm({ when: 'at:2026-11-26T06:00:00Z' })).toMatchObject({ ok: false, code: 'when' }) // past the 24h expiry
    expect(await arm({ when: 'idle:10', then: 'shout' })).toMatchObject({ ok: false, code: 'then' })
    expect(await arm({ when: 'idle:10', expires_hours: 200 })).toMatchObject({ ok: false, code: 'expires' })
    expect(await arm({ when: 'idle:10', basis: '' })).toMatchObject({ ok: false, code: 'basis' })
    expect(await arm({ when: 'ticket:aaaabbbb person:review' })).toMatchObject({ ok: true, mode: 'release', when: 'ticket:aaaabbbbccccdddd person:review', then: 'insert' })
    expect(m.casts).toEqual([])
    await m.h.stop()
  })
  it('at most 5 armed per session; an armed one is withdrawn by its id and never fires', async () => {
    const clock = { ms: Date.parse('2026-11-25T00:00:00Z') }
    const m = await team({ clock, busy: {} })
    const ids: string[] = []
    for (let i = 0; i < 5; i += 1) ids.push(String((await m.cast({ ...base, mode: 'release', when: 'at:2026-11-25T01:00:00Z' })).release))
    expect(await m.cast({ ...base, mode: 'release', when: 'at:2026-11-25T01:00:00Z' })).toMatchObject({ ok: false, code: 'full' })
    expect(await m.queue({ action: 'withdraw', id: ids[0] })).toEqual({ ok: true, withdrawn: true })
    expect(await m.queue({ action: 'withdraw', id: ids[0] })).toEqual({ ok: true, withdrawn: false, state: 'withdrawn' })
    expect(await m.queue({ action: 'withdraw', id: 'r-nope' })).toMatchObject({ ok: false, code: 'release' })
    clock.ms += 61 * 60_000
    m.h.releaseTick()
    expect(m.casts.length).toBe(3) // 5 armed, 1 withdrawn, the 4th and 5th hit the hourly limit of 3
    const listed = (await m.queue({})).releases as Array<{ id: string; state: string; result?: string }>
    expect(listed.find(r => r.id === ids[0])?.state).toBe('withdrawn')
    expect(listed.filter(r => r.state === 'released').length).toBe(3)
    expect(listed.filter(r => r.state === 'failed').every(r => r.result?.startsWith('rate-limited'))).toBe(true)
    expect(JSON.stringify(listed)).not.toContain('session-o') // the observer field is not echoed
    await m.h.stop()
  })
  it('ticket stage: fires once when the ticket reaches the stage, kept across a restart', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-rel-home-'))
    const clock = { ms: Date.parse('2026-11-25T00:00:00Z') }
    const t: Ticket = { id: 'aaaabbbbccccdddd', assignments: [{ id: 'a1', state: 'running' }] }
    const m = await team({ home, clock, busy: {}, tickets: [t] })
    expect(await m.cast({ ...base, mode: 'release', when: 'ticket:aaaabbbbccccdddd person:review', then: 'queue' })).toMatchObject({ ok: true })
    m.h.releaseTick()
    expect(m.casts).toEqual([])
    await m.h.stop()
    const n = await team({ home, clock, busy: {}, tickets: [t] })
    t.assignments[0]!.report = { state: 'ready' }
    clock.ms += 60_000
    n.h.releaseTick(); n.h.releaseTick()
    expect(n.casts).toEqual([expect.objectContaining({ sessionId: 'session-m', mode: 'queue' })])
    expect(n.wakes('session-m')).toBe(0)
    expect(((await n.queue({})).releases as Array<{ state: string; result: string }>)[0]).toMatchObject({ state: 'released', result: 'queue c1' })
    await n.h.stop()
  })
  it('idle: fires after the target stays idle that long; a busy look starts the count again', async () => {
    const clock = { ms: Date.parse('2026-11-25T00:00:00Z') }
    const busy: Record<string, boolean | undefined> = { 'session-m': false }
    const m = await team({ clock, busy })
    expect(await m.cast({ ...base, mode: 'release', when: 'idle:10', then: 'trigger' })).toMatchObject({ ok: true })
    m.h.releaseTick()                       // quiet from here
    clock.ms += 6 * 60_000; busy['session-m'] = true; m.h.releaseTick()   // busy: reset
    clock.ms += 1 * 60_000; busy['session-m'] = false; m.h.releaseTick()  // quiet again
    clock.ms += 9 * 60_000; m.h.releaseTick()
    expect(m.casts).toEqual([])
    clock.ms += 1 * 60_000; m.h.releaseTick()
    expect(m.casts).toEqual([expect.objectContaining({ mode: 'queue' })])
    expect(m.wakes('session-m')).toBe(1)
    await m.h.stop()
  })
  it('a trigger released on a busy target is queued instead; an unreleased one expires; a turned-off switch fails it', async () => {
    const clock = { ms: Date.parse('2026-11-25T00:00:00Z') }
    const busy: Record<string, boolean | undefined> = { 'session-m': true }
    const m = await team({ clock, busy })
    await m.cast({ ...base, mode: 'release', when: 'at:2026-11-25T00:10:00Z', then: 'trigger' })
    await m.cast({ ...base, template_id: 'late', mode: 'release', when: 'idle:10', expires_hours: 1 })
    await m.cast({ ...base, template_id: 'off', mode: 'release', when: 'at:2026-11-25T00:30:00Z' })
    clock.ms += 10 * 60_000; m.h.releaseTick()
    expect(m.casts).toEqual([expect.objectContaining({ templateId: 't', mode: 'queue' })])
    expect(m.wakes('session-m')).toBe(0)
    expect(m.h.saveSettings({ observerCast: false }, () => true)).toMatchObject({ ok: true })
    clock.ms += 60 * 60_000; m.h.releaseTick()
    const byTemplate = Object.fromEntries(((await m.queue({})).releases as Array<{ template_id: string; state: string; result?: string }>).map(r => [r.template_id, r]))
    expect(byTemplate.late).toMatchObject({ state: 'expired' })
    expect(byTemplate.off).toMatchObject({ state: 'failed' })
    expect(byTemplate.off.result).toMatch(/^off/)
    expect(m.casts.length).toBe(1)
    await m.h.stop()
  })
})
