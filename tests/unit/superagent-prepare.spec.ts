// @vitest-environment node
/** docs/design/superagent-reliability.md R1–R5: a ticket's directory is prepared before its member starts, and the team can cap running tickets. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync } from 'node:fs'
import { defaultPrepare, type PrepareRunner } from '../../src/superagent/host/executor.ts'
import { parseSettings, DEFAULT_SETTINGS } from '../../src/superagent/host/policy.ts'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'

async function team(settings: Record<string, unknown>, run: PrepareRunner, members = ['session-a', 'session-b']) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const ws = mkdtempSync(join(tmpdir(), 'sa-prep-ws-'))
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', ...members], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-prep-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
    workspaceOf: (id: string) => id === 'session-nows' ? undefined : join(ws, id), runPrepare: run,
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', ...settings }, () => true)).toMatchObject({ ok: true })
  h.start()
  const open = (text: string): string => {
    const asked = h.request(text) as { triggerId: string }
    h.pass()
    return (routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: text, scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id
  }
  const cards = (member?: string) => sent.filter(([id, t]) => (member === undefined || id === member) && t.startsWith('[superagent assignment]')).map(([, t]) => t)
  return { h, open, cards, ws }
}

const ok: PrepareRunner = async () => ({ ok: true, output: '' })

describe('settings', () => {
  it('keeps the prepare command and the cap across a reload', async () => {
    const { parseStoredSettings } = await import('../../src/superagent/host/policy.ts')
    expect(parseStoredSettings({ prepare: { command: 'p', timeoutMs: 120_000 }, maxConcurrent: 3 })).toMatchObject({ ok: true, settings: { prepare: { command: 'p', timeoutMs: 120_000 }, maxConcurrent: 3 } })
  })
  it('takes a prepare command and a cap, and refuses what it should', () => {
    expect(parseSettings({ prepare: { command: ' git worktree add x ', timeoutMinutes: 5 }, maxConcurrent: 2 }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { prepare: { command: 'git worktree add x', timeoutMs: 300_000 }, maxConcurrent: 2 } })
    expect(parseSettings({ prepare: { command: 'x' } }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { prepare: { timeoutMs: 600_000 } } })
    expect(parseSettings({ prepare: { command: '' } }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ prepare: { command: 'x', timeoutMinutes: 31 } }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ maxConcurrent: -1 }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    const cleared = parseSettings({ prepare: null }, { ...DEFAULT_SETTINGS, prepare: { command: 'x', timeoutMs: 1 } })
    expect(cleared.ok && cleared.settings).not.toHaveProperty('prepare')
  })
  it('a prepare command is the owner\'s to write', () => {
    expect(touchesRules({ prepare: { command: 'x' } })).toBe(true)
    expect(touchesRules({ maxConcurrent: 1 })).toBe(false)
  })
})

describe('preparing a ticket', () => {
  it('runs in the member\'s workspace with the ticket\'s variables, then hands out the card that says so', async () => {
    const run = vi.fn(ok)
    const m = await team({ prepare: { command: 'make-it' } }, run, ['session-a'])
    const ticket = m.open('写文档')
    await vi.waitFor(() => { expect(m.cards('session-a')).toHaveLength(1) })
    expect(run).toHaveBeenCalledWith('make-it', join(m.ws, 'session-a'), expect.objectContaining({ SUPERAGENT_TICKET_ID: ticket, SUPERAGENT_MEMBER: 'session-a', SUPERAGENT_TICKET_NAME: expect.any(String) }), 600_000)
    expect(m.cards('session-a')[0]).toContain('prepared:')
    await m.h.stop()
  })
  it('a failure frees the member, records the output, and gives no card', async () => {
    const m = await team({ prepare: { command: 'fail' } }, async () => ({ ok: false, output: 'exit 1\nno such branch' }), ['session-a'])
    const ticket = m.open('写文档')
    await vi.waitFor(() => { expect(m.h.store.tickets.get(ticket)?.delivery?.error).toContain('no such branch') })
    expect(m.cards()).toHaveLength(0)
    expect(m.h.executor.bindingOf('session-a')).toBeUndefined()
    await m.h.stop()
  })
  it('a retry prepares again, and a ticket already prepared is not prepared twice', async () => {
    let fails = 1
    const run = vi.fn<PrepareRunner>(async () => fails-- > 0 ? { ok: false, output: 'boom' } : { ok: true, output: '' })
    const m = await team({ prepare: { command: 'p' } }, run, ['session-a'])
    const ticket = m.open('写文档')
    await vi.waitFor(() => { expect(m.h.store.tickets.get(ticket)?.delivery).toBeDefined() })
    m.h.engine.retryTicket(ticket)
    m.h.pass()
    await vi.waitFor(() => { expect(m.cards('session-a')).toHaveLength(1) })
    expect(run).toHaveBeenCalledTimes(2)
    await m.h.stop()
  })
  it('a member with no workspace gets no card, and the ticket says why', async () => {
    const m = await team({ prepare: { command: 'p' } }, ok, ['session-nows'])
    const ticket = m.open('写文档')
    await vi.waitFor(() => { expect(m.h.store.tickets.get(ticket)?.delivery?.error).toContain('no workspace') })
    expect(m.cards()).toHaveLength(0)
    await m.h.stop()
  })
  it('with no command, nothing runs and the card goes out as before', async () => {
    const run = vi.fn(ok)
    const m = await team({}, run, ['session-a'])
    m.open('写文档')
    await vi.waitFor(() => { expect(m.cards('session-a')).toHaveLength(1) })
    expect(run).not.toHaveBeenCalled()
    expect(m.cards('session-a')[0]).not.toContain('prepared:')
    await m.h.stop()
  })
  it('the default runner reports the exit and the end of the output, and a timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-prep-run-')); mkdirSync(dir, { recursive: true })
    expect(await defaultPrepare('echo "$SUPERAGENT_TICKET_ID"', dir, { SUPERAGENT_TICKET_ID: 't-1' }, 5_000)).toEqual({ ok: true, output: 't-1\n' })
    expect(await defaultPrepare('echo bad >&2; exit 3', dir, {}, 5_000)).toMatchObject({ ok: false, output: expect.stringContaining('exit 3') })
    expect(await defaultPrepare('sleep 5', dir, {}, 200)).toMatchObject({ ok: false, output: expect.stringContaining('timed out') })
  })
})

describe('the cap', () => {
  it('holds new tickets at the cap and lets the next one go when a slot frees', async () => {
    const m = await team({ maxConcurrent: 1 }, ok)
    const first = m.open('一')
    m.open('二')
    await vi.waitFor(() => { expect(m.cards()).toHaveLength(1) })
    await new Promise(r => setTimeout(r, 50))
    expect(m.cards()).toHaveLength(1)
    m.h.engine.stopTicket(first, 'done')
    m.h.pass()
    await vi.waitFor(() => { expect(m.cards()).toHaveLength(2) })
    await m.h.stop()
  })
  it('0 is no cap: every free member gets one', async () => {
    const m = await team({ maxConcurrent: 0 }, ok)
    m.open('一'); m.open('二')
    await vi.waitFor(() => { expect(m.cards()).toHaveLength(2) })
    await m.h.stop()
  })
})
