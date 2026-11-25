// @vitest-environment node
/** #902 pre-release review fixes (#907 B1/B2, #908 B1, #910 B1/B2): each blocker has its own case here. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

type Row = { id: string; session_id: string; state: string; origin?: string | null }

async function team(o: { caps?: boolean; origin?: boolean; rows?: Row[]; deliver?: (id: string) => boolean; home?: string; clock?: { ms: number }; observer?: string } = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const observer = o.observer ?? 'session-o'
  const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-m': 'superagent-member', [observer]: 'superagent-observer' }
  const casts: Array<Record<string, unknown>> = []
  const withdrawn: Array<Record<string, unknown>> = []
  const removed: string[] = []
  const rows = o.rows ?? []
  const templates = new Set<string>()
  let next = 0
  const clock = o.clock ?? { ms: Date.parse('2026-11-25T00:00:00Z') }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m', observer], remote: [] } : undefined, home: o.home ?? mkdtempSync(join(tmpdir(), 'sa-rev-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string) => (o.deliver ?? (() => true))(id), interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
    now: () => new Date(clock.ms).toISOString(), sessionBusy: () => false,
    ...(o.caps === false ? {} : { castCapabilities: () => ({ modes: ['insert', 'queue'], origin: o.origin !== false, confirmedDelivery: true }) }),
    castCard: (input: Record<string, unknown>) => { casts.push(input); const id = `q${String(casts.length)}`; rows.push({ id, session_id: String(input.sessionId), state: 'waiting', origin: (input.origin as string | undefined) ?? null }); return { ok: true, queued: 1, id } },
    castQueue: () => ({
      list: (f: { sessionId?: string; origin?: string; state?: string }) => ({ ok: true, items: rows.filter(r => (f.sessionId === undefined || r.session_id === f.sessionId) && (f.origin === undefined || r.origin === f.origin) && (f.state === undefined || r.state === f.state)) }),
      withdraw: (i: Record<string, unknown>) => { withdrawn.push(i); return { ok: true, withdrawn: true } },
    }),
    cardDrafts: () => ({
      draft: (i: Record<string, unknown>) => { const id = typeof i.id === 'string' ? i.id : `card-${String(++next)}`; templates.add(id); return { ok: true, id, name: i.name, content_sha256: 'sha', created: i.id === undefined } },
      remove: (i: { id: string }) => { removed.push(i.id); const had = templates.delete(i.id); return { ok: true, deleted: had } },
      has: (_a: string, id: string) => templates.has(id),
    }),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', observerCast: true, observerCardDraft: true }, () => true, id => presets[id])).toMatchObject({ ok: true })
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const as = (name: string) => async (args: Record<string, unknown>) => await registered.get(name)!.execute(args, { agent: { id: observer }, signal: new AbortController().signal })
  const cast = (args: Record<string, unknown>) => as('a2a_card_cast')({ session_id: 'session-m', template_id: 't', reason: 'r', basis: 'none: x', ...args })
  return { h, cast, queue: as('a2a_card_queue'), draft: as('a2a_card_draft'), casts, withdrawn, removed, rows, templates, clock }
}

describe('#910 review B1: an older plugin gets insert only', () => {
  it('without declared capabilities queue, trigger and release are unavailable and nothing reaches the plugin', async () => {
    const m = await team({ caps: false })
    for (const mode of ['queue', 'trigger', 'release']) expect(await m.cast({ mode, when: 'idle:10' })).toMatchObject({ ok: true, available: false })
    expect(m.casts).toEqual([])
    expect(await m.cast({})).toMatchObject({ ok: true, mode: 'insert' })
    expect(m.casts[0]).not.toHaveProperty('origin')
    await m.h.stop()
  })
})

describe('#910 review B2: what is reported is what happened', () => {
  it('the wake is sent, not live, or failed — woken only when sent', async () => {
    const m = await team({ deliver: () => false })
    expect(await m.cast({})).toMatchObject({ ok: true, woken: false, wake: 'not-live' })
    const n = await team({ deliver: () => { throw new Error('boom') } })
    expect(await n.cast({})).toMatchObject({ ok: true, woken: false, wake: 'failed' })
    await m.h.stop(); await n.h.stop()
  })
  it('an arm that cannot be saved arms nothing; a withdrawal that cannot be saved keeps it armed', async () => {
    const m = await team()
    const saver = m.h as unknown as { saveReleases: (r: unknown) => boolean }
    const real = saver.saveReleases.bind(m.h)
    saver.saveReleases = () => false
    expect(await m.cast({ mode: 'release', when: 'idle:10' })).toMatchObject({ ok: false, code: 'not-saved' })
    saver.saveReleases = real
    const armed = await m.cast({ mode: 'release', when: 'idle:10' })
    saver.saveReleases = () => false
    expect(await m.queue({ action: 'withdraw', id: armed.release })).toMatchObject({ ok: false, code: 'not-saved' })
    saver.saveReleases = real
    expect((await m.queue({})).releases).toEqual([expect.objectContaining({ id: armed.release, state: 'armed' })])
    await m.h.stop()
  })
  it('a release left releasing by a restart is reconciled from the plugin queue, never cast twice', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-rev-home-'))
    const clock = { ms: Date.parse('2026-11-25T00:00:00Z') }
    const rows: Row[] = []
    const m = await team({ home, clock, rows })
    const a = (await m.cast({ mode: 'release', when: 'at:2026-11-25T00:10:00Z' })).release as string
    const b = (await m.cast({ template_id: 't2', mode: 'release', when: 'at:2026-11-25T00:10:00Z' })).release as string
    await m.h.stop()
    // Simulate a stop after writing `releasing` for both: a's cast reached the plugin, b's did not.
    const file = join(home, ...findReleases(home))
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { releases: Array<{ id: string; state: string }> }
    for (const r of saved.releases) r.state = 'releasing'
    writeFileSync(file, JSON.stringify(saved))
    rows.push({ id: 'qa', session_id: 'session-m', state: 'waiting', origin: `a2a|team:team|observer:session-o|mode:insert|release:${a}` })
    const n = await team({ home, clock, rows })
    clock.ms += 11 * 60_000
    n.h.releaseTick()
    expect(n.casts.map(c => c.templateId)).toEqual(['t2'])
    const byId = Object.fromEntries(((await n.queue({})).releases as Array<{ id: string; state: string; result: string }>).map(r => [r.id, r]))
    expect(byId[a]).toMatchObject({ state: 'released', result: 'reconciled qa' })
    expect(byId[b]).toMatchObject({ state: 'released' })
    await n.h.stop()
    // A plugin that keeps no origin cannot tell: the release ends failed as uncertain.
    const home2 = mkdtempSync(join(tmpdir(), 'sa-rev-home-'))
    const p = await team({ home: home2, clock: { ms: Date.parse('2026-11-25T00:00:00Z') }, origin: false })
    const c = (await p.cast({ mode: 'release', when: 'idle:10' })).release as string
    await p.h.stop()
    const file2 = join(home2, ...findReleases(home2))
    const s2 = JSON.parse(readFileSync(file2, 'utf8')) as { releases: Array<{ state: string }> }
    s2.releases[0]!.state = 'releasing'
    writeFileSync(file2, JSON.stringify(s2))
    const q = await team({ home: home2, origin: false })
    q.h.releaseTick()
    expect(((await q.queue({})).releases as Array<{ id: string; state: string; result: string }>)[0]).toMatchObject({ id: c, state: 'failed', result: expect.stringMatching(/^uncertain/) })
    expect(q.casts).toEqual([])
    await q.h.stop()
  })
  it('an event condition is refused as not available yet', async () => {
    const m = await team()
    expect(await m.cast({ mode: 'release', when: 'event:repeat-failure' })).toMatchObject({ ok: false, code: 'when', error: expect.stringContaining('not available yet') })
    await m.h.stop()
  })
})

describe('#907 review B2: casts are attributed by origin', () => {
  it('another team\'s row on a shared session is never shown or withdrawn; another observer\'s row is not mine', async () => {
    const rows: Row[] = [
      { id: 'x1', session_id: 'session-m', state: 'waiting', origin: 'a2a|team:other|observer:session-z|mode:insert' },
      { id: 'x2', session_id: 'session-m', state: 'waiting', origin: 'a2a|team:team|observer:session-old|mode:queue' },
    ]
    const m = await team({ rows })
    const mine = await m.cast({ mode: 'queue' })
    expect(mine.origin).toBe('a2a|team:team|observer:session-o|mode:queue')
    const items = (await m.queue({})).items as Array<{ id: string; mine?: boolean; requested?: string; origin?: string }>
    expect(items.map(r => [r.id, r.mine, r.requested])).toEqual([['x2', false, 'queue'], [mine.id, true, 'queue']])
    expect(JSON.stringify(items)).not.toContain('session-old')
    expect(await m.queue({ action: 'withdraw', session_id: 'session-m', id: 'x1' })).toMatchObject({ ok: false, code: 'cast' })
    expect(await m.queue({ action: 'withdraw', session_id: 'session-m', id: 'x2' })).toMatchObject({ ok: false, code: 'not-yours' })
    expect(m.h.ownerCastQueue({ action: 'withdraw', session_id: 'session-m', id: 'x1' })).toMatchObject({ ok: false, code: 'cast' })
    expect(m.h.ownerCastQueue({ action: 'withdraw', session_id: 'session-m', id: 'x2' })).toEqual({ ok: true, withdrawn: true })
    expect(await m.queue({ action: 'withdraw', session_id: 'session-m', id: mine.id })).toEqual({ ok: true, withdrawn: true })
    expect(m.withdrawn).toEqual([{ sessionId: 'session-m', id: 'x2', origin: rows[1]!.origin }, { sessionId: 'session-m', id: mine.id, origin: mine.origin }])
    await m.h.stop()
  })
})

describe('#908 review B1: custom cards are bound to their author', () => {
  const card = { action: 'create', name: '对账卡', content: '先核原证', for: ['session-m'], scene: '月结对账' }
  it('after an observer handover, the new observer cannot edit, delete or cast the old one\'s card', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-rev-home-'))
    const m = await team({ home })
    const made = await m.draft(card)
    expect(made).toMatchObject({ ok: true, created: true })
    await m.h.stop()
    const n = await team({ home, observer: 'session-o2' })
    expect(((await n.draft({})).cards as Array<{ id: string; mine: boolean; author?: string }>)[0]).toMatchObject({ id: made.id, mine: false })
    expect(((await n.draft({})).cards as Array<Record<string, unknown>>)[0]).not.toHaveProperty('author')
    expect(await n.draft({ ...card, action: 'update', id: made.id })).toMatchObject({ ok: false, code: 'not-yours' })
    expect(await n.draft({ action: 'delete', id: made.id })).toMatchObject({ ok: false, code: 'not-yours' })
    expect(await n.cast({ template_id: made.id })).toMatchObject({ ok: false, code: 'not-yours' })
    await n.h.stop()
  })
  it('delete removes the record only when the template is gone; a create the record cannot hold is taken back', async () => {
    const m = await team()
    const made = await m.draft(card)
    m.templates.add('kept')
    // The plugin keeps it (deleted false, still present): nothing is removed from the record.
    const keep = await m.draft({ ...card })
    m.templates.delete(String(keep.id))
    expect(await m.draft({ action: 'delete', id: keep.id })).toEqual({ ok: true, deleted: false, reconciled: true })
    expect(await m.draft({ action: 'delete', id: made.id })).toEqual({ ok: true, deleted: true })
    expect((await m.draft({})).cards).toEqual([])
    const saver = m.h as unknown as { saveObserverCards: (c: unknown) => boolean }
    saver.saveObserverCards = () => false
    const lost = await m.draft(card)
    expect(lost).toMatchObject({ ok: false, code: 'not-saved' })
    expect(m.removed.at(-1)).toMatch(/^card-/)
    await m.h.stop()
  })
})

/** The team state directory's observer-releases.json, wherever the host keeps it under home. */
function findReleases(home: string): string[] {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
  const walk = (dir: string, rel: string[]): string[] | undefined => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (name === 'observer-releases.json') return [...rel, name]
      if (statSync(path).isDirectory()) { const hit = walk(path, [...rel, name]); if (hit !== undefined) return hit }
    }
    return undefined
  }
  const hit = walk(home, [])
  if (hit === undefined) throw new Error('no observer-releases.json under home')
  return hit
}

