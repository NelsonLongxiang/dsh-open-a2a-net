// @vitest-environment node
/**
 * The a2a-seat Pi extension's lifecycle (#688 reviews), driven through its real event handlers with a fake Pi API and a
 * scripted CLI. Not a real Pi runtime: the handlers, the lock, the cursor state, the scoped owed facts and the generation
 * fence are the code under test.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Exec = { stdout: string; stderr: string; code: number; killed: boolean }
type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<void> | void
const A = 'seat-a/0123456789abcdef', B = 'seat-b/fedcba9876543210', HOST = 'http://127.0.0.1:9'
const ok = (stdout = '{}'): Exec => ({ stdout, stderr: '', code: 0, killed: false })
const fail = (): Exec => ({ stdout: '', stderr: 'down', code: 1, killed: false })
const tick = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)) }
/** A pid that is certainly not running (a child that has already exited). */
const deadPid = (): number => spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid!

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
  const facts = () => calls.filter(c => c[0] === 'ticket').map(c => `${String(c[1])} ${String(c[c.indexOf('--ticket') + 1])}`)
  return { api, sent, calls, notes, fire, facts }
}
const inbox = (handle: string, next: string, mail: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) => ok(JSON.stringify({ handle, next, mail, lost: 0, epochChanged: false, ...extra }))
const work = (ticket: string, seq: number, run = `run-${ticket}`) => ({ from: 'superagent', text: `work ${ticket}`, seq, task_id: ticket, context_id: run })
const state = (ext: { seatStatePath(h: string, home: string): string }, handle = A) => JSON.parse(readFileSync(ext.seatStatePath(handle, HOST), 'utf8')) as { cursor: string; inflight: Array<{ ticket: string; run: string }>; owed: Array<{ op: string; ticket: string; run: string; event: string }> }

afterEach(() => { vi.unstubAllEnvs() })

describe('one seat, one consumer (R1, F1)', () => {
  it('two seats on one OS user keep their own cursors', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    expect(ext.seatStatePath(A, HOST)).not.toBe(ext.seatStatePath(B, HOST))
    const a = pi(A, args => args[0] === 'inbox' ? inbox(A, 'ep:50') : ok())
    ext.default(a.api as never)
    await a.fire('session_start')
    await a.fire('session_shutdown')
    expect(state(ext).cursor).toBe('ep:50')
    const b = pi(B, args => args[0] === 'inbox' ? inbox(B, 'ep:1', [work('t-b', 1)]) : ok())
    ext.default(b.api as never)
    await b.fire('session_start')
    expect(b.calls.find(c => c[0] === 'inbox')).toEqual(['inbox', '--after', 'start'])
    expect(b.sent).toEqual(['work t-b'])
  })

  it('the lock is created exclusively: of two consumers in one process only the first reads the mailbox; the second reads nothing', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    const reply = (args: string[]) => args[0] === 'inbox' ? inbox(A, 'ep:1', [work('t-1', 1)]) : ok()
    const first = pi(A, reply), second = pi(A, reply)
    ext.default(first.api as never)
    ext.default(second.api as never)
    await Promise.all([first.fire('session_start'), second.fire('session_start')])
    const readers = [first, second].filter(p => p.calls.some(c => c[0] === 'inbox'))
    expect(readers).toHaveLength(1)
    expect(first.sent.length + second.sent.length).toBe(1)
    expect([...first.notes, ...second.notes].join('\n')).toContain('another Pi consumer holds seat')
  })

  it('a live holder keeps the seat; an unreadable lock is left alone; a dead holder\'s lock is reclaimed; only the holder releases it', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    const path = ext.seatStatePath(A, HOST)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: process.ppid, token: 'someone' }))
    expect(ext.takeSeatLock(path, 'me')).toBe('held')
    writeFileSync(`${path}.lock`, 'not a lock')
    expect(ext.takeSeatLock(path, 'me')).toBe('unreadable')
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe('not a lock')
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: deadPid(), token: 'gone' }))
    expect(ext.takeSeatLock(path, 'me')).toBe('taken')
    expect(ext.holdsSeatLock(path, 'me')).toBe(true)
    ext.dropSeatLock(path, 'other')
    expect(ext.holdsSeatLock(path, 'me')).toBe(true)
    ext.dropSeatLock(path, 'me')
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('a consumer whose lock was taken over stops reading', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    let reads = 0
    const p = pi(A, args => { if (args[0] === 'inbox') reads++; return args[0] === 'inbox' ? inbox(A, 'ep:0') : ok() })
    ext.default(p.api as never)
    await p.fire('session_start')
    expect(reads).toBe(1)
    writeFileSync(`${ext.seatStatePath(A, HOST)}.lock`, JSON.stringify({ pid: process.ppid, token: 'thief' }))
    await p.fire('agent_settled', { aborted: false })
    expect(reads).toBe(1)
  })
})

