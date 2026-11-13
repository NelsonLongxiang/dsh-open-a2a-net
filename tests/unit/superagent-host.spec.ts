/**
 * superagent design v4, PR-B: the host's ports for the vendored engine — durable Repositories with upstream's
 * MemoryRepositories semantics, and the team Policy (upstream docs/002 gate, accept mode off).
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Engine, MemoryRepositories, ticketStage, type Candidate, type EngineOptions, type Repositories, type Trigger } from '../../src/superagent/upstream/dsh-superagent/src/core/index.ts'
import { JsonRepositories } from '../../src/superagent/host/store.ts'
import { DEFAULT_SETTINGS, parseSettings, policyEffects, policyVersion, teamPolicy, teamScope, type TeamSettings } from '../../src/superagent/host/policy.ts'
import { policyChangedLines } from '../../src/superagent/host/executor.ts'
import { ORIGIN_LINE_NOTE, OTHER_TICKETS_SHOWN, candidateCard } from '../../src/superagent/host/index.ts'
import { SAID_CAP, attentionText, registerSuperagentTools } from '../../src/superagent/host/tools.ts'

/** Design v5: the team is a canvas team; tests give the host one canvas, `team`, with these sessions (router first). */
const canvasOf = (local: readonly string[], remote: ReadonlyArray<{ ref: string; key: string; url: string }> = []) => (name: string) => name === 'team' ? { local, remote } : undefined

const tmp = (): string => join(mkdtempSync(join(tmpdir(), 'sa-host-')), 'superagent', 'state.json')
const settings = (over: Partial<TeamSettings> = {}): TeamSettings => ({ ...DEFAULT_SETTINGS, ...over })
const wb = (id: string, thread = 't1', over: Partial<Trigger> = {}): Trigger => ({
  id, source: 'workbench', threads: [{ source: 'workbench', id: thread }], actor: { source: 'workbench', id: 'owner' }, human: true, addressed: 'direct',
  at: `2026-11-07T00:00:${id.padStart(2, '0')}Z`, text: `request ${id}`, channel: { source: 'workbench', thread, address: { trigger: id } }, meta: {}, ...over,
})

/** One scripted run of the engine on the given repositories; returns a canonical dump of every row it left. */
function scenario(repo: Repositories): unknown {
  const requests: Candidate[] = []
  let clock = 0
  const options: EngineOptions = {
    repo, policy: () => teamPolicy(settings()), scope: teamScope(() => settings()),
    assessor: { request: c => { requests.push(c) } },
    executor: { start: () => {}, deliver: () => {}, stop: () => {} },
    outbox: { send: () => {}, status: () => undefined, withdraw: () => {} },
    now: () => new Date(Date.UTC(2026, 10, 7, 0, 0, clock++)).toISOString(),
  }
  const engine = new Engine(options)
  engine.receive(wb('1')); engine.evaluateDue()
  engine.decide('1', { kind: 'accept', title: 'Fix', scope: 'small', reason: 'asked', acknowledgement: 'on it', evalId: requests.at(-1)!.evalId })
  engine.receive(wb('2')) // a follow-up on the ticket's Thread: fanned out, no Eval
  engine.receive(wb('3', 't2')); engine.evaluateDue()
  engine.decide('3', { kind: 'ignore', reason: 'chat', evalId: requests.at(-1)!.evalId })
  return {
    tickets: repo.tickets.list(), open: repo.tickets.open(), active: repo.tickets.active(),
    threads: repo.threads.list(), activeThreads: repo.threads.active(),
    t1: repo.decisions.byThread('workbench:t1'), t2: repo.decisions.byThread('workbench:t2'),
    d2: repo.triggers.disposition('2'), trig: repo.triggers.get('3'),
  }
}

describe('JsonRepositories', () => {
  it('leaves exactly what upstream MemoryRepositories leaves for the same engine run', () => {
    expect(scenario(new JsonRepositories(''))).toEqual(scenario(new MemoryRepositories()))
  })
  it('persists every committed unit of work and reloads it', () => {
    const path = tmp()
    const first = scenario(new JsonRepositories(path))
    const again = new JsonRepositories(path)
    expect(again.loadError).toBeUndefined()
    expect({ tickets: again.tickets.list(), threads: again.threads.list(), t1: again.decisions.byThread('workbench:t1') })
      .toEqual({ tickets: (first as any).tickets, threads: (first as any).threads, t1: (first as any).t1 })
    expect((JSON.parse(readFileSync(path, 'utf8')) as { v: number }).v).toBe(1)
  })
  it('rolls back a failed unit of work in memory and on disk, and only the outermost one writes', () => {
    const path = tmp()
    const repo = new JsonRepositories(path)
    repo.atomic(() => { repo.triggers.save(wb('1')) })
    const before = readFileSync(path, 'utf8')
    expect(() => repo.atomic(() => { repo.triggers.save(wb('2')); repo.atomic(() => repo.triggers.save(wb('3'))); throw Error('boom') })).toThrow('boom')
    expect(repo.triggers.get('2')).toBeUndefined()
    expect(repo.triggers.get('3')).toBeUndefined()
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
  it('an unreadable file refuses every write instead of overwriting it', () => {
    const path = tmp(); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '{"v":9}')
    const repo = new JsonRepositories(path)
    expect(repo.loadError).toMatch(/unreadable/)
    expect(() => repo.atomic(() => repo.triggers.save(wb('1')))).toThrow(/unreadable/)
    expect(readFileSync(path, 'utf8')).toBe('{"v":9}')
  })
})

describe('team policy (upstream docs/002, accept mode off)', () => {
  const thread = (subscriptions: string[] = []) => ({ key: 'workbench:t1', ref: { source: 'workbench', id: 't1' }, createdAt: '', subscriptions, correlated: [], pending: [], meta: {} })
  const policy = teamPolicy(settings({ allowed: { workbench: ['owner'], a2a: ['dsh/aaaaaaaa'] }, acceptMode: 'off' }))
  it('an allowed sender addressing the agent is explicit; nothing inferred while the accept mode is off', () => {
    expect(policy.gate(wb('1'), thread(), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: 'direct', sender: 'owner' } })
    expect(policy.gate(wb('1', 't1', { actor: { source: 'workbench', id: 'stranger' } }), thread(), [])).toEqual({ admissible: false, reason: 'notListed' })
    expect(policy.gate(wb('1', 't1', { human: false }), thread(), [])).toEqual({ admissible: false, reason: 'botNotListed' })
    const { addressed: _a, ...unaddressed } = wb('1')
    expect(policy.gate(unaddressed, thread(), [])).toEqual({ admissible: false, reason: 'notAddressed' })
    expect(policy.gate(unaddressed, thread(['k1']), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'followup' } })
    // Identities are never mapped across Sources: the A2A allowed handle is no workbench actor.
    expect(policy.gate(wb('1', 't1', { actor: { source: 'workbench', id: 'dsh/aaaaaaaa' } }), thread(), [])).toEqual({ admissible: false, reason: 'notListed' })
    expect(policy.admitsInferred(['any'])).toBe(false)
  })
  it('revalidation needs the sender still on its Source list', () => {
    const mandate = { strength: 'explicit' as const, policyVersion: 'x', basis: { via: 'addressed' as const, addressed: 'direct' as const, sender: 'owner' }, actor: { source: 'workbench', id: 'owner' }, scope: 's' }
    expect(policy.revalidate(mandate)).toBe(true)
    expect(teamPolicy(settings({ allowed: { workbench: [], a2a: [] } })).revalidate(mandate)).toBe(false)
  })
  it('the Policy version moves with the allowed lists only', () => {
    const base = policyVersion(settings())
    expect(policyVersion(settings({ router: 'session-x', evalTimeoutMs: 60_000, paused: true, sources: { workbench: false, a2a: true } }))).toBe(base)
    expect(policyVersion(settings({ allowed: { workbench: ['owner'], a2a: ['dsh/aaaaaaaa'] } }))).not.toBe(base)
  })
  it('a Source that is off filters its Triggers', () => {
    expect(teamScope(() => settings()).scope({ source: 'workbench', meta: {} })).toEqual({ listened: true, observed: false })
    expect(teamScope(() => settings()).scope({ source: 'a2a', meta: {} })).toEqual({ listened: false, reason: 'sourceOff' })
    expect(teamScope(() => settings()).scope({ source: 'feishu', meta: {} })).toEqual({ listened: false, reason: 'sourceOff' })
  })
  it('settings writes are validated field by field', () => {
    expect(parseSettings({ router: 'session-1', allowed: { a2a: ['dsh/aaaaaaaa'] } }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { router: 'session-1', allowed: { workbench: ['owner'], a2a: ['dsh/aaaaaaaa'] } } })
    expect(parseSettings({ router: 'has space' }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ allowed: { a2a: [''] } }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ evalTimeoutMs: 5 }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ router: null }, { ...DEFAULT_SETTINGS, router: 'session-1' })).toMatchObject({ ok: true, settings: { allowed: DEFAULT_SETTINGS.allowed } })
    expect((parseSettings({ router: null }, { ...DEFAULT_SETTINGS, router: 'session-1' }) as { settings: TeamSettings }).settings.router).toBeUndefined()
  })
})

describe('candidate card', () => {
  it('tells the router how to record a would-accept in observe mode', () => {
    const repo = new MemoryRepositories()
    const seen: Candidate[] = []
    const engine = new Engine({ repo, policy: () => teamPolicy(settings()), scope: teamScope(() => settings()), assessor: { request: vi.fn(c => { seen.push(c) }) },
      executor: { start: () => {}, deliver: () => {}, stop: () => {} }, outbox: { send: () => {}, status: () => undefined, withdraw: () => {} } })
    engine.receive(wb('1')); engine.evaluateDue()
    const card = candidateCard({ ...seen[0]!, strength: 'inferred' }, settings({ acceptMode: 'observe', rules: [{ name: 'deps', text: 'Upgrade.', enabled: true }] }))
    expect(card).toContain('still route a matching candidate as accept, naming its rules')
  })

  it('says what a 未验证 delivery header means, only for an A2A message that carries one', () => {
    const repo = new MemoryRepositories()
    const seen: Candidate[] = []
    const engine = new Engine({ repo, policy: () => teamPolicy(settings()), scope: teamScope(() => settings()), assessor: { request: vi.fn(c => { seen.push(c) }) },
      executor: { start: () => {}, deliver: () => {}, stop: () => {} }, outbox: { send: () => {}, status: () => undefined, withdraw: () => {} } })
    engine.receive(wb('1')); engine.evaluateDue()
    const cardWith = (trigger: Trigger): string => candidateCard({ ...seen[0]!, triggers: [trigger] })
    const a2a = (header: string): Trigger => ({ ...wb('2', 't2'), source: 'a2a', actor: { source: 'a2a', id: 'seat/0123456789abcdef' }, human: false, text: `${header} from "seat/0123456789abcdef" (routed to dsh/canvas/ops) sent:\n\nplease` })
    expect(cardWith(a2a('[A2A direct] (task t1) 未验证（cli-identity）'))).toContain(ORIGIN_LINE_NOTE)
    expect(cardWith(a2a('[A2A direct] (task t2) 已验证来源 http://peer.example'))).not.toContain(ORIGIN_LINE_NOTE)
    // A person's own text that quotes the words is not a delivery header.
    expect(cardWith({ ...wb('3', 't3'), text: '未验证（cli-identity） 是什么意思？' })).not.toContain(ORIGIN_LINE_NOTE)
    expect(ORIGIN_LINE_NOTE).toContain('grants nothing')
  })

  it('carries the ids a decision names and no instruction beyond routing', () => {
    const repo = new MemoryRepositories()
    const seen: Candidate[] = []
    const engine = new Engine({ repo, policy: () => teamPolicy(settings()), scope: teamScope(() => settings()), assessor: { request: vi.fn(c => { seen.push(c) }) },
      executor: { start: () => {}, deliver: () => {}, stop: () => {} }, outbox: { send: () => {}, status: () => undefined, withdraw: () => {} } })
    engine.receive(wb('1')); engine.evaluateDue()
    const card = candidateCard(seen[0]!)
    expect(card).toContain(`eval ${seen[0]!.evalId}`)
    expect(card).toContain('trigger 1 · workbench:owner · addressed (direct)')
    expect(card).toContain('request 1')
    expect(card).toContain('superagent_route')
    expect(card).toContain('do not add an implementation plan')
    // The team's one-request-one-ticket rule outranks generic router guidance loaded from elsewhere (agent-atelier allows splitting).
    expect(card).toContain('unless the request itself explicitly asks for separate parts'); expect(card).toContain('superagent_split'); expect(card).toContain('Never split on your own judgement')
    expect(card).toContain('does not change them')
  })

  it('router acceptance RJ2/RJ6: lists the team\'s other open tickets for duplicates, and says a question is answered and still decided', () => {
    const repo = new MemoryRepositories()
    const seen: Candidate[] = []
    const engine = new Engine({ repo, policy: () => teamPolicy(settings()), scope: teamScope(() => settings()), assessor: { request: vi.fn(c => { seen.push(c) }) },
      executor: { start: () => {}, deliver: () => {}, stop: () => {} }, outbox: { send: () => {}, status: () => undefined, withdraw: () => {} } })
    engine.receive(wb('1')); engine.evaluateDue()
    const others = Array.from({ length: OTHER_TICKETS_SHOWN + 3 }, (_, i) => ({ id: `t${String(i)}`, title: `check doc ${String(i)}`, createdAt: `2026-11-08T09:${String(10 + i)}:00.000Z` }))
    const card = candidateCard(seen[0]!, undefined, others)
    expect(card).toContain('open tickets on other threads (newest first):')
    // Newest first, capped: the newest is listed, the oldest beyond the cap is not.
    expect(card).toContain(`- t${String(OTHER_TICKETS_SHOWN + 2)} · check doc ${String(OTHER_TICKETS_SHOWN + 2)}`)
    expect(card).not.toContain('- t0 · ')
    expect(card.indexOf(`t${String(OTHER_TICKETS_SHOWN + 2)} ·`)).toBeLessThan(card.indexOf(`t${String(OTHER_TICKETS_SHOWN + 1)} ·`))
    expect(card).toContain('a duplicate is attached, never accepted twice')
    expect(card).toContain('superagent_reply (purpose answer')
    expect(card).toContain('Every candidate ends with a superagent_route item.')
    // No other open ticket: no such section.
    expect(candidateCard(seen[0]!)).not.toContain('open tickets on other threads')
    // Design reevaluate-note: the router is told a message is a second look, and how to pass a member a fact.
    expect(card).toContain('superagent_note')
    expect(candidateCard(seen[0]!, undefined, [], new Set(['1']))).toContain('trigger 1 · workbench:owner · addressed (direct) · ')
    expect(candidateCard(seen[0]!, undefined, [], new Set(['1']))).toContain('judged before: a person asked for a fresh judgement of this message')
    expect(card).not.toContain('judged before')
  })
})

