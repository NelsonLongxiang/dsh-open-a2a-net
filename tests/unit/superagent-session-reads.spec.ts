// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { mkdtempSync, cleanupBeforeTempDirs } from '../temp-dirs.ts'
import { memberTurnFrom } from '../../src/superagent/session-reads.ts'
import { SuperagentHost } from '../../src/superagent/host/index.ts'
import { routeItem } from '../../src/superagent/host/tools.ts'

type Job = { owner?: string; status: string }
/** An instance method, like LocalJobRegistry.list: it must receive its owning service. */
class Jobs {
  readonly store = new Map<string, Job>()
  callers: string[] = []
  list(caller: string): Job[] { this.callers.push(caller); return [...this.store.values()] }
}

describe('memberTurnFrom job service receiver', () => {
  it.each([
    ['no jobs', [], true],
    ['own running', [{ owner: 'member', status: 'running' }], false],
    ['own stopping', [{ owner: 'member', status: 'stopping' }], false],
    ['own completed', [{ owner: 'member', status: 'completed' }], true],
    ['other member running', [{ owner: 'other', status: 'running' }], true],
    ['unowned running', [{ status: 'running' }], true],
  ] as const)('%s preserves the receiver and existing owner/status filtering', (_name, rows, quiet) => {
    const jobs = new Jobs()
    rows.forEach((job, i) => jobs.store.set(String(i), job))
    const events = [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'first' }] } } }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: ' waiting ' }] } } }]
    expect(memberTurnFrom('member', events, jobs)).toEqual({ quiet, text: 'waiting' })
    expect(jobs.callers).toEqual(['member'])
  })
  it('keeps the missing-service/missing-method compatibility path', () => {
    expect(memberTurnFrom('member', [], undefined)).toEqual({ quiet: true, text: '' })
    expect(memberTurnFrom('member', [], {})).toEqual({ quiet: true, text: '' })
  })
  it('does not turn a real registry read failure into a false quiet result', () => {
    expect(() => memberTurnFrom('member', [], { list() { throw new Error('registry unavailable') } })).toThrow('registry unavailable')
  })
})

it('waiting with a receiver-dependent jobs service parks the original assignment and releases the one execution slot', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sa-jobs-receiver-'))
  const jobs = new Jobs()
  const delivered: string[] = []
  const host = new SuperagentHost({
    home, canvasTeam: () => ({ local: ['router', 'member'], remote: [] }),
    logger: { info() {}, warn() {} }, interval: () => () => {},
    deliverToSession: (id, text) => { if (id === 'member') delivered.push(text); return true },
    memberTurn: id => memberTurnFrom(id, [], jobs),
  })
  cleanupBeforeTempDirs(() => host.stop())
  expect(host.saveSettings({ canvas: 'team', router: 'router', maxConcurrent: 1 }, () => true)).toMatchObject({ ok: true })
  host.start()
  const accept = (text: string) => {
    const request = host.request(text) as { triggerId: string }
    return (routeItem(host, { trigger_id: request.triggerId, kind: 'accept', title: text, scope: 'fixture', reason: 'owner asked' }) as { ticket_id: string }).ticket_id
  }
  const one = accept('first'), two = accept('second')
  await vi.waitFor(() => expect(host.executor.bindingOf('member')?.ticketId).toBe(one))
  const originalAssignment = host.store.tickets.get(one)!.assignments.at(-1)!.id
  expect(host.report('member', { state: 'waiting', summary: 'needs input', question: 'which format?' }, one)).toMatchObject({ ok: true })
  expect(() => host.memberIdle('member')).not.toThrow()
  await vi.waitFor(() => expect(host.executor.bindingOf('member')?.ticketId).toBe(two))
  const disk = JSON.parse(readFileSync(join(home, 'superagent', 'executor.json'), 'utf8'))
  expect(disk.bindings.map((b: {ticketId: string}) => b.ticketId)).toEqual([two])
  expect(disk.parked).toEqual(expect.arrayContaining([expect.objectContaining({ ticketId: one, assignmentId: originalAssignment })]))
  expect(host.store.tickets.get(one)!.assignments.at(-1)).toMatchObject({ id: originalAssignment, state: 'running', report: { state: 'waiting' } })
  expect(host.store.tickets.get(one)!.ended).toBeUndefined()
  expect(delivered.filter(t => t.startsWith('[superagent assignment]'))).toHaveLength(2)
})
