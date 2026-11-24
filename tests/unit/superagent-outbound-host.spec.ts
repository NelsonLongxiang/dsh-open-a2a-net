// @vitest-environment node
/**
 * #882 review B1: the host wiring of the outbound answer notes, on a real SuperagentHost — the team pass writes an owed
 * note once and clears its health problem; an ended ticket's answer shows as its own problem; a held outbound lock makes
 * the checkpoint fail without waking pass after pass.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 25_000 })
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Trigger } from '../../src/superagent/upstream/dsh-superagent/src/core/index.ts'
import { problemText } from '../../src/superagent/host/health-reminders.ts'

const canvasOf = (local: readonly string[]) => (name: string) => name === 'team' ? { local, remote: [] } : undefined
const wb = (id: string): Trigger => ({ id, source: 'workbench', threads: [{ source: 'workbench', id: 't1' }], actor: { source: 'workbench', id: 'owner' }, human: true, addressed: 'direct',
  at: '2026-11-24T00:00:01Z', text: 'request ' + id, channel: { source: 'workbench', thread: 't1', address: { trigger: id } }, meta: {} })
const ADDR = 'dsh/canvas/other'
const answerText = (task: string) => '[A2A receipt] task ' + task + ' 数据在附件里'

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const home = mkdtempSync(join(tmpdir(), 'sa-outhost-'))
  const warns: string[] = []
  const make = () => new SuperagentHost({ canvasTeam: canvasOf(['session-r', 'session-m']), home, logger: { info: () => {}, warn: (f: string) => { warns.push(f) } },
    deliverToSession: () => true, interval: () => () => {}, sessionLoaded: () => true } as never)
  const first = make()
  expect(first.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  first.engine.receive(wb('1')); first.pass()
  expect(routeItem(first, { trigger_id: '1', kind: 'accept', title: '调研', scope: 's', reason: 'asked' })).toMatchObject({ ok: true })
  const ticketId = first.store.tickets.list()[0]!.id
  const path = join(home, 'superagent', 'outbound.json')
  const record = (card: string, task: string, over: Record<string, unknown> = {}) => ({ card, ticketId, address: ADDR, text: '原文', by: 'session-r', at: '2026-11-24T00:00:02Z', state: 'answered', task,
    answer: { text: answerText(task), at: '2026-11-24T00:00:03Z', key: 'r-' + card }, ...over })
  const seed = (rows: Array<ReturnType<typeof record>>) => { mkdirSync(join(home, 'superagent'), { recursive: true }); writeFileSync(path, JSON.stringify(Object.fromEntries(rows.map(r => [r.card, r])))) }
  const notes = (host: { store: { tickets: { get(id: string): { inputs: Array<{ kind: string; text?: string }> } | undefined } } }) => host.store.tickets.get(ticketId)!.inputs.filter(i => i.kind === 'note' && i.text?.includes('的回执：'))
  return { make, ticketId, path, record, seed, notes, warns }
}

describe('#882: the team pass and health for owed outbound answer notes', () => {
  it('health names the owed note and the ended-ticket answer; a pass writes the owed note once and clears its problem', async () => {
    const t = await team()
    t.seed([t.record('c1', 'direct-out000001'), t.record('c2', 'direct-out000002', { noteBlocked: 'ticket-ended' })])
    const host = t.make()
    const before = host.health().filter(p => p.code.startsWith('outbound-note-'))
    expect(before.map(p => p.code).sort()).toEqual(['outbound-note-pending', 'outbound-note-ticket-ended'])
    expect(before.every(p => p.ticketId === t.ticketId && p.title === '调研')).toBe(true)
    expect(problemText(before.find(p => p.code === 'outbound-note-pending')! as never)).toContain('还没写成')
    expect(problemText(before.find(p => p.code === 'outbound-note-ticket-ended')! as never)).toContain('不会重发原请求')
    host.pass()
    expect(t.notes(host)).toHaveLength(1)
    expect(t.notes(host)[0]!.text).toContain('direct-out000001')
    expect(host.health().filter(p => p.code.startsWith('outbound-note-')).map(p => p.code)).toEqual(['outbound-note-ticket-ended'])
    expect((JSON.parse(readFileSync(t.path, 'utf8')) as Record<string, { noted?: boolean }>).c1!.noted).toBe(true)
    host.pass()
    expect(t.notes(host)).toHaveLength(1)
  })

  it('a held outbound lock: the note is written once, the checkpoint stays owed, and pass is not woken over and over', async () => {
    const t = await team()
    t.seed([t.record('c1', 'direct-out000001')])
    writeFileSync(t.path + '.lock', 'held by another writer')
    const host = t.make()
    const original = host.pass.bind(host)
    let passes = 0
    ;(host as unknown as { pass: () => void }).pass = () => { passes += 1; if (passes > 20) return; original() }
    host.pass()
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(passes).toBeLessThanOrEqual(3)
    expect(t.notes(host)).toHaveLength(1)
    expect((JSON.parse(readFileSync(t.path, 'utf8')) as Record<string, { noted?: boolean }>).c1!.noted).toBeUndefined()
    expect(host.health().map(p => p.code)).toContain('outbound-note-pending')
  })
})
