// @vitest-environment node
/**
 * a2a-net CLI ergonomics (cli/a2a.mjs): argument parsing, exit codes, host /
 * key resolution, init overwrite guard and error messages. Every run uses a
 * throwaway HOME, and the "host" is a local stub that answers fixed JSON and
 * records what the CLI sent, so nothing here touches a real DSH or ~/.a2a.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const CLI = join(process.cwd(), 'cli', 'a2a.mjs')

interface Run { code: number; stdout: string; stderr: string }

function runCli(args: string[], env: Record<string, string> = {}, cli = CLI, input?: string): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH ?? '', ...env } })
    if (input !== undefined) child.stdin.end(input)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += String(c) })
    child.stderr.on('data', (c) => { stderr += String(c) })
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

function tmpHomeDir(): string {
  return mkdtempSync(join(tmpdir(), 'a2a-cli-home-'))
}

interface Seen { path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }

/** A stub host: records each request and answers with `reply(path)`. */
async function stubHost(reply: (path: string) => { status: number; body: unknown }): Promise<{ url: string; seen: Seen[]; server: Server }> {
  const seen: Seen[] = []
  const server = createServer((req, res) => {
    let text = ''
    req.on('data', (c) => { text += String(c) })
    req.on('end', () => {
      const path = req.url ?? '/'
      seen.push({ path, headers: req.headers, body: text === '' ? {} : JSON.parse(text) as Record<string, unknown> })
      const { status, body } = reply(path)
      const payload = JSON.stringify(body)
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
      res.end(payload)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return { url: `http://127.0.0.1:${String(port)}`, seen, server }
}

const delivered = { status: 200, body: { routed: true, delivered: true, team: 'ops', task_id: 'direct-12345678', task_status: 'TASK_STATE_DELIVERED', receipt: 'routed' } }

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve))))
})

describe('a2a-net CLI: exit codes and help', () => {
  it('no command and an unknown command are usage errors (exit 2); help exits 0 on stdout', async () => {
    const HOME = tmpHomeDir()
    const empty = await runCli([], { HOME, A2A_CLI_HOME: HOME })
    const unknown = await runCli(['frobnicate'], { HOME, A2A_CLI_HOME: HOME })
    const help = await runCli(['help'], { HOME, A2A_CLI_HOME: HOME })
    const dashHelp = await runCli(['--help'], { HOME, A2A_CLI_HOME: HOME })
    expect(empty.code).toBe(2)
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('unknown command "frobnicate"')
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('usage: a2a <command>')
    expect(dashHelp.code).toBe(0)
  })

  it('an unknown flag and a value flag without its value are usage errors', async () => {
    const HOME = tmpHomeDir()
    expect((await runCli(['teams', '--hmoe', 'x'], { HOME, A2A_CLI_HOME: HOME })).code).toBe(2)
    const missing = await runCli(['teams', '--home'], { HOME, A2A_CLI_HOME: HOME })
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('--home needs a value')
  })
})

describe('a2a-net CLI: init', () => {
  it('writes a 0600 identity, refuses to overwrite it without --force, and replaces it with --force', async () => {
    const HOME = tmpHomeDir()
    const file = join(HOME, 'cli.json')
    expect((await runCli(['init', 'scout', '--uuid', '0123456789abcdef'], { HOME, A2A_CLI_HOME: HOME })).code).toBe(0)
    const first = readFileSync(file, 'utf8')
    // 0600 is a POSIX permission bit; Windows stat reports 0666 and guards
    // via ACLs instead — assert the bit where it exists.
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    const again = await runCli(['init', 'other'], { HOME, A2A_CLI_HOME: HOME })
    expect(again.code).toBe(1)
    expect(again.stderr).toContain('already exists: scout/0123456789abcdef')
    expect(readFileSync(file, 'utf8')).toBe(first)
    expect((await runCli(['init', 'other', '--force'], { HOME, A2A_CLI_HOME: HOME })).code).toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8')).name).toBe('other')
  })

  it('a bad name or uuid is a usage error', async () => {
    const HOME = tmpHomeDir()
    expect((await runCli(['init', 'Bad Name'], { HOME, A2A_CLI_HOME: HOME })).code).toBe(2)
    expect((await runCli(['init', 'scout', '--uuid', 'xyz'], { HOME, A2A_CLI_HOME: HOME })).code).toBe(2)
  })
})