describe('router acceptance RJ2/RJ6: the model sees what a superagent tool returned', () => {
  const registered = new Map<string, { output: { render: (args: unknown, value: Record<string, unknown>) => { type: string; text: string }[] } }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, () => undefined)
  const render = (name: string, value: Record<string, unknown>): string => registered.get(name)!.output.render({}, value)[0]!.text
  it('a read shows the tickets, a decision its ticket id, a refusal its code — not a bare ok', () => {
    expect(render('superagent_read', { ok: true, tickets: [{ id: 'abc', title: 'check a2a-cli.md', ended: null }] })).toBe('superagent read: ok {"tickets":[{"id":"abc","title":"check a2a-cli.md","ended":null}]}')
    expect(render('superagent_route', { ok: true, results: [{ ok: true, trigger_id: 'x', kind: 'accept', ticket_id: 'T1' }] })).toContain('"ticket_id":"T1"')
    expect(render('superagent_route', { ok: false, results: [{ ok: false, trigger_id: 'x', code: 'repo', error: 'no member works in a/b' }] })).toBe('superagent route refused: {"results":[{"ok":false,"trigger_id":"x","code":"repo","error":"no member works in a/b"}]}')
    expect(render('superagent_reply', { ok: false, code: 'notReady', error: 'the ticket has no usable result yet' })).toContain('"code":"notReady"')
    expect(render('a2a_ticket_report', { ok: true, ticket_id: 'T1', state: 'ready' })).toContain('"state":"ready"')
  })
  it('router acceptance RJ8: an attention reply carries the member\'s question verbatim, once', () => {
    expect(attentionText('等你回答后成员继续。', '这次报告用中文还是英文写？')).toBe('这次报告用中文还是英文写？\n\n等你回答后成员继续。')
    expect(attentionText('成员问：这次报告用中文还是英文写？请回复。', '这次报告用中文还是英文写？')).toBe('成员问：这次报告用中文还是英文写？请回复。')
  })
  it('a result longer than the cap is clipped and says so', () => {
    const text = render('superagent_read', { ok: true, tickets: 'x'.repeat(SAID_CAP * 2) })
    expect(text.length).toBeLessThan(SAID_CAP + 200)
    expect(text).toMatch(/… \(clipped, \d+ chars\)$/)
  })
})

describe('PR-B2a: bots, accept modes and rules (upstream docs/002)', () => {
  const thread = (subscriptions: string[] = []) => ({ key: 'a2a:t1', ref: { source: 'a2a', id: 't1' }, createdAt: '', subscriptions, correlated: [], pending: [], meta: {} })
  const bot = (over: Partial<Trigger> = {}): Trigger => ({ ...wb('9'), source: 'a2a', threads: [{ source: 'a2a', id: 't1' }], actor: { source: 'a2a', id: 'seat/0123456789abcdef' }, human: false, addressed: 'direct', ...over })
  const rules = [{ name: 'deps', text: 'Upgrade a pinned dependency when a bot reports it.', enabled: true }, { name: 'off-rule', text: 'disabled', enabled: false }]
  const with_ = (over: Partial<TeamSettings>) => teamPolicy(settings({ bots: { a2a: ['seat/0123456789abcdef'] }, rules, ...over }))
  it('a listed bot addressing the agent is an inferred candidate unless the mode is off; nothing else of a bot', () => {
    expect(with_({ acceptMode: 'observe' }).gate(bot(), thread(), [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'bot', sender: 'seat/0123456789abcdef', observation: { mode: 'observe' } } })
    expect(with_({ acceptMode: 'off' }).gate(bot(), thread(), [])).toEqual({ admissible: false, reason: 'acceptOff' })
    expect(with_({ acceptMode: 'auto' }).gate(bot({ actor: { source: 'a2a', id: 'other/0123456789abcdef' } }), thread(), [])).toEqual({ admissible: false, reason: 'botNotListed' })
    const { addressed: _a, ...unaddressed } = bot()
    expect(with_({ acceptMode: 'auto' }).gate(unaddressed, thread(), [])).toEqual({ admissible: false, reason: 'notAddressed' })
    // A bot listed under a2a is no workbench person, and an A2A handle is never human (a2a-watch D7).
    expect(with_({ acceptMode: 'auto' }).gate(bot({ source: 'workbench' }), thread(), [])).toEqual({ admissible: false, reason: 'botNotListed' })
    // Design M12: one message the owner took from an unlisted sender passes as an explicit request, and stays valid.
    const granted = teamPolicy(settings({ acceptMode: 'off' }), { taken: id => id === 'taken-1' })
    const out = granted.gate(bot({ id: 'taken-1', actor: { source: 'a2a', id: 'other/0123456789abcdef' } }), thread(), [])
    expect(out).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'listed', authority: 'owner-once', sender: 'other/0123456789abcdef' } })
    expect(granted.gate(bot({ id: 'other-2', actor: { source: 'a2a', id: 'other/0123456789abcdef' } }), thread(), [])).toEqual({ admissible: false, reason: 'botNotListed' })
    if (out.admissible) expect(granted.revalidate({ strength: 'explicit', basis: out.basis, actor: { source: 'a2a', id: 'other/0123456789abcdef' } } as never)).toBe(true)
  })
  it('an unlisted person\'s follow-up is inferred outside off', () => {
    const p = teamPolicy(settings({ acceptMode: 'observe' }))
    expect(p.gate(wb('1', 't1', { actor: { source: 'workbench', id: 'guest' } }), thread(['k1']), [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'followup' } })
  })
  it('accepting inferred work needs auto and only enabled rules', () => {
    expect(with_({ acceptMode: 'auto' }).admitsInferred(['deps'])).toBe(true)
    expect(with_({ acceptMode: 'auto' }).admitsInferred([])).toBe(false)
    expect(with_({ acceptMode: 'auto' }).admitsInferred(['off-rule'])).toBe(false)
    expect(with_({ acceptMode: 'auto' }).admitsInferred(['deps', 'unknown'])).toBe(false)
    expect(with_({ acceptMode: 'observe' }).admitsInferred(['deps'])).toBe(false)
  })
  it('revalidation of a bot mandate needs the bot still listed, auto, and its rules still enabled', () => {
    const mandate = { strength: 'inferred' as const, policyVersion: 'x', basis: { via: 'bot' as const, addressed: 'direct' as const, sender: 'seat/0123456789abcdef', rules: ['deps'], observation: { mode: 'auto' as const } }, actor: { source: 'a2a', id: 'seat/0123456789abcdef' }, scope: 's' }
    expect(with_({ acceptMode: 'auto' }).revalidate(mandate)).toBe(true)
    expect(with_({ acceptMode: 'observe' }).revalidate(mandate)).toBe(false)
    expect(with_({ acceptMode: 'auto', bots: { a2a: [] } }).revalidate(mandate)).toBe(false)
    expect(with_({ acceptMode: 'auto', rules: [{ ...rules[0]!, enabled: false }] }).revalidate(mandate)).toBe(false)
  })
  it('the Policy version moves with the mode, the bot list and the rules', () => {
    const base = policyVersion(settings())
    expect(policyVersion(settings({ acceptMode: 'auto' }))).not.toBe(base)
    expect(policyVersion(settings({ bots: { a2a: ['seat/0123456789abcdef'] } }))).not.toBe(base)
    expect(policyVersion(settings({ rules }))).not.toBe(base)
    expect(policyVersion(settings({ rules: [...rules].reverse() }))).toBe(policyVersion(settings({ rules })))
  })
  it('settings validate bots, mode and rules', () => {
    expect(parseSettings({ acceptMode: 'auto', bots: { a2a: ['seat/0123456789abcdef'] }, rules: [{ name: 'deps', text: 't' }] }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { acceptMode: 'auto', rules: [{ name: 'deps', text: 't', enabled: true }] } })
    expect(parseSettings({ acceptMode: 'always' }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ bots: { workbench: ['x'] } }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ rules: [{ name: 'Bad Name', text: 't' }] }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ rules: [{ name: 'a', text: 't' }, { name: 'a', text: 'u' }] }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(DEFAULT_SETTINGS.acceptMode).toBe('observe')
  })
})

describe('PR-B2a: the router tool on inferred candidates', () => {
  it('observe records would-accept; auto accepts on matched enabled rules; a bot can never stop', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const home = mkdtempSync(join(tmpdir(), 'sa-b2a-'))
    const host = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']), home, logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {} })
    expect(host.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, bots: { a2a: ['seat/0123456789abcdef'] }, rules: [{ name: 'deps', text: 'Upgrade a pinned dependency.' }] }, () => true)).toMatchObject({ ok: true })
    const botTrigger = (id: string, thread: string): Trigger => ({ ...wb(id, thread), source: 'a2a', threads: [{ source: 'a2a', id: thread }], actor: { source: 'a2a', id: 'seat/0123456789abcdef' }, human: false, channel: { source: 'a2a', thread, address: {} }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: `direct-${id}` } })
    host.engine.receive(botTrigger('1', 'b1')); host.pass()
    expect(host.engine.candidate('1')?.strength).toBe('inferred')
    expect(routeItem(host, { trigger_id: '1', kind: 'accept', title: 't', scope: 's', reason: 'matches deps' })).toMatchObject({ ok: false, code: 'rules' })
    expect(routeItem(host, { trigger_id: '1', kind: 'accept', title: 't', scope: 's', reason: 'matches deps', rules: ['deps'] })).toMatchObject({ ok: true, decision: 'ignore', reason: [{ code: 'observed', values: { text: 'deps' } }] })
    expect(host.store.tickets.list()).toHaveLength(0)
    expect(host.saveSettings({ acceptMode: 'auto' }, () => true)).toMatchObject({ ok: true })
    host.engine.receive(botTrigger('2', 'b2')); host.pass()
    expect(routeItem(host, { trigger_id: '2', kind: 'accept', title: 'bump', scope: 'one dep', reason: 'matches deps', rules: ['deps'] })).toMatchObject({ ok: true, decision: 'accept' })
    const ticket = host.store.tickets.list()[0]!
    expect(ticket.mandate).toMatchObject({ strength: 'inferred', basis: { via: 'bot', rules: ['deps'] } })
    // A bot asking to stop is never a stop (upstream stopNotExplicit).
    host.engine.receive(botTrigger('3', 'b3')); host.pass()
    expect(routeItem(host, { trigger_id: '3', kind: 'stop', ticket_id: ticket.id, reason: 'bot says stop' })).toMatchObject({ ok: true, decision: 'ignore', reason: [{ code: 'stopNotExplicit' }] })
    expect(host.store.tickets.get(ticket.id)?.ended).toBeUndefined()
    // A rule it did not match, or a disabled one, accepts nothing.
    host.engine.receive(botTrigger('4', 'b4')); host.pass()
    expect(routeItem(host, { trigger_id: '4', kind: 'accept', title: 'x', scope: 'y', reason: 'z', rules: ['nope'] })).toMatchObject({ ok: false })
  })
})

