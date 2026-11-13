// @vitest-environment node
/**
 * docs/design/superagent-pi-platform.md PR-B: a Pi seat (a CLI identity whose own signed card declares piSeat, deposited on
 * the team host) is a team member: admitted to the team canvas with its key pinned, given work through its mailbox, and
 * heard only through a CLI claim under the pinned key.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CanvasStore } from '../../src/canvas-store.ts'
import { PI_PLATFORM, piCardText, piDeliverable, piSeatAdmission } from '../../src/superagent/platforms/pi.ts'
import type { RemoteMember } from '../../src/superagent/host/policy.ts'

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
  const make = async (piDeliver: (handle: string, key: string, text: string, ticket: string) => boolean, sent: string[] = [], remotes: RemoteMember[] = [seat, remote]) => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const h = new SuperagentHost({
      canvasTeam: name => name === 'team' ? { local: ['session-r'], remote: remotes } : undefined,
      home: mkdtempSync(join(tmpdir(), 'sa-pi-')), logger: { info: () => {}, warn: () => {} }, interval: () => () => {},
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
    expect(h.remoteEvent('idle', SEAT, KEY_P, { quiet: true, text: '', person: true }, true)).toEqual({ ok: true })
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

  it('a seat is heard only through a CLI claim under its pinned key; a node claim never speaks for it, nor a CLI claim for a session', async () => {
    const h = await make(() => true)
    expect(h.remoteEvent('idle', SEAT, KEY_P, undefined, true)).toEqual({ ok: true })
    expect(h.remoteEvent('idle', SEAT, KEY_P, undefined, false)).toMatchObject({ ok: false, code: 'not-member' })
    expect(h.remoteEvent('idle', SEAT, KEY_Q, undefined, true)).toMatchObject({ ok: false, code: 'not-member' })
    expect(h.remoteEvent('idle', 'dsh/bbbbbbbb', KEY_B, undefined, true)).toMatchObject({ ok: false, code: 'not-member' })
    expect(h.remoteEvent('idle', 'dsh/bbbbbbbb', KEY_B, undefined, false)).toEqual({ ok: true })
  })
})