describe('a2a-net CLI: route / report talk to the right host with the right message', () => {
  it('flag values never leak into the message, in either flag spelling, and the key rides X-API-Key', async () => {
    const host = await stubHost(() => delivered)
    servers.push(host.server)
    const HOME = tmpHomeDir()
    await runCli(['init', 'scout', '--uuid', '0123456789abcdef'], { HOME, A2A_CLI_HOME: HOME })
    const spaced = await runCli(['route', 'ops', 'hello', 'there', '--key', 'K1', '--home', host.url], { HOME, A2A_CLI_HOME: HOME })
    const equals = await runCli(['route', '--home=' + host.url, 'ops', 'second', 'try', '--key=K2'], { HOME, A2A_CLI_HOME: HOME })
    expect(spaced.code).toBe(0)
    expect(equals.code).toBe(0)
    const [a, b] = host.seen.filter(s => s.path === '/a2a/direct')
    expect(a?.body.message).toBe('hello there')
    expect(a?.headers['x-api-key']).toBe('K1')
    expect(b?.body.message).toBe('second try')
    expect(b?.headers['x-api-key']).toBe('K2')
    expect(spaced.stdout.trim()).toBe('[route] delivered → ops · task direct-12345678 · receipt arrives in: a2a inbox')
  })

  it('a message that starts with "-" goes after "--"', async () => {
    const host = await stubHost(() => delivered)
    servers.push(host.server)
    const HOME = tmpHomeDir()
    await runCli(['init', 'scout'], { HOME, A2A_CLI_HOME: HOME })
    expect((await runCli(['route', 'ops', '--home', host.url, '--', '-1', 'is', 'the', 'answer'], { HOME, A2A_CLI_HOME: HOME })).code).toBe(0)
    expect(host.seen.find(s => s.path === '/a2a/direct')?.body.message).toBe('-1 is the answer')
  })

  it('host and key resolve from $A2A_HOME / $A2A_KEY, and from the home saved by init --home', async () => {
    const host = await stubHost(() => delivered)
    servers.push(host.server)
    const HOME = tmpHomeDir()
    await runCli(['init', 'scout'], { HOME, A2A_CLI_HOME: HOME })
    expect((await runCli(['report', 'all', 'good'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url, A2A_KEY: 'ENVKEY' })).code).toBe(0)
    const report = host.seen.find(s => s.path === '/a2a/direct')
    expect(report?.headers['x-api-key']).toBe('ENVKEY')
    expect(report?.body.message).toBe('[a2a-net cli report] all good')
    const SAVED = tmpHomeDir()
    await runCli(['init', 'scout', '--home', `${host.url}/`], { HOME: SAVED, A2A_CLI_HOME: SAVED })
    expect(JSON.parse(readFileSync(join(SAVED, 'cli.json'), 'utf8')).home).toBe(host.url)
    host.seen.length = 0
    expect((await runCli(['route', 'ops', 'via', 'saved'], { HOME: SAVED, A2A_CLI_HOME: SAVED })).code).toBe(0)
    expect(host.seen.map(s => s.path)).toEqual(['/a2a/direct'])
  })

  it('--json keeps the raw reply; a refusal exits 1 with the host\'s reason', async () => {
    const host = await stubHost(() => ({ status: 403, body: { error: 'caller not admitted' } }))
    servers.push(host.server)
    const HOME = tmpHomeDir()
    await runCli(['init', 'scout'], { HOME, A2A_CLI_HOME: HOME })
    const refused = await runCli(['route', 'ops', 'hi', '--home', host.url], { HOME, A2A_CLI_HOME: HOME })
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('caller not admitted')
    const raw = await runCli(['route', 'ops', 'hi', '--home', host.url, '--json'], { HOME, A2A_CLI_HOME: HOME })
    expect(raw.code).toBe(1)
    expect(JSON.parse(raw.stdout)).toEqual({ error: 'caller not admitted' })
  })
})