describe('PR-B2b: the a2a Channel through the hosted a2a-watch', () => {
  async function hostWith(answer: (args: string[]) => string | Error) {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const calls: string[][] = []
    const host = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']),
      home: mkdtempSync(join(tmpdir(), 'sa-b2b-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      homeUrl: () => 'http://127.0.0.1:1',
      runCli: async args => { calls.push(args); const out = answer(args); if (out instanceof Error) throw out; return out },
    })
    expect(host.saveSettings({ sources: { a2a: true } }, () => true)).toMatchObject({ ok: true })
    const queue = (id: string, address: Record<string, string>) => host.store.atomic(() => host.store.messages.save({ message: { id, channel: { source: 'a2a', thread: 'a2a:ctx', address }, text: 'done', kind: 'reply' }, status: 'pending', queuedAt: new Date().toISOString() }))
    const settle = async () => { host.pass(); for (let i = 0; i < 20 && calls.length >= 0; i++) await new Promise(r => setTimeout(r, 5)) }
    return { host, calls, queue, settle }
  }
  const caller = { caller: 'reporter/0123456789abcdef', task: 'direct-0123456789ab' }
  it('rechecks the caller link, then sends the one formal receipt; the row turns sent', async () => {
    const h = await hostWith(args => args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}')
    h.queue('m1', caller)
    await h.settle()
    expect(h.calls.map(a => a[0])).toEqual(['admission', 'receipt'])
    expect(h.calls[1]).toEqual(expect.arrayContaining(['direct-0123456789ab', '--to', 'reporter/0123456789abcdef', '--outcome', 'completed']))
    expect(h.host.store.messages.get('m1')?.status).toBe('sent')
  })
  it('acceptance run 3: the request a ticket was accepted from keeps its formal receipt for the result — before a ready report a reply on it is a follow-up', async () => {
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const h = await hostWith(args => args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}')
    expect(h.host.saveSettings({ canvas: 'team', router: 'session-r', acceptMode: 'auto', bots: { a2a: [caller.caller] }, rules: [{ name: 'deps', text: 'Upgrade a pinned dependency.' }] }, () => true)).toMatchObject({ ok: true })
    const channel = { source: 'a2a', thread: 'a2a:ctx-5', address: { ...caller, context: 'ctx-5' } }
    h.host.engine.receive({ ...wb('5', 'ctx-5'), source: 'a2a', threads: [{ source: 'a2a', id: 'ctx-5' }], actor: { source: 'a2a', id: caller.caller }, human: false, channel, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: caller.task } })
    h.host.pass()
    expect(routeItem(h.host, { trigger_id: '5', kind: 'accept', title: 'bump', scope: 'one dep', reason: 'matches deps', rules: ['deps'] })).toMatchObject({ ok: true, decision: 'accept' })
    const ticketId = h.host.store.tickets.list()[0]!.id
    const queueOn = (id: string, text: string, address: Record<string, string> = channel.address) => h.host.store.atomic(() => h.host.store.messages.save({ message: { id, channel: { ...channel, address }, text, kind: 'reply', ticketId }, status: 'pending', queuedAt: new Date().toISOString() }))
    const formal = () => h.calls.filter(a => a[0] === 'receipt' && !a.includes('--acknowledged'))
    // The member's question, relayed while the ticket is open with no ready report: a follow-up in the same context.
    queueOn('q1', 'zone 匹配要区分大小写吗？')
    await h.settle()
    expect(h.host.store.messages.get('q1')?.status).toBe('sent')
    expect(formal()).toEqual([])
    expect(h.calls.find(a => a[0] === 'route')).toEqual(expect.arrayContaining(['route', caller.caller, '--context', 'ctx-5']))
    // A reply on another request of the thread (not the one the ticket came from) still takes that request's receipt.
    queueOn('a1', '回答另一个问题', { caller: caller.caller, task: 'direct-other00000001', context: 'ctx-5' })
    await h.settle()
    expect(formal().map(a => a[1])).toEqual(['direct-other00000001'])
    // The member reports ready: the result takes the request's one formal receipt.
    await new Promise(r => setTimeout(r, 20))
    expect(h.host.report('session-m', { state: 'ready', summary: 'ticket/bump 0123abc' })).toMatchObject({ ok: true })
    queueOn('r1', '完成：ticket/bump 0123abc')
    await h.settle()
    expect(formal().map(a => a[1])).toEqual(['direct-other00000001', caller.task])
    expect(formal().at(-1)).toEqual(expect.arrayContaining(['--outcome', 'completed']))
  })
  it('acceptance run 3: a ticket that ends with its request unanswered gets the host\'s ending receipt — stopped at once, completed after the grace', async () => {
    const { SuperagentHost, END_RECEIPT_GRACE_MS } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    let clock = Date.parse('2026-11-07T10:00:00.000Z')
    const calls: string[][] = []
    const host = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']),
      home: mkdtempSync(join(tmpdir(), 'sa-end-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      homeUrl: () => 'http://127.0.0.1:1', now: () => new Date(clock).toISOString(),
      runCli: async args => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' },
    })
    expect(host.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [caller.caller] }, rules: [{ name: 'deps', text: 'Upgrade a pinned dependency.' }] }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { host.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    const open = (n: string) => {
      const channel = { source: 'a2a', thread: `a2a:ctx-${n}`, address: { caller: caller.caller, task: `direct-${n.padStart(12, '0')}`, context: `ctx-${n}` } }
      host.engine.receive({ ...wb(n, `ctx-${n}`), source: 'a2a', threads: [{ source: 'a2a', id: `ctx-${n}` }], actor: { source: 'a2a', id: caller.caller }, human: false, channel, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: channel.address.task } })
      host.pass()
      const routed = routeItem(host, { trigger_id: n, kind: 'accept', title: `t${n}`, scope: 's', reason: 'r', rules: ['deps'] }) as { ok: boolean; ticket_id: string }
      expect(routed).toMatchObject({ ok: true })
      return { ticketId: routed.ticket_id, task: channel.address.task }
    }
    const endings = () => calls.filter(a => a[0] === 'receipt' && !a.includes('--acknowledged'))
    // Stopped by the owner: upstream sends it no result; the host's ending receipt goes at once.
    const stopped = open('6')
    host.engine.stopTicket(stopped.ticketId, 'owner stop')
    await settle()
    expect(endings().map(a => [a[1], a[a.indexOf('--outcome') + 1]])).toEqual([[stopped.task, 'abandoned']])
    // Completed with no result relayed: the router gets the grace first, then the host sends the ending receipt once.
    const done = open('7')
    await settle()
    expect(host.report('session-m', { state: 'ready', summary: 'ticket/t7 0123abc' })).toMatchObject({ ok: true })
    await settle()
    expect(host.ticket(done.ticketId)?.ended?.outcome).toBe('completed')
    expect(endings().filter(a => a[1] === done.task)).toEqual([])
    clock += END_RECEIPT_GRACE_MS + 1_000
    await settle(); await settle()
    const doneReceipts = endings().filter(a => a[1] === done.task)
    expect(doneReceipts).toHaveLength(1)
    expect(doneReceipts[0]!.at(-1)).toContain('ticket/t7 0123abc')
    // market N1c: the ending receipt names the member that did the work, even though the ticket has ended; the
    // acknowledgement, sent before any member held it, names the router.
    expect(doneReceipts[0]!.slice(doneReceipts[0]!.indexOf('--by'), doneReceipts[0]!.indexOf('--by') + 2)).toEqual(['--by', 'session-m'])
    const ack = calls.find(a => a[0] === 'receipt' && a[1] === done.task && a.includes('--acknowledged'))!
    expect(ack.slice(ack.indexOf('--by'), ack.indexOf('--by') + 2)).toEqual(['--by', 'session-r'])
    expect(host.seatOf(done.ticketId)).toEqual({ seat: 'session-m', seatId: expect.stringMatching(/^seat-/), role: 'member' })
    // The role says which seat this is: the acknowledgement's is the router's, the ending receipt's the member's.
    expect(ack.slice(ack.indexOf('--by-role'), ack.indexOf('--by-role') + 2)).toEqual(['--by-role', 'router'])
    // The seat's stable id rides along (named dispatch N2): the market keys its records on it, not the handle.
    expect(ack[ack.indexOf('--by-seat-id') + 1]).toMatch(/^seat-[0-9a-f]{8}$/)
    expect(doneReceipts[0]![doneReceipts[0]!.indexOf('--by-seat-id') + 1]).toMatch(/^seat-[0-9a-f]{8}$/)
    expect(doneReceipts[0]!.slice(doneReceipts[0]!.indexOf('--by-role'), doneReceipts[0]!.indexOf('--by-role') + 2)).toEqual(['--by-role', 'member'])
  })
  it('a caller no longer linked makes the message gone (dropped), never sent', async () => {
    const h = await hostWith(args => args[0] === 'admission' ? JSON.stringify({ admitted: false }) : '{}')
    h.queue('m2', caller)
    await h.settle()
    expect(h.calls.map(a => a[0])).toEqual(['admission'])
    expect(h.host.store.messages.get('m2')).toMatchObject({ status: 'dropped', reason: 'gone' })
  })
  it('a failed send stays pending for the next pass; a Source switched off sends nothing', async () => {
    const h = await hostWith(() => new Error('host busy'))
    h.queue('m3', caller)
    await h.settle()
    expect(h.host.store.messages.get('m3')?.status).toBe('pending')
    expect(h.host.saveSettings({ sources: { a2a: false } }, () => true)).toMatchObject({ ok: true })
    const before = h.calls.length
    await h.settle()
    expect(h.calls.length).toBe(before)
    expect(h.host.a2aAddress).toBeUndefined()
  })
})

describe('PR-B2b: the A2A Source scope is a2a-watch\'s trust filter', () => {
  it('a Trigger without a trusted proof and an operator link, or a loop or a receipt, is filtered', () => {
    const scope = teamScope(() => settings({ sources: { workbench: true, a2a: true } })).scope
    expect(scope({ source: 'a2a', meta: { proof: 'cli-identity', admission: 'cli-deposit' } })).toMatchObject({ listened: true })
    expect(scope({ source: 'a2a', meta: { proof: 'legacy-window', admission: 'cli-deposit' } })).toEqual({ listened: false, reason: 'unverified' })
    expect(scope({ source: 'a2a', meta: { proof: 'cli-identity', admission: 'scope-off' } })).toEqual({ listened: false, reason: 'unlinked' })
    expect(scope({ source: 'a2a', meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: 'a2a-x' } })).toEqual({ listened: false, reason: 'loop' })
    expect(scope({ source: 'a2a', meta: { proof: 'cli-identity', admission: 'cli-deposit', receiptFor: 't' } })).toEqual({ listened: false, reason: 'receipt' })
    expect(teamScope(() => settings()).scope({ source: 'a2a', meta: { proof: 'cli-identity', admission: 'cli-deposit' } })).toEqual({ listened: false, reason: 'sourceOff' })
  })
})