describe('#911 review: S4 boundaries', () => {
  it('B2: a cast for a member that left the team stays this team\'s: listed, and withdrawn by the owner (not the observer)', async () => {
    const rows: Row[] = [{ id: 'g1', session_id: 'session-gone', state: 'waiting', origin: 'a2a|team:team|observer:session-o|mode:insert' }, { id: 'g2', session_id: 'session-gone', state: 'waiting', origin: null }]
    const m = await team({ rows })
    expect(((await m.queue({})).items as Array<{ id: string }>).map(r => r.id)).toEqual(['g1'])
    expect(await m.queue({ action: 'withdraw', session_id: 'session-gone', id: 'g1' })).toMatchObject({ ok: false, code: 'not-in-team' })
    expect(m.h.ownerCastQueue({ action: 'withdraw', session_id: 'session-gone', id: 'g2' })).toMatchObject({ ok: false, code: 'cast' })
    expect(m.h.ownerCastQueue({ action: 'withdraw', session_id: 'session-gone', id: 'g1' })).toEqual({ ok: true, withdrawn: true })
    await m.h.stop()
  })
  it('only whitelisted fields of a plugin row reach the state and the tools', async () => {
    const rows = [{ id: 'w1', session_id: 'session-m', state: 'waiting', origin: 'a2a|team:team|observer:session-o|mode:queue', content: 'CARD TEXT', observer: 'session-o', token: 'x' } as unknown as Row]
    const m = await team({ rows })
    const text = JSON.stringify([await m.queue({}), m.h.state().casts])
    for (const leak of ['CARD TEXT', '"observer"', '"token"', 'origin']) expect(text).not.toContain(leak)
    expect(text).toContain('"requested":"queue"')
    await m.h.stop()
  })
  it('turning casting off for a member withdraws this team\'s waiting casts and armed releases for it, nothing else', async () => {
    const rows: Row[] = [
      { id: 'o1', session_id: 'session-m', state: 'waiting', origin: 'a2a|team:team|observer:session-o|mode:queue' },
      { id: 'o2', session_id: 'session-m', state: 'waiting', origin: 'a2a|team:other|observer:session-z|mode:queue' },
      { id: 'o3', session_id: 'session-m', state: 'waiting', origin: null },
      { id: 'o4', session_id: 'session-r', state: 'waiting', origin: 'a2a|team:team|observer:session-o|mode:queue' },
    ]
    const m = await team({ rows })
    const armed = await m.cast({ mode: 'release', when: 'idle:10' })
    expect(m.h.saveSettings({ castOff: ['session-m'] }, () => true)).toMatchObject({ ok: true, castOff: { withdrawn: 1, notWithdrawn: [], releasesWithdrawn: 1, releasesSaved: true } })
    expect(m.withdrawn.map(w => w.id)).toEqual(['o1'])
    expect(((await m.queue({})).releases as Array<{ id: string; state: string; result?: string }>).find(r => r.id === armed.release)).toMatchObject({ state: 'withdrawn', result: 'member-off' })
    await m.h.stop()
  })
})

