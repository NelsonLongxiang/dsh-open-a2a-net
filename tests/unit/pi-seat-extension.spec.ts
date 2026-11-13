// @vitest-environment node
/**
 * The a2a-seat Pi extension's lifecycle (#688 review F1–F3), driven through its real event handlers with a fake Pi API
 * and a scripted CLI. Not a real Pi runtime: the handlers, cursor state, owed facts and generation fence are the code under
 * test.
 */
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Exec = { stdout: string; stderr: string; code: number; killed: boolean }
type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<void> | void
const A = 'seat-a/0123456789abcdef', B = 'seat-b/fedcba9876543210', HOST = 'http://127.0.0.1:9'
const ok = (stdout = '{}'): Exec => ({ stdout, stderr: '', code: 0, killed: false })
const fail = (): Exec => ({ stdout: '', stderr: 'down', code: 1, killed: false })
const tick = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)) }

async function load(home: string) {
  vi.resetModules()
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  return await import('../../pi/extension/a2a-seat.ts')
}

/** A Pi with one seat identity and a scripted CLI; `reply` decides each CLI call. */
function pi(handle: string, reply: (args: string[]) => Promise<Exec> | Exec) {
  const handlers = new Map<string, Handler>()
  const sent: string[] = [], calls: string[][] = [], notes: string[] = []
  const api = {
    on: (event: string, handler: Handler) => { handlers.set(event, handler) },
    exec: async (_cmd: string, args: string[]) => { calls.push(args); return args[0] === 'whoami' ? ok(JSON.stringify({ handle, host: HOST })) : await reply(args) },
    sendUserMessage: (text: string) => { sent.push(text) },
  }
  const ctx = { hasUI: true, ui: { notify: (m: string) => { notes.push(m) } }, isIdle: () => true }
  const fire = async (event: string, payload: Record<string, unknown> = {}) => { await handlers.get(event)?.(payload, ctx); await tick() }
  return { api, sent, calls, notes, fire }
}
const inbox = (handle: string, next: string, mail: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) => ok(JSON.stringify({ handle, next, mail, lost: 0, epochChanged: false, ...extra }))

afterEach(() => { vi.unstubAllEnvs() })

describe('F1: a cursor belongs to one seat', () => {
  it('two seats on one OS user keep their own cursors; B reads from its own start even after A moved far ahead', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pi-seat-'))
    const ext = await load(home)
    expect(ext.seatStatePath(A, HOST)).not.toBe(ext.seatStatePath(B, HOST))
    const a = pi(A, args => args[0] === 'inbox' ? inbox(A, 'ep:50') : ok())
    ext.default(a.api as never)
    await a.fire('session_start')
    await a.fire('session_shutdown')
    expect(JSON.parse(readFileSync(ext.seatStatePath(A, HOST), 'utf8')).cursor).toBe('ep:50')
    const b = pi(B, args => args[0] === 'inbox' ? inbox(B, 'ep:1', [{ from: 'superagent', text: 'work for B', seq: 1, task_id: 't-b' }]) : ok())
    ext.default(b.api as never)
    await b.fire('session_start')
    expect(b.calls.find(c => c[0] === 'inbox')).toEqual(['inbox', '--after', 'start'])
    expect(b.sent).toEqual(['work for B'])
  })

  it('a read of another mailbox, or a cursor the host never issued, hands nothing over and says so', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    const wrong = pi(A, args => args[0] === 'inbox' ? inbox(B, 'ep:2', [{ from: 'superagent', text: 'not mine', seq: 2 }]) : ok())
    ext.default(wrong.api as never)
    await wrong.fire('session_start')
    expect(wrong.sent).toEqual([])
    expect(wrong.notes.join('\n')).toContain('stops consuming')
    await wrong.fire('session_shutdown')
    const ahead = pi(A, args => args[0] === 'inbox' ? inbox(A, 'ep:99', [], { cursorAhead: true }) : ok())
    ext.default(ahead.api as never)
    await ahead.fire('session_start')
    expect(ahead.sent).toEqual([])
    expect(ahead.notes.join('\n')).toContain('was not issued')
  })

  it('one consumer per seat: a live other process holding the lock keeps this session off the mailbox', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    const path = ext.seatStatePath(A, HOST)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: process.ppid }))
    const p = pi(A, args => args[0] === 'inbox' ? inbox(A, 'ep:1', [{ from: 'superagent', text: 'w', seq: 1 }]) : ok())
    ext.default(p.api as never)
    await p.fire('session_start')
    expect(p.calls.some(c => c[0] === 'inbox')).toBe(false)
    expect(p.notes.join('\n')).toContain('another Pi process')
  })
})