describe('a2a-net CLI: a host behind dsh-pocket', () => {
  it('sends the pocket token as the dsh_pocket_token cookie next to X-API-Key ($A2A_POCKET_TOKEN wins over $A2A_TOKEN)', async () => {
    const host = await stubHost(() => ({ status: 200, body: { sessions: [], remote: [] } }))
    servers.push(host.server)
    const HOME = tmpHomeDir()
    expect((await runCli(['teams'], { HOME, A2A_HOME: host.url, A2A_KEY: 'K', A2A_TOKEN: 'T1' })).code).toBe(0)
    expect((await runCli(['teams'], { HOME, A2A_HOME: host.url, A2A_TOKEN: 'T1', A2A_POCKET_TOKEN: 'T2' })).code).toBe(0)
    expect((await runCli(['teams'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url })).code).toBe(0)
    const [both, pocketOnly, neither] = host.seen
    expect(both?.headers['x-api-key']).toBe('K')
    expect(both?.headers.cookie).toBe('dsh_pocket_token=T1')
    expect(pocketOnly?.headers.cookie).toBe('dsh_pocket_token=T2')
    expect(pocketOnly?.headers['x-api-key']).toBeUndefined()
    expect(neither?.headers.cookie).toBeUndefined()
  })

  it('whoami reports an unreadable deposit face instead of claiming OFFLINE', async () => {
    const host = await stubHost(() => ({ status: 405, body: '' }))
    servers.push(host.server)
    const HOME = tmpHomeDir()
    await runCli(['init', 'scout'], { HOME, A2A_CLI_HOME: HOME })
    const out = await runCli(['whoami', '--home', host.url], { HOME, A2A_CLI_HOME: HOME })
    expect(out.stdout).toMatch(/deposit\s+UNKNOWN — deposit face unreadable: HTTP 405/)
    expect(out.stdout).not.toContain('OFFLINE')
  })
})

describe('a2a-net CLI: read commands and errors', () => {
  it('a keyed host says which knob to set; tasks --json lists every row', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ taskId: `direct-${String(i).padStart(8, '0')}`, team: 'ops', status: 'pending' }))
    let keyed = true
    const host = await stubHost(() => keyed ? { status: 401, body: { error: 'unauthorized: X-API-Key required' } } : { status: 200, body: { tasks: rows, tasksDead: [], archived: [] } })
    servers.push(host.server)
    const HOME = tmpHomeDir()
    const denied = await runCli(['tasks', '--home', host.url], { HOME, A2A_CLI_HOME: HOME })
    expect(denied.code).toBe(1)
    expect(denied.stderr).toContain('set $A2A_KEY')
    keyed = false
    const table = await runCli(['tasks', '--home', host.url], { HOME, A2A_CLI_HOME: HOME })
    expect(table.stdout).toContain('… 5 more (--json lists all)')
    const json = await runCli(['tasks', '--home', host.url, '--json'], { HOME, A2A_CLI_HOME: HOME })
    expect((JSON.parse(json.stdout) as { pending: unknown[] }).pending).toHaveLength(25)
  })

  it('double-run idempotency under one A2A_CLI_HOME (Windows isolation round)', async () => {
    // The review FAIL: HOME-only isolation leaked the real profile on
    // Windows (os.homedir() reads USERPROFILE) — a second run collided with
    // the machine's own identity. With A2A_CLI_HOME the anchor is
    // platform-uniform; two inits in ONE home are exactly as safe as two
    // homes: the overwrite guard refuses, the key never moves.
    const home = tmpHomeDir()
    const first = await runCli(['init', 'scout', '--uuid', '0123456789abcdef'], { HOME: home, A2A_CLI_HOME: home })
    expect(first.code).toBe(0)
    const before = readFileSync(join(home, 'cli.json'), 'utf8')
    const second = await runCli(['init', 'scout', '--uuid', '0123456789abcdef'], { HOME: home, A2A_CLI_HOME: home })
    expect(second.code).not.toBe(0)
    expect(second.stderr).toContain('already exists')
    const after = readFileSync(join(home, 'cli.json'), 'utf8')
    expect(after).toBe(before)
  })

  it('the identity lands inside A2A_CLI_HOME — never in a stray .a2a spelling of the temp home', async () => {
    const home = tmpHomeDir()
    const out = await runCli(['init', 'scout'], { HOME: home, A2A_CLI_HOME: home })
    expect(out.code).toBe(0)
    expect(existsSync(join(home, 'cli.json'))).toBe(true)
    expect(existsSync(join(home, '.a2a'))).toBe(false)
  })

  it('an unreachable host names itself and the fix', async () => {
    const host = await stubHost(() => delivered)
    const url = host.url
    await new Promise(resolve => host.server.close(resolve))
    const out = await runCli(['teams', '--home', url], { HOME: tmpHomeDir() })
    expect(out.code).toBe(1)
    expect(out.stderr).toContain(`cannot reach host ${url}`)
  })

  it('without the built lib/, publish says to build instead of crashing; other commands still load', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a2a-cli-nolib-'))
    mkdirSync(join(dir, 'cli'))
    copyFileSync(CLI, join(dir, 'cli', 'a2a.mjs'))
    const HOME = tmpHomeDir()
    const cli = join(dir, 'cli', 'a2a.mjs')
    expect((await runCli(['init', 'scout'], { HOME, A2A_CLI_HOME: HOME }, cli)).code).toBe(0)
    const publish = await runCli(['publish'], { HOME, A2A_CLI_HOME: HOME }, cli)
    expect(publish.code).toBe(1)
    expect(publish.stderr).toContain('run `pnpm build`')
  })
})

