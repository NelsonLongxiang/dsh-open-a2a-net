// @vitest-environment node
/** #951 S1: `a2a-net user sessions / session read / session prompt` against a stub of the three routes (loopback only, a made-up delegate). */
import { mkdtempSync } from '../temp-dirs.ts'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cliEnv } from './harness.ts'

let server: Server, base = '', seen: Array<{ method: string; url: string; headers: Record<string, unknown>; body: string }> = [], answer: { status: number; body: unknown } = { status: 200, body: {} }, identity = ''
const CLI = join(process.cwd(), 'cli/a2a.mjs')

beforeEach(async () => {
  seen = []; answer = { status: 200, body: {} }
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      const payload = JSON.stringify(answer.body)
      res.writeHead(answer.status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`
  identity = mkdtempSync(join(tmpdir(), 'cli-user-sessions-'))
  mkdirSync(identity, { recursive: true })
  writeFileSync(join(identity, 'owner-delegates.json'), JSON.stringify({ homes: { [base]: { token: 'dshod_made-up-fixture', id: 'd-1', name: 'fixture' } } }))
})
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })

// Async on purpose: the stub server answers from this very process, which a synchronous spawn would block.
const run = (...args: string[]): Promise<{ code: number | null; out: string; err: string }> => new Promise(resolve => {
  const child = spawn(process.execPath, [CLI, '--home', base, '--key', 'fixture-control-key', ...args], { env: cliEnv(identity) })
  let out = '', err = ''
  child.stdout.on('data', c => { out += String(c) }); child.stderr.on('data', c => { err += String(c) })
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
  child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }) })
})

describe('user sessions', () => {
  it('lists with the team filter, sends the delegate and the key, and prints one line per session', async () => {
    answer.body = { ok: true, count: 2, truncated: false, sessions: [{ id: 'session-0123456789abcdef', name: '席位一', joined: true, live: true, archived: false, role: 'member', status: 'idle', queued: 2 }, { id: 'session-aaaaaaaaaaaaaaaa', name: 'x', joined: false, live: false, archived: true, role: null }] }
    const r = await run('user', 'sessions', '--team', 'ops team')
    expect(r.code).toBe(0)
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/__dsh_a2a/user/sessions?team=ops%20team' })
    expect(seen[0]!.headers['x-dsh-owner-delegate']).toBe('dshod_made-up-fixture'); expect(seen[0]!.headers['x-api-key']).toBe('fixture-control-key')
    expect(r.out).toContain('session-0123456789abcdef  live'); expect(r.out).toContain('idle q2'); expect(r.out).toContain('session-aaaaaaaaaaaaaaaa'); expect(r.out).not.toContain('dshod_')
  })
})

describe('user session read', () => {
  it('passes the cursor, the page size and the cut, prints each entry with its index and the way to the older page', async () => {
    answer.body = { ok: true, id: 'session-0123456789abcdef', total: 45, from: 25, to: 45, stale: false, entries: [{ i: 25, role: 'user', text: '问 25' }, { i: 26, role: 'assistant', text: '答 26' }] }
    const r = await run('user', 'session', 'read', 'session-0123456789abcdef', '--before', '45', '--limit', '20', '--chars', '900')
    expect(r.code).toBe(0)
    expect(seen[0]!.url).toBe('/__dsh_a2a/user/session?id=session-0123456789abcdef&before=45&limit=20&chars=900')
    expect(r.out).toContain('entries 25–44 of 45'); expect(r.out).toContain('older: --before 25'); expect(r.out).toContain('[25] user: 问 25')
  })
  it('a refusal is printed and exits non-zero; without an id it is a usage error (exit 2) and sends nothing', async () => {
    answer = { status: 404, body: { ok: false, code: 'no-log', error: 'no log artifact for this session' } }
    expect((await run('user', 'session', 'read', 'session-dddddddddddddddd')).code).toBe(1)
    seen = []
    expect((await run('user', 'session', 'read')).code).toBe(2); expect(seen).toEqual([])
  })
})

describe('user session prompt', () => {
  it('--steer sends mode steer with the text after -- (a text that starts with a dash is fine) and the request id', async () => {
    answer.body = { ok: true, id: 'session-0123456789abcdef', mode: 'steer', delivered: 'steered' }
    const r = await run('user', 'session', 'prompt', 'session-0123456789abcdef', '--steer', '--request-id', 'r-1', '--', '--先看', '#12', '的评审')
    expect(r.code).toBe(0); expect(r.out).toContain('steered to session-0123456789abcdef')
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/__dsh_a2a/user/session/prompt' })
    expect(JSON.parse(seen[0]!.body)).toEqual({ id: 'session-0123456789abcdef', mode: 'steer', text: '--先看 #12 的评审', request_id: 'r-1' })
  })
  it('--queue sends mode queue; a replay is said so', async () => {
    answer.body = { ok: true, id: 'session-0123456789abcdef', mode: 'queue', delivered: 'queued', replayed: true }
    const r = await run('user', 'session', 'prompt', 'session-0123456789abcdef', '--queue', '--', '稍后')
    expect(JSON.parse(seen[0]!.body).mode).toBe('queue'); expect(r.out).toContain('queued to'); expect(r.out).toContain('replayed')
  })
  it.each([['neither', []], ['both', ['--steer', '--queue']]])('%s of --steer and --queue is a usage error and sends nothing', async (_n, flags) => {
    const r = await run('user', 'session', 'prompt', 'session-0123456789abcdef', ...flags, '--', '内容')
    expect(r.code).toBe(2); expect(seen).toEqual([])
  })
  it('no text is a usage error; a refusal from the host exits non-zero with its code', async () => {
    expect((await run('user', 'session', 'prompt', 'session-0123456789abcdef', '--steer')).code).toBe(2); expect(seen).toEqual([])
    answer = { status: 409, body: { ok: false, code: 'not-live', error: 'the session is joined but not running' } }
    const r = await run('user', 'session', 'prompt', 'session-aaaaaaaaaaaaaaaa', '--steer', '--', 'x')
    expect(r.code).toBe(1); expect(r.err + r.out).toContain('not running')
  })
  it('the help names the three commands', async () => {
    const r = await run('help')
    expect(r.out + r.err).toContain('user session prompt <id> (--steer|--queue)')
  })
})
