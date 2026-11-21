// @vitest-environment node
/** docs/design/superagent-ygl-memory.md Y2, Y3: the ygl-trees steps on the card, and one reminder at ready. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { yglCapabilities, yglCapabilitiesOf } from '../../src/superagent/host/ygl-home.ts'

async function team(ygl: boolean, made: string[] = [], version?: string) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem, registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-ygl-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
    hasTool: (id: string, name: string) => ygl && ((id === 'session-m' && name === 'mcp__ygl__write') || (id === 'session-r' && name === 'mcp__ygl__read')),
    ensureYglProject: (name: string) => { made.push(name) },
    // Without a version, the host reads what the start-up probe learned (the module state), as src/index.ts wires it.
    yglCapabilities: version !== undefined ? () => yglCapabilitiesOf(version) : yglCapabilities,
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
  const candidate = sent.find(([id, text]) => id === 'session-r' && text.startsWith('[superagent candidate]'))?.[1] ?? ''
  return { h, ticket, card, candidate, report }
}

describe('ygl-trees on the assignment card', () => {
  it('a member with the ygl tools finds the steps in its card; one without them does not', async () => {
    const m = await team(true)
    expect(m.card).toContain('team memory (ygl-trees)')
    expect(m.card).toContain('mcp__ygl__read domain agent action brief')
    // Y1c: the card names the team's project; the member selects it for its own session first (ygl-trees#260), then briefs.
    expect(m.card).toContain('This team\'s project is "team-team"')
    expect(m.card).toContain('mcp__ygl__write domain project action use name "team-team"')
    expect(m.card).toContain('make no other project')
    expect(m.card).toContain('pass the ids you wrote in ygl on a2a_ticket_report')
    // Y2: the skill match and the ticket's task are on the card the member receives.
    expect(m.card).toContain('domain agent action match')
    expect(m.card).toContain('domain task action add with text set to this ticket\'s title and project "team-team"')
    await m.h.stop()
    const n = await team(false)
    expect(n.card).not.toContain('ygl')
    await n.h.stop()
  })
})

describe('the team\'s ygl-trees project (Y1c)', () => {
  it('the host asks for the team\'s project, named after its canvas, and the router\'s card names it', async () => {
    const made: string[] = []
    const m = await team(true, made)
    expect(m.h.yglProject()).toBe('team-team')
    expect(made).toContain('team-team')
    expect(m.candidate).toContain('this team\'s ygl-trees project is "team-team"')
    await m.h.stop()
  })
  it('a router without the ygl read tool is not told about it', async () => {
    const n = await team(false)
    expect(n.candidate).not.toContain('ygl-trees project')
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

describe('the cards follow the installed ygl-trees (Y1d/Y1e, owner 2026-11-18)', () => {
  it('0.126.0: no project-use step, the team scope on kb add and searches, on both cards and the state', async () => {
    const m = await team(true, [], '0.126.0')
    expect(m.card).not.toContain('domain project action use')
    expect(m.card).toContain('domain agent action brief with project "team-team"')
    expect(m.card).toContain('with scope "bench:team-team" (this team\'s notes), then again with scope ""')
    expect(m.card).toContain('kb add what the next session should reuse, with scope "bench:team-team"')
    expect(m.candidate).toContain('search its kb notes with scope "bench:team-team", then with scope ""')
    expect(m.h.state().ygl).toEqual({ version: '0.126.0', briefHonorsProject: true, kbScope: true, project: 'team-team', scope: 'bench:team-team' })
    await m.h.stop()
  })
  it('0.122.0: today\'s steps, and no scope', async () => {
    const m = await team(true, [], '0.122.0')
    expect(m.card).toContain('mcp__ygl__write domain project action use name "team-team"')
    expect(m.card).not.toContain('bench:team-')
    expect(m.h.state().ygl).toEqual({ version: '0.122.0', briefHonorsProject: false, kbScope: false, project: 'team-team' })
    await m.h.stop()
  })
})

describe('#739 review R1: the team engines start only after the ygl-trees version read settles', () => {
  it('a start waits for a pending read; the first card then carries the 0.126 steps', async () => {
    const { startWhenYglKnown, yglCapabilities, setYglCapabilitiesForTest, YGL_UNKNOWN } = await import('../../src/superagent/host/ygl-home.ts')
    setYglCapabilitiesForTest(YGL_UNKNOWN)
    let resolve!: (v: string) => void
    const read = () => new Promise<string | undefined>(r => { resolve = r })
    let seen: unknown
    const start = vi.fn(() => { seen = yglCapabilities() })
    startWhenYglKnown(start, { logger: { warn: () => {} }, read })
    await Promise.resolve()
    expect(start).not.toHaveBeenCalled()
    resolve('0.126.0')
    await vi.waitFor(() => { expect(start).toHaveBeenCalledTimes(1) })
    expect(seen).toMatchObject({ version: '0.126.0', kbScope: true, briefHonorsProject: true })
    // The host started then sends the scoped steps on its first card.
    const m = await team(true, [], undefined)
    expect(m.h.state().ygl).toMatchObject({ kbScope: true, scope: 'bench:team-team' })
    expect(m.card).toContain('with scope "bench:team-team"')
    await m.h.stop()
    setYglCapabilitiesForTest(YGL_UNKNOWN)
  })
  it('a failed read settles as unknown and still starts; a cancelled start never runs', async () => {
    const { startWhenYglKnown, yglCapabilities, setYglCapabilitiesForTest, YGL_UNKNOWN } = await import('../../src/superagent/host/ygl-home.ts')
    const failed = vi.fn()
    startWhenYglKnown(failed, { logger: { warn: () => {} }, read: async () => { throw new Error('no ygl-trees') } })
    await vi.waitFor(() => { expect(failed).toHaveBeenCalledTimes(1) })
    expect(yglCapabilities()).toEqual(YGL_UNKNOWN)
    let resolve!: (v: string) => void
    const cancelled = vi.fn()
    const cancel = startWhenYglKnown(cancelled, { logger: { warn: () => {} }, read: () => new Promise(r => { resolve = r }) })
    cancel(); resolve('0.126.0')
    await new Promise(r => setTimeout(r, 10))
    expect(cancelled).not.toHaveBeenCalled()
    setYglCapabilitiesForTest(YGL_UNKNOWN)
  })
})

describe('#739 rereview R1: no card goes out before the version read settles, on any entry', () => {
  it('a request taken while the read is pending yields only scoped cards once it settles (every assignment, not just one)', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const { startWhenYglKnown, yglSettled, setYglCapabilitiesForTest, YGL_UNKNOWN } = await import('../../src/superagent/host/ygl-home.ts')
    setYglCapabilitiesForTest(YGL_UNKNOWN, false)
    const sent: Array<[string, string]> = []
    const h = new SuperagentHost({
      canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-ygl-')), logger: { info: () => {}, warn: () => {} },
      deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
      hasTool: (id: string, name: string) => (id === 'session-m' && name === 'mcp__ygl__write') || (id === 'session-r' && name === 'mcp__ygl__read'),
      ensureYglProject: () => {}, yglCapabilities, yglReady: yglSettled,
    } as never)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    let resolve!: (v: string) => void
    // As src/index.ts wires it since 2026-11-18: the engine starts at boot; what the ygl barrier holds goes out once the read settles.
    h.start()
    startWhenYglKnown(() => { h.resumeHeld() }, { logger: { warn: () => {} }, read: () => new Promise(r => { resolve = r }) })
    // The workbench entry, while the read is pending: the request is taken, no card goes out.
    const asked = h.request('调研一下') as { triggerId: string }
    expect(asked.triggerId).toBeDefined()
    h.pass()
    await new Promise(r => setTimeout(r, 10))
    expect(sent.filter(([, t]) => t.startsWith('[superagent candidate]') || t.startsWith('[superagent assignment]'))).toEqual([])
    resolve('0.126.0')
    await vi.waitFor(() => { expect(sent.some(([id, t]) => id === 'session-r' && t.startsWith('[superagent candidate]'))).toBe(true) })
    const candidate = sent.find(([id, t]) => id === 'session-r' && t.startsWith('[superagent candidate]'))![1]
    expect(candidate).toContain('scope "bench:team-team"')
    const ticket = (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '调研', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
    await vi.waitFor(() => { expect(h.executor.bindingOf('session-m')?.ticketId).toBe(ticket) })
    const assignments = sent.filter(([id, t]) => id === 'session-m' && t.startsWith('[superagent assignment]')).map(([, t]) => t)
    expect(assignments.length).toBeGreaterThan(0)
    for (const card of assignments) {
      expect(card).toContain('with scope "bench:team-team"')
      expect(card).not.toContain('domain project action use')
    }
    await h.stop()
    setYglCapabilitiesForTest(YGL_UNKNOWN)
  })
})
