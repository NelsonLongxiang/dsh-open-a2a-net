// @vitest-environment node
/**
 * #742: a quiet member idle that lands while an Input delivery to its Assignment is still in flight. settle() must not park
 * during the delivery, but the idle must not be lost either: once the delivery finishes, it settles when the turn that
 * ended had taken the Input in, and is dropped when a newer turn, a failed delivery or a later Input supersedes it.
 * Public host APIs and synthetic tasks only (the reporter's fixture plus the regression set the issue asks for).
 */
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, cleanupBeforeTempDirs } from '../temp-dirs.ts'
import { SuperagentHost } from '../../src/superagent/host/index.ts'
import { routeItem } from '../../src/superagent/host/tools.ts'

const R = 'session-a0000000aaaa1111', M = 'session-b1111111bbbb2222'
const tick = (): Promise<void> => new Promise<void>(r => setImmediate(r))
const ms = (n: number): Promise<void> => new Promise<void>(r => setTimeout(r, n))

async function fixture(quiet = true) {
  const home = mkdtempSync(join(tmpdir(), 'member-delivery-idle-'))
  const sent: string[] = []
  const releases: ((ok: boolean) => void)[] = []
  let hold = 0
  const h = new SuperagentHost({
    home, canvasTeam: () => ({ local: [R, M], remote: [] }), logger: { info() {}, warn() {} }, interval: () => () => {},
    memberTurn: () => ({ quiet, text: 'waiting on owner' }),
    deliverToSession: ((id: string, text: string) => {
      if (id !== M) return true
      sent.push(text)
      if (hold > 0 && text.startsWith('[superagent input]')) { hold--; return new Promise<boolean>(resolve => { releases.push(resolve) }) }
      return true
    }) as never,
  })
  cleanupBeforeTempDirs(() => h.stop())
  expect(h.saveSettings({ canvas: 'fixture', router: R, maxConcurrent: 1 }, () => true)).toMatchObject({ ok: true })
  h.start()
  const accept = (text: string) => {
    const req = h.request(text) as { triggerId: string; thread: string }
    const out = routeItem(h, { trigger_id: req.triggerId, kind: 'accept', title: text, scope: 'synthetic fixture', reason: 'test owner request' }) as { ok: boolean; ticket_id: string }
    expect(out.ok).toBe(true)
    return { ticket: out.ticket_id, thread: req.thread }
  }
  const a = accept('A waits on an input'), b = accept('B queued behind A')
  await vi.waitFor(() => expect(h.executor.bindingOf(M)?.ticketId).toBe(a.ticket))
  const original = h.store.tickets.get(a.ticket)!.assignments.at(-1)!.id
  /** Sends a held follow-up to A; resolves once its delivery is in flight. */
  const heldInput = async (text = 'a normal follow-up') => {
    const before = releases.length
    hold++
    h.request(text, a.thread)
    await vi.waitFor(() => expect(releases.length).toBe(before + 1))
    return releases[before]!
  }
  const turn = (summary = 'needs owner input') => {
    h.memberClaimed(M)
    expect(h.report(M, { state: 'waiting', summary, question: 'which output format?' }, a.ticket)).toMatchObject({ ok: true })
    h.memberIdle(M)
  }
  const drained = async () => { await vi.waitFor(() => expect(h.store.tickets.get(a.ticket)!.undelivered).toEqual([])); await tick(); await tick(); h.pass(); await tick() }
  const assignCards = () => sent.filter(t => t.startsWith('[superagent assignment]')).length
  const expectSlotFreed = () => {
    expect(h.store.tickets.get(a.ticket)!.ended).toBeUndefined()
    expect(h.store.tickets.get(a.ticket)!.assignments.at(-1)!.id).toBe(original)
    expect(h.executor.bindingFor(M, a.ticket)).toBeDefined()
    expect(h.executor.bindingOf(M)?.ticketId).toBe(b.ticket)
    expect(assignCards()).toBe(2)
  }
  const expectSlotHeld = () => {
    expect(h.store.tickets.get(a.ticket)!.ended).toBeUndefined()
    expect(h.executor.bindingOf(M)?.ticketId).toBe(a.ticket)
    expect(h.executor.bindingOf(M)?.assignmentId).toBe(original)
    expect(assignCards()).toBe(1)
  }
  return { h, a, b, heldInput, turn, drained, expectSlotFreed, expectSlotHeld }
}