describe('PR-C1: executor restart recovery', () => {
  it('a running assignment restarts on the same member with upstream\'s recovery note; the slot is not stuck', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const home = mkdtempSync(join(tmpdir(), 'sa-c1-'))
    const make = (sent: Array<[string, string]>) => new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']), home, logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {} })
    const sent1: Array<[string, string]> = []
    const h1 = make(sent1)
    expect(h1.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    h1.start()
    const asked = h1.request('do it')
    expect(asked.ok).toBe(true)
    const triggerId = (asked as { triggerId: string }).triggerId
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    expect(routeItem(h1, { trigger_id: triggerId, kind: 'accept', title: 'T', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
    await new Promise(r => setTimeout(r, 20))
    expect(sent1.filter(([id, t]) => id === 'session-m' && t.includes('[superagent assignment]'))).toHaveLength(1)
    const ticketId = h1.executor.list()[0]!.ticketId
    expect(h1.ticket(ticketId)?.assignments.at(-1)?.state).toBe('running')
    void h1.stop()

    // The host restarts: the running assignment is interrupted and runs again on the member, with the recovery note.
    const sent2: Array<[string, string]> = []
    const h2 = make(sent2)
    h2.start()
    await new Promise(r => setTimeout(r, 30))
    const t = h2.ticket(ticketId)!
    expect(t.assignments.at(-1)?.state).toBe('running')
    expect(h2.executor.list().map(b => [b.member, b.ticketId])).toEqual([['session-m', ticketId]])
    expect(sent2.some(([id, text]) => id === 'session-m' && (text.includes('[superagent assignment]') || text.includes('restarted')))).toBe(true)
    void h2.stop()
  })
})

describe('PR-C2: remote members and served teams are judged by pinned keys', () => {
  const KEY_B = 'MCowBQYDK2VwAyEA' + 'B'.repeat(44), KEY_A = 'MCowBQYDK2VwAyEA' + 'A'.repeat(44), KEY_E = 'MCowBQYDK2VwAyEA' + 'E'.repeat(44)
  it('remote members are the canvas team\'s remote slots (keys pinned there); the served team is pinned by its action; both survive a reload', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { parseStoredSettings } = await import('../../src/superagent/host/policy.ts')
    const home = mkdtempSync(join(tmpdir(), 'sa-c2-'))
    const remote = [{ ref: 'dsh/bbbbbbbb@12345678', key: KEY_B, url: 'http://127.0.0.1:9' }]
    const make = () => new SuperagentHost({ canvasTeam: canvasOf(['session-r'], remote), home, logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {}, localSessionOf: h => h === 'dsh/cccccccc' ? 'session-c' : undefined })
    const h = make()
    // A write never names members, remote ones included: they are added on the canvas, which pins their key.
    expect(h.saveSettings({ remoteMembers: remote }, () => true)).toMatchObject({ ok: false, error: expect.stringContaining('canvas') })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    expect(h.serveTeam({ url: 'http://127.0.0.1:8', key: KEY_A }, ['session-c'], () => true)).toEqual({ ok: true })
    const again = make()
    expect(again.settings.remoteMembers).toEqual(remote)
    expect(again.settings.serves).toEqual({ url: 'http://127.0.0.1:8', key: KEY_A, members: ['session-c'] })
    // A v4 file's stored pool is dropped on load (the canvas is the pool now), whatever its shape.
    expect(parseStoredSettings({ members: ['session-x'], remoteMembers: [{ ref: 'bad', key: KEY_B, url: 'x' }] })).toMatchObject({ ok: true, settings: { members: [], remoteMembers: [] } })
    // Team side: a report or turn end counts only under the pinned key for that member handle.
    expect(again.remoteEvent('idle', 'dsh/bbbbbbbb', KEY_E, undefined)).toMatchObject({ ok: false, code: 'not-member' })
    expect(again.remoteEvent('idle', 'dsh/bbbbbbbb', KEY_B, undefined)).toEqual({ ok: true })
    expect(again.remoteEvent('report', 'dsh/bbbbbbbb', KEY_B, { state: 'ready', summary: 'x' })).toMatchObject({ ok: false, code: 'not-assigned' })
    // Member side: work counts only from the served team's key, for a session that serves it.
    expect(again.assignedWork('assign', 'dsh/cccccccc', KEY_E, 'work')).toMatchObject({ ok: false, code: 'not-team' })
    expect(again.assignedWork('assign', 'dsh/dddddddd', KEY_A, 'work')).toMatchObject({ ok: false, code: 'not-member' })
    expect(again.assignedWork('assign', 'dsh/cccccccc', KEY_A, 'work')).toEqual({ ok: true })
    expect(again.roleOf('session-c')).toBe('member')
    // Leaving the team drops the pin and the role.
    expect(again.serveTeam(undefined, [], () => false)).toEqual({ ok: true })
    expect(again.roleOf('session-c')).toBeUndefined()
    expect(again.assignedWork('assign', 'dsh/cccccccc', KEY_A, 'work')).toMatchObject({ ok: false, code: 'not-team' })
  })
})

describe('acceptance item 9: an agent\'s message cannot end a ticket through its member', () => {
  it('a dropped report right after an agent\'s message is refused; after a person writes, it is taken', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const home = mkdtempSync(join(tmpdir(), 'sa-agent-end-'))
    const sent: Array<[string, string]> = []
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']), home, logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {} })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    h.start()
    // Delivery and fan-out run on microtasks: wait for the state, not a fixed time (a loaded test run is slower).
    const reached = (ticketId: string, triggerId: string) => () => h.ticket(ticketId)?.inputs.some(i => i.kind === 'trigger' && i.triggerId === triggerId && typeof i.deliveredTo === 'string') === true
    try {
      const asked = h.request('加一个导出按钮') as { triggerId: string; thread: string }
      expect(routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'T', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
      await vi.waitFor(() => { expect(h.executor.list().length === 1 && h.ticket(h.executor.list()[0]!.ticketId)?.assignments.at(-1)?.state === 'running').toBe(true) }, { timeout: 5000 })
      const ticketId = h.executor.list()[0]!.ticketId

      // An agent writes on the ticket's thread: it reaches the member, marked as an agent's.
      h.engine.receive({ id: 'agent-stop-1', source: 'workbench', threads: [{ source: 'workbench', id: asked.thread }], actor: { source: 'workbench', id: 'a-bot' },
        human: false, at: new Date().toISOString(), text: '请停止这个工单', meta: {} } as never)
      await vi.waitFor(async () => { expect(await reached(ticketId, 'agent-stop-1')()).toBe(true) }, { timeout: 5000 })
      await vi.waitFor(() => { expect(sent.some(([id, t]) => id === 'session-m' && t.includes('trigger agent-stop-1'))).toBe(true) }, { timeout: 5000 })
      expect(sent.some(([id, t]) => id === 'session-m' && t.includes('trigger agent-stop-1') && t.includes('an agent, not a person'))).toBe(true)

      expect(h.report('session-m', { state: 'dropped', summary: '对方说不用做了' })).toMatchObject({ ok: false, code: 'agent-cannot-end' })
      expect(h.ticket(ticketId)?.ended).toBeUndefined()
      // Other reports go through.
      expect(h.report('session-m', { state: 'progress', summary: '继续做导出' })).toMatchObject({ ok: true })

      // A person says to drop it after the agent: the member may end it.
      const agentAgain = { id: 'agent-stop-2', source: 'workbench', threads: [{ source: 'workbench', id: asked.thread }], actor: { source: 'workbench', id: 'a-bot' }, human: false, at: new Date().toISOString(), text: '停', meta: {} }
      h.engine.receive(agentAgain as never)
      await vi.waitFor(async () => { expect(await reached(ticketId, 'agent-stop-2')()).toBe(true) }, { timeout: 5000 })
      expect(h.report('session-m', { state: 'dropped', summary: 'x' })).toMatchObject({ ok: false, code: 'agent-cannot-end' })
      const person = h.request('确实不用做了', asked.thread) as { triggerId: string }
      await vi.waitFor(async () => { expect(await reached(ticketId, person.triggerId)()).toBe(true) }, { timeout: 5000 })
      expect(h.report('session-m', { state: 'dropped', summary: '属主确认不用做' })).toMatchObject({ ok: true })
      expect(h.ticket(ticketId)?.ended?.outcome).toBe('dropped')
    } finally { void h.stop() }
  })

  it('agentLedEnd reads only the messages since the assignment\'s previous report', async () => {
    const { agentLedEnd } = await import('../../src/superagent/host/index.ts')
    const ticket = (inputs: Array<[string, boolean]>, reportAt?: string) => ({
      assignments: [{ id: 'a1', state: 'running', createdAt: '2026-11-07T10:00:00.000Z', ...(reportAt ? { report: { state: 'progress', summary: 's', at: reportAt } } : {}) }],
      inputs: inputs.map(([at, human], i) => ({ id: `i${String(i)}`, kind: 'trigger', triggerId: `t${String(i)}`, at, deliveredTo: 'a1', ...(human ? { human: true } : {}) })),
    }) as never
    expect(agentLedEnd(ticket([]), 'a1')).toBe(false)
    expect(agentLedEnd(ticket([['2026-11-07T10:01:00.000Z', false]]), 'a1')).toBe(true)
    expect(agentLedEnd(ticket([['2026-11-07T10:01:00.000Z', false], ['2026-11-07T10:02:00.000Z', true]]), 'a1')).toBe(false)
    expect(agentLedEnd(ticket([['2026-11-07T10:01:00.000Z', true], ['2026-11-07T10:02:00.000Z', false]]), 'a1')).toBe(true)
    // An agent's message before the previous report was already answered by that report.
    expect(agentLedEnd(ticket([['2026-11-07T10:01:00.000Z', false]], '2026-11-07T10:05:00.000Z'), 'a1')).toBe(false)
    // One stamped the same millisecond as the previous report is not known to have been seen by it.
    expect(agentLedEnd(ticket([['2026-11-07T10:05:00.000Z', false]], '2026-11-07T10:05:00.000Z'), 'a1')).toBe(true)
  })
})

describe('a member\'s turn: silent ends, failures, handoffs and stale reports', () => {
  async function team(extra: Record<string, unknown> = {}) {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const sent: Array<[string, string]> = []
    const turn = { quiet: true, text: '' }
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-a']), home: mkdtempSync(join(tmpdir(), 'sa-turn-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ ...turn }), ...extra } as never)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    h.start()
    const accept = (text: string, title: string): { ticket: string; thread: string; trigger: string } => {
      const asked = h.request(text) as { triggerId: string; thread: string }
      h.pass()
      const out = routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title, scope: 's', reason: 'r' }) as { ticket_id: string }
      return { ticket: out.ticket_id, thread: asked.thread, trigger: asked.triggerId }
    }
    const cards = (prefix: string): string[] => sent.filter(([id, t]) => id === 'session-a' && t.startsWith(prefix)).map(([, t]) => t)
    const toRouter = (): string[] => sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent report]')).map(([, t]) => t)
    const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))
    return { h, sent, turn, accept, cards, toRouter, tick }
  }

  it('a turn that ends without a report reports waiting with the member\'s last words, and frees the member', async () => {
    const m = await team()
    try {
      const one = m.accept('第一', '一'), two = m.accept('第二', '二')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(1) })
      m.turn.text = '我看完了，等你确认。'
      m.h.memberIdle('session-a')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(2) })
      expect(m.cards('[superagent assignment]')[1]).toContain(two.ticket)
      expect(m.h.store.tickets.get(one.ticket)!.assignments.at(-1)!.report).toMatchObject({ state: 'waiting', summary: '我看完了，等你确认。' })
      expect(m.toRouter().some(t => t.includes(one.ticket) && t.includes('我看完了'))).toBe(true)
    } finally { await m.h.stop() }
  })

  it('shell jobs still running hold the slot and decide nothing until they end', async () => {
    const m = await team()
    try {
      const one = m.accept('第一', '一'); m.accept('第二', '二')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(1) })
      m.turn.quiet = false
      m.h.memberIdle('session-a')
      await m.tick()
      expect(m.h.store.tickets.get(one.ticket)!.assignments.at(-1)!.report).toBeUndefined()
      expect(m.cards('[superagent assignment]')).toHaveLength(1)
      m.turn.quiet = true
      m.h.memberIdle('session-a')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(2) })
    } finally { await m.h.stop() }
  })

  it('a ticket waiting on a person holds no member; the answer brings it back to that member first', async () => {
    const m = await team()
    try {
      const one = m.accept('第一', '一'), two = m.accept('第二', '二'), three = m.accept('第三', '三')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(1) })
      expect(m.h.report('session-a', { state: 'waiting', summary: '要问一下', question: '用哪种格式？' }, one.ticket)).toMatchObject({ ok: true })
      m.h.memberIdle('session-a')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(2) })
      expect(m.cards('[superagent assignment]')[1]).toContain(two.ticket)
      expect(m.h.store.tickets.get(one.ticket)!.assignments.at(-1)!.state).toBe('running')
      // The parked ticket still takes its member's report.
      expect(m.h.report('session-a', { state: 'progress', summary: '后台那项跑完了' }, one.ticket)).toMatchObject({ ok: true })
      expect(m.h.request('用 CSV', one.thread)).toMatchObject({ ok: true })
      m.h.pass()
      await m.tick()
      expect(m.cards('[superagent input]')).toHaveLength(0)
      // The member finishes the second ticket: the answer goes before the third ticket.
      expect(m.h.report('session-a', { state: 'ready', summary: '完成' }, two.ticket)).toMatchObject({ ok: true })
      await vi.waitFor(() => { expect(m.cards('[superagent input]').some(t => t.includes(one.ticket) && t.includes('用 CSV'))).toBe(true) })
      expect(m.cards('[superagent assignment]').some(t => t.includes(three.ticket))).toBe(false)
    } finally { await m.h.stop() }
  })

  it('a wrong id is refused and says what is open; nothing changes and it is counted', async () => {
    const m = await team()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    try {
      const asked = m.h.request('一张') as { triggerId: string }
      m.h.pass()
      const wrong = asked.triggerId.slice(0, -1) + (asked.triggerId.endsWith('0') ? '1' : '0')
      const out = routeItem(m.h, { trigger_id: wrong, kind: 'ignore', reason: 'r' }) as { ok: boolean; error: string }
      expect(out).toMatchObject({ ok: false, trigger_id: wrong })
      expect(out.error).toContain('nothing was changed')
      expect(out.error).toContain(`Closest: ${asked.triggerId}`)
      expect(m.h.store.triggers.disposition(asked.triggerId)?.decisionId).toBeUndefined()
      expect((m.h.state() as { refusals: { counts: Record<string, number> } }).refusals.counts['superagent-wrong-id']).toBe(1)
      const one = routeItem(m.h, { trigger_id: asked.triggerId, kind: 'accept', title: '一', scope: 's', reason: 'r' }) as { ticket_id: string }
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(1) })
      const stale = m.h.report('session-a', { state: 'ready', summary: 'x' }, one.ticket_id.slice(0, -1) + 'z') as { code: string; error: string }
      expect(stale.code).toBe('not-yours')
      expect(stale.error).toContain(`Your tickets: ${one.ticket_id}`)
      expect(m.h.store.tickets.get(one.ticket_id)!.ended).toBeUndefined()
    } finally { await m.h.stop() }
  })

  it('a report names its ticket: a late turn cannot report on the next one', async () => {
    const m = await team()
    try {
      const one = m.accept('第一', '一'), two = m.accept('第二', '二')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(1) })
      m.h.engine.stopTicket(one.ticket, 'not needed')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(2) })
      expect(m.h.report('session-a', { state: 'ready', summary: '旧回合的结果' }, one.ticket)).toMatchObject({ ok: false, code: 'not-yours' })
      expect(m.h.store.tickets.get(two.ticket)!.ended).toBeUndefined()
    } finally { await m.h.stop() }
  })

  it('a member stopped mid-turn takes no new ticket until that turn has ended', async () => {
    let running = true
    const m = await team({ cancelTurn: () => running })
    try {
      const one = m.accept('第一', '一'); m.accept('第二', '二')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(1) })
      m.h.engine.stopTicket(one.ticket, 'not needed')
      await m.tick()
      expect(m.cards('[superagent assignment]')).toHaveLength(1)
      running = false
      m.h.memberIdle('session-a')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(2) })
    } finally { await m.h.stop() }
  })

  it('a failed turn fails the ticket for a person; a passing failure goes on after a backoff', async () => {
    const m = await team()
    try {
      const one = m.accept('第一', '一')
      await vi.waitFor(() => { expect(m.cards('[superagent assignment]')).toHaveLength(1) })
      vi.useFakeTimers({ toFake: ['setTimeout'] })
      m.h.memberFailed('session-a', new Error('429 rate limit'))
      m.h.memberIdle('session-a') // the idle that follows a failure ends nothing while the retry waits
      expect(m.h.store.tickets.get(one.ticket)!.assignments.at(-1)!.report).toBeUndefined()
      await vi.advanceTimersByTimeAsync(15_000)
      vi.useRealTimers()
      await vi.waitFor(() => { expect(m.sent.some(([id, t]) => id === 'session-a' && t.includes('failed for a passing reason'))).toBe(true) })
      m.h.memberFailed('session-a', new Error('invalid tool schema'))
      expect(ticketStage(m.h.store.tickets.get(one.ticket)!)).toEqual({ stage: 'person', action: 'failed' })
      expect(m.toRouter().some(t => t.includes('invalid tool schema'))).toBe(true)
    } finally { vi.useRealTimers(); await m.h.stop() }
  })
})