/** A stub host with a mailbox: `mail` is what the inbox action returns (newest first, like the host). */
async function mailHost() {
  const mail: Array<{ at: number; from: string; text: string }> = []
  const deposits: Array<{ handle: string; expiresAt: number }> = []
  const actions: string[] = []
  const host = await stubHost((path) => {
    if (path !== '/__dsh_a2a/cli-deposit') return { status: 404, body: {} }
    const action = String(host.seen.at(-1)?.body.action)
    actions.push(action)
    if (action === 'inbox') return { status: 200, body: { ok: true, mail: [...mail].sort((a, b) => b.at - a.at) } }
    if (action === 'list') return { status: 200, body: { ok: true, deposits } }
    if (action === 'publish') return { status: 200, body: { ok: true, handle: 'scout/0123456789abcdef', expiresAt: Date.now() + 4 * 3_600_000, cardUrl: 'x' } }
    return { status: 200, body: { ok: false, error: 'unknown action' } }
  })
  servers.push(host.server)
  return { ...host, mail, deposits, actions }
}

async function scoutHome(): Promise<string> {
  const HOME = tmpHomeDir()
  await runCli(['init', 'scout', '--uuid', '0123456789abcdef'], { HOME, A2A_CLI_HOME: HOME })
  return HOME
}

describe('a2a-net CLI: inbox unread cursor', () => {
  it('--new shows only unread mail oldest first and advances the cursor; --peek does not; a shared millisecond is not lost', async () => {
    const host = await mailHost()
    const HOME = await scoutHome()
    const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url }
    host.mail.push({ at: 1000, from: 'cargo/22222222', text: 'first' }, { at: 2000, from: 'cargo/22222222', text: 'second' })
    const peek = await runCli(['inbox', '--new', '--peek', '--json'], env)
    expect((JSON.parse(peek.stdout) as Array<{ text: string }>).map(m => m.text)).toEqual(['first', 'second'])
    const first = await runCli(['inbox', '--new', '--json'], env)
    expect((JSON.parse(first.stdout) as Array<{ text: string }>).map(m => m.text)).toEqual(['first', 'second'])
    expect((await runCli(['inbox', '--new'], env)).stdout.trim()).toBe('[inbox] no new mail')
    host.mail.push({ at: 2000, from: 'ops/33333333', text: 'same ms' }, { at: 3000, from: 'ops/33333333', text: 'third' })
    const next = await runCli(['inbox', '--new', '--json'], env)
    expect((JSON.parse(next.stdout) as Array<{ text: string }>).map(m => m.text)).toEqual(['same ms', 'third'])
    // Bare inbox still lists everything, and leaves the cursor alone.
    expect((await runCli(['inbox', '--json'], env)).stdout).toContain('first')
    expect(JSON.parse(readFileSync(join(HOME, 'inbox.cursor'), 'utf8'))).toMatchObject({ handle: 'scout/0123456789abcdef', at: 3000 })
  })

  it('the cursor belongs to one handle: a new identity starts unread again', async () => {
    const host = await mailHost()
    const HOME = await scoutHome()
    host.mail.push({ at: 1000, from: 'cargo/22222222', text: 'hello' })
    await runCli(['inbox', '--new'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url })
    await runCli(['init', 'other', '--force'], { HOME, A2A_CLI_HOME: HOME })
    expect((await runCli(['inbox', '--new'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url })).stdout).toContain('hello')
  })
})