describe('#742 idle versus input-delivery completion', () => {
  it('control: an input delivered before the final idle releases the one execution slot', async () => {
    const f = await fixture()
    const release = await f.heldInput()
    release(true)
    await f.drained()
    f.turn()
    await f.drained()
    f.expectSlotFreed()
  })

  it('a quiet idle during a pending delivery releases the slot once the delivery completes', async () => {
    const f = await fixture()
    const release = await f.heldInput()
    f.turn()
    f.expectSlotHeld()
    release(true)
    await f.drained()
    f.expectSlotFreed()
  })

  it('the replayed idle settles once: a second pass after it changes nothing', async () => {
    const f = await fixture()
    const release = await f.heldInput()
    f.turn()
    release(true)
    await f.drained()
    f.expectSlotFreed()
    f.h.pass(); await tick(); await tick()
    f.expectSlotFreed()
  })

  it('a new claim after the set-aside idle supersedes it: the member is in a new turn, the slot stays', async () => {
    const f = await fixture()
    const release = await f.heldInput()
    f.turn()
    f.h.memberClaimed(M)
    release(true)
    await f.drained()
    f.expectSlotHeld()
  })

  it('a failed delivery drops the set-aside idle: no parking over an Input the member never got', async () => {
    const f = await fixture()
    const release = await f.heldInput()
    f.turn()
    release(false)
    await vi.waitFor(() => expect(f.h.store.tickets.get(f.a.ticket)!.delivery).toBeDefined())
    await tick(); await tick()
    f.expectSlotHeld()
  })

  it('an idle whose turn was claimed before the send started did not take the Input in: it waits for the turn the Input wakes', async () => {
    const f = await fixture()
    f.h.memberClaimed(M)
    expect(f.h.report(M, { state: 'waiting', summary: 'needs owner input', question: 'which output format?' }, f.a.ticket)).toMatchObject({ ok: true })
    await ms(5)
    const release = await f.heldInput()
    f.h.memberIdle(M)
    release(true)
    await f.drained()
    f.expectSlotHeld()
    // The Input's own turn ends quietly: that idle settles as usual.
    f.turn('read the follow-up')
    await f.drained()
    f.expectSlotFreed()
  })

  it('a second Input queued behind the pending delivery supersedes the idle; its own turn settles', async () => {
    const f = await fixture()
    const first = await f.heldInput('first follow-up')
    f.turn()
    await ms(5)
    f.h.request('second follow-up', f.a.thread)
    await tick()
    first(true)
    await f.drained()
    f.expectSlotHeld()
    f.turn('read both follow-ups')
    await f.drained()
    f.expectSlotFreed()
  })

  it('a nonquiet idle (background jobs) during the delivery keeps the slot after it completes', async () => {
    const f = await fixture(false)
    const release = await f.heldInput()
    f.turn()
    release(true)
    await f.drained()
    f.expectSlotHeld()
  })

  it('#745 R1: an empty extra delivery pass keeps the real send boundary; an idle claimed before the send does not park', async () => {
    const f = await fixture()
    // The old turn is claimed and reports before the new Input exists.
    f.h.memberClaimed(M)
    expect(f.h.report(M, { state: 'waiting', summary: 'needs owner input', question: 'which output format?' }, f.a.ticket)).toMatchObject({ ok: true })
    const release = await f.heldInput()
    f.h.memberIdle(M)
    // A normal scan while the delivery is pending queues a pass that will find nothing new.
    f.h.executor.launch()
    await tick()
    release(true)
    await f.drained()
    f.expectSlotHeld()
    // The Input's own turn still settles as usual.
    f.turn('read the follow-up')
    await f.drained()
    f.expectSlotFreed()
  })

  it('#745 R2: a second Input in the same millisecond as the ended turn is not taken for one that turn consumed', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const f = await fixture()
      const first = await f.heldInput('first follow-up')
      f.turn()
      // After the idle, without another claim: same Date.now() as the claim and the first send.
      f.h.request('second follow-up', f.a.thread)
      await tick()
      first(true)
      await f.drained()
      f.expectSlotHeld()
      f.turn('read the second follow-up')
      await f.drained()
      f.expectSlotFreed()
    } finally { clock.mockRestore() }
  })
})