describe('#913 review: what is left open is said, not assumed', () => {
  it('casting a member off reports each cast the plugin did not withdraw', async () => {
    const rows: Row[] = [{ id: 's1', session_id: 'session-m', state: 'waiting', origin: 'a2a|team:team|observer:session-o|mode:queue' }]
    const m = await team({ rows })
    const svc = (m.h as unknown as { d: { castQueue: () => { withdraw: (i: unknown) => unknown } } }).d
    const real = svc.castQueue
    svc.castQueue = () => ({ ...real(), withdraw: () => ({ ok: true, withdrawn: false }) })
    expect(m.h.saveSettings({ castOff: ['session-m'] }, () => true)).toMatchObject({ ok: true, castOff: { withdrawn: 0, notWithdrawn: ['s1'] } })
    await m.h.stop()
  })
  it('a release is matched by its exact origin, however many newer rows the target has', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-rev-home-'))
    const rows: Row[] = []
    const m = await team({ home, rows })
    const a = (await m.cast({ mode: 'release', when: 'idle:10', then: 'queue' })).release as string
    await m.h.stop()
    const file = join(home, ...findReleases(home))
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { releases: Array<{ state: string }> }
    saved.releases[0]!.state = 'releasing'
    writeFileSync(file, JSON.stringify(saved))
    rows.push({ id: 'old', session_id: 'session-m', state: 'delivered', origin: `a2a|team:team|observer:session-o|mode:queue|release:${a}` })
    for (let i = 0; i < 300; i++) rows.push({ id: `n${String(i)}`, session_id: 'session-m', state: 'waiting', origin: 'a2a|team:team|observer:session-o|mode:insert' })
    const n = await team({ home, rows })
    n.h.releaseTick()
    expect(((await n.queue({})).releases as Array<{ id: string; state: string; result: string }>)[0]).toMatchObject({ id: a, state: 'released', result: 'reconciled old' })
    expect(n.casts).toEqual([])
    await n.h.stop()
  })
  it('an edit whose record cannot be finished leaves the card pending and uncastable; a create that cannot be taken back names the orphan', async () => {
    const m = await team()
    const made = await m.draft({ action: 'create', name: '卡', content: '正文', for: ['session-m'], scene: '场景' })
    const saver = m.h as unknown as { saveObserverCards: (c: unknown) => boolean }
    const real = saver.saveObserverCards.bind(m.h)
    // Pending can be written, the final record cannot.
    let calls = 0
    saver.saveObserverCards = (c: unknown) => (++calls === 1 ? real(c) : false)
    expect(await m.draft({ action: 'update', id: made.id, name: '卡', content: '新正文', for: ['session-m'], scene: '场景' })).toMatchObject({ ok: false, code: 'not-saved', pending: true })
    saver.saveObserverCards = real
    expect(await m.cast({ template_id: made.id })).toMatchObject({ ok: false, code: 'pending' })
    expect(((await m.draft({})).cards as Array<{ pending?: boolean }>)[0]!.pending).toBe(true)
    expect(await m.draft({ action: 'update', id: made.id, name: '卡', content: '新正文', for: ['session-m'], scene: '场景' })).toMatchObject({ ok: true })
    expect(await m.cast({ template_id: made.id })).toMatchObject({ ok: true })
    // The pending mark itself cannot be written: nothing changes, the plugin is not called.
    saver.saveObserverCards = () => false
    expect(await m.draft({ action: 'update', id: made.id, name: '卡', content: '再改', for: ['session-m'], scene: '场景' })).toMatchObject({ ok: false, code: 'not-saved' })
    // A create the record cannot hold, and the plugin will not take back: the orphan is named.
    const d = (m.h as unknown as { d: { cardDrafts: () => Record<string, unknown> } }).d
    const realDrafts = d.cardDrafts
    d.cardDrafts = () => ({ ...realDrafts(), remove: () => ({ ok: true, deleted: false }) })
    const lost = await m.draft({ action: 'create', name: '卡2', content: 'x', for: ['session-m'], scene: '场景' })
    expect(lost).toMatchObject({ ok: false, code: 'not-saved', orphan: expect.stringMatching(/^card-/) })
    await m.h.stop()
  })
})