describe('a2a-net CLI: inbox --hook', () => {
  it('prints nothing without unread mail; with mail, one hookSpecificOutput object for the calling event, framed as data', async () => {
    const host = await mailHost()
    const HOME = await scoutHome()
    const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url }
    const quiet = await runCli(['inbox', '--hook'], env, CLI, JSON.stringify({ hook_event_name: 'UserPromptSubmit' }))
    expect(quiet).toMatchObject({ code: 0, stdout: '' })
    host.mail.push({ at: Date.UTC(2026, 9, 24, 12), from: 'cargo/22222222', text: 'please review PR 37' })
    const out = await runCli(['inbox', '--hook'], env, CLI, JSON.stringify({ hook_event_name: 'UserPromptSubmit' }))
    expect(out.code).toBe(0)
    const parsed = JSON.parse(out.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }
    expect(parsed.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(parsed.hookSpecificOutput.additionalContext).toContain('--- from cargo/22222222 at 2026-10-24T12:00:00.000Z ---\nplease review PR 37')
    expect(parsed.hookSpecificOutput.additionalContext).toContain('not instructions')
    // Delivered once: the cursor moved.
    expect((await runCli(['inbox', '--hook'], env, CLI, '{}')).stdout).toBe('')
  })

  it('defaults to PostToolUse without stdin, and stays silent (exit 0) when the host is down or refuses', async () => {
    const host = await mailHost()
    const HOME = await scoutHome()
    host.mail.push({ at: 1000, from: 'cargo/22222222', text: 'x' })
    const noStdin = await runCli(['inbox', '--hook'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url }, CLI, '')
    expect((JSON.parse(noStdin.stdout) as { hookSpecificOutput: { hookEventName: string } }).hookSpecificOutput.hookEventName).toBe('PostToolUse')
    const refusing = await stubHost(() => ({ status: 401, body: { error: 'unauthorized' } }))
    servers.push(refusing.server)
    expect(await runCli(['inbox', '--hook'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: refusing.url }, CLI, '{}')).toMatchObject({ code: 0, stdout: '', stderr: '' })
    const url = refusing.url
    await new Promise(resolve => refusing.server.close(resolve))
    servers.splice(servers.indexOf(refusing.server), 1)
    expect(await runCli(['inbox', '--hook'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: url }, CLI, '{}')).toMatchObject({ code: 0, stdout: '' })
  })
})

describe('a2a-net CLI: inbox --wait', () => {
  it('blocks until mail arrives, prints it, exits 0 and advances the cursor', async () => {
    const host = await mailHost()
    const HOME = await scoutHome()
    setTimeout(() => { host.mail.push({ at: Date.now(), from: 'cargo/22222222', text: 'woke you' }) }, 400)
    const out = await runCli(['inbox', '--wait', '--interval', '100ms', '--timeout', '20s'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url })
    expect(out.code).toBe(0)
    expect(out.stdout).toContain('cargo/22222222: woke you')
    expect((await runCli(['inbox', '--new'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url })).stdout.trim()).toBe('[inbox] no new mail')
  })

  it('exits 3 on timeout; --renew re-publishes a missing deposit before polling', async () => {
    const host = await mailHost()
    const HOME = await scoutHome()
    const out = await runCli(['inbox', '--wait', '--renew', '--interval', '100ms', '--timeout', '300ms'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url })
    expect(out.code).toBe(3)
    expect(out.stderr).toContain('no new mail within')
    expect(out.stderr).toContain('deposit renewed')
    expect(host.actions).toContain('publish')
    host.actions.length = 0
    host.deposits.push({ handle: 'scout/0123456789abcdef', expiresAt: Date.now() + 3 * 3_600_000 })
    await runCli(['inbox', '--wait', '--renew', '--interval', '100ms', '--timeout', '200ms'], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url })
    expect(host.actions).not.toContain('publish')
  })

  it('a bad duration is a usage error', async () => {
    const HOME = await scoutHome()
    // POSIX shape note: without the anchor a HOME-only env leaves the CLI
    // reading the REAL profile on Windows (USERPROFILE) — the tenth leak of
    // the PR#36 family; the anchor makes the run platform-uniform.
    expect((await runCli(['inbox', '--wait', '--timeout', 'soon'], { HOME, A2A_CLI_HOME: HOME })).code).toBe(2)
  })
})

