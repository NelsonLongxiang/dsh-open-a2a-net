// @vitest-environment node
/** Observer phase 2 (T5-A): the observer casts a card into its own team's sessions; the a2a side checks who may. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function team(o: { observerCast?: boolean; service?: boolean } = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-o': 'superagent-observer' }
  const casts: Array<{ sessionId: string; templateId: string; reason: string }> = []
  const sent: Array<[string, string]> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', 'session-o'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-cast-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
    ...(o.service === false ? {} : { castCard: (input: { sessionId: string; templateId: string; reason: string }) => { casts.push(input); return input.templateId === 'dup' ? { ok: false, code: 'already-queued', error: 'x' } : { ok: true, queued: 1 } } }),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', ...(o.observerCast === true ? { observerCast: true } : {}) }, () => true, id => presets[id])).toMatchObject({ ok: true })
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const cast = async (as: string, args: Record<string, unknown>) => await registered.get('a2a_card_cast')!.execute(args, { agent: { id: as }, signal: new AbortController().signal })
  return { h, cast, casts, sent }
}

describe('T5-A: a2a_card_cast', () => {
  it('a plain member (or the router) is refused, whatever it passes; nothing reaches the plugin', async () => {
    const m = await team({ observerCast: true })
    expect(await m.cast('session-m', { session_id: 'session-r', template_id: 't', reason: 'r' })).toMatchObject({ ok: false, code: 'not-observer' })
    expect(await m.cast('session-r', { session_id: 'session-m', template_id: 't', reason: 'r' })).toMatchObject({ ok: false, code: 'not-observer' })
    expect(m.casts).toEqual([])
    await m.h.stop()
  })
  it('is off until the owner turns observerCast on', async () => {
    const m = await team()
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 't', reason: 'r' })).toMatchObject({ ok: false, code: 'off' })
    expect(m.casts).toEqual([])
    expect(m.h.saveSettings({ observerCast: 'yes' } as never, () => true)).toMatchObject({ ok: false })
    await m.h.stop()
  })
  it('casts only into another session of the observer\'s own team, and wakes it', async () => {
    const m = await team({ observerCast: true })
    expect(await m.cast('session-o', { session_id: 'session-elsewhere', template_id: 't', reason: 'r' })).toMatchObject({ ok: false, code: 'not-in-team' })
    expect(await m.cast('session-o', { session_id: 'session-o', template_id: 't', reason: 'r' })).toMatchObject({ ok: false, code: 'not-in-team' })
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: '', reason: 'r' })).toMatchObject({ ok: false, code: 'template' })
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 'atelier-action-review', reason: '卡在验收' })).toEqual({ ok: true, queued: 1 })
    expect(m.casts).toEqual([{ sessionId: 'session-m', templateId: 'atelier-action-review', reason: '卡在验收' }])
    expect(m.sent.some(([id, text]) => id === 'session-m' && text.startsWith('[superagent card]'))).toBe(true)
    // The plugin's refusal comes back as is, and no wake follows it.
    const woken = m.sent.length
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 'dup', reason: 'r' })).toMatchObject({ ok: false, code: 'already-queued' })
    expect(m.sent.length).toBe(woken)
    await m.h.stop()
  })
  it('without the plugin\'s cast service it answers available: false', async () => {
    const m = await team({ observerCast: true, service: false })
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 't', reason: 'r' })).toMatchObject({ ok: true, available: false })
    await m.h.stop()
  })
})