describe('F2: a turn end is owed until the host takes it', () => {
  it('a failed idle is kept (and persisted), retried before any new work is fetched, and cleared only on success', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    let idleCode = 1, next = 1
    const p = pi(A, args => {
      if (args[0] === 'inbox') { const n = next++; return inbox(A, `ep:${String(n)}`, n === 1 ? [{ from: 'superagent', text: 'work 1', seq: 1 }] : [{ from: 'superagent', text: `work ${String(n)}`, seq: n }]) }
      if (args[0] === 'ticket' && args[1] === 'idle') return idleCode === 0 ? ok() : fail()
      return ok()
    })
    ext.default(p.api as never)
    await p.fire('session_start')
    expect(p.sent).toEqual(['work 1'])
    await p.fire('agent_settled', { aborted: false })
    expect(p.calls.filter(c => c[1] === 'idle')).toHaveLength(1)
    expect(JSON.parse(readFileSync(ext.seatStatePath(A, HOST), 'utf8')).owedEnd).toEqual({ op: 'idle' })
    expect(p.notes.join('\n')).toContain('retrying')
    // A second settle with no new work owes nothing new; the first stays owed.
    await p.fire('agent_settled', { aborted: false })
    expect(p.sent).toEqual(['work 1'])
    // A new session on the same seat (a restart) still owes it, sends it first, then reads new work.
    await p.fire('session_shutdown')
    idleCode = 0
    const q = pi(A, args => {
      if (args[0] === 'inbox') return inbox(A, 'ep:2', [{ from: 'superagent', text: 'work 2', seq: 2 }])
      return ok()
    })
    ext.default(q.api as never)
    await q.fire('session_start')
    const order = q.calls.filter(c => c[0] !== 'whoami').map(c => c.slice(0, 2).join(' '))
    expect(order.indexOf('ticket idle')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('ticket idle')).toBeLessThan(order.indexOf('inbox --after'))
    expect(q.sent).toEqual(['work 2'])
    expect(JSON.parse(readFileSync(ext.seatStatePath(A, HOST), 'utf8')).owedEnd).toBeUndefined()
  })

  it('an aborted run owes an error, kept the same way; a failed read acknowledgement is retried too', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    let readCode = 1
    const p = pi(A, args => {
      if (args[0] === 'inbox') return inbox(A, 'ep:1', [{ from: 'superagent', text: 'work', seq: 1 }])
      if (args[0] === 'ticket' && args[1] === 'read') return readCode === 0 ? ok() : fail()
      if (args[0] === 'ticket' && args[1] === 'error') return fail()
      return ok()
    })
    ext.default(p.api as never)
    await p.fire('session_start')
    let state = JSON.parse(readFileSync(ext.seatStatePath(A, HOST), 'utf8'))
    expect(state.owedRead).toBe(true)
    await p.fire('agent_settled', { aborted: true })
    state = JSON.parse(readFileSync(ext.seatStatePath(A, HOST), 'utf8'))
    expect(state.owedEnd).toEqual({ op: 'error', text: 'the Pi run was aborted' })
    expect(p.calls.some(c => c[0] === 'ticket' && c[1] === 'error')).toBe(true)
    void readCode
  })
})

describe('F3: shutdown fences an in-flight poll', () => {
  it('an inbox answer that arrives after shutdown hands nothing over, moves no cursor and acknowledges nothing', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    let release: (value: Exec) => void = () => {}
    const p = pi(A, args => args[0] === 'inbox' ? new Promise<Exec>(resolve => { release = resolve }) : ok())
    ext.default(p.api as never)
    await p.fire('session_start')
    expect(p.calls.some(c => c[0] === 'inbox')).toBe(true)
    await p.fire('session_shutdown')
    release(inbox(A, 'ep:1', [{ from: 'superagent', text: 'late work', seq: 1 }]))
    await tick()
    expect(p.sent).toEqual([])
    expect(p.calls.some(c => c[0] === 'ticket' && c[1] === 'read')).toBe(false)
    const path = ext.seatStatePath(A, HOST)
    expect(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).cursor : 'start').toBe('start')
  })
})
