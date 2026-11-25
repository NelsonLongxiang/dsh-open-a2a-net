// @vitest-environment node
/** #902 S4: the owner's side of casting — members turned off, the router's trigger switch, the team page's view and withdraw. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'

async function team(o: { queue?: boolean } = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-o': 'superagent-observer' }
  const casts: Array<{ sessionId: string }> = []
  const withdrawn: Array<{ sessionId: string; id: string }> = []
  const clock = { ms: Date.parse('2026-11-25T00:00:00Z') }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', 'session-o'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-own-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
    now: () => new Date(clock.ms).toISOString(), sessionBusy: () => false,
    castCapabilities: () => ({ modes: ['insert', 'queue'], origin: true, confirmedDelivery: true }),
    castCard: (input: { sessionId: string }) => { casts.push(input); return { ok: true, queued: 1 } },
    ...(o.queue === false ? {} : { castQueue: () => ({
      list: () => ({ ok: true, items: [{ id: 'q1', session_id: 'session-m', state: 'waiting', name: 'c', basis: 'none: a', mode: 'queue', origin: 'a2a|team:team|observer:session-o|mode:queue' }, { id: 'q2', session_id: 'session-elsewhere', state: 'waiting' }] }),
      withdraw: (i: { sessionId: string; id: string }) => { withdrawn.push(i); return { ok: true, withdrawn: true } },
    }) }),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', observerCast: true }, () => true, id => presets[id])).toMatchObject({ ok: true })
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const cast = async (args: Record<string, unknown>) => await registered.get('a2a_card_cast')!.execute({ template_id: 't', reason: 'r', basis: 'none: x', ...args }, { agent: { id: 'session-o' }, signal: new AbortController().signal })
  return { h, cast, casts, withdrawn }
}

describe('#902 S4', () => {
  it('castOff and observerTriggerRouter are owner-only rule fields, validated', async () => {
    expect(touchesRules({ castOff: ['session-m'] })).toBe(true)
    expect(touchesRules({ observerTriggerRouter: true })).toBe(true)
    const m = await team()
    expect(m.h.saveSettings({ castOff: ['not a session'] } as never, () => true)).toMatchObject({ ok: false })
    expect(m.h.saveSettings({ observerTriggerRouter: 'yes' } as never, () => true)).toMatchObject({ ok: false })
    expect(m.h.saveSettings({ castOff: ['session-m', 'session-m'] }, () => true)).toMatchObject({ ok: true })
    expect((m.h.settings as { castOff?: string[] }).castOff).toEqual(['session-m'])
    expect(m.h.saveSettings({ castOff: [] }, () => true)).toMatchObject({ ok: true })
    expect('castOff' in m.h.settings).toBe(false)
    await m.h.stop()
  })
  it('a member the owner turned off takes no cast in any mode, and an armed release for it fails when it comes due', async () => {
    const m = await team()
    expect(await m.cast({ session_id: 'session-m', mode: 'release', when: 'at:2026-11-25T00:10:00Z' })).toMatchObject({ ok: true })
    expect(m.h.saveSettings({ castOff: ['session-m'] }, () => true)).toMatchObject({ ok: true })
    for (const mode of ['insert', 'queue', 'trigger', 'release']) expect(await m.cast({ session_id: 'session-m', mode, when: 'idle:10' })).toMatchObject({ ok: false, code: 'member-off' })
    ;(m.h as unknown as { d: { now: () => string } }).d.now = () => '2026-11-25T00:11:00.000Z'
    m.h.releaseTick()
    expect(m.casts).toEqual([])
    expect(await m.cast({ session_id: 'session-r' })).toMatchObject({ ok: true })
    await m.h.stop()
  })
  it('trigger reaches the router only once the owner allows it', async () => {
    const m = await team()
    expect(await m.cast({ session_id: 'session-r', mode: 'trigger' })).toMatchObject({ ok: false, code: 'trigger-router' })
    expect(await m.cast({ session_id: 'session-r', mode: 'release', when: 'idle:10', then: 'trigger' })).toMatchObject({ ok: false, code: 'trigger-router' })
    expect(m.h.saveSettings({ observerTriggerRouter: true }, () => true)).toMatchObject({ ok: true })
    expect(await m.cast({ session_id: 'session-r', mode: 'trigger' })).toMatchObject({ ok: true, mode: 'trigger' })
    await m.h.stop()
  })
  it('the team state carries 待投卡: switches, members off, this team\'s waiting casts and armed releases only', async () => {
    const m = await team()
    await m.cast({ session_id: 'session-m', mode: 'release', when: 'idle:10' })
    m.h.saveSettings({ castOff: ['session-r'] }, () => true)
    const casts = m.h.state().casts as Record<string, any>
    expect(casts).toMatchObject({ on: true, draft: false, triggerRouter: false, off: ['session-r'], available: true })
    expect(casts.waiting.map((w: { id: string }) => w.id)).toEqual(['q1'])
    expect(casts.releases).toHaveLength(1)
    expect(casts.releases[0]).not.toHaveProperty('observer')
    await m.h.stop()
    const n = await team({ queue: false })
    expect(n.h.state().casts).toMatchObject({ on: true, available: false })
    await n.h.stop()
  })
  it('the owner withdraws a waiting cast or an armed release of this team, never another team\'s', async () => {
    const m = await team()
    const armed = await m.cast({ session_id: 'session-m', mode: 'release', when: 'idle:10' })
    expect(m.h.ownerCastQueue({ action: 'withdraw', session_id: 'session-m', id: 'q1' })).toEqual({ ok: true, withdrawn: true })
    expect(m.withdrawn).toEqual([{ sessionId: 'session-m', id: 'q1', origin: 'a2a|team:team|observer:session-o|mode:queue' }])
    expect(m.h.ownerCastQueue({ action: 'withdraw', session_id: 'session-elsewhere', id: 'q2' })).toMatchObject({ ok: false, code: 'cast' })
    expect(m.h.ownerCastQueue({ action: 'withdraw', id: String(armed.release) })).toEqual({ ok: true, withdrawn: true })
    expect((m.h.state().casts as { releases: unknown[] }).releases).toEqual([])
    await m.h.stop()
  })
})
