// @vitest-environment node
/**
 * superagent p1-context-read, CLI side: `route` journals what the host took
 * (and only that) into A2A_CLI_HOME/sent.jsonl, and `a2a thread <context_id>`
 * merges that journal with the host's tagged mailbox rows — newest first,
 * paged by a cursor it hands back, read-only. The host here is a stub whose
 * mailbox is the REAL CliDepositStore; nothing touches a real DSH or ~/.a2a.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CliDepositStore } from '../../src/cli-deposit.ts'

const CLI = join(process.cwd(), 'cli', 'a2a.mjs')
const SCOUT = 'scout/0123456789abcdef'

interface Run { code: number; stdout: string; stderr: string }
function runCli(args: string[], env: Record<string, string>): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH ?? '', ...env } })
    let stdout = '', stderr = ''
    child.stdout.on('data', (c) => { stdout += String(c) })
    child.stderr.on('data', (c) => { stderr += String(c) })
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve)))) })

/** A stub host: /a2a/direct answers `direct()`; the cli-deposit inbox is the real store. */
async function host(direct: () => { status: number; body: unknown } = () => ({ status: 200, body: {} }), now?: () => number) {
  const store = new CliDepositStore(join(mkdtempSync(join(tmpdir(), 'thread-host-')), 'deposits.json'), now === undefined ? undefined : { now })
  const seen: string[] = []
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (c) => { text += String(c) })
    req.on('end', () => {
      const body = text === '' ? {} : JSON.parse(text) as { action?: string; handle?: string }
      seen.push(req.url === '/__dsh_a2a/cli-deposit' ? String(body.action) : String(req.url))
      const { status, body: reply } = req.url === '/a2a/direct' ? direct() : { status: 200, body: body.action === 'inbox' ? { ok: true, ...store.readMailbox(String(body.handle)) } : { ok: true, deposits: [] } }
      const payload = JSON.stringify(reply)
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
      res.end(payload)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return { url: `http://127.0.0.1:${String((server.address() as { port: number }).port)}`, store, seen }
}

async function scoutEnv(url: string): Promise<Record<string, string>> {
  const HOME = mkdtempSync(join(tmpdir(), 'thread-cli-'))
  await runCli(['init', 'scout', '--uuid', '0123456789abcdef'], { HOME, A2A_CLI_HOME: HOME })
  return { HOME, A2A_CLI_HOME: HOME, A2A_HOME: url }
}
const journal = (env: Record<string, string>, file = 'sent.jsonl') => existsSync(join(env.HOME, file))
  ? readFileSync(join(env.HOME, file), 'utf8').trim().split('\n').filter(l => l !== '').map(l => JSON.parse(l) as Record<string, unknown>)
  : []
const writeJournal = (env: Record<string, string>, rows: unknown[], file = 'sent.jsonl') =>
  writeFileSync(join(env.HOME, file), rows.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n')

type Thread = { entries: Array<Record<string, unknown>>; more: boolean; next_before: string | null; unscoped: number; mail_lost: number | null; epoch?: string }
async function thread(env: Record<string, string>, args: string[]): Promise<Thread> {
  const out = await runCli(['thread', ...args], env)
  expect(out.code, out.stderr).toBe(0)
  return JSON.parse(out.stdout) as Thread
}

describe('route journals what the host took (superagent p1-context-read)', () => {
  it('a taken route is one 0600 line under the context the host named; the sync reply rides along', async () => {
    let reply: { status: number; body: unknown } = { status: 200, body: { routed: true, delivered: true, team: 'ops', task_id: 'direct-aaaa1111', context_id: 'ctx-host', task_status: 'TASK_STATE_DELIVERED', receipt: 'routed' } }
    const h = await host(() => reply)
    const env = await scoutEnv(h.url)
    expect((await runCli(['route', 'ops', 'hello', 'there'], env)).code).toBe(0)
    reply = { status: 200, body: { routed: true, team: 'ops', task_id: 'direct-bbbb2222', context_id: 'ctx-sync', task_status: 'TASK_STATE_COMPLETED', result: { text: 'the answer' } } }
    expect((await runCli(['route', 'ops', 'question', '--sync', '--context', 'ctx-sync'], env)).code).toBe(0)
    const rows = journal(env)
    expect(rows).toEqual([
      { handle: SCOUT, at: expect.any(Number), team: 'ops', task_id: 'direct-aaaa1111', context_id: 'ctx-host', text: 'hello there' },
      { handle: SCOUT, at: expect.any(Number), team: 'ops', task_id: 'direct-bbbb2222', context_id: 'ctx-sync', text: 'question', reply: 'the answer' },
    ])
    expect(statSync(join(env.HOME, 'sent.jsonl')).mode & 0o777).toBe(0o600)
  })

  it('a -32005 reply names no context: only an explicit --context journals it', async () => {
    const h = await host(() => ({ status: 200, body: { error: 'sync wait budget fired', code: -32005, task_id: 'direct-cccc3333', task_status: 'TASK_STATE_DELIVERED' } }))
    const env = await scoutEnv(h.url)
    await runCli(['route', 'ops', 'slow', '--sync', '--json'], env)
    expect(journal(env)).toEqual([])
    await runCli(['route', 'ops', 'slow', '--sync', '--json', '--context', 'ctx-mine'], env)
    expect(journal(env)).toMatchObject([{ task_id: 'direct-cccc3333', context_id: 'ctx-mine', text: 'slow' }])
  })

  it('nothing the host did not take is journaled (gone, retry, conflict)', async () => {
    let reply: { status: number; body: unknown } = { status: 404, body: { error: 'no such team', code: -32001, task_id: 't', context_id: 'ctx-x' } }
    const h = await host(() => reply)
    const env = await scoutEnv(h.url)
    await runCli(['route', 'ops', 'gone', '--context', 'ctx-x'], env)
    reply = { status: 403, body: { error: 'caller not admitted', context_id: 'ctx-x' } }
    await runCli(['route', 'ops', 'retry', '--context', 'ctx-x'], env)
    reply = { status: 409, body: { error: 'task id reused', replay: false } }
    await runCli(['route', 'ops', 'conflict', '--context', 'ctx-x', '--task', 'direct-dddd4444'], env)
    reply = { status: 200, body: { routed: true, delivered: true, team: 'ops', task_id: 'direct-eeee5555', context_id: 'ctx-x' } }
    await runCli(['report', 'not a route'], env)
    expect(journal(env)).toEqual([])
  })

  it('long text is cut with its length kept; past the size cap the journal rolls one generation', async () => {
    const h = await host(() => ({ status: 200, body: { routed: true, team: 'ops', task_id: 'direct-ffff6666', context_id: 'ctx-big', task_status: 'TASK_STATE_COMPLETED', result: { text: 'r'.repeat(4500) } } }))
    const env = await scoutEnv(h.url)
    const old = { handle: SCOUT, at: 1, team: 'ops', task_id: 'old', context_id: 'ctx-big', text: 'x'.repeat(1024 * 1024) }
    writeJournal(env, [old])
    expect((await runCli(['route', 'ops', 'm'.repeat(4001), '--sync'], env)).code).toBe(0)
    const [row] = journal(env)
    expect(row).toMatchObject({ task_id: 'direct-ffff6666', truncated: true, chars: 4001, reply_truncated: true, reply_chars: 4500 })
    expect(String(row.text)).toHaveLength(4000)
    expect(String(row.reply)).toHaveLength(4000)
    expect(journal(env).length).toBe(1)
    expect(journal(env, 'sent.1.jsonl')).toMatchObject([{ task_id: 'old' }])
    // Both generations are read back, older first.
    expect((await thread(env, ['ctx-big'])).entries.map(e => e.task_id)).toEqual(['direct-ffff6666', 'old'])
  })

  it('a journal that cannot be written never fails the send', async () => {
    const h = await host(() => ({ status: 200, body: { routed: true, delivered: true, team: 'ops', task_id: 'direct-abab7777', context_id: 'ctx-j' } }))
    const env = await scoutEnv(h.url)
    mkdirSync(join(env.HOME, 'sent.jsonl'))
    const out = await runCli(['route', 'ops', 'hi'], env)
    expect(out.code).toBe(0)
    expect(out.stdout).toContain('delivered → ops · task direct-abab7777')
    expect(out.stderr).toContain('sent journal not written')
  })
})

describe('thread <context_id> (superagent p1-context-read)', () => {
  it('merges tagged mail and journaled routes newest first; untagged rows are counted, never placed', async () => {
    let t = 1000
    const h = await host(undefined, () => t)
    const env = await scoutEnv(h.url)
    h.store.mail(SCOUT, 'ops/11111111', 'legacy row')
    t = 2000; h.store.mail(SCOUT, 'ops/11111111', 'first ask', undefined, { taskId: 'p1', contextId: 'ctx-a' })
    t = 3000; h.store.mail(SCOUT, 'ops/11111111', 'elsewhere', undefined, { taskId: 'p2', contextId: 'ctx-b' })
    t = 4000; h.store.mail(SCOUT, 'ops/11111111', 'second ask', 'sync-answered', { taskId: 'p3', contextId: 'ctx-a' })
    writeJournal(env, [
      { handle: SCOUT, at: 2500, team: 'ops', task_id: 'r1', context_id: 'ctx-a', text: 'my answer', reply: 'ok' },
      { handle: 'other/0123456789abcdef', at: 2600, team: 'ops', task_id: 'foreign', context_id: 'ctx-a', text: 'not mine' },
      '{"torn',
      { handle: SCOUT, at: 2700, team: 'ops', task_id: 'r-b', context_id: 'ctx-b', text: 'other talk' },
    ])
    const out = await thread(env, ['ctx-a'])
    expect(out).toMatchObject({ more: false, next_before: null, unscoped: 1, mail_lost: 0, epoch: expect.any(String) })
    expect(out.entries).toEqual([
      { dir: 'in', at: 4000, seq: 4, from: 'ops/11111111', task_id: 'p3', text: 'second ask', dup: 'sync-answered' },
      { dir: 'out', at: 2500, team: 'ops', task_id: 'r1', text: 'my answer', reply: 'ok' },
      { dir: 'in', at: 2000, seq: 2, from: 'ops/11111111', task_id: 'p1', text: 'first ask' },
    ])
    expect(existsSync(join(env.HOME, 'inbox.cursor'))).toBe(false)
    expect(h.seen).toEqual(['inbox'])
  })

  it('pages through a shared millisecond without a repeat or a gap', async () => {
    const h = await host(undefined, () => 5000)
    const env = await scoutEnv(h.url)
    for (const n of [1, 2, 3]) h.store.mail(SCOUT, 'ops/11111111', `in ${String(n)}`, undefined, { contextId: 'ctx-t' })
    writeJournal(env, [
      { handle: SCOUT, at: 5000, team: 'ops', task_id: 'b-out', context_id: 'ctx-t', text: 'out b' },
      { handle: SCOUT, at: 5000, team: 'ops', task_id: 'a-out', context_id: 'ctx-t', text: 'out a' },
      { handle: SCOUT, at: 4000, team: 'ops', task_id: 'early', context_id: 'ctx-t', text: 'early' },
    ])
    const whole = await thread(env, ['ctx-t'])
    // Same millisecond: the journal side is newer than the mailbox side; within a side, higher seq / task id first.
    expect(whole.entries.map(e => e.task_id ?? e.seq)).toEqual(['b-out', 'a-out', 3, 2, 1, 'early'])
    const pages: Array<Array<Record<string, unknown>>> = []
    let before: string | null = null
    do {
      const page: Thread = await thread(env, ['ctx-t', '--limit', '2', ...(before === null ? [] : ['--before', before])])
      pages.push(page.entries)
      before = page.next_before
      expect(page.more).toBe(before !== null)
    } while (before !== null)
    expect(pages.map(p => p.length)).toEqual([2, 2, 2])
    expect(pages.flat()).toEqual(whole.entries)
    expect((await thread(env, ['ctx-t', '--limit', '2'])).next_before).toBe('5000:out:a-out')
    expect((await thread(env, ['ctx-t', '--before', '5000:in:2'])).entries.map(e => e.task_id ?? e.seq)).toEqual([1, 'early'])
  })

  it('reports mail the cap pushed out; the default page is 20', async () => {
    const h = await host()
    const env = await scoutEnv(h.url)
    for (let i = 0; i < 70; i += 1) h.store.mail(SCOUT, 'ops/11111111', `m${String(i)}`, undefined, { contextId: 'ctx-flood' })
    const out = await thread(env, ['ctx-flood'])
    expect(out.mail_lost).toBe(6)
    expect(out.entries).toHaveLength(20)
    expect(out.more).toBe(true)
    expect(out.entries[0]).toMatchObject({ seq: 70 })
  })

  it('refuses bad usage with exit 2 before reading anything', async () => {
    const h = await host()
    const env = await scoutEnv(h.url)
    for (const args of [[], ['a', 'b'], ['c', '--limit', '0'], ['c', '--limit', '201'], ['c', '--limit', '1.5'], ['c', '--limit', 'x'], ['c', '--limit', '1e1'],
      ['c', '--before', 'nope'], ['c', '--before', '12:in:x'], ['c', '--before', '12:side:x'], ['c', '--before', '12:out:']]) {
      const out = await runCli(['thread', ...args], env)
      expect(out.code, args.join(' ')).toBe(2)
    }
    expect(h.seen).toEqual([])
    expect((await thread(env, ['c', '--limit', '200'])).entries).toEqual([])
  })
})