describe('ops loop: members work in repositories; a ticket accepted for one runs only on its members', () => {
  it('paused: nothing is assigned or delivered to a member; resuming sends what waited', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const home = mkdtempSync(join(tmpdir(), 'sa-paused-'))
    const sent: Array<[string, string]> = []
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-a']), home, logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {} })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    h.start()
    const toMember = (prefix: string): string[] => sent.filter(([id, t]) => id === 'session-a' && t.startsWith(prefix)).map(([, t]) => t)
    const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 30))
    try {
      const first = h.request('第一张') as { triggerId: string; thread: string }
      h.pass()
      const one = routeItem(h, { trigger_id: first.triggerId, kind: 'accept', title: '一', scope: 's', reason: 'r' }) as { ticket_id: string }
      await vi.waitFor(() => { expect(toMember('[superagent assignment]')).toHaveLength(1) })
      const second = h.request('第二张') as { triggerId: string }
      h.pass()
      expect(routeItem(h, { trigger_id: second.triggerId, kind: 'accept', title: '二', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
      await settle()
      expect(h.saveSettings({ paused: true }, () => true)).toMatchObject({ ok: true })
      // An Input for the running ticket is held, and the member the stop frees takes no new ticket.
      expect(h.request('补充', first.thread)).toMatchObject({ ok: true })
      await settle()
      expect(toMember('[superagent input]')).toHaveLength(0)
      h.engine.stopTicket(one.ticket_id, 'done')
      h.pass()
      await settle()
      expect(toMember('[superagent assignment]')).toHaveLength(1)
      expect(h.saveSettings({ paused: false }, () => true)).toMatchObject({ ok: true })
      await vi.waitFor(() => { expect(toMember('[superagent assignment]')).toHaveLength(2) })
    } finally { await h.stop() }
  })

  it('an Input that arrives during a delivery goes out right after it', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const home = mkdtempSync(join(tmpdir(), 'sa-again-'))
    const sent: string[] = []
    let release: ((ok: boolean) => void) | undefined
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-a']), home, logger: { info: () => {}, warn: () => {} }, interval: () => () => {},
      deliverToSession: ((id: string, text: string) => {
        if (id !== 'session-a') return true
        sent.push(text)
        return text.startsWith('[superagent input]') && release === undefined ? new Promise<boolean>(resolve => { release = resolve }) : true
      }) as never })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    h.start()
    try {
      const first = h.request('一张') as { triggerId: string; thread: string }
      h.pass()
      expect(routeItem(h, { trigger_id: first.triggerId, kind: 'accept', title: '一', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
      await vi.waitFor(() => { expect(sent.some(t => t.startsWith('[superagent assignment]'))).toBe(true) })
      const one = h.request('补充甲', first.thread) as { triggerId: string }
      await vi.waitFor(() => { expect(release).toBeDefined() })
      const two = h.request('补充乙', first.thread) as { triggerId: string }
      await new Promise(resolve => setTimeout(resolve, 20))
      release!(true)
      await vi.waitFor(() => { expect(sent.some(t => t.startsWith('[superagent input]') && t.includes(two.triggerId))).toBe(true) })
      expect(sent.filter(t => t.includes(one.triggerId))).toHaveLength(1)
    } finally { await h.stop() }
  })

  it('a failed assignment goes out again on the periodic retry', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const home = mkdtempSync(join(tmpdir(), 'sa-retry-'))
    const sent: Array<[string, string]> = []
    let up = false
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-a']), home, logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { if (id === 'session-a' && !up) return false; sent.push([id, text]); return true }, interval: () => () => {} })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    h.start()
    const now = vi.spyOn(Date, 'now')
    try {
      const first = h.request('一张') as { triggerId: string }
      h.pass()
      expect(routeItem(h, { trigger_id: first.triggerId, kind: 'accept', title: '一', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(sent.some(([id]) => id === 'session-a')).toBe(false)
      up = true
      now.mockReturnValue(Date.now() + 60_000)
      h.pass()
      await vi.waitFor(() => { expect(sent.some(([id, t]) => id === 'session-a' && t.startsWith('[superagent assignment]'))).toBe(true) })
    } finally { now.mockRestore(); await h.stop() }
  })

  it('settings name each member\'s repository (owner/name), only for members, and drop it when the member goes', () => {
    // Design v5: the pool comes from the canvas (the host passes it in as the current settings); a write never names members.
    expect(parseSettings({ members: ['session-a', 'session-b'] }, DEFAULT_SETTINGS)).toMatchObject({ ok: false, error: expect.stringContaining('canvas') })
    const s: TeamSettings = { ...DEFAULT_SETTINGS, members: ['session-a', 'session-b'] }
    expect(parseSettings({ repos: { 'session-a': 'NelsonLongxiang/dsh-open-a2a-net', 'session-b': 'NelsonLongxiang/agent-atelier' } }, s)).toMatchObject({ ok: true, settings: { repos: { 'session-a': 'NelsonLongxiang/dsh-open-a2a-net', 'session-b': 'NelsonLongxiang/agent-atelier' } } })
    expect(parseSettings({ repos: { 'session-x': 'o/r' } }, s)).toMatchObject({ ok: false, error: expect.stringContaining('not a member') })
    expect(parseSettings({ repos: { 'session-a': 'no-slash' } }, s)).toMatchObject({ ok: false, error: expect.stringContaining('owner/name') })
    const named = (parseSettings({ repos: { 'session-a': 'o/a', 'session-b': 'o/b' } }, s) as { settings: TeamSettings }).settings
    // session-b left the canvas: its repository is not carried into the next write.
    expect(parseSettings({ paused: false }, { ...named, members: ['session-a'] })).toMatchObject({ ok: true, settings: { repos: { 'session-a': 'o/a' } } })
    expect(parseSettings({ paused: true }, named)).toMatchObject({ ok: true, settings: { repos: { 'session-a': 'o/a', 'session-b': 'o/b' } } })
    expect(DEFAULT_SETTINGS.repos).toEqual({})
  })

  it('the router names the repository; its ticket waits for that repository\'s member without holding up others', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const home = mkdtempSync(join(tmpdir(), 'sa-repos-'))
    const sent: Array<[string, string]> = []
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-a', 'session-b']), home, logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {} })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', repos: { 'session-a': 'o/net', 'session-b': 'o/atelier' } }, () => true)).toMatchObject({ ok: true })
    h.start()
    const assigned = (member: string): string[] => sent.filter(([id, t]) => id === member && t.startsWith('[superagent assignment]')).map(([, t]) => t)
    try {
      // The router sees the team's repositories.
      const first = h.request('net：核对 README 的命令表') as { triggerId: string }
      h.pass()
      expect(sent.find(([id]) => id === 'session-r')?.[1]).toContain('The team\'s members each work in one repository: o/atelier, o/net')
      // An unknown repository is refused, naming the known ones; nothing is accepted.
      expect(routeItem(h, { trigger_id: first.triggerId, kind: 'accept', title: 'x', scope: 'y', reason: 'z', repo: 'o/other' })).toMatchObject({ ok: false, code: 'repo', error: expect.stringContaining('o/atelier, o/net') })
      expect(routeItem(h, { trigger_id: first.triggerId, kind: 'accept', title: 'net 1', scope: 's', reason: 'r', repo: 'o/net' })).toMatchObject({ ok: true, repo: 'o/net' })
      await vi.waitFor(() => { expect(assigned('session-a')).toHaveLength(1) })
      expect(assigned('session-a')[0]).toContain('repository: o/net (yours)')
      expect(assigned('session-a')[0]).toContain('reasonable defaults for routine steps')
      // A ticket's worktree stays inside the member's sandbox, kept out of the checkout's status (a path beside it is refused).
      expect(assigned('session-a')[0]).toContain('.worktrees/')
      expect(assigned('session-a')[0]).toContain('.git/info/exclude')
      // A second net ticket waits for session-a although session-b is free …
      const second = h.request('net：核对 docs/protocol') as { triggerId: string }
      expect(routeItem(h, { trigger_id: second.triggerId, kind: 'accept', title: 'net 2', scope: 's', reason: 'r', repo: 'o/net' })).toMatchObject({ ok: true })
      // … and an atelier ticket accepted after it goes to session-b at once.
      const third = h.request('atelier：校准 a2a-cli 参考') as { triggerId: string }
      expect(routeItem(h, { trigger_id: third.triggerId, kind: 'accept', title: 'atelier 1', scope: 's', reason: 'r', repo: 'o/atelier' })).toMatchObject({ ok: true })
      await vi.waitFor(() => { expect(assigned('session-b')).toHaveLength(1) })
      expect(assigned('session-b')[0]).toContain('atelier 1')
      expect(assigned('session-a')).toHaveLength(1)
      // The ticket repositories persist with the bindings.
      const stored = JSON.parse(readFileSync(join(home, 'superagent', 'executor.json'), 'utf8')) as { repos: Record<string, string> }
      expect(Object.values(stored.repos).sort()).toEqual(['o/atelier', 'o/net', 'o/net'])
      // session-a finishes: the waiting net ticket launches on it.
      expect(h.report('session-a', { state: 'ready', summary: '核对完毕，ticket/net-1 0123abc' })).toMatchObject({ ok: true })
      await vi.waitFor(() => { expect(assigned('session-a')).toHaveLength(2) })
      expect(assigned('session-a')[1]).toContain('net 2')
      // Its own ready report ended net 1: no "no longer yours" notice wakes it for a turn.
      const notices = (member: string) => sent.filter(([id, t]) => id === member && t.includes('is no longer yours'))
      expect(notices('session-a')).toEqual([])
      // An owner stop is news to the member: it gets the notice.
      const atelier = h.store.tickets.list().find(t => t.title === 'atelier 1')!
      h.engine.stopTicket(atelier.id, 'owner stop')
      await vi.waitFor(() => { expect(notices('session-b')).toHaveLength(1) })
      expect(notices('session-b')[0]?.[1]).toContain('(owner stop)')
    } finally { void h.stop() }
  })
})

describe('ops team ledger: every A2A message to the team address gets a formal outcome', () => {
  it('a message the team does not take is told so (rejected, with the reason)', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const calls: string[][] = []
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']),
      home: mkdtempSync(join(tmpdir(), 'sa-outcome-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      homeUrl: () => 'http://127.0.0.1:1',
      runCli: async args => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' },
    })
    const bot = 'reporter/0123456789abcdef', stranger = 'stranger/0123456789abcdef'
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'observe', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Upgrade a pinned dependency.' }] }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { h.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    const receive = (n: string, from: string, ctx = `ctx-${n}`) => {
      const task = `direct-${n.padStart(12, '0')}`
      h.engine.receive({ ...wb(n, ctx), source: 'a2a', threads: [{ source: 'a2a', id: ctx }], actor: { source: 'a2a', id: from }, human: false, channel: { source: 'a2a', thread: `a2a:${ctx}`, address: { caller: from, task, context: ctx } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } })
      h.pass()
      return task
    }
    const receiptFor = (task: string) => calls.find(a => a[0] === 'receipt' && a[1] === task && !a.includes('--acknowledged'))
    const outcome = (args: string[] | undefined) => args?.[args.indexOf('--outcome') + 1]
    // Observe mode: the router's accept is recorded as would-accept; the requester learns nothing was taken.
    const observed = receive('1', bot)
    expect(routeItem(h, { trigger_id: '1', kind: 'accept', title: 't', scope: 's', reason: 'matches deps', rules: ['deps'] })).toMatchObject({ ok: true, decision: 'ignore' })
    // A sender not on the list is refused at the gate.
    const refused = receive('2', stranger)
    await settle()
    expect(outcome(receiptFor(observed))).toBe('rejected')
    expect(receiptFor(observed)!.at(-1)).toContain('观察模式')
    expect(outcome(receiptFor(refused))).toBe('rejected')
    expect(receiptFor(refused)!.at(-1)).toContain('名单')
    // Auto: a ticket, whose own request keeps the acknowledgement-and-result path (no outcome receipt now).
    expect(h.saveSettings({ acceptMode: 'auto' }, () => true)).toMatchObject({ ok: true })
    const request = receive('3', bot, 'ctx-3')
    const accepted = routeItem(h, { trigger_id: '3', kind: 'accept', title: 'bump', scope: 's', reason: 'r', rules: ['deps'] }) as { ticket_id: string }
    await settle()
    expect(receiptFor(request)).toBeUndefined()
    // The bot's stop on that thread is refused (an agent cannot stop a ticket), and told so.
    const stop = receive('4', bot, 'ctx-3')
    expect(routeItem(h, { trigger_id: '4', kind: 'stop', ticket_id: accepted.ticket_id, reason: 'bot says stop' })).toMatchObject({ ok: true, decision: 'ignore' })
    await settle()
    expect(outcome(receiptFor(stop))).toBe('rejected')
    expect(receiptFor(stop)!.at(-1)).toContain('不能停止工单')
    // Each message is answered once.
    await settle()
    expect(calls.filter(a => a[0] === 'receipt' && [observed, refused, stop].includes(a[1]!)).length).toBe(3)
  })
})