describe('a2a-net CLI: the inbox cursor stays inside A2A_CLI_HOME', () => {
  it('advancing the cursor writes A2A_CLI_HOME/inbox.cursor and creates no .a2a under the real home', async () => {
    const host = await mailHost()
    const HOME = tmpHomeDir()
    const ANCHOR = tmpHomeDir()
    const env = { HOME, A2A_CLI_HOME: ANCHOR, A2A_HOME: host.url }
    expect((await runCli(['init', 'scout', '--uuid', '0123456789abcdef'], env)).code).toBe(0)
    host.mail.push({ at: 1000, from: 'cargo/22222222', text: 'hello' })
    expect((await runCli(['inbox', '--new'], env)).stdout).toContain('hello')
    expect(existsSync(join(ANCHOR, 'inbox.cursor'))).toBe(true)
    expect(existsSync(join(HOME, '.a2a'))).toBe(false)
  })
})

describe('a2a-net CLI: route --sync', () => {
  it('sends wait:true and prints the reply; --context continues a conversation; async stays wait:false', async () => {
    const host = await stubHost(() => ({ status: 200, body: { routed: true, team: 'dsh/66abc2cf', session: 's', result: { text: '你好，收到。' }, task_id: 'direct-aa11bb22', context_id: 'ctx-1', task_status: 'TASK_STATE_COMPLETED', artifacts: [] } }))
    servers.push(host.server)
    const HOME = await scoutHome()
    const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url }
    const sync = await runCli(['route', 'dsh/66abc2cf', '打个招呼', '--sync'], env)
    expect(sync.code).toBe(0)
    expect(sync.stdout).toBe('[route] reply from dsh/66abc2cf · task direct-aa11bb22 · context ctx-1\n你好，收到。\n')
    await runCli(['route', 'dsh/66abc2cf', '再聊一句', '--sync', '--context', 'ctx-1'], env)
    const [first, second] = host.seen.filter(s => s.path === '/a2a/direct')
    expect(first?.body).toMatchObject({ team: 'dsh/66abc2cf', message: '打个招呼', wait: true })
    expect(first?.body.context_id).toBeUndefined()
    expect(second?.body).toMatchObject({ message: '再聊一句', wait: true, context_id: 'ctx-1' })
  })

  it('an unsettled sync status is flagged; async route still sends wait:false', async () => {
    let reply: unknown = { routed: true, team: 'ops', result: { text: '(still running)' }, task_id: 'direct-cc33dd44', task_status: 'TASK_STATE_DELIVERED' }
    const host = await stubHost(() => ({ status: 200, body: reply }))
    servers.push(host.server)
    const HOME = await scoutHome()
    const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: host.url }
    const unsettled = await runCli(['route', 'ops', 'hi', '--sync'], env)
    expect(unsettled.code).toBe(0)
    expect(unsettled.stderr).toContain('status TASK_STATE_DELIVERED')
    reply = { routed: true, delivered: true, team: 'ops', task_id: 'direct-ee55ff66', task_status: 'TASK_STATE_DELIVERED', receipt: 'routed' }
    await runCli(['route', 'ops', 'hi'], env)
    expect(host.seen.filter(s => s.path === '/a2a/direct').at(-1)?.body.wait).toBe(false)
  })
})

