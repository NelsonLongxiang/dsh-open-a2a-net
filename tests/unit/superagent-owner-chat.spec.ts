// @vitest-environment node
/** docs/design/superagent-router-owner-asks.md D14a: the owner talking to a member directly is not the ticket's business. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const now = { person: undefined as { id: string; atMs: number; text: string } | undefined, text: '' }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-chat-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {},
    memberTurn: () => ({ quiet: true, text: now.text }), personMessage: () => now.person, sessionName: (id: string) => id,
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const asked = h.request('做一件事') as { triggerId: string }
  h.pass()
  const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: 't', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
  await vi.waitFor(() => { expect(sent.some(([id, t]) => id === 'session-m' && t.startsWith('[superagent assignment]'))).toBe(true) })
  const assignment = () => h.store.tickets.get(ticket)!.assignments.at(-1)!
  const toMember = () => sent.filter(([id]) => id === 'session-m').map(([, t]) => t)
  return { h, now, ticket, assignment, toMember }
}

describe('the owner talks to a member that holds a ticket', () => {
  it('records no report from that turn, keeps the ticket running, and sends the member back to it', async () => {
    const m = await team()
    m.now.person = { id: 'msg-1', atMs: 1, text: '你现在在做什么' }
    m.now.text = '我在做那张单'
    m.h.memberIdle('session-m')
    await vi.waitFor(() => { expect(m.toMember().some(t => t.includes('separate from this ticket'))).toBe(true) })
    expect(m.assignment().report).toBeUndefined()
    expect(m.assignment().state).toBe('running')
    expect(m.h.executor.bindingOf('session-m')?.ticketId).toBe(m.ticket)
    await m.h.stop()
  })

  it('the turn after it, on the ticket, ends as any other does', async () => {
    const m = await team()
    m.now.person = { id: 'msg-1', atMs: 1, text: '在吗' }
    m.h.memberIdle('session-m')
    m.now.person = undefined
    m.now.text = '做不下去了，等信息'
    m.h.memberIdle('session-m')
    expect(m.assignment().report).toMatchObject({ state: 'waiting', summary: '做不下去了，等信息' })
    await m.h.stop()
  })

  it('a member with no ticket is left alone', async () => {
    const m = await team()
    m.h.engine.stopTicket(m.ticket, 'done with it')
    m.h.pass()
    const before = m.toMember().length
    m.now.person = { id: 'msg-1', atMs: 1, text: '聊聊' }
    m.h.memberIdle('session-m')
    await Promise.resolve()
    expect(m.toMember().filter(t => t.includes('separate from this ticket'))).toHaveLength(0)
    expect(m.toMember().length).toBeGreaterThanOrEqual(before)
    await m.h.stop()
  })
})