describe('a message the team could not judge still gets its outcome', () => {
  it('after the router times out for good, the sender is told (failed) once the grace has passed, and not before', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { UNAVAILABLE_RECEIPT_GRACE_MS } = await import('../../src/superagent/host/receipts.ts')
    const calls: string[][] = []
    let clock = Date.parse('2026-11-07T00:00:30.000Z')
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r']), home: mkdtempSync(join(tmpdir(), 'sa-unavailable-')), logger: { info: () => {}, warn: () => {} },
      deliverToSession: () => true, interval: () => () => {}, homeUrl: () => 'http://127.0.0.1:1', now: () => new Date(clock).toISOString(),
      runCli: async args => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' } })
    const bot = 'reporter/0123456789abcdef'
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Upgrade a pinned dependency.' }] }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { h.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    const task = 'direct-000000000001'
    h.engine.receive({ ...wb('1', 'ctx-1'), at: new Date(clock).toISOString(), source: 'a2a', threads: [{ source: 'a2a', id: 'ctx-1' }], actor: { source: 'a2a', id: bot }, human: false, channel: { source: 'a2a', thread: 'a2a:ctx-1', address: { caller: bot, task, context: 'ctx-1' } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } })
    const receiptFor = () => calls.find(a => a[0] === 'receipt' && a[1] === task && !a.includes('--acknowledged'))
    const outcome = (args: string[] | undefined) => args?.[args.indexOf('--outcome') + 1]
    // The router never answers: each Eval expires; the third expiry records the message unavailable.
    for (let i = 0; i < 4; i++) { await settle(); clock += 11 * 60_000 }
    await settle()
    const decided = h.store.decisions.byThread('a2a:ctx-1').map(d => d.kind)
    expect(decided.at(-1)).toBe('unavailable')
    // Within the grace the owner may still ask for a fresh judgement: nothing is sent yet.
    expect(receiptFor()).toBeUndefined()
    clock += UNAVAILABLE_RECEIPT_GRACE_MS
    await settle()
    expect(outcome(receiptFor())).toBe('failed')
    expect(receiptFor()!.at(-1)).toContain('没能判断')
    // Once.
    await settle()
    expect(calls.filter(a => a[0] === 'receipt' && a[1] === task && !a.includes('--acknowledged'))).toHaveLength(1)
  })

  it('an Eval ended unavailable only to be judged again (a policy change) sends nothing', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { UNAVAILABLE_RECEIPT_GRACE_MS } = await import('../../src/superagent/host/receipts.ts')
    const calls: string[][] = []
    let clock = Date.parse('2026-11-07T00:00:30.000Z')
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r']), home: mkdtempSync(join(tmpdir(), 'sa-unavailable2-')), logger: { info: () => {}, warn: () => {} },
      deliverToSession: () => true, interval: () => () => {}, homeUrl: () => 'http://127.0.0.1:1', now: () => new Date(clock).toISOString(),
      runCli: async args => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' } })
    const bot = 'reporter/0123456789abcdef'
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Upgrade a pinned dependency.' }] }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { h.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    const task = 'direct-000000000002'
    h.engine.receive({ ...wb('2', 'ctx-2'), at: new Date(clock).toISOString(), source: 'a2a', threads: [{ source: 'a2a', id: 'ctx-2' }], actor: { source: 'a2a', id: bot }, human: false, channel: { source: 'a2a', thread: 'a2a:ctx-2', address: { caller: bot, task, context: 'ctx-2' } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } })
    await settle()
    // A rules change re-assesses the Eval in progress: an `unavailable` decision whose message is queued again.
    expect(h.saveSettings({ rules: [{ name: 'deps', text: 'Upgrade a pinned dependency, any.' }] }, () => true)).toMatchObject({ ok: true })
    await settle()
    expect(h.store.decisions.byThread('a2a:ctx-2').some(d => d.kind === 'unavailable')).toBe(true)
    clock += UNAVAILABLE_RECEIPT_GRACE_MS + 60_000
    await settle()
    expect(calls.find(a => a[0] === 'receipt' && a[1] === task && !a.includes('--acknowledged'))).toBeUndefined()
  })
})

describe('design M12: a request from an unlisted sender waits on the owner', () => {
  it('holds it on a sender card, tells the sender, and acts on the owner\'s choice', async () => {
    const { SuperagentHost, SENDER_TAKE_LIST, SENDER_DECLINE } = await import('../../src/superagent/host/index.ts')
    const calls: string[][] = []
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']),
      home: mkdtempSync(join(tmpdir(), 'sa-sender-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      homeUrl: () => 'http://127.0.0.1:1', now: () => '2026-11-07T00:05:00.000Z',
      runCli: async args => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' },
    })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'observe' }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { h.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    const receive = (n: string, from: string, ctx = `ctx-${n}`) => {
      const task = `direct-${n.padStart(12, '0')}`
      h.engine.receive({ ...wb(n, ctx), source: 'a2a', threads: [{ source: 'a2a', id: ctx }], actor: { source: 'a2a', id: from }, human: false, channel: { source: 'a2a', thread: `a2a:${ctx}`, address: { caller: from, task, context: ctx } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } })
      h.pass()
      return task
    }
    const receiptFor = (task: string) => calls.find(a => a[0] === 'receipt' && a[1] === task && !a.includes('--acknowledged'))
    const ackFor = (task: string) => calls.find(a => a[0] === 'receipt' && a[1] === task && a.includes('--acknowledged'))
    const cardOf = (trigger: string) => h.decisionCards().find(c => c.source === 'sender' && c.by === trigger)
    const a = 'dsh/aaaaaaaa', b = 'dsh/bbbbbbbb'

    // Held: a card for the owner, an acknowledgement for the sender, no refusal.
    const first = receive('1', a)
    await settle()
    expect(cardOf('1')).toMatchObject({ level: 'P1', options: ['接这一单', SENDER_TAKE_LIST, SENDER_DECLINE] })
    expect(cardOf('1')!.reason).toContain('request 1')
    expect(ackFor(first)!.at(-1)).toContain('团队主人决定')
    expect(receiptFor(first)).toBeUndefined()
    // One waiting card per sender: the same sender's next message is refused as before.
    const second = receive('2', a)
    await settle()
    expect(cardOf('2')).toBeUndefined()
    expect(receiptFor(second)!.at(-1)).toContain('名单')
    // The owner must choose; declining tells the sender so.
    expect(h.decide(cardOf('1')!.id, 'choose', undefined, '再说吧')).toMatchObject({ ok: false, code: 'choice' })
    expect(h.decide(cardOf('1')!.id, 'choose', SENDER_DECLINE)).toMatchObject({ ok: true, taken: false })
    await settle()
    expect(receiptFor(first)!.at(-1)).toContain('主人没有接')
    expect(h.senderChoice('1')).toBe('declined')

    // Taken, and the sender listed: the gate now admits that message as the owner's explicit request, judged again.
    const third = receive('3', b)
    await settle()
    expect(h.decide(cardOf('3')!.id, 'choose', SENDER_TAKE_LIST)).toMatchObject({ ok: true, taken: true })
    expect(h.settings.bots.a2a).toContain(b)
    expect(h.senderChoice('3')).toBe('taken')
    await settle()
    expect(receiptFor(third)).toBeUndefined()
    expect(h.engine.candidate('3')).toMatchObject({ strength: 'explicit' })
  })

  it('does not hold an old message, and at most ten wait at a time', async () => {
    const { SuperagentHost, SENDER_CARDS_MAX } = await import('../../src/superagent/host/index.ts')
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r']), home: mkdtempSync(join(tmpdir(), 'sa-sender-cap-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      homeUrl: () => 'http://127.0.0.1:1', now: () => '2026-11-08T12:00:00.000Z',
      runCli: async args => args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true } }, () => true)).toMatchObject({ ok: true })
    const put = (n: string, from: string, at: string) => {
      h.engine.receive({ ...wb(n, `c${n}`), at, source: 'a2a', threads: [{ source: 'a2a', id: `c${n}` }], actor: { source: 'a2a', id: from }, human: false, channel: { source: 'a2a', thread: `a2a:c${n}`, address: { caller: from, task: `direct-${n.padStart(12, '0')}`, context: `c${n}` } }, meta: {} })
      return h.senderHold(n)
    }
    expect(put('1', 'dsh/00000001', '2026-11-07T00:00:00.000Z')).toBeUndefined()
    for (let i = 0; i < SENDER_CARDS_MAX; i++) expect(put(String(10 + i), `dsh/1000000${String(i)}`, '2026-11-08T11:00:00.000Z')).toBe('hold')
    expect(put('99', 'dsh/99999999', '2026-11-08T11:00:00.000Z')).toBeUndefined()
  })
})