describe('stale lock reclaim compares ownership (#688 re-review R1)', () => {
  it('a contender that saw the dead lock but comes second leaves the live lock alone', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    const path = ext.seatStatePath(A, HOST)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: deadPid(), token: 'dead' }))
    // A reclaims and takes the seat; B had read the same dead lock before and now goes on with its reclaim.
    expect(ext.takeSeatLock(path, 'token-a')).toBe('taken')
    ext.reclaimSeatLock(path, 'dead', 'token-b')
    expect(ext.holdsSeatLock(path, 'token-a')).toBe(true)
    expect(ext.takeSeatLock(path, 'token-b')).toBe('held')
    expect(existsSync(`${path}.lock.reclaim`)).toBe(false)
  })

  it('a lock moved aside that turns out not to be the dead one is put back, never lost', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    const path = ext.seatStatePath(A, HOST)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: process.pid, token: 'live' }))
    expect(ext.moveAsideIf(`${path}.lock`, 'dead')).toBe(false)
    expect(ext.holdsSeatLock(path, 'live')).toBe(true)
  })

  it('real processes racing for one dead lock: exactly one takes it, and it still holds it after the others are done', async () => {
    const { spawn } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    const dir = mkdtempSync(join(tmpdir(), 'pi-seat-race-'))
    const path = join(dir, 'seat.json')
    const module = fileURLToPath(new URL('../../pi/extension/a2a-seat.ts', import.meta.url))
    for (let round = 0; round < 5; round++) {
      writeFileSync(`${path}.lock`, JSON.stringify({ pid: deadPid(), token: 'dead' }))
      const start = Date.now() + 400
      const child = `const m = await import(${JSON.stringify(module)}); while (Date.now() < ${String(start)}); const token = 't' + process.pid; const got = m.takeSeatLock(${JSON.stringify(path)}, token); await new Promise(r => setTimeout(r, 300)); console.log(JSON.stringify({ got, holds: m.holdsSeatLock(${JSON.stringify(path)}, token) })); if (got === 'taken') m.dropSeatLock(${JSON.stringify(path)}, token)`
      const results = await Promise.all(Array.from({ length: 6 }, () => new Promise<{ got: string; holds: boolean }>((resolve, reject) => {
        const p = spawn(process.execPath, ['--input-type=module', '-e', child], { stdio: ['ignore', 'pipe', 'pipe'] })
        let out = '', err = ''
        p.stdout.on('data', d => { out += String(d) })
        p.stderr.on('data', d => { err += String(d) })
        p.on('close', code => { code === 0 ? resolve(JSON.parse(out.trim()) as { got: string; holds: boolean }) : reject(new Error(err)) })
      })))
      const taken = results.filter(r => r.got === 'taken')
      expect(taken, JSON.stringify(results)).toHaveLength(1)
      expect(taken[0]!.holds).toBe(true)
    }
  }, 30_000)
})