describe('a2a-net CLI: route carries its own task id and resends it safely (gh#112)', () => {
  /** A host whose /a2a/direct answers come from `script`, one per request; `drop` tears the socket down unanswered. */
  async function scriptedHost(script: Array<{ status: number; body: unknown } | 'drop'>, query: unknown = { found: false, reason: 'unknown-task' }) {
    const seen: Seen[] = []
    const server = createServer((req, res) => {
      let text = ''
      req.on('data', (c) => { text += String(c) })
      req.on('end', () => {
        const path = req.url ?? '/'
        seen.push({ path, headers: req.headers, body: text === '' ? {} : JSON.parse(text) as Record<string, unknown> })
        const next = path === '/a2a/query' ? { status: 200, body: query } : (script.shift() ?? delivered)
        if (next === 'drop') { req.socket.destroy(); return }
        const payload = JSON.stringify(next.body)
        res.writeHead(next.status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    servers.push(server)
    return { url: `http://127.0.0.1:${String((server.address() as { port: number }).port)}`, seen, direct: () => seen.filter(s => s.path === '/a2a/direct') }
  }
  const fast = (HOME: string, url: string) => ({ HOME, A2A_CLI_HOME: HOME, A2A_HOME: url, A2A_RETRY_BASE_MS: '1' })

  it('every route and report sends a fresh caller-born task id', async () => {
    const host = await scriptedHost([])
    const HOME = await scoutHome()
    expect((await runCli(['route', 'ops', 'one'], fast(HOME, host.url))).code).toBe(0)
    expect((await runCli(['route', 'ops', 'two'], fast(HOME, host.url))).code).toBe(0)
    expect((await runCli(['report', 'three'], fast(HOME, host.url))).code).toBe(0)
    const ids = host.direct().map(s => s.body.task_id)
    for (const id of ids) expect(id).toMatch(/^direct-[0-9a-f]{12}$/)
    expect(new Set(ids).size).toBe(3)
  })

  it('a dropped connection and a 5xx are resent with the SAME task id until the host answers', async () => {
    const host = await scriptedHost(['drop', { status: 503, body: { error: 'restarting' } }])
    const HOME = await scoutHome()
    const out = await runCli(['route', 'ops', 'hi'], fast(HOME, host.url))
    expect(out.code).toBe(0)
    const sent = host.direct()
    expect(sent).toHaveLength(3)
    expect(new Set(sent.map(s => s.body.task_id)).size).toBe(1)
    expect(new Set(sent.map(s => s.headers['x-a2a-sig'])).size).toBe(3)
  })

  it('a host that never answers gives up after 3 resends and names the --task that resends safely', async () => {
    const host = await scriptedHost(['drop', 'drop', 'drop', 'drop', 'drop'])
    const HOME = await scoutHome()
    const out = await runCli(['route', 'ops', 'hi'], fast(HOME, host.url))
    expect(out.code).toBe(1)
    expect(host.direct()).toHaveLength(4)
    const id = String(host.direct()[0]?.body.task_id)
    expect(out.stderr).toContain(`resend safely with: --task ${id}`)
  })

  it('--task resends an earlier id; a replay reports the prior outcome from /a2a/query and runs nothing twice', async () => {
    const replay = { status: 409, body: { error: 'duplicate task id within the idempotency window', code: -32003, task_id: 'direct-aaaabbbbcccc', replay: true } }
    const host = await scriptedHost([replay], { found: true, status: 'pending', task_id: 'direct-aaaabbbbcccc' })
    const HOME = await scoutHome()
    const out = await runCli(['route', 'ops', 'hi', '--task', 'direct-aaaabbbbcccc'], fast(HOME, host.url))
    expect(out.code).toBe(0)
    expect(out.stdout.trim()).toBe('[route] already delivered → ops · task direct-aaaabbbbcccc · pending — not sent a second time')
    expect(host.direct()).toHaveLength(1)
    const query = host.seen.find(s => s.path === '/a2a/query')
    const sent = host.direct()[0]!.body
    // The fingerprint is the host's own: sha256 over {caller, message, noWait, team}.
    const fingerprint = createHash('sha256').update(JSON.stringify({ caller: sent.caller_session, message: 'hi', noWait: true, team: 'ops' })).digest('hex')
    expect(query?.body).toEqual({ task_id: 'direct-aaaabbbbcccc', fingerprint })
  })

  it('a replay whose earlier attempt failed exits 1 with the reason and is not sent again', async () => {
    const replay = { status: 409, body: { code: -32003, task_id: 'direct-aaaabbbbcccc', replay: true, error: 'duplicate' } }
    const host = await scriptedHost([replay], { found: true, status: 'failed', error: 'flooded: per-sender rate', task_id: 'direct-aaaabbbbcccc' })
    const HOME = await scoutHome()
    const out = await runCli(['route', 'ops', 'hi', '--task', 'direct-aaaabbbbcccc'], fast(HOME, host.url))
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('already ran and failed: flooded: per-sender rate')
    expect(host.direct()).toHaveLength(1)
  })

  it('a task id reused for a different message is a conflict: exit 1, nothing resent', async () => {
    const conflict = { status: 409, body: { error: 'task id reused with a different payload', code: -32002, task_id: 'direct-aaaabbbbcccc', replay: false } }
    const host = await scriptedHost([conflict])
    const HOME = await scoutHome()
    const out = await runCli(['route', 'ops', 'other text', '--task', 'direct-aaaabbbbcccc'], fast(HOME, host.url))
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('already used for a different message')
    expect(host.direct()).toHaveLength(1)
    expect(host.seen.some(s => s.path === '/a2a/query')).toBe(false)
  })

  it('a malformed --task is a usage error', async () => {
    const HOME = await scoutHome()
    expect((await runCli(['route', 'ops', 'hi', '--task', 'bad id!'], { HOME, A2A_CLI_HOME: HOME })).code).toBe(2)
  })
})