describe('spec audit: follow-ups, the owner answering, the terminal', () => {
  it('a follow-up delivered to a member is acknowledged, and gets its formal outcome when the ticket ends', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const calls: string[][] = []
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']), home: mkdtempSync(join(tmpdir(), 'sa-followup-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {}, homeUrl: () => 'http://127.0.0.1:1',
      runCli: async args => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' } })
    const bot = 'reporter/0123456789abcdef'
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Upgrade.' }] }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { h.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    const receive = (n: string, ctx: string) => { const task = `direct-${n.padStart(12, '0')}`; h.engine.receive({ ...wb(n, ctx), source: 'a2a', threads: [{ source: 'a2a', id: ctx }], actor: { source: 'a2a', id: bot }, human: false, channel: { source: 'a2a', thread: `a2a:${ctx}`, address: { caller: bot, task, context: ctx } }, addressed: 'direct', meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } } as never); h.pass(); return task }
    const receipts = (task: string): string[][] => calls.filter(a => a[0] === 'receipt' && a[1] === task)
    const first = receive('1', 'ctx-1')
    const accepted = routeItem(h, { trigger_id: '1', kind: 'accept', title: 'bump', scope: 's', reason: 'r', rules: ['deps'] }) as { ticket_id: string }
    await settle()
    const followUp = receive('2', 'ctx-1')
    await settle(); await settle()
    expect(receipts(followUp).length, JSON.stringify(calls)).toBe(1)
    expect(receipts(followUp)[0]).toContain('--acknowledged')
    h.engine.stopTicket(accepted.ticket_id, 'done')
    await settle()
    const final = receipts(followUp).find(a => !a.includes('--acknowledged'))
    expect(final, JSON.stringify(receipts(followUp))).toBeDefined()
    expect(final![final!.indexOf('--outcome') + 1]).toBe('abandoned')
    expect(receipts(first).some(a => !a.includes('--acknowledged'))).toBe(true)
    await h.stop()
  })

  it('a requester\'s answer that reaches the ticket and is also judged and ignored by the router keeps its formal receipt for the ticket\'s end (field run, 2026-11-11)', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const calls: string[][] = []
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']), home: mkdtempSync(join(tmpdir(), 'sa-answer-ignore-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {}, homeUrl: () => 'http://127.0.0.1:1',
      runCli: async args => { calls.push(args); return args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' } })
    const bot = 'market/0123456789abcdef'
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Upgrade.' }] }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { h.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    const receive = (n: string, ctx: string) => { const task = `direct-${n.padStart(12, '0')}`; h.engine.receive({ ...wb(n, ctx), source: 'a2a', threads: [{ source: 'a2a', id: ctx }], actor: { source: 'a2a', id: bot }, human: false, channel: { source: 'a2a', thread: `a2a:${ctx}`, address: { caller: bot, task, context: ctx } }, addressed: 'direct', meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } } as never); h.pass(); return task }
    const receipts = (task: string): string[][] => calls.filter(a => a[0] === 'receipt' && a[1] === task)
    receive('1', 'ctx-1')
    const accepted = routeItem(h, { trigger_id: '1', kind: 'accept', title: 'bump', scope: 's', reason: 'r', rules: ['deps'] }) as { ticket_id: string }
    await settle()
    // The requester answers on a new task in the same context; the engine fans it out into the ticket.
    const answer = receive('2', 'ctx-1')
    await settle()
    expect(h.store.triggers.disposition('2')?.fanout ?? []).toContain(accepted.ticket_id)
    // The router also judges it, as on the field run, and ignores it (an answer, not new work).
    h.store.decisions.save({ id: 'dec-2', threadKey: 'a2a:ctx-1', evalId: 'ev-2', kind: 'ignore', triggerIds: ['2'], reason: [{ triggerId: '2', code: 'said', values: { text: '对在办工单问题的回答' } }], at: new Date().toISOString() } as never)
    await settle(); await settle()
    // No "not taken" receipt: the member has it, and its outcome comes when the ticket ends.
    expect(receipts(answer).filter(a => !a.includes('--acknowledged')), JSON.stringify(receipts(answer))).toHaveLength(0)
    h.engine.stopTicket(accepted.ticket_id, 'done')
    await settle()
    const final = receipts(answer).find(a => !a.includes('--acknowledged'))
    expect(final, JSON.stringify(receipts(answer))).toBeDefined()
    expect(final![final!.indexOf('--outcome') + 1]).not.toBe('rejected')
    await h.stop()
  })

  it('light path (superagent-market-progress-roster P2): the caller a ticket serves talks to its member without the router; another caller in the same conversation still goes to the router', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']), home: mkdtempSync(join(tmpdir(), 'sa-light-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {}, homeUrl: () => 'http://127.0.0.1:1',
      runCli: async args => args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' })
    const market = 'market/0123456789abcdef', other = 'other/0123456789abcdef'
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [market, other] }, rules: [{ name: 'deps', text: 'Upgrade.' }] }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { h.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    const receive = (n: string, ctx: string, bot: string) => { const task = `direct-${n.padStart(12, '0')}`; h.engine.receive({ ...wb(n, ctx), source: 'a2a', threads: [{ source: 'a2a', id: ctx }], actor: { source: 'a2a', id: bot }, human: false, channel: { source: 'a2a', thread: `a2a:${ctx}`, address: { caller: bot, task, context: ctx } }, addressed: 'direct', meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } } as never); h.pass() }
    receive('1', 'ctx-1', market)
    const accepted = routeItem(h, { trigger_id: '1', kind: 'accept', title: 'chat', scope: 's', reason: 'r', rules: ['deps'] }) as { ticket_id: string }
    await settle()
    receive('2', 'ctx-1', market)
    receive('3', 'ctx-1', other)
    await settle()
    // The router's queue: the served caller's message is not in it, the other caller's is.
    const thread = h.store.threads.get('a2a:ctx-1')!
    const queued = [...thread.pending, ...(thread.evaluating?.triggerIds ?? [])]
    expect(queued).not.toContain('2')
    expect(queued).toContain('3')
    // Both reach the member as inputs.
    expect(h.store.tickets.get(accepted.ticket_id)!.inputs.filter(i => i.kind === 'trigger').map(i => (i as { triggerId: string }).triggerId)).toEqual(expect.arrayContaining(['2', '3']))
    await h.stop()
  })

  it('the owner answers a question on a ticket an agent asked for; the answer reaches its member as a person\'s message', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const sent: Array<[string, string]> = []
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']), home: mkdtempSync(join(tmpdir(), 'sa-answer-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {} })
    const bot = 'reporter/0123456789abcdef'
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Upgrade.' }] }, () => true)).toMatchObject({ ok: true })
    h.engine.receive({ ...wb('1', 'ctx-1'), source: 'a2a', threads: [{ source: 'a2a', id: 'ctx-1' }], actor: { source: 'a2a', id: bot }, human: false, channel: { source: 'a2a', thread: 'a2a:ctx-1', address: { caller: bot, task: 'direct-1', context: 'ctx-1' } }, addressed: 'direct', meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: 'direct-1' } } as never)
    h.pass()
    const accepted = routeItem(h, { trigger_id: '1', kind: 'accept', title: 'bump', scope: 's', reason: 'r', rules: ['deps'] }) as { ticket_id: string }
    await vi.waitFor(() => { expect(sent.some(([id, t]) => id === 'session-m' && t.startsWith('[superagent assignment]'))).toBe(true) })
    expect(h.answer(accepted.ticket_id, '用 CSV')).toMatchObject({ ok: false, code: 'no-question' })
    expect(h.report('session-m', { state: 'waiting', summary: '要问', question: '用哪种格式？' }, accepted.ticket_id)).toMatchObject({ ok: true })
    const answered = h.answer(accepted.ticket_id, '用 CSV') as { triggerId: string }
    expect(answered).toMatchObject({ ok: true })
    await vi.waitFor(() => { expect(sent.some(([id, t]) => id === 'session-m' && t.startsWith('[superagent input]') && t.includes('用 CSV'))).toBe(true) })
    const ticket = h.store.tickets.get(accepted.ticket_id)!
    expect(ticket.inputs.find(i => i.kind === 'trigger' && i.triggerId === answered.triggerId)).toMatchObject({ human: true })
    expect(sent.filter(([id, t]) => id === 'session-r' && t.includes('[superagent candidate]') && t.includes('用 CSV'))).toHaveLength(0)
    await h.stop()
  })

  it('a request from the terminal is an ordinary message: judged by the rules, and it cannot stop a ticket', () => {
    const repo = new MemoryRepositories()
    const gate = teamPolicy(settings({ acceptMode: 'auto' })).gate
    const thread = { key: 'workbench:t', subscriptions: [] } as never
    expect(gate({ ...wb('1'), actor: { source: 'workbench', id: 'cli' }, human: false, addressed: 'direct' } as never, thread, [])).toMatchObject({ admissible: true, strength: 'inferred', basis: { via: 'bot' } })
    expect(gate({ ...wb('2'), actor: { source: 'workbench', id: 'owner' }, human: true, addressed: 'direct' } as never, thread, [])).toMatchObject({ admissible: true, strength: 'explicit' })
    void repo
  })
})

