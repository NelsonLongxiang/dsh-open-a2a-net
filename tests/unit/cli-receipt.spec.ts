// @vitest-environment node
/**
 * superagent p1-receipt-cmd, CLI side: `a2a receipt <task_id>` composes the one
 * formal-receipt shape (header + v2 envelope with disposition), finds its target
 * in the mailbox or takes an explicit --to, rides task id receipt-<task_id>, and
 * refuses what it cannot send whole — before any request. The host is a stub
 * whose mailbox is the REAL CliDepositStore; nothing touches a real DSH or ~/.a2a.
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
  const bodies: Array<Record<string, unknown>> = []
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (c) => { text += String(c) })
    req.on('end', () => {
      const body = text === '' ? {} : JSON.parse(text) as { action?: string; handle?: string }
      seen.push(req.url === '/__dsh_a2a/cli-deposit' ? String(body.action) : String(req.url))
      if (req.url === '/a2a/direct') bodies.push(body as Record<string, unknown>)
      const { status, body: reply } = req.url === '/a2a/direct' ? direct() : { status: 200, body: body.action === 'inbox' ? { ok: true, ...store.readMailbox(String(body.handle)) } : { ok: true, deposits: [] } }
      const payload = JSON.stringify(reply)
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
      res.end(payload)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return { url: `http://127.0.0.1:${String((server.address() as { port: number }).port)}`, store, seen, bodies }
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


describe('receipt <task_id> (superagent p1-receipt-cmd)', () => {
  it('a result receipt: the header, then the envelope with outcome + disposition, to the mailbox sender, in its context', async () => {
    const h = await host(() => ({ status: 200, body: { routed: true, delivered: true, receipt: 'mailbox', team: 'ops/11111111', task_id: 'receipt-job-1', context_id: 'ctx-1' } }))
    const env = await scoutEnv(h.url)
    h.store.mail(SCOUT, 'ops/11111111', 'please build it', undefined, { taskId: 'job-1', contextId: 'ctx-1' })
    const out = await runCli(['receipt', 'job-1', 'built\nand', '  tested'], env)
    expect(out.code, out.stderr).toBe(0)
    expect(out.stdout).toContain('delivered → ops/11111111 · task receipt-job-1')
    expect(h.bodies.at(-1)).toEqual({ team: 'ops/11111111', message: '[A2A receipt] task job-1 built and tested\n{"outcome":"completed","idempotencyKey":"job-1","disposition":"result"}', caller_session: SCOUT, wait: false, task_id: 'receipt-job-1', context_id: 'ctx-1' })
    // The receipt is this identity's side of that conversation.
    expect(journal(env)).toMatchObject([{ task_id: 'receipt-job-1', context_id: 'ctx-1', team: 'ops/11111111' }])
  })

  it('an attention receipt carries no outcome; --to picks the target when the mailbox cannot', async () => {
    const h = await host(() => ({ status: 200, body: { routed: true, delivered: true, team: 'dsh/22222222', task_id: 'receipt-job-2' } }))
    const env = await scoutEnv(h.url)
    h.store.mail(SCOUT, 'ops/11111111', 'from one', undefined, { taskId: 'job-2' })
    h.store.mail(SCOUT, 'ops/33333333', 'from another', undefined, { taskId: 'job-2' })
    expect((await runCli(['receipt', 'job-2', 'which?'], env)).code).toBe(2)
    const out = await runCli(['receipt', 'job-2', '--attention', '--to', 'dsh/22222222', 'which', 'branch?'], env)
    expect(out.code, out.stderr).toBe(0)
    expect(h.bodies.at(-1)).toEqual({ team: 'dsh/22222222', message: '[A2A receipt] task job-2 which branch?\n{"idempotencyKey":"job-2","disposition":"attention"}', caller_session: SCOUT, wait: false, task_id: 'receipt-job-2' })
    expect((await runCli(['receipt', 'job-none', '--to', 'dsh/22222222', 'ok'], env)).code).toBe(0)
  })

  it('market N1c/N1d: --by and --artifacts ride the envelope; a question rides attention-<task>-<id> and leaves the result to follow', async () => {
    const h = await host(() => ({ status: 200, body: { routed: true, delivered: true, team: 'ops/11111111' } }))
    const env = await scoutEnv(h.url)
    h.store.mail(SCOUT, 'ops/11111111', 'please build it', undefined, { taskId: 'job-7', contextId: 'ctx-7' })
    const asked = await runCli(['receipt', 'job-7', '--attention', '--question-id', 'q1', '--options', 'main|next', '--default', 'main', '--by', 'scout/0123456789abcdef', '--', '哪个分支？'], env)
    expect(asked.code, asked.stderr).toBe(0)
    expect(h.bodies.at(-1)).toEqual({ team: 'ops/11111111', message: '[A2A receipt] task job-7 哪个分支？\n{"idempotencyKey":"job-7","disposition":"attention","by":{"seat":"scout/0123456789abcdef"},"question":{"id":"q1","text":"哪个分支？","options":["main","next"],"default":"main"}}', caller_session: SCOUT, wait: false, task_id: 'attention-job-7-q1', context_id: 'ctx-7' })
    const done = await runCli(['receipt', 'job-7', '--artifacts', 'file:f-1,table:tb-2', '--', 'built'], env)
    expect(done.code, done.stderr).toBe(0)
    expect(h.bodies.at(-1)).toMatchObject({ task_id: 'receipt-job-7', message: '[A2A receipt] task job-7 built\n{"outcome":"completed","idempotencyKey":"job-7","disposition":"result","artifacts":[{"kind":"file","id":"f-1"},{"kind":"table","id":"tb-2"}]}' })
    for (const bad of [['--question-id', 'q1'], ['--attention', '--question-id', 'bad id'], ['--by-name', 'x'], ['--artifacts', 'nocolon'], ['--attention', '--options', 'a|b']]) {
      const before = h.bodies.length
      expect((await runCli(['receipt', 'job-7', ...bad, '--', 'x'], env)).code, bad.join(' ')).toBe(2)
      expect(h.bodies.length).toBe(before)
    }
  })

  it('a second, different receipt for the task is refused with the follow-up path named', async () => {
    const h = await host(() => ({ status: 409, body: { error: 'task id already used for a different message', replay: false, task_id: 'receipt-job-3' } }))
    const env = await scoutEnv(h.url)
    const out = await runCli(['receipt', 'job-3', '--to', 'ops/11111111', 'changed my mind'], env)
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('task receipt-job-3 already carried a different receipt — a task gets one receipt; send any follow-up as a new task in the same context')
    expect(journal(env)).toEqual([])
  })

  it('--outcome says how the work ended (p1-receipt-outcome): failed, rejected, abandoned; completed by default', async () => {
    const h = await host(() => ({ status: 200, body: { routed: true, delivered: true, team: 'ops/11111111', task_id: 'receipt-x' } }))
    const env = await scoutEnv(h.url)
    for (const outcome of ['failed', 'rejected', 'abandoned', 'completed']) {
      const out = await runCli(['receipt', `job-${outcome}`, '--outcome', outcome, '--to', 'ops/11111111', 'see', 'log'], env)
      expect(out.code, out.stderr).toBe(0)
      expect(h.bodies.at(-1)?.message).toBe(`[A2A receipt] task job-${outcome} see log\n{"outcome":"${outcome}","idempotencyKey":"job-${outcome}","disposition":"result"}`)
    }
    // --outcome=value spells the same flag.
    expect((await runCli(['receipt', 'job-eq', '--outcome=rejected', '--to', 'ops/11111111', 'not mine'], env)).code).toBe(0)
    expect(h.bodies.at(-1)?.message).toContain('{"outcome":"rejected","idempotencyKey":"job-eq","disposition":"result"}')
  })

  it('--outcome refuses what a sender cannot claim, and refuses beside --attention, before any request', async () => {
    const h = await host(() => ({ status: 200, body: { routed: true, delivered: true, team: 'ops/1', task_id: 'receipt-x' } }))
    const env = await scoutEnv(h.url)
    for (const value of ['expired', 'sync_completed', 'unknown', 'unclassified', 'FAILED', 'done']) {
      const out = await runCli(['receipt', 'job-1', '--outcome', value, '--to', 'ops/1', 'x'], env)
      expect(out.code, value).toBe(2)
      expect(out.stderr).toContain('--outcome takes completed, failed, rejected, abandoned')
    }
    const both = await runCli(['receipt', 'job-1', '--attention', '--outcome', 'failed', '--to', 'ops/1', 'x'], env)
    expect(both.code).toBe(2)
    expect(both.stderr).toContain('--attention takes no --outcome')
    expect(h.seen.filter(p => p === '/a2a/direct')).toEqual([])
  })

  it('refuses with exit 2 what it cannot send whole, before any request', async () => {
    const h = await host(() => ({ status: 200, body: { routed: true, delivered: true, team: 'ops/1', task_id: 'receipt-x' } }))
    const env = await scoutEnv(h.url)
    const at80 = 'j'.repeat(72)
    for (const args of [['receipt'], ['receipt', 'job-1'], ['receipt', 'job-1', '   '], ['receipt', 'bad@id', 'ok'], ['receipt', '-x', 'ok'], ['receipt', `${at80}k`, '--to', 'ops/1', 'ok'], ['receipt', 'job-1', '--to', '', 'ok'], ['receipt', 'job-none', 'ok']]) {
      const out = await runCli(args, env)
      expect(out.code, args.join(' ')).toBe(2)
    }
    const odd = await runCli(['receipt', 'bad@id', '--to', 'ops/1', 'ok'], env)
    expect(odd.code).toBe(2)
    expect(odd.stderr).toContain('has characters a receipt\'s own task id cannot carry')
    const long = await runCli(['receipt', `${at80}k`, '--to', 'ops/1', 'ok'], env)
    expect(long.stderr).toContain('(81 characters, at most 80); it is not cut short')
    expect(h.seen.filter(p => p === '/a2a/direct')).toEqual([])
    // The longest id that still fits: receipt-<72 chars> is exactly 80.
    expect((await runCli(['receipt', at80, '--to', 'ops/1', 'ok'], env)).code).toBe(0)
    expect(h.bodies.at(-1)?.task_id).toBe(`receipt-${at80}`)
  })
})

describe('sent journal roll (global review of PR #383, item b)', () => {
  it('a roll that fails for any reason but a vanished file still only warns; the send stands', async () => {
    const h = await host(() => ({ status: 200, body: { routed: true, delivered: true, team: 'ops', task_id: 'direct-roll0001', context_id: 'ctx-roll' } }))
    const env = await scoutEnv(h.url)
    writeJournal(env, [{ handle: SCOUT, at: 1, team: 'ops', task_id: 'old', context_id: 'ctx-roll', text: 'x'.repeat(1024 * 1024) }])
    mkdirSync(join(env.HOME, 'sent.1.jsonl', 'occupied'), { recursive: true })
    const out = await runCli(['route', 'ops', 'hi'], env)
    expect(out.code).toBe(0)
    expect(out.stderr).toContain('sent journal not written')
  })
})
