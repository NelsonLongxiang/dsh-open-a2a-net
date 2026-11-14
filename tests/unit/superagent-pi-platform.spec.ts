// @vitest-environment node
/**
 * docs/design/superagent-pi-platform.md PR-B: a Pi seat (a CLI identity whose own signed card declares piSeat, deposited on
 * the team host) is a team member: admitted to the team canvas with its key pinned, given work through its mailbox, and
 * heard only through a CLI claim under the pinned key.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CanvasStore } from '../../src/canvas-store.ts'
import { PI_PLATFORM, piCardText, piDeliverable, piSeatAdmission } from '../../src/superagent/platforms/pi.ts'
import type { RemoteMember } from '../../src/superagent/host/policy.ts'
import { runOf } from '../../src/superagent/host/executor.ts'

const KEY_P = 'MCowBQYDK2VwAyEA' + 'P'.repeat(44), KEY_Q = 'MCowBQYDK2VwAyEA' + 'Q'.repeat(44), KEY_B = 'MCowBQYDK2VwAyEA' + 'B'.repeat(44)
const SEAT = 'fleet-pi/0123456789abcdef'
const card = (over: Record<string, unknown> = {}): string => JSON.stringify({ name: SEAT, publicKey: KEY_P, capabilities: { piSeat: true }, ...over })

describe('the Pi seat rules (platforms/pi.ts)', () => {
  it('admits only a CLI handle deposited here whose own card declares piSeat, and gives the key to pin', () => {
    expect(piSeatAdmission(SEAT, { cardJson: card() })).toEqual({ ok: true, key: KEY_P })
    expect(piSeatAdmission(SEAT, undefined)).toMatchObject({ ok: false, error: expect.stringContaining('deposited on the team host') })
    expect(piSeatAdmission(SEAT, { cardJson: card({ capabilities: {} }) })).toMatchObject({ ok: false, error: expect.stringContaining('not a Pi seat') })
    // A top-level field is outside the signed core: it is no declaration.
    expect(piSeatAdmission(SEAT, { cardJson: card({ capabilities: {}, platform: 'pi', piSeat: true }) })).toMatchObject({ ok: false })
    expect(piSeatAdmission('dsh/0123abcd', { cardJson: card() })).toMatchObject({ ok: false })
  })

  it('delivers only while the deposit is here under the pinned key', () => {
    expect(piDeliverable({ cardJson: card() }, KEY_P)).toBe(true)
    expect(piDeliverable({ cardJson: card({ publicKey: KEY_Q }) }, KEY_P)).toBe(false)
    expect(piDeliverable(undefined, KEY_P)).toBe(false)
  })

  it('the card tells the seat to answer with the CLI, naming the ticket; a stop is left as it is', () => {
    expect(piCardText('[superagent assignment] T', 'assign', 't-1')).toContain('a2a-net ticket report --ticket t-1')
    expect(piCardText('stop', 'stop', 't-1')).toBe('stop')
  })
})

describe('the canvas pins a Pi seat\'s key', () => {
  it('a CLI handle added with a key keeps it; a re-add never replaces it; removing forgets it; it survives a reload', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pi-canvas-')), 'canvas.json')
    const store = new CanvasStore(path)
    store.create('team')
    expect(store.addMember('team', SEAT, undefined, { ownerKey: KEY_P })).toBe(true)
    expect(store.seatKeyOf(SEAT)).toBe(KEY_P)
    expect(store.addMember('team', SEAT, undefined, { ownerKey: KEY_Q })).toBe(true)
    expect(store.seatKeyOf(SEAT)).toBe(KEY_P)
    expect(new CanvasStore(path).seatKeyOf(SEAT)).toBe(KEY_P)
    // An ordinary CLI handle (no key) pins nothing.
    expect(store.addMember('team', 'req/fedcba9876543210')).toBe(true)
    expect(store.seatKeyOf('req/fedcba9876543210')).toBeUndefined()
    expect(store.removeMember('team', SEAT)).toBe(true)
    expect(store.seatKeyOf(SEAT)).toBeUndefined()
    expect(new CanvasStore(path).seatKeyOf(SEAT)).toBeUndefined()
  })
})

describe('the team host and its Pi seat', () => {
  const seat: RemoteMember = { ref: SEAT, key: KEY_P, url: '', platform: PI_PLATFORM }
  const remote: RemoteMember = { ref: 'dsh/bbbbbbbb@12345678', key: KEY_B, url: 'http://127.0.0.1:9' }
  const make = async (piDeliver: (handle: string, key: string, text: string, ticket: string, run?: string) => boolean, sent: string[] = [], remotes: RemoteMember[] = [seat, remote], home = mkdtempSync(join(tmpdir(), 'sa-pi-'))) => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const h = new SuperagentHost({
      canvasTeam: name => name === 'team' ? { local: ['session-r'], remote: remotes } : undefined,
      home, logger: { info: () => {}, warn: () => {} }, interval: () => () => {},
      deliverToSession: (id, text) => { sent.push(`${id}:${text}`); return true },
      piSeat: handle => handle === SEAT ? { ok: true, key: KEY_P } : { ok: false, error: `[pi-seat] ${handle} is a CLI handle that is not a Pi seat` },
      piDeliver,
    })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    return h
  }

  it('R4 as revised: only a Pi seat joins the team canvas; another CLI handle is refused with the reason', async () => {
    const h = await make(() => true)
    expect(h.canvasMemberRefusal('team', SEAT)).toBeUndefined()
    expect(h.canvasMemberRefusal('team', 'req/fedcba9876543210')).toMatch(/requester, not a member.*not a Pi seat/)
  })

  it('work goes to the seat\'s mailbox as the Pi card, never to a session', async () => {
    const mailed: Array<[string, string, string, string]> = []
    const sent: string[] = []
    const h = await make((handle, key, text, ticket) => { mailed.push([handle, key, text, ticket]); return true }, sent, [seat])
    h.start()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const asked = h.request('do it') as { triggerId: string }
    expect(routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'T', scope: 's', reason: 'r' })).toMatchObject({ ok: true })
    await new Promise(r => setTimeout(r, 30))
    expect(mailed).toHaveLength(1)
    const [handle, key, text, ticket] = mailed[0]!
    expect([handle, key]).toEqual([SEAT, KEY_P])
    expect(text).toContain('[superagent assignment]')
    expect(text).toContain(`a2a-net ticket report --ticket ${ticket}`)
    expect(h.executor.list().map(b => b.member)).toEqual([SEAT])
    expect(sent.some(line => line.startsWith(`${SEAT}:`))).toBe(false)
    void h.stop()
  })

  it('a lapsed or re-keyed seat gets nothing: the delivery fails and the assignment does not run', async () => {
    let tries = 0
    const h = await make(() => { tries += 1; return false }, [], [seat])
    h.start()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const asked = h.request('do it') as { triggerId: string }
    routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'T', scope: 's', reason: 'r' })
    await new Promise(r => setTimeout(r, 30))
    expect(tries).toBeGreaterThan(0)
    expect(h.store.tickets.list()[0]?.assignments.some(a => a.state === 'running')).toBe(false)
    void h.stop()
  })

  it('#685 F1: a seat cannot stand for the owner — no rule changes, and its turn end never counts as a person\'s', async () => {
    const h = await make(() => true)
    for (const op of ['rules-propose', 'rules-apply']) {
      expect(h.remoteEvent(op, SEAT, KEY_P, { value: { rules: [] }, reason: 'x', person: { text: 'agreed', atMs: Date.now() + 60_000 } }, true)).toMatchObject({ ok: false, code: 'op' })
    }
    expect(h.remoteEvent('idle', SEAT, KEY_P, { quiet: true, text: '', person: true, ticket_id: 't-none', run_id: 'r-none', event_id: 'e-p1' }, true)).toMatchObject({ ok: true })
    // A remote member session keeps both (its host vouches for its session).
    expect(h.remoteEvent('rules-propose', 'dsh/bbbbbbbb', KEY_B, { value: {}, reason: 'x' }, false)).not.toMatchObject({ code: 'op' })
  })

  it('#685 F2: a seat removed while its ticket runs gets the stop in its mailbox under its old pin only, never through a session', async () => {
    // The deposit as the host sees it: delivery happens only while the deposit is still under the key given.
    let depositKey: string | undefined = KEY_P
    const mailed: Array<[string, string]> = [], sent: string[] = []
    let remotes: RemoteMember[] = [seat]
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const h = new SuperagentHost({
      canvasTeam: name => name === 'team' ? { local: ['session-r'], remote: remotes } : undefined,
      home: mkdtempSync(join(tmpdir(), 'sa-pi-stop-')), logger: { info: () => {}, warn: () => {} }, interval: () => () => {},
      deliverToSession: (id, text) => { sent.push(`${id}:${text}`); return true },
      piSeat: handle => handle === SEAT && depositKey !== undefined ? { ok: true, key: depositKey } : { ok: false, error: 'no' },
      piDeliver: (_h, key, text) => { if (key !== depositKey) return false; mailed.push([key, text]); return true },
    })
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    h.start()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const asked = h.request('do it') as { triggerId: string }
    routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'T', scope: 's', reason: 'r' })
    await new Promise(r => setTimeout(r, 30))
    expect(mailed).toHaveLength(1)
    // The owner takes the seat off the canvas: the pool changes, and nothing for it ever goes to a session.
    remotes = []
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    await new Promise(r => setTimeout(r, 50))
    expect(sent.filter(line => line.startsWith(`${SEAT}:`))).toEqual([])
    const deliver = (h as unknown as { deliverToMember(m: string, t: string, k: string, id: string): Promise<boolean> }).deliverToMember.bind(h)
    // Removed: the stop goes to the mailbox under the old pin; new work does not.
    expect(await deliver(SEAT, 'stop it', 'stop', 't-1')).toBe(true)
    expect(mailed.at(-1)).toEqual([KEY_P, 'stop it'])
    expect(await deliver(SEAT, 'more', 'input', 't-1')).toBe(false)
    expect(await deliver(SEAT, 'new', 'assign', 't-2')).toBe(false)
    // Re-keyed: the deposit's new key is never used, so the stop goes nowhere.
    depositKey = KEY_Q
    expect(await deliver(SEAT, 'stop again', 'stop', 't-1')).toBe(false)
    expect(mailed.some(([key]) => key === KEY_Q)).toBe(false)
    // Lapsed: no deposit, nothing delivered.
    depositKey = undefined
    expect(await deliver(SEAT, 'stop again', 'stop', 't-1')).toBe(false)
    // A handle never given work has no pin: nothing.
    expect(await deliver('other-pi/0123456789abcdef', 'stop', 'stop', 't-1')).toBe(false)
    expect(sent.filter(line => line.includes('/0123456789abcdef:'))).toEqual([])
    void h.stop()
  })

  it('#688 G1: a seat\'s question is a decision card on the host too, whatever sent it', async () => {
    const h = await make(() => true)
    expect(h.remoteEvent('report', SEAT, KEY_P, { state: 'waiting', summary: 's', question: 'which?' }, true)).toMatchObject({ ok: false, code: 'decision' })
    expect(h.remoteEvent('report', SEAT, KEY_P, { state: 'waiting', summary: 's', question: 'which?', options: ['a', 'b'], recommended: 'c' }, true)).toMatchObject({ ok: false, code: 'decision' })
    // With options and a recommendation the report goes on to the executor (no assignment here, so it is not-assigned).
    expect(h.remoteEvent('report', SEAT, KEY_P, { state: 'waiting', summary: 's', question: 'which?', options: ['a', 'b'], recommended: 'a' }, true)).not.toMatchObject({ code: 'decision' })
  })

  it('#688 R2: an idle the host took whose answer was lost, replayed after the next ticket was given, leaves that ticket alone', async () => {
    const mailed: Array<[string, string, string | undefined]> = []
    const h = await make((_h, _k, text, ticket, run) => { mailed.push([ticket, text, run]); return true }, [], [seat])
    h.start()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    for (const text of ['first', 'second']) {
      const asked = h.request(text) as { triggerId: string }
      routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: text, scope: 's', reason: 'r' })
    }
    await new Promise(r => setTimeout(r, 30))
    const bindingA = h.executor.bindingOf(SEAT)!
    const ticketA = bindingA.ticketId, runA = runOf(bindingA)
    // The work went out with its run as the mailbox row's context id.
    expect(mailed[0]?.[2]).toBe(runA)
    // The seat ends its turn on A: the host takes it (the answer is lost on the way back) and gives the seat B.
    expect(h.remoteEvent('idle', SEAT, KEY_P, { quiet: true, text: '', ticket_id: ticketA, run_id: runA, event_id: 'ev-a-1' }, true)).toEqual({ ok: true })
    await new Promise(r => setTimeout(r, 30))
    const ticketB = h.executor.bindingOf(SEAT)?.ticketId
    expect(ticketB).toBeDefined()
    expect(ticketB).not.toBe(ticketA)
    const before = JSON.stringify(h.ticket(ticketB!))
    // The replay of A's idle, and any later fact for A, do nothing to B.
    expect(h.remoteEvent('idle', SEAT, KEY_P, { quiet: true, text: '', ticket_id: ticketA, run_id: runA, event_id: 'ev-a-1' }, true)).toEqual({ ok: true, duplicate: true })
    expect(h.remoteEvent('error', SEAT, KEY_P, { error: 'late', transient: true, ticket_id: ticketA, run_id: runA, event_id: 'ev-a-2' }, true)).toEqual({ ok: true, stale: true })
    expect(JSON.stringify(h.ticket(ticketB!))).toBe(before)
    expect(h.executor.bindingOf(SEAT)?.ticketId).toBe(ticketB)
    void h.stop()
  })

  it('#688 R2 (re-review): a fact from another run of the same ticket does nothing; an accepted fact replayed after a restart is a duplicate', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-pi-restart-'))
    const h = await make(() => true, [], [seat], home)
    h.start()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const asked = h.request('only') as { triggerId: string }
    routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'only', scope: 's', reason: 'r' })
    await new Promise(r => setTimeout(r, 30))
    const binding = h.executor.bindingOf(SEAT)!
    const run = runOf(binding)
    const before = JSON.stringify(h.ticket(binding.ticketId))
    // Same ticket, an earlier run (as a restart that re-ran the ticket leaves behind): stale, and the current run untouched.
    expect(h.remoteEvent('error', SEAT, KEY_P, { error: 'old run', ticket_id: binding.ticketId, run_id: 'an-earlier-run', event_id: 'ev-old' }, true)).toEqual({ ok: true, stale: true })
    expect(h.remoteEvent('idle', SEAT, KEY_P, { quiet: true, text: '', ticket_id: binding.ticketId, run_id: 'an-earlier-run', event_id: 'ev-old-2' }, true)).toEqual({ ok: true, stale: true })
    expect(JSON.stringify(h.ticket(binding.ticketId))).toBe(before)
    expect(h.executor.bindingOf(SEAT)).toEqual(binding)
    // A read on the current run is taken once; the host restarts; its replay is a duplicate, not a new fact.
    expect(h.remoteEvent('read', SEAT, KEY_P, { ticket_id: binding.ticketId, run_id: run, event_id: 'ev-read' }, true)).toEqual({ ok: true })
    await h.stop()
    const again = await make(() => true, [], [seat], home)
    again.start()
    try {
      expect(again.remoteEvent('read', SEAT, KEY_P, { ticket_id: binding.ticketId, run_id: run, event_id: 'ev-read' }, true)).toEqual({ ok: true, duplicate: true })
      // A stale fact is never recorded (it had no effect): replayed after the restart it is stale again, and still does nothing.
      expect(again.remoteEvent('error', SEAT, KEY_P, { error: 'old run', ticket_id: binding.ticketId, run_id: 'an-earlier-run', event_id: 'ev-old' }, true)).toEqual({ ok: true, stale: true })
      // A fact without its run is refused.
      expect(again.remoteEvent('idle', SEAT, KEY_P, { quiet: true, text: '', ticket_id: binding.ticketId, event_id: 'ev-x' }, true)).toMatchObject({ ok: false, code: 'report' })
    } finally { void again.stop() }
  })

  it('#688 C1: a seat removed mid-run gets the stop as a control row for that run', async () => {
    const mailed: Array<[string, string, string | undefined]> = []
    const remotes: RemoteMember[] = [seat]
    const h = await make((_h, _k, text, ticket, run) => { mailed.push([ticket, text, run]); return true }, [], remotes)
    h.start()
    try {
      const { routeItem } = await import('../../src/superagent/host/tools.ts')
      const asked = h.request('one') as { triggerId: string }
      routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'one', scope: 's', reason: 'r' })
      await new Promise(r => setTimeout(r, 30))
      const binding = h.executor.bindingOf(SEAT)!
      remotes.splice(0, remotes.length)
      h.poolChanged()
      await new Promise(r => setTimeout(r, 30))
      const stop = mailed.find(([ticket, text]) => ticket === binding.ticketId && text.includes('is no longer yours'))
      expect(stop?.[2]).toBe(`stop.${runOf(binding)}`)
    } finally { void h.stop() }
  })

  it('#688 re-review R2: a transient error sent four times while the journal cannot be written runs no effect; once it can, exactly one', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-pi-journal-'))
    const h = await make(() => true, [], [seat], home)
    h.start()
    try {
      const { routeItem } = await import('../../src/superagent/host/tools.ts')
      const asked = h.request('one') as { triggerId: string }
      routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'one', scope: 's', reason: 'r' })
      await new Promise(r => setTimeout(r, 30))
      const binding = h.executor.bindingOf(SEAT)!
      let effects = 0
      const real = h.executor.memberError.bind(h.executor)
      h.executor.memberError = (member, error) => { effects++; real(member, error) }
      const journal = join(home, 'superagent', 'pi-events.json')
      mkdirSync(journal, { recursive: true })
      const fact = { error: 'fetch failed: one Pi run', transient: true, ticket_id: binding.ticketId, run_id: runOf(binding), event_id: 'ev-err' }
      for (let i = 0; i < 4; i++) expect(h.remoteEvent('error', SEAT, KEY_P, fact, true)).toMatchObject({ ok: false, code: 'journal', retryable: true })
      expect(effects).toBe(0)
      expect(h.executor.bindingOf(SEAT)).toEqual(binding)
      // The journal can be written again: the same event runs once; every later replay is a duplicate.
      rmSync(journal, { recursive: true })
      expect(h.remoteEvent('error', SEAT, KEY_P, fact, true)).toEqual({ ok: true })
      for (let i = 0; i < 3; i++) expect(h.remoteEvent('error', SEAT, KEY_P, fact, true)).toEqual({ ok: true, duplicate: true })
      expect(effects).toBe(1)
      expect(h.ticket(binding.ticketId)?.assignments.at(-1)?.state).not.toBe('failed')
    } finally { void h.stop() }
  })

  it('#688 re-review R2: an applied fact whose applied-record fails is not run again in this process', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-pi-journal2-'))
    const h = await make(() => true, [], [seat], home)
    h.start()
    try {
      const { routeItem } = await import('../../src/superagent/host/tools.ts')
      const asked = h.request('one') as { triggerId: string }
      routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'one', scope: 's', reason: 'r' })
      await new Promise(r => setTimeout(r, 30))
      const binding = h.executor.bindingOf(SEAT)!
      let effects = 0
      const real = h.executor.memberError.bind(h.executor)
      const journal = join(home, 'superagent', 'pi-events.json')
      // The effect runs, then the journal breaks before its applied record is written.
      h.executor.memberError = (member, error) => { effects++; real(member, error); mkdirSync(`${journal}.blocked`, { recursive: true }); rmSync(journal, { force: true }); mkdirSync(journal) }
      const fact = { error: 'fetch failed: one Pi run', transient: true, ticket_id: binding.ticketId, run_id: runOf(binding), event_id: 'ev-err' }
      expect(h.remoteEvent('error', SEAT, KEY_P, fact, true)).toEqual({ ok: true })
      for (let i = 0; i < 3; i++) expect(h.remoteEvent('error', SEAT, KEY_P, fact, true)).toEqual({ ok: true, duplicate: true })
      expect(effects).toBe(1)
    } finally { void h.stop() }
  })

  it('#688 re-review R2: a pending record left by a process that stopped before its effect: after the restart the ticket runs anew, and the old fact touches nothing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sa-pi-pending-'))
    const h = await make(() => true, [], [seat], home)
    h.start()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const asked = h.request('one') as { triggerId: string }
    routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'one', scope: 's', reason: 'r' })
    await new Promise(r => setTimeout(r, 30))
    const binding = h.executor.bindingOf(SEAT)!
    // The process stops between the pending record and the effect.
    h.executor.memberIdle = () => { throw new Error('process stopped') }
    const idle = { quiet: true, text: '', ticket_id: binding.ticketId, run_id: runOf(binding), event_id: 'ev-idle' }
    expect(() => h.remoteEvent('idle', SEAT, KEY_P, idle, true)).toThrow('process stopped')
    await h.stop()
    const again = await make(() => true, [], [seat], home)
    again.start()
    try {
      await new Promise(r => setTimeout(r, 30))
      // The restart interrupted the running assignment and runs the ticket again in a new run (executor.recover).
      const fresh = again.executor.bindingOf(SEAT)!
      expect(fresh.ticketId).toBe(binding.ticketId)
      expect(runOf(fresh)).not.toBe(runOf(binding))
      const before = JSON.stringify(again.ticket(binding.ticketId))
      // The old run's pending idle, sent again, is stale: it does not end the new run.
      expect(again.remoteEvent('idle', SEAT, KEY_P, idle, true)).toEqual({ ok: true, stale: true })
      expect(again.executor.bindingOf(SEAT)).toEqual(fresh)
      expect(JSON.stringify(again.ticket(binding.ticketId))).toBe(before)
    } finally { void again.stop() }
  })

  it('#688 C2: a fact whose effect fails records nothing; its retry applies it', async () => {
    const h = await make(() => true, [], [seat])
    h.start()
    try {
      const { routeItem } = await import('../../src/superagent/host/tools.ts')
      const asked = h.request('one') as { triggerId: string }
      routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 'one', scope: 's', reason: 'r' })
      await new Promise(r => setTimeout(r, 30))
      const binding = h.executor.bindingOf(SEAT)!
      const idle = { quiet: true, text: '', ticket_id: binding.ticketId, run_id: runOf(binding), event_id: 'ev-idle' }
      const real = h.executor.memberIdle.bind(h.executor)
      h.executor.memberIdle = () => { throw new Error('interrupted') }
      expect(() => h.remoteEvent('idle', SEAT, KEY_P, idle, true)).toThrow('interrupted')
      expect(h.executor.bindingOf(SEAT)).toEqual(binding)
      h.executor.memberIdle = real
      expect(h.remoteEvent('idle', SEAT, KEY_P, idle, true)).toEqual({ ok: true })
      expect(h.executor.bindingOf(SEAT)?.ticketId).not.toBe(binding.ticketId)
      expect(h.remoteEvent('idle', SEAT, KEY_P, idle, true)).toEqual({ ok: true, duplicate: true })
    } finally { void h.stop() }
  })

  it('a seat is heard only through a CLI claim under its pinned key; a node claim never speaks for it, nor a CLI claim for a session', async () => {
    const h = await make(() => true)
    const fact = (event: string) => ({ ticket_id: 't-none', run_id: 'r-none', event_id: event })
    expect(h.remoteEvent('idle', SEAT, KEY_P, fact('e-1'), true)).toMatchObject({ ok: true })
    expect(h.remoteEvent('idle', SEAT, KEY_P, fact('e-2'), false)).toMatchObject({ ok: false, code: 'not-member' })
    expect(h.remoteEvent('idle', SEAT, KEY_Q, fact('e-3'), true)).toMatchObject({ ok: false, code: 'not-member' })
    // A Pi seat's turn fact names its ticket and event.
    expect(h.remoteEvent('idle', SEAT, KEY_P, undefined, true)).toMatchObject({ ok: false, code: 'report' })
    expect(h.remoteEvent('idle', 'dsh/bbbbbbbb', KEY_B, undefined, true)).toMatchObject({ ok: false, code: 'not-member' })
    expect(h.remoteEvent('idle', 'dsh/bbbbbbbb', KEY_B, undefined, false)).toEqual({ ok: true })
  })
})