describe('design v5: the team is a canvas team', () => {
  it('binds to a canvas this host owns; the router is one of its sessions; the pool follows the canvas; a member removed mid-ticket loses it to another member', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const sent: Array<[string, string]> = []
    let local: string[] = ['session-r', 'session-a']
    const h = new SuperagentHost({
      home: mkdtempSync(join(tmpdir(), 'sa-v5-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {},
      canvasTeam: name => name === 'ops' ? { local, remote: [] } : undefined, canvasNames: () => ['ops'],
    })
    // Unbound: the state says why; a router alone, an unknown canvas, a router outside the canvas are refused.
    expect(h.state()).toMatchObject({ canvasProblem: expect.stringContaining('建队'), canvases: ['ops'] })
    expect(h.saveSettings({ router: 'session-r' }, () => true)).toMatchObject({ ok: false, error: expect.stringContaining('canvas') })
    expect(h.saveSettings({ canvas: 'nope', router: 'session-r' }, () => true)).toMatchObject({ ok: false, error: expect.stringContaining('no canvas team nope') })
    expect(h.saveSettings({ canvas: 'ops', router: 'session-x' }, () => true)).toMatchObject({ ok: false, error: expect.stringContaining('local session of the canvas team ops') })
    expect(h.saveSettings({ canvas: 'ops', router: 'session-r' }, () => true)).toMatchObject({ ok: true, settings: { canvas: 'ops', router: 'session-r', members: ['session-a'] } })
    expect(h.state().canvasProblem).toBeUndefined()
    expect(h.roleOf('session-a')).toBe('member')
    h.start()
    const assigned = (member: string) => sent.filter(([id, t]) => id === member && t.startsWith('[superagent assignment]'))
    try {
      const asked = h.request('核对 README 的命令表') as { triggerId: string }
      expect(routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'readme', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
      await vi.waitFor(() => { expect(h.executor.list()).toHaveLength(1) })
      const ticketId = h.executor.list()[0]!.ticketId
      // The owner adds session-b on the canvas and removes session-a: the pool follows, and the ticket moves (Q2).
      local = ['session-r', 'session-b']
      h.poolChanged()
      expect(h.roleOf('session-a')).toBeUndefined()
      // The binding is recorded once the card is delivered (asynchronously): wait for it, not for the card.
      await vi.waitFor(() => { expect(h.executor.list()).toEqual([expect.objectContaining({ member: 'session-b', ticketId })]) })
      expect(assigned('session-b')).toHaveLength(1)
      const stop = sent.find(([id, t]) => id === 'session-a' && t.includes('is no longer yours'))
      expect(stop?.[1]).toContain('(you were removed from the team)')
      expect(h.ticket(ticketId)?.ended).toBeUndefined()
      expect(h.ticket(ticketId)?.delivery).toBeUndefined()
    } finally { void h.stop() }
  })

  it('a removed member is let go even when the engine will not move its ticket (review of #441)', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const sent: Array<[string, string]> = []
    let local: string[] = ['session-r', 'session-a']
    const h = new SuperagentHost({
      home: mkdtempSync(join(tmpdir(), 'sa-v5-letgo-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {},
      canvasTeam: name => name === 'ops' ? { local, remote: [] } : undefined,
    })
    expect(h.saveSettings({ canvas: 'ops', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    h.start()
    try {
      const asked = h.request('核对一节文档') as { triggerId: string }
      expect(routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'doc', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
      await vi.waitFor(() => { expect(h.executor.list()).toHaveLength(1) })
      // The engine refuses the move (as for an Assignment it no longer runs): the binding still goes, with the notice.
      h.engine.retryTicket = () => { throw new Error('notRetryable') }
      local = ['session-r']
      h.poolChanged()
      expect(h.executor.list()).toEqual([])
      expect(sent.find(([id, t]) => id === 'session-a' && t.includes('is no longer yours'))?.[1]).toContain('(you were removed from the team)')
    } finally { void h.stop() }
  })

  it('v5 acceptance F1/F3: an upgraded team (router stored, no canvas bound) can be composed and bound; its running work stays put meanwhile', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const sent: Array<[string, string]> = []
    const canvases: Record<string, string[]> = { ops: ['session-r', 'session-a'] }
    const h = new SuperagentHost({
      home: mkdtempSync(join(tmpdir(), 'sa-v5-upgrade-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {},
      canvasTeam: name => canvases[name] !== undefined ? { local: canvases[name]!, remote: [] } : undefined,
      canvasesOf: id => Object.keys(canvases).filter(name => canvases[name]!.includes(id)),
    })
    expect(h.saveSettings({ canvas: 'ops', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    h.start()
    try {
      const asked = h.request('核对一节文档') as { triggerId: string }
      expect(routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'doc', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
      await vi.waitFor(() => { expect(h.executor.list()).toHaveLength(1) })
      const assignment = h.executor.list()[0]!.assignmentId
      // The canvas goes away (as after an upgrade: the router is stored, nothing is bound) …
      delete canvases.ops
      h.poolChanged()
      // … F3: the running assignment stays with its member, which is told nothing.
      expect(h.executor.list()).toEqual([expect.objectContaining({ member: 'session-a', assignmentId: assignment })])
      expect(sent.some(([id, t]) => id === 'session-a' && t.includes('is no longer yours'))).toBe(false)
      // F1: with the bound canvas gone, the stored router may join the canvas that becomes the team.
      expect(h.settings.router).toBe('session-r')
      expect(h.canvasMemberRefusal('ops2', 'session-r')).toBeUndefined()
      canvases.ops2 = ['session-r', 'session-a']
      h.poolChanged()
      expect(h.executor.list()).toEqual([expect.objectContaining({ member: 'session-a', assignmentId: assignment })])
      // Bound again: the member is in the pool, its work goes on.
      expect(h.saveSettings({ canvas: 'ops2', router: 'session-r' }, () => true)).toMatchObject({ ok: true, settings: { members: ['session-a'] } })
      expect(h.executor.list()).toEqual([expect.objectContaining({ member: 'session-a', assignmentId: assignment })])
    } finally { void h.stop() }
  })

  it('v5 acceptance F4: a session served for another team on another preset takes no new work (a stop still reaches it), and the state says why', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const KEY_A = 'MCowBQYDK2VwAyEA' + 'A'.repeat(44)
    const delivered: string[] = []
    const presets: Record<string, string> = { 'session-c': 'standard' }
    const h = new SuperagentHost({
      home: mkdtempSync(join(tmpdir(), 'sa-v5-serve-preset-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: (_id, text) => { delivered.push(text); return true }, interval: () => () => {},
      localSessionOf: handle => handle === 'dsh/cccccccc' ? 'session-c' : undefined, presetOf: id => presets[id],
    })
    // A serve stored before presets: written without the check (as a v4 file loads).
    expect(h.serveTeam({ url: 'http://127.0.0.1:8', key: KEY_A }, ['session-c'], () => true)).toEqual({ ok: true })
    expect(h.assignedWork('assign', 'dsh/cccccccc', KEY_A, 'work')).toMatchObject({ ok: false, code: 'preset' })
    expect(h.assignedWork('stop', 'dsh/cccccccc', KEY_A, 'stop')).toEqual({ ok: true })
    expect(h.state()).toMatchObject({ servesProblem: expect.stringContaining('superagent-member') })
    expect((h.state().refusals as { counts: Record<string, number> }).counts['superagent-member-preset']).toBe(1)
    // On the member preset it works again.
    presets['session-c'] = 'superagent-member'
    expect(h.assignedWork('assign', 'dsh/cccccccc', KEY_A, 'work')).toEqual({ ok: true })
    expect(h.state().servesProblem).toBeUndefined()
  })

  it('one session, one team role: the team canvas takes no CLI handle and no off-preset session; a team session joins no other canvas', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const canvases: Record<string, string[]> = { ops: ['session-r', 'session-m'], other: [] }
    const h = new SuperagentHost({
      home: mkdtempSync(join(tmpdir(), 'sa-v5-roles-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      canvasTeam: name => canvases[name] !== undefined ? { local: canvases[name]!, remote: [] } : undefined,
      canvasesOf: id => Object.keys(canvases).filter(name => canvases[name]!.includes(id)),
      localSessionOf: handle => handle === 'dsh/aaaaaaaa' ? 'session-m' : undefined,
    })
    const of = (id: string) => ({ 'session-r': 'superagent-router', 'session-m': 'superagent-member', 'session-s': 'standard' } as Record<string, string>)[id]
    expect(h.saveSettings({ canvas: 'ops', router: 'session-r' }, () => true, of)).toMatchObject({ ok: true })
    expect(h.canvasMemberRefusal('ops', 'ops-inventory/0123456789abcdef', of)).toContain('a CLI handle is a requester')
    expect(h.canvasMemberRefusal('ops', 'session-s', of)).toContain('superagent-member')
    expect(h.canvasMemberRefusal('ops', 'session-n', of)).toBeUndefined()
    expect(h.canvasMemberRefusal('other', 'session-m', of)).toContain('sits in no other canvas')
    expect(h.canvasMemberRefusal('other', 'dsh/aaaaaaaa@12345678', of)).toContain('sits in no other canvas')
    expect(h.canvasMemberRefusal('other', 'session-s', of)).toBeUndefined()
    // Binding is refused while a team session also sits in another canvas.
    canvases.other = ['session-m']
    expect(h.saveSettings({ canvas: 'ops', router: 'session-r', paused: false }, () => true, of)).toMatchObject({ ok: false, error: expect.stringContaining('also sits in canvas other') })
  })
})

describe('router acceptance follow-up: what a settings change means to each open ticket (upstream PolicyEffect)', () => {
  const rule = (name: string, text: string, enabled = true) => ({ name, text, enabled })
  const base: TeamSettings = { ...DEFAULT_SETTINGS, acceptMode: 'auto', bots: { a2a: ['ops/0123456789abcdef'] }, rules: [rule('docs', 'check docs'), rule('deps', 'bump deps')] }
  const inferred = (id: string, rules: string[]) => ({ id, mandate: { strength: 'inferred' as const, policyVersion: 'v', basis: { via: 'bot' as const, observation: { mode: 'auto' as const }, rules }, actor: { source: 'a2a', id: 'ops/0123456789abcdef' } } }) as never
  const explicit = (id: string) => ({ id, mandate: { strength: 'explicit' as const, policyVersion: 'v', basis: { via: 'addressed' as const, addressed: 'direct' as const, sender: 'owner' }, actor: { source: 'workbench', id: 'owner' } } }) as never
  it('a rule the ticket was accepted on that changed, was turned off or removed', () => {
    const after = { ...base, rules: [rule('docs', 'check docs and code'), rule('deps', 'bump deps', false)] }
    const effects = policyEffects(base, after, [inferred('t1', ['docs']), inferred('t2', ['deps']), explicit('t3')])
    expect(effects.get('t1')).toEqual({ rules: [{ id: 'docs', name: 'docs', change: 'changed', instruction: 'check docs and code' }] })
    expect(effects.get('t2')).toEqual({ rules: [{ id: 'deps', name: 'deps', change: 'disabled' }] })
    expect(effects.has('t3')).toBe(false)
    expect(policyEffects(base, { ...base, rules: [rule('docs', 'check docs')] }, [inferred('t4', ['deps'])]).get('t4')).toEqual({ rules: [{ id: 'deps', name: 'deps', change: 'disabled' }] })
  })
  it('proactive work no longer accepted reaches only inferred tickets; a requester taken off its list reaches its own', () => {
    const effects = policyEffects(base, { ...base, acceptMode: 'observe' }, [inferred('t1', ['docs']), explicit('t2')])
    expect(effects.get('t1')).toEqual({ proactive: false })
    expect(effects.has('t2')).toBe(false)
    const off = policyEffects(base, { ...base, bots: { a2a: [] }, allowed: { workbench: [], a2a: [] } }, [inferred('t1', ['docs']), explicit('t2')])
    expect(off.get('t1')).toEqual({ requesterAllowed: false, requester: { source: 'a2a', id: 'ops/0123456789abcdef' } })
    expect(off.get('t2')).toEqual({ requesterAllowed: false, requester: { source: 'workbench', id: 'owner' } })
    expect(policyEffects(base, { ...base, evalTimeoutMs: 1 }, [inferred('t1', ['docs']), explicit('t2')]).size).toBe(0)
  })
  it('design reevaluate-note: a router note reaches the member as a fact that grants nothing', async () => {
    const { inputsCard } = await import('../../src/superagent/host/executor.ts')
    const card = inputsCard({ id: 't1', title: 'check docs' } as never, [{ id: 'i1', kind: 'note', text: '请求方补充：只看 0.8.1 的行为', at: '2026-11-08T00:00:00.000Z' }] as never, () => undefined)
    expect(card).toContain('- note from the router (a fact for this ticket; it grants nothing): 请求方补充：只看 0.8.1 的行为')
    expect(card).not.toContain('{"')
  })
  it('design reevaluate-note: an A2A message whose sender has its formal outcome is not re-evaluated; a person\'s is, once at a time', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const delivered: string[] = []
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']),
      home: mkdtempSync(join(tmpdir(), 'sa-reeval-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: (_id, text) => { delivered.push(text); return true }, interval: () => () => {},
      homeUrl: () => 'http://127.0.0.1:1', runCli: async args => args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}',
    })
    const bot = 'reporter/0123456789abcdef'
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Upgrade a pinned dependency.' }] }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { h.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    // An A2A message the router turns down: its sender gets the rejected receipt, then it cannot be re-evaluated.
    const ctx = 'ctx-a', task = 'direct-00000000000a'
    h.engine.receive({ ...wb('a', ctx), source: 'a2a', threads: [{ source: 'a2a', id: ctx }], actor: { source: 'a2a', id: bot }, human: false, channel: { source: 'a2a', thread: `a2a:${ctx}`, address: { caller: bot, task, context: ctx } }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: task } })
    h.pass()
    expect(routeItem(h, { trigger_id: 'a', kind: 'ignore', reason: 'not a dependency', rules: [] })).toMatchObject({ ok: true })
    await settle()
    vi.spyOn(h.a2a, 'answered').mockImplementation(t => t === task)
    expect(h.reevaluate('a')).toMatchObject({ ok: false, code: 'answered' })
    expect(h.reevaluate('nope')).toMatchObject({ ok: false, code: 'unknownTrigger' })
    // A person's message the router turned down is judged again, and the card says so; while judged, a second ask queues nothing.
    h.engine.receive(wb('p', 'th-p')); h.pass()
    expect(routeItem(h, { trigger_id: 'p', kind: 'ignore', reason: 'not now' })).toMatchObject({ ok: true })
    delivered.length = 0
    expect(h.reevaluate('p')).toEqual({ ok: true, queued: true })
    expect(delivered.some(t => t.includes('trigger p ') && t.includes('judged before: a person asked for a fresh judgement'))).toBe(true)
    expect(h.reevaluate('p')).toEqual({ ok: true, queued: false })
  })
  it('the member reads the effect in words, never as JSON', () => {
    const lines = policyChangedLines({ rules: [{ id: 'docs', name: 'docs', change: 'changed', instruction: 'check docs and code' }, { id: 'deps', name: 'deps', change: 'disabled' }], proactive: false, requesterAllowed: false, requester: { source: 'a2a', id: 'ops/x' } })
    expect(lines.join('\n')).toContain('rule docs, which this ticket was accepted on, now reads: check docs and code')
    expect(lines.join('\n')).toContain('rule deps, which this ticket was accepted on, is off now')
    expect(lines.join('\n')).toContain('accept mode is not auto')
    expect(lines.join('\n')).toContain('a2a:ops/x, who asked for this ticket, may no longer start work')
    expect(lines.join('\n')).not.toContain('{')
  })
})

describe('a remote member listed as a bot is a caller, not a worker (market on the canvas)', () => {
  it('the worker pool, the member list and the executor leave it out; other remote members stay workers', async () => {
    const { SuperagentHost, workerRemotes } = await import('../../src/superagent/host/index.ts')
    const market = { ref: 'market/fd417315@88679599', key: 'K1', url: 'http://127.0.0.1:1' }, peer = { ref: 'dsh/bbbb2222@89abcdef', key: 'K2', url: 'http://127.0.0.1:2' }
    expect(workerRemotes({ remoteMembers: [market, peer], bots: { a2a: ['market/fd417315'] } })).toEqual(['dsh/bbbb2222@89abcdef'])
    expect(workerRemotes({ remoteMembers: [market, peer], bots: { a2a: [] } })).toEqual(['market/fd417315@88679599', 'dsh/bbbb2222@89abcdef'])
    const h = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m'], [market, peer]), home: mkdtempSync(join(tmpdir(), 'sa-botworker-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {}, sessionName: (id: string) => id } as never)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r', bots: { a2a: ['market/fd417315'] } }, () => true)).toMatchObject({ ok: true })
    expect(h.memberListLine()).toBe("The team's members: session-m; dsh/bbbb2222@89abcdef.")
    await h.stop()
  })
})

describe('market N1d: a member\'s question carries its answers to the requester', () => {
  it('choicesOf gives the options and the recommendation of the card the question report raised', async () => {
    const caller = { caller: 'market/0123456789abcdef' }
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const host = new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']), home: mkdtempSync(join(tmpdir(), 'sa-choices-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      homeUrl: () => 'http://127.0.0.1:1', runCli: async args => args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' })
    expect(host.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [caller.caller] }, rules: [{ name: 'deps', text: 'Upgrade.' }] }, () => true)).toMatchObject({ ok: true })
    const settle = async () => { host.pass(); for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5)) }
    const channel = { source: 'a2a', thread: 'a2a:ctx-q', address: { caller: caller.caller, task: 'direct-000000000009', context: 'ctx-q' } }
    host.engine.receive({ ...wb('9', 'ctx-q'), source: 'a2a', threads: [{ source: 'a2a', id: 'ctx-q' }], actor: { source: 'a2a', id: caller.caller }, human: false, channel, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: channel.address.task } })
    host.pass()
    const routed = routeItem(host, { trigger_id: '9', kind: 'accept', title: 'greet', scope: 's', reason: 'r', rules: ['deps'] }) as { ticket_id: string }
    await settle()
    expect(host.choicesOf(routed.ticket_id)).toBeUndefined()
    expect(host.report('session-m', { state: 'waiting', summary: '等发起方选风格', question: '问候语用哪种风格？', decision: { level: 'P1', options: ['正式', '口语', '俏皮'], recommended: '口语' } })).toMatchObject({ ok: true })
    await settle()
    expect(host.choicesOf(routed.ticket_id)).toEqual({ options: ['正式', '口语', '俏皮'], recommended: '口语' })
    await host.stop()
  })
})

describe('seatOf at boot reads no canvas (regression of #611 on the test host)', () => {
  it('the seat and its role come from the executor and the preset, even when reading the canvas throws', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    let booting = false
    const team = canvasOf(['session-r', 'session-o'])
    const bot = 'market/0123456789abcdef'
    const host = new SuperagentHost({ canvasTeam: (name: string) => { if (booting) throw new ReferenceError("Cannot access 'cardCache' before initialization"); return team(name) },
      home: mkdtempSync(join(tmpdir(), 'sa-seatboot-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {}, homeUrl: () => 'http://127.0.0.1:1',
      presetOf: (id: string) => id === 'session-o' ? 'superagent-observer' : 'superagent-router', sessionName: (id: string) => id,
      runCli: async (args: string[]) => args[0] === 'admission' ? JSON.stringify({ admitted: true, rule: 'cli-deposit' }) : '{}' } as never)
    expect(host.saveSettings({ canvas: 'team', router: 'session-r', sources: { a2a: true }, acceptMode: 'auto', bots: { a2a: [bot] }, rules: [{ name: 'deps', text: 'Upgrade.' }] }, () => true)).toMatchObject({ ok: true })
    const channel = { source: 'a2a', thread: 'a2a:ctx-b', address: { caller: bot, task: 'direct-00000000000b', context: 'ctx-b' } }
    host.engine.receive({ ...wb('b', 'ctx-b'), source: 'a2a', threads: [{ source: 'a2a', id: 'ctx-b' }], actor: { source: 'a2a', id: bot }, human: false, channel, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: channel.address.task } } as never)
    host.pass()
    const routed = routeItem(host, { trigger_id: 'b', kind: 'accept', title: 'boot', scope: 's', reason: 'r', rules: ['deps'] }) as { ticket_id: string }
    for (let i = 0; i < 20; i++) { host.pass(); await new Promise(r => setTimeout(r, 5)) }
    expect(host.seatOf(routed.ticket_id)).toEqual({ seat: 'session-o', seatId: expect.stringMatching(/^seat-/), role: 'observer' })
    booting = true
    // Before the fix the observer check read the canvas settings and threw here (the plugin's start failed with it).
    expect(host.seatOf(routed.ticket_id)).toEqual({ seat: 'session-o', seatId: expect.stringMatching(/^seat-/), role: 'observer' })
    booting = false
    await host.stop()
  })
})
