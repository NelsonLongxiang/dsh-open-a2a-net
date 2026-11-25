// @vitest-environment node
/** #902 S2: the observer writes its own cards for named members of its team, and casts them only to those members. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'

async function team(o: { draft?: boolean; service?: boolean } = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-n': 'superagent-member', 'session-o': 'superagent-observer' }
  const casts: Array<{ sessionId: string; templateId: string; authorSession?: string }> = []
  const drafts: Array<Record<string, unknown>> = []
  let next = 0
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', 'session-n', 'session-o'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-draft-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
    castCard: (input: { sessionId: string; templateId: string; authorSession?: string }) => { casts.push(input); return { ok: true, queued: 1, id: `q${String(casts.length)}` } },
    ...(o.service === false ? {} : { cardDrafts: () => ({
      draft: (i: Record<string, unknown>) => { drafts.push(i); const id = typeof i.id === 'string' ? i.id : `card-${String(++next)}`; return { ok: true, id, name: i.name, content_sha256: 'sha', created: i.id === undefined } },
      remove: (i: { id: string }) => ({ ok: true, deleted: i.id.startsWith('card-') }),
    }) }),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', observerCast: true, ...(o.draft === true ? { observerCardDraft: true } : {}) }, () => true, id => presets[id])).toMatchObject({ ok: true })
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const call = (tool: string) => async (as: string, args: Record<string, unknown>) => await registered.get(tool)!.execute(args, { agent: { id: as }, signal: new AbortController().signal })
  return { h, draft: call('a2a_card_draft'), cast: call('a2a_card_cast'), casts, drafts }
}

const card = { action: 'create', name: '对账前自查', content: '先核 {{session}} 的原证', for: ['session-m'], scene: '月结对账卡在原证', from: 'atelier-action-review' }

describe('#902 S2: a2a_card_draft', () => {
  it('turning observerCardDraft on is the owner\'s call (a rule field), not a shell\'s', () => {
    expect(touchesRules({ observerCardDraft: true })).toBe(true)
  })
  it('serves only the observer; off until the owner turns observerCardDraft on (list still answers)', async () => {
    const m = await team()
    expect(await m.draft('session-m', card)).toMatchObject({ ok: false, code: 'not-observer' })
    expect(await m.draft('session-o', card)).toMatchObject({ ok: false, code: 'off' })
    expect(await m.draft('session-o', {})).toEqual({ ok: true, on: false, cards: [] })
    expect(m.drafts).toEqual([])
    expect(m.h.saveSettings({ observerCardDraft: 'yes' } as never, () => true)).toMatchObject({ ok: false })
    await m.h.stop()
  })
  it('without the plugin\'s author-session cards it answers available: false', async () => {
    const m = await team({ draft: true, service: false })
    expect(await m.draft('session-o', card)).toMatchObject({ ok: true, available: false })
    await m.h.stop()
  })
  it('a card names members of this team (not the observer) and a one-line scene; it is written into the observer\'s own session', async () => {
    const m = await team({ draft: true })
    expect(await m.draft('session-o', { ...card, for: [] })).toMatchObject({ ok: false, code: 'for' })
    expect(await m.draft('session-o', { ...card, for: ['session-elsewhere'] })).toMatchObject({ ok: false, code: 'for' })
    expect(await m.draft('session-o', { ...card, for: ['session-o'] })).toMatchObject({ ok: false, code: 'for' })
    expect(await m.draft('session-o', { ...card, scene: '' })).toMatchObject({ ok: false, code: 'scene' })
    const made = await m.draft('session-o', card)
    expect(made).toEqual({ ok: true, id: 'card-1', created: true, for: ['session-m'], scene: '月结对账卡在原证' })
    expect(m.drafts[0]).toMatchObject({ authorSession: 'session-o', name: '对账前自查', content: '先核 {{session}} 的原证', description: 'for: session-m · scene: 月结对账卡在原证 · from: atelier-action-review' })
    expect((await m.draft('session-o', {})).cards).toEqual([expect.objectContaining({ id: 'card-1', for: ['session-m'], scene: '月结对账卡在原证', from: 'atelier-action-review' })])
    await m.h.stop()
  })
  it('a card of the observer\'s own goes only to the members it is for, naming the observer as author; ["team"] means every member', async () => {
    const m = await team({ draft: true })
    await m.draft('session-o', card)
    expect(await m.cast('session-o', { session_id: 'session-n', template_id: 'card-1', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: false, code: 'not-for' })
    expect(await m.cast('session-o', { session_id: 'session-m', template_id: 'card-1', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: true })
    expect(m.casts.at(-1)).toMatchObject({ sessionId: 'session-m', templateId: 'card-1', authorSession: 'session-o' })
    await m.draft('session-o', { ...card, name: '全队', for: ['team'] })
    expect(await m.cast('session-o', { session_id: 'session-n', template_id: 'card-2', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: true })
    // A library card is cast as before, with no author.
    expect(await m.cast('session-o', { session_id: 'session-n', template_id: 'atelier-x', reason: 'r', basis: 'none: test' })).toMatchObject({ ok: true })
    expect(m.casts.at(-1)!.authorSession).toBeUndefined()
    await m.h.stop()
  })
  it('update and delete only its own cards; at most 50 per team', async () => {
    const m = await team({ draft: true })
    expect(await m.draft('session-o', { ...card, action: 'update', id: 'not-mine' })).toMatchObject({ ok: false, code: 'card' })
    await m.draft('session-o', card)
    expect(await m.draft('session-o', { ...card, action: 'update', id: 'card-1', for: ['session-m', 'session-n'] })).toMatchObject({ ok: true, created: false, for: ['session-m', 'session-n'] })
    expect(await m.draft('session-o', { action: 'delete', id: 'not-mine' })).toMatchObject({ ok: false, code: 'card' })
    expect(await m.draft('session-o', { action: 'delete', id: 'card-1' })).toEqual({ ok: true, deleted: true })
    expect((await m.draft('session-o', {})).cards).toEqual([])
    for (let i = 0; i < 50; i++) expect(await m.draft('session-o', { ...card, name: `c${String(i)}` })).toMatchObject({ ok: true })
    expect(await m.draft('session-o', { ...card, name: 'one too many' })).toMatchObject({ ok: false, code: 'full' })
    await m.h.stop()
  })
})
