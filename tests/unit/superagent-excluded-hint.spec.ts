// @vitest-environment node
/**
 * Ticket 877ca64f: a ticket every eligible member is excluded from (the owner took the work off them on a credential card)
 * says so — queue reason all-excluded, the health text, and assignTicket refuses the excluded member instead of ok:true.
 * Also the #825 review's leftover test gaps: V5 (the 500-entry cap), X3 (two levels of split), V10 (tools hidden, not only refused).
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CALL = { command: 'cat ~/.dsh/a2a/cli.json' }
async function team(members: readonly string[], cap = 1) {
  const { SuperagentHost, CREDENTIAL_STOP } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const clock = { now: Date.parse('2026-11-23T01:00:00.000Z') }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', ...members], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-excl-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: () => undefined,
    now: () => new Date(clock.now).toISOString(),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', maxConcurrent: cap }, () => true)).toMatchObject({ ok: true })
  h.start()
  const accept = (triggerId: string, title: string) => (routeItem(h, { trigger_id: triggerId, kind: 'accept', title, scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
  const asked = h.request('写文档') as { triggerId: string }
  h.pass()
  const ticket = accept(asked.triggerId, '写文档')
  await vi.waitFor(() => { expect(h.executor.memberOfTicket(ticket)).toBeDefined() })
  const holder = h.executor.memberOfTicket(ticket)!.member
  h.auditCall(holder, 'member', 'bash', CALL)
  const card = h.decisionCards().find(c => c.by === 'credential:' + holder)!
  const stop = () => { const out = h.decide(card.id, 'choose', CREDENTIAL_STOP) as { refiled: string[] }; h.pass(); return out.refiled[0]! }
  const priv = h as unknown as { credentialExcluded(id: string): string[]; credentialExclusions: Map<string, string> }
  return { h, clock, holder, stop, accept, priv }
}

describe('877ca64f: a ticket nobody may take says so', () => {
  it('single-member team: queue reason all-excluded, the health text names it, assignTicket refuses the excluded member', async () => {
    const m = await team(['session-a'])
    const again = m.accept(m.stop(), '写文档（重派）')
    await vi.waitFor(() => { expect(m.h.executor.queued().some(q => q.ticketId === again)).toBe(true) })
    expect(m.h.executor.queued().find(q => q.ticketId === again)).toMatchObject({ reason: 'all-excluded', member: m.holder })
    expect(m.h.queueOf(again)).toMatchObject({ reason: 'all-excluded' })
    const { queuedProblems } = await import('../../src/superagent/host/index.ts')
    const { queuedText } = await import('../../src/superagent/host/health-reminders.ts')
    const problems = queuedProblems(m.h.executor.queued(), () => '2026-11-23T00:00:00.000Z', () => '写文档（重派）', Date.parse('2026-11-23T02:00:00.000Z'))
    expect(problems).toEqual([expect.objectContaining({ reason: 'all-excluded', session: m.holder })])
    expect(queuedText(problems[0]! as never)).toContain('可派的成员都被排除了')
    expect(m.h.assignTicket(again, m.holder)).toMatchObject({ ok: false, code: 'excluded' })
    expect(m.h.executor.list().some(b => b.ticketId === again)).toBe(false)
    await m.h.stop()
  })

  it('with another member free, the refiled ticket is not reported excluded', async () => {
    const m = await team(['session-a', 'session-b'])
    const again = m.accept(m.stop(), '写文档（重派）')
    await vi.waitFor(() => { expect(m.h.executor.list().some(b => b.ticketId === again)).toBe(true) })
    expect(m.h.executor.queued().some(q => q.reason === 'all-excluded')).toBe(false)
    await m.h.stop()
  })
})

describe('#825 review leftovers', () => {
  it('V5: the exclusion record keeps the newest 500', async () => {
    const m = await team(['session-a', 'session-b'])
    for (let i = 0; i < 500; i++) m.priv.credentialExclusions.set('old-' + String(i), 'session-x')
    const refiled = m.stop()
    expect(m.priv.credentialExclusions.size).toBe(500)
    expect(m.priv.credentialExclusions.has('old-0')).toBe(false)
    expect(m.priv.credentialExclusions.get(refiled)).toBe(m.holder)
    await m.h.stop()
  })

  it('X3: a grandchild of a split of the refiled ticket keeps the exclusion', async () => {
    const m = await team(['session-a', 'session-b', 'session-c', 'session-d', 'session-e', 'session-f'], 6)
    const again = m.accept(m.stop(), '写文档（重派）')
    const first = m.h.splitParent(again, 'session-r', [{ title: '前半', scope: 'a' }, { title: '后半', scope: 'b' }], 'two') as { ok: boolean; children: string[] }
    expect(first).toMatchObject({ ok: true })
    const second = m.h.splitParent(first.children[0]!, 'session-r', [{ title: '前一', scope: 'a1' }, { title: '前二', scope: 'a2', member: m.holder }], 'two more') as { ok: boolean; children: string[] }
    expect(second).toMatchObject({ ok: true })
    for (const grandchild of second.children) expect(m.priv.credentialExcluded(grandchild)).toEqual([m.holder])
    await vi.waitFor(() => { for (const g of second.children) expect(m.h.executor.list().some(b => b.ticketId === g)).toBe(true) })
    for (const g of second.children) expect(m.h.executor.list().find(b => b.ticketId === g)!.member).not.toBe(m.holder)
    await m.h.stop()
  })

  it('V10: a blocked work tool is hidden from a member, team tools and run_code are not', async () => {
    const { RoleTools } = await import('../../src/superagent/host/role-tools.ts')
    const log: string[] = []
    const agent = { id: 'm', ctx: { [Symbol('dsh.scope')]: {}, tools: { get: (name: string) => (['bash', 'a2a_ticket_report', 'run_code', 'read'].includes(name) ? {} : undefined), restrict: (f: { deny?: string[] }) => { log.push((f.deny ?? []).join(',')); return () => {} } } } }
    const tools = new RoleTools({ roleOf: () => 'member', blockedOf: () => ['bash', 'a2a_ticket_report', 'run_code'], agentOf: () => agent as never, logger: { warn: () => {} } })
    tools.sync(agent as never)
    const deny = log.at(-1)!.split(',')
    expect(deny).toContain('bash')
    expect(deny).not.toContain('a2a_ticket_report')
    expect(deny).not.toContain('run_code')
    expect(deny).not.toContain('read')
  })
})
