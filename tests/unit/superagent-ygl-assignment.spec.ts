// @vitest-environment node
/** docs/design/superagent-ygl-memory.md Y2, Y3: the ygl-trees steps on the card, and one reminder at ready. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

async function team(ygl: boolean) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem, registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-ygl-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
    hasTool: (id: string, name: string) => ygl && id === 'session-m' && name === 'mcp__ygl__write',
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const report = async (args: Record<string, unknown>) => await registered.get('a2a_ticket_report')!.execute(args, { agent: { id: 'session-m' }, signal: new AbortController().signal })
  const asked = h.request('调研一下') as { triggerId: string }
  h.pass()
  const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '调研', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
  await vi.waitFor(() => { expect(h.executor.bindingOf('session-m')?.ticketId).toBe(ticket) })
  const card = sent.find(([id, text]) => id === 'session-m' && text.startsWith('[superagent assignment]'))![1]
  return { h, ticket, card, report }
}

describe('ygl-trees on the assignment card', () => {
  it('a member with the ygl tools finds the steps in its card; one without them does not', async () => {
    const m = await team(true)
    expect(m.card).toContain('team memory (ygl-trees)')
    expect(m.card).toContain('mcp__ygl__read domain agent action brief')
    // ygl-trees MCP drops an explicit project on agent brief (ygl-trees#260): select it for this session, then brief again.
    expect(m.card).toContain('ambiguous project: mcp__ygl__write domain project action use')
    expect(m.card).toContain('pass the ids you wrote in ygl on a2a_ticket_report')
    await m.h.stop()
    const n = await team(false)
    expect(n.card).not.toContain('ygl')
    await n.h.stop()
  })
})

describe('the reminder at ready', () => {
  it('sends a ready with no ids back once, then takes the next one', async () => {
    const m = await team(true)
    expect(await m.report({ ticket_id: m.ticket, state: 'ready', summary: '结论' })).toMatchObject({ ok: false, code: 'ygl-record' })
    expect(await m.report({ ticket_id: m.ticket, state: 'ready', summary: '结论，没有值得留的' })).toMatchObject({ ok: true })
    await m.h.stop()
  })
  it('takes a ready that names its ids, and shows them in the summary', async () => {
    const m = await team(true)
    expect(await m.report({ ticket_id: m.ticket, state: 'ready', summary: '结论', ygl: ['kb:abc123', 'claim:9f'] })).toMatchObject({ ok: true })
    expect(m.h.store.tickets.get(m.ticket)!.assignments.at(-1)!.report!.summary).toBe('结论\nygl: kb:abc123, claim:9f')
    await m.h.stop()
  })
  it('never reminds a member without the ygl tools, nor on a report that is not ready', async () => {
    const m = await team(true)
    expect(await m.report({ ticket_id: m.ticket, state: 'progress', summary: '在做' })).toMatchObject({ ok: true })
    await m.h.stop()
    const n = await team(false)
    expect(await n.report({ ticket_id: n.ticket, state: 'ready', summary: '结论' })).toMatchObject({ ok: true })
    await n.h.stop()
  })
  it('refuses more than 40 ids', async () => {
    const m = await team(true)
    expect(await m.report({ ticket_id: m.ticket, state: 'ready', summary: 's', ygl: Array.from({ length: 41 }, (_, i) => `k${String(i)}`) })).toMatchObject({ ok: false, code: 'ygl' })
    await m.h.stop()
  })
})
