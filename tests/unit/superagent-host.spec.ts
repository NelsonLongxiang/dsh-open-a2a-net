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
  const policy = teamPolicy(settings({ allowed: { workbench: ['owner'], a2a: ['dsh/aaaaaaaa'] } }))
  it('an allowed sender addressing the agent is explicit; nothing else is admitted while the accept mode is off', () => {
    expect(policy.gate(wb('1'), thread(), [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { via: 'addressed', addressed: 'direct', sender: 'owner' } })
    expect(policy.gate(wb('1', 't1', { actor: { source: 'workbench', id: 'stranger' } }), thread(), [])).toEqual({ admissible: false, reason: 'notListed' })
    expect(policy.gate(wb('1', 't1', { human: false }), thread(), [])).toEqual({ admissible: false, reason: 'notHuman' })
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