describe('facts are scoped to their ticket and replay-safe (R2)', () => {
  it('a read and an idle name the delivered ticket and keep one event id across retries until acknowledged', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    let idleCode = 1
    const p = pi(A, args => {
      if (args[0] === 'inbox') return inbox(A, 'ep:1', [work('t-1', 1)])
      if (args[0] === 'ticket' && args[1] === 'idle') return idleCode === 0 ? ok() : fail()
      return ok()
    })
    ext.default(p.api as never)
    await p.fire('session_start')
    expect(p.sent).toEqual(['work t-1'])
    expect(p.facts()).toEqual(['read t-1'])
    await p.fire('agent_settled', { aborted: false })
    const owed = state(ext).owed
    expect(owed).toMatchObject([{ op: 'idle', ticket: 't-1' }])
    // The retry (a later settle) sends the same event id: the host acknowledges a replay and does nothing with it.
    idleCode = 0
    await p.fire('agent_settled', { aborted: false })
    const idles = p.calls.filter(c => c[0] === 'ticket' && c[1] === 'idle').map(c => c[c.indexOf('--event') + 1])
    expect(idles).toHaveLength(2)
    expect(new Set(idles).size).toBe(1)
    expect(idles[0]).toBe(owed[0]!.event)
    expect(state(ext).owed).toEqual([])
  })

  it('owed facts go out one at a time even when a settle and a poll overlap', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    let active = 0, most = 0
    const p = pi(A, async args => {
      if (args[0] === 'inbox') return inbox(A, 'ep:1', [work('t-1', 1)])
      if (args[0] === 'ticket') { active++; most = Math.max(most, active); await new Promise(r => setTimeout(r, 5)); active--; return ok() }
      return ok()
    })
    ext.default(p.api as never)
    await p.fire('session_start')
    await Promise.all([p.fire('agent_settled', { aborted: false }), p.fire('agent_settled', { aborted: false })])
    await new Promise(r => setTimeout(r, 30))
    expect(most).toBe(1)
    expect(p.facts().filter(f => f.startsWith('idle'))).toEqual(['idle t-1'])
  })
})

describe('in-flight work survives its consumer (R3)', () => {
  it('a consumer that dies after handing work over leaves the ticket in flight; its successor owes an error for that ticket first', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    const first = pi(A, args => args[0] === 'inbox' ? inbox(A, 'ep:1', [work('t-1', 1)]) : ok())
    ext.default(first.api as never)
    await first.fire('session_start')
    expect(first.sent).toEqual(['work t-1'])
    expect(state(ext)).toMatchObject({ cursor: 'ep:1', inflight: [{ ticket: 't-1', run: 'run-t-1' }] })
    // Abrupt exit: no settle, no shutdown. Its lock now names a dead process.
    writeFileSync(`${ext.seatStatePath(A, HOST)}.lock`, JSON.stringify({ pid: deadPid(), token: 'dead' }))
    const next = pi(A, args => args[0] === 'inbox' ? inbox(A, 'ep:1') : ok())
    ext.default(next.api as never)
    await next.fire('session_start')
    const order = next.calls.filter(c => c[0] !== 'whoami').map(c => c.slice(0, 2).join(' '))
    expect(next.facts()).toEqual(['error t-1'])
    expect(order.indexOf('ticket error')).toBeLessThan(order.indexOf('inbox --after'))
    expect(state(ext)).toMatchObject({ inflight: [], owed: [] })
  })

  it('an orderly shutdown mid-run owes an error for the ticket; an aborted run owes one too', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    const p = pi(A, args => args[0] === 'inbox' ? inbox(A, 'ep:1', [work('t-1', 1)]) : args[0] === 'ticket' && args[1] === 'error' ? fail() : ok())
    ext.default(p.api as never)
    await p.fire('session_start')
    await p.fire('session_shutdown')
    expect(state(ext).owed).toMatchObject([{ op: 'error', ticket: 't-1' }])
    const q = pi(A, args => args[0] === 'inbox' ? inbox(A, 'ep:2', [work('t-2', 2)]) : ok())
    ext.default(q.api as never)
    await q.fire('session_start')
    await q.fire('agent_settled', { aborted: true })
    expect(q.facts()).toEqual(['error t-1', 'read t-2', 'error t-2'])
  })
})

describe('shutdown fences an in-flight poll (F3)', () => {
  it('an inbox answer that arrives after shutdown hands nothing over, moves no cursor and sends no fact', async () => {
    const ext = await load(mkdtempSync(join(tmpdir(), 'pi-seat-')))
    let release: (value: Exec) => void = () => {}
    const p = pi(A, args => args[0] === 'inbox' ? new Promise<Exec>(resolve => { release = resolve }) : ok())
    ext.default(p.api as never)
    await p.fire('session_start')
    await p.fire('session_shutdown')
    release(inbox(A, 'ep:1', [work('t-1', 1)]))
    await tick()
    expect(p.sent).toEqual([])
    expect(p.facts()).toEqual([])
    const path = ext.seatStatePath(A, HOST)
    expect(existsSync(path) ? state(ext).cursor : 'start').toBe('start')
  })
})
