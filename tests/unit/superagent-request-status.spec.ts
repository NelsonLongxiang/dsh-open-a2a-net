// @vitest-environment node
/** #929 gap 2: `user request status <trigger>` — where a request went, from the store alone. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-reqstatus-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const ask = (text: string): string => (h.request(text) as { triggerId: string }).triggerId
  const accept = async (triggerId: string, title: string): Promise<string> => {
    h.pass()
    const ticket = (routeItem(h, { trigger_id: triggerId, kind: 'accept', title, scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
    await vi.waitFor(() => { expect(h.executor.bindingOf('session-m')?.ticketId).toBe(ticket) })
    return ticket
  }
  return { h, ask, accept }
}

describe('#929 gap 2: user request status', () => {
  it('refuses what is not a request id, and an id no request on this team has', async () => {
    const m = await team()
    for (const bad of ['', 'x', 'wb-', 'wb-zzzz', '../wb-00000000-0000-0000-0000-000000000000', 'wb-00000000-0000-0000-0000-000000000000/']) {
      expect(m.h.requestStatus(bad), JSON.stringify(bad)).toMatchObject({ ok: false, code: 'trigger' })
    }
    expect(m.h.requestStatus('wb-00000000-0000-0000-0000-000000000000')).toMatchObject({ ok: false, code: 'unknown' })
    await m.h.stop()
  })

  it('a request the router has not judged is pending, with no ticket; once accepted it names the ticket, its stage and what it reported', async () => {
    const m = await team()
    const trigger = m.ask('做事')
    const before = m.h.requestStatus(trigger) as { ok: boolean; status: string; tickets: unknown[] }
    expect(before).toMatchObject({ ok: true, triggerId: trigger, status: 'pending' })
    expect(before.tickets).toEqual([])
    const ticket = await m.accept(trigger, '做事')
    const after = m.h.requestStatus(trigger) as { status: string; tickets: Array<{ id: string; title: string; stage: { stage: string } }> }
    expect(after.status).toBe('ticketed')
    expect(after.tickets).toHaveLength(1)
    expect(after.tickets[0]).toMatchObject({ id: ticket, title: '做事' })
    expect(typeof after.tickets[0]!.stage.stage).toBe('string')
    await m.h.stop()
  })

  it('a request the router declined is judged with no ticket, not pending', async () => {
    const m = await team()
    const trigger = m.ask('不需要处理的话')
    m.h.pass()
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    expect(routeItem(m.h, { trigger_id: trigger, kind: 'ignore', reason: 'not work' } as never)).toMatchObject({ ok: true })
    const status = m.h.requestStatus(trigger) as { status: string; tickets: unknown[] }
    expect(status.tickets).toEqual([])
    expect(status.status).toBe('no-ticket')
    await m.h.stop()
  })

  it('another request is not shown another request\'s ticket', async () => {
    const m = await team()
    const first = m.ask('第一件')
    const second = m.ask('第二件')
    const ticket = await m.accept(first, '第一件')
    const mine = m.h.requestStatus(first) as { tickets: Array<{ id: string }> }
    const other = m.h.requestStatus(second) as { status: string; tickets: Array<{ id: string }> }
    expect(mine.tickets.map(t => t.id)).toEqual([ticket])
    expect(other.tickets.some(t => t.id === ticket)).toBe(false)
    expect(other.status).not.toBe('ticketed')
    await m.h.stop()
  })

  it('it reads only: asking again changes nothing, and a long report summary is cut', async () => {
    const m = await team()
    const trigger = m.ask('做事')
    await m.accept(trigger, '做事')
    const a = JSON.stringify(m.h.requestStatus(trigger))
    expect(JSON.stringify(m.h.requestStatus(trigger))).toBe(a)
    expect(JSON.stringify(m.h.state())).toBe(JSON.stringify(m.h.state()))
    await m.h.stop()
  })
})
