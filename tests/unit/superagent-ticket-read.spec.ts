// @vitest-environment node
/** a2a_ticket_read: a member reads its own tickets, an observer its team's; nobody acts through it. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem, registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const presets: Record<string, string> = { 'session-o': 'superagent-observer' }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a', 'session-b', 'session-o'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-read-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', maxConcurrent: 1 }, () => true)).toMatchObject({ ok: true })
  h.start()
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const read = async (as: string, args: Record<string, unknown>) => await registered.get('a2a_ticket_read')!.execute(args, { agent: { id: as }, signal: new AbortController().signal })
  const asked = h.request('写文档') as { triggerId: string }
  h.pass()
  const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '写文档', scope: '只写文档', reason: 'r' } as never) as { ticket_id: string }).ticket_id
  await vi.waitFor(() => { expect(h.executor.memberOfTicket(ticket)).toBeDefined() })
  const holder = h.executor.memberOfTicket(ticket)!.member
  const other = ['session-a', 'session-b', 'session-o'].find(id => id !== holder && id !== 'session-o')!
  return { h, read, ticket, holder, other }
}

describe('a2a_ticket_read', () => {
  it('a member reads the ticket it holds, with its scope and stage', async () => {
    const m = await team()
    const mine = await m.read(m.holder, { kind: 'mine' })
    expect(mine).toMatchObject({ ok: true, tickets: [expect.objectContaining({ id: m.ticket, title: '写文档', scope: '只写文档' })] })
    expect(await m.read(m.holder, { kind: 'ticket', ticket_id: m.ticket })).toMatchObject({ ok: true, ticket: { id: m.ticket } })
    await m.h.stop()
  })
  it('another member sees none of it, and may not read the team', async () => {
    const m = await team()
    expect(await m.read(m.other, { kind: 'mine' })).toMatchObject({ ok: true, tickets: [] })
    expect(await m.read(m.other, { kind: 'ticket', ticket_id: m.ticket })).toMatchObject({ ok: false, code: 'not-yours' })
    expect(await m.read(m.other, { kind: 'team' })).toMatchObject({ ok: false, code: 'not-observer' })
    await m.h.stop()
  })
  it('an observer reads the team and its decisions', async () => {
    const m = await team()
    expect(await m.read('session-o', { kind: 'team' })).toMatchObject({ ok: true, tickets: [expect.objectContaining({ id: m.ticket })] })
    expect(await m.read('session-o', { kind: 'decisions' })).toMatchObject({ ok: true })
    expect(await m.read('session-o', { kind: 'ticket', ticket_id: m.ticket })).toMatchObject({ ok: true })
    await m.h.stop()
  })
  it('the router and a session outside the team are refused', async () => {
    const m = await team()
    expect(await m.read('session-r', { kind: 'mine' })).toMatchObject({ ok: false, code: 'not-member' })
    expect(await m.read('session-x', { kind: 'mine' })).toMatchObject({ ok: false, code: 'not-member' })
    await m.h.stop()
  })
})
