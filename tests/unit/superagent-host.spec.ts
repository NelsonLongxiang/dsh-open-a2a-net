/**
 * superagent design v4, PR-B: the host's ports for the vendored engine — durable Repositories with upstream's
 * MemoryRepositories semantics, and the team Policy (upstream docs/002 gate, accept mode off).
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Engine, MemoryRepositories, type Candidate, type EngineOptions, type Repositories, type Trigger } from '../../src/superagent/upstream/dsh-superagent/src/core/index.ts'
import { JsonRepositories } from '../../src/superagent/host/store.ts'
import { DEFAULT_SETTINGS, parseSettings, policyVersion, teamPolicy, teamScope, type TeamSettings } from '../../src/superagent/host/policy.ts'
import { OTHER_TICKETS_SHOWN, candidateCard } from '../../src/superagent/host/index.ts'
import { SAID_CAP, registerSuperagentTools } from '../../src/superagent/host/tools.ts'

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
    expect(teamScope(() => settings()).scope({ source: 'github', meta: {} })).toEqual({ listened: false, reason: 'sourceOff' })
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
    expect(card).toContain('never split it into several')
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

describe('ops loop: members work in repositories; a ticket accepted for one runs only on its members', () => {
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
  it('a message the team does not take is told so (rejected, with the reason); a follow-up is told it reached the member', async () => {
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
