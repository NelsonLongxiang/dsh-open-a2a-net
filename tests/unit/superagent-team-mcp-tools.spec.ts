/**
 * #690 review F1/F2/F4 negative regressions for the team MCP tools: the credential is the calling member's own seat, names
 * never collide, a call runs the caller team's exact descriptor, and a changed descriptor replaces the registered tool.
 */
import { describe, expect, it } from 'vitest'
import { mcpToolFingerprint, teamToolName, TeamMcpTools } from '../../src/superagent/host/team-mcp-tools.ts'
import type { McpToolInfo } from '../../src/superagent/host/team-mcp.ts'

type Def = { name: string; description: string; execute: (args: unknown, exec: { agent?: { id: unknown } }) => Promise<Record<string, unknown>> }

function fakeTeam(members: Record<string, { seat?: string; ticket?: string }>, offered: Record<string, McpToolInfo[]>) {
  const calls: Array<{ server: string; tool: string; seat?: string; by: string }> = []
  const named: Record<string, string> = {}
  const team = {
    offered,
    named,
    calls,
    settings: { serves: undefined },
    roleOf: (id: string) => members[id] !== undefined ? 'member' : 'other',
    executor: {
      bindingOf: (id: string) => members[id]?.ticket !== undefined ? { ticketId: members[id]!.ticket! } : undefined,
      memberOfTicket: (ticketId: string) => named[ticketId] !== undefined ? { member: named[ticketId]!, named: true } : undefined,
    },
    mcpSeatOf: (id: string) => members[id]?.seat,
    // The ticket's receipt seat (what the old code used): deliberately another member's seat.
    seatOf: () => ({ seat: 'other', seatId: 'seat-WRONG', role: 'member' }),
    mcp: {
      status: () => Object.keys(team.offered).map(name => ({ name })),
      offered: (name: string) => team.offered[name] ?? [],
      callTool: async (server: string, tool: string, _args: unknown, who: { by: string; seat?: string }) => {
        calls.push({ server, tool, by: who.by, ...(who.seat !== undefined ? { seat: who.seat } : {}) })
        return { text: `ran ${tool}`, size: 1, clipped: false, isError: false }
      },
    },
  }
  return team
}

function registry(teams: Array<ReturnType<typeof fakeTeam>>, sessionTeam: Record<string, number>) {
  const defs = new Map<string, Def>()
  const disposed: string[] = []
  const ctx = { tools: { register: (def: Def) => { defs.set(def.name, def); return () => { disposed.push(def.name); defs.delete(def.name) } } } }
  const tools = new TeamMcpTools(ctx as never, id => sessionTeam[id] !== undefined ? teams[sessionTeam[id]!] as never : undefined, () => teams as never, { warn: () => {} })
  return { tools, defs, disposed }
}

const schema = (prop: string) => ({ type: 'object', properties: { [prop]: { type: 'string' } } })

describe('team MCP tool names (#690 F2)', () => {
  it('raw names that differ only in punctuation, or past 64 characters, get distinct names', () => {
    expect(teamToolName('market', 'write_file')).toBe('team__market__write_file')
    expect(teamToolName('market', 'write.file')).not.toBe(teamToolName('market', 'write_file'))
    const long = 'x'.repeat(70)
    expect(teamToolName('market', `${long}a`)).not.toBe(teamToolName('market', `${long}b`))
    for (const n of [teamToolName('market', 'write.file'), teamToolName('market', `${long}a`)]) expect(n).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('A offers write.file, B offers write_file: B calling write_file runs write_file on B, never A\'s write.file', async () => {
    const a = fakeTeam({ 'sa': { seat: 'seat-a', ticket: 't-a' } }, { files: [{ name: 'write.file', inputSchema: schema('path') }] })
    const b = fakeTeam({ 'sb': { seat: 'seat-b', ticket: 't-b' } }, { files: [{ name: 'write_file', inputSchema: schema('path') }] })
    const r = registry([a, b], { sa: 0, sb: 1 })
    r.tools.refresh()
    expect(r.tools.names()).toHaveLength(2)
    const bName = teamToolName('files', 'write_file')
    expect(await r.defs.get(bName)!.execute({ path: 'p' }, { agent: { id: 'sb' } })).toMatchObject({ ok: true })
    expect(b.calls).toEqual([{ server: 'files', tool: 'write_file', by: 'sb', seat: 'seat-b' }])
    // A calling B's tool: its team does not offer that descriptor.
    expect(await r.defs.get(bName)!.execute({}, { agent: { id: 'sa' } })).toMatchObject({ ok: false, code: 'not-offered' })
    expect(a.calls).toEqual([])
  })

  it('two teams with one raw name but different parameters get a tool each, and each runs only for its own team', async () => {
    const a = fakeTeam({ 'sa': { seat: 'seat-a', ticket: 't-a' } }, { files: [{ name: 'put', inputSchema: schema('path') }] })
    const b = fakeTeam({ 'sb': { seat: 'seat-b', ticket: 't-b' } }, { files: [{ name: 'put', inputSchema: schema('key') }] })
    const r = registry([a, b], { sa: 0, sb: 1 })
    r.tools.refresh()
    const names = r.tools.names()
    expect(names).toHaveLength(2)
    expect(names).not.toContain(teamToolName('files', 'put'))
    const results = await Promise.all(names.map(async n => [n, await r.defs.get(n)!.execute({}, { agent: { id: 'sb' } })] as const))
    expect(results.filter(([, out]) => out.ok === true)).toHaveLength(1)
    expect(b.calls).toHaveLength(1)
  })

  it('a changed description or schema under the same raw name replaces the registered tool (F4)', () => {
    const a = fakeTeam({ 'sa': { seat: 'seat-a', ticket: 't-a' } }, { files: [{ name: 'put', description: 'v1', inputSchema: schema('path') }] })
    const r = registry([a], { sa: 0 })
    r.tools.refresh()
    const name = teamToolName('files', 'put')
    expect(r.defs.get(name)!.description).toContain('v1')
    a.offered.files = [{ name: 'put', description: 'v2', inputSchema: schema('key') }]
    r.tools.refresh()
    expect(r.disposed).toEqual([name])
    expect(r.defs.get(name)!.description).toContain('v2')
    expect(mcpToolFingerprint('files', a.offered.files[0]!)).not.toBe(mcpToolFingerprint('files', { name: 'put', description: 'v1', inputSchema: schema('path') }))
  })
})

describe('the credential is the calling member\'s own seat (#690 F1)', () => {
  it('calls as the caller\'s seat, never the ticket\'s receipt seat; refuses when the ticket is named for another member', async () => {
    const a = fakeTeam({ 'sa': { seat: 'seat-a', ticket: 't-1' }, 'sb': { seat: 'seat-b' } }, { m: [{ name: 'list' }] })
    const r = registry([a], { sa: 0, sb: 0 })
    r.tools.refresh()
    const def = r.defs.get(teamToolName('m', 'list'))!
    expect(await def.execute({}, { agent: { id: 'sa' } })).toMatchObject({ ok: true })
    expect(a.calls).toEqual([{ server: 'm', tool: 'list', by: 'sa', seat: 'seat-a' }])
    // The ticket now names B (a reassignment in flight): A, still bound, gets no call under any seat.
    a.named['t-1'] = 'sb'
    expect(await def.execute({}, { agent: { id: 'sa' } })).toMatchObject({ ok: false, code: 'not-your-ticket' })
    expect(a.calls).toHaveLength(1)
  })
})
