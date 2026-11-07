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
import { candidateCard } from '../../src/superagent/host/index.ts'

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
    const host = new SuperagentHost({ home, logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {} })
    expect(host.saveSettings({ router: 'session-r', sources: { a2a: true }, bots: { a2a: ['seat/0123456789abcdef'] }, rules: [{ name: 'deps', text: 'Upgrade a pinned dependency.' }] }, () => true)).toMatchObject({ ok: true })
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
    const host = new SuperagentHost({
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
    const make = (sent: Array<[string, string]>) => new SuperagentHost({ home, logger: { info: () => {}, warn: () => {} }, deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {} })
    const sent1: Array<[string, string]> = []
    const h1 = make(sent1)
    expect(h1.saveSettings({ router: 'session-r', members: ['session-m'] }, () => true)).toMatchObject({ ok: true })
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
