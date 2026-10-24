// @vitest-environment node
/**
 * a2a-net CLI ergonomics (cli/a2a.mjs): argument parsing, exit codes, host /
 * key resolution, init overwrite guard and error messages. Every run uses a
 * throwaway HOME, and the "host" is a local stub that answers fixed JSON and
 * records what the CLI sent, so nothing here touches a real DSH or ~/.a2a.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const CLI = join(process.cwd(), 'cli', 'a2a.mjs')

interface Run { code: number; stdout: string; stderr: string }

function runCli(args: string[], env: Record<string, string> = {}, cli = CLI): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH ?? '', ...env } })
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
    const empty = await runCli([], { HOME })
    const unknown = await runCli(['frobnicate'], { HOME })
    const help = await runCli(['help'], { HOME })
    const dashHelp = await runCli(['--help'], { HOME })
    expect(empty.code).toBe(2)
    expect(unknown.code).toBe(2)
    expect(unknown.stderr).toContain('unknown command "frobnicate"')
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('usage: a2a <command>')
    expect(dashHelp.code).toBe(0)
  })

  it('an unknown flag and a value flag without its value are usage errors', async () => {
    const HOME = tmpHomeDir()
    expect((await runCli(['teams', '--hmoe', 'x'], { HOME })).code).toBe(2)
    const missing = await runCli(['teams', '--home'], { HOME })
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('--home needs a value')
  })
})

describe('a2a-net CLI: init', () => {
  it('writes a 0600 identity, refuses to overwrite it without --force, and replaces it with --force', async () => {
    const HOME = tmpHomeDir()
    const file = join(HOME, '.a2a', 'cli.json')
    expect((await runCli(['init', 'scout', '--uuid', '0123456789abcdef'], { HOME })).code).toBe(0)
    const first = readFileSync(file, 'utf8')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const again = await runCli(['init', 'other'], { HOME })
    expect(again.code).toBe(1)
    expect(again.stderr).toContain('already exists: scout/0123456789abcdef')
    expect(readFileSync(file, 'utf8')).toBe(first)
    expect((await runCli(['init', 'other', '--force'], { HOME })).code).toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8')).name).toBe('other')
  })

  it('a bad name or uuid is a usage error', async () => {
    const HOME = tmpHomeDir()
    expect((await runCli(['init', 'Bad Name'], { HOME })).code).toBe(2)
    expect((await runCli(['init', 'scout', '--uuid', 'xyz'], { HOME })).code).toBe(2)
  })
})

describe('a2a-net CLI: route / report talk to the right host with the right message', () => {
  it('flag values never leak into the message, in either flag spelling, and the key rides X-API-Key', async () => {
    const host = await stubHost(() => delivered)
    servers.push(host.server)
    const HOME = tmpHomeDir()
    await runCli(['init', 'scout', '--uuid', '0123456789abcdef'], { HOME })
    const spaced = await runCli(['route', 'ops', 'hello', 'there', '--key', 'K1', '--home', host.url], { HOME })
    const equals = await runCli(['route', '--home=' + host.url, 'ops', 'second', 'try', '--key=K2'], { HOME })
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
    await runCli(['init', 'scout'], { HOME })
    expect((await runCli(['route', 'ops', '--home', host.url, '--', '-1', 'is', 'the', 'answer'], { HOME })).code).toBe(0)
    expect(host.seen.find(s => s.path === '/a2a/direct')?.body.message).toBe('-1 is the answer')
  })

  it('host and key resolve from $A2A_HOME / $A2A_KEY, and from the home saved by init --home', async () => {
    const host = await stubHost(() => delivered)
    servers.push(host.server)
    const HOME = tmpHomeDir()
    await runCli(['init', 'scout'], { HOME })
    expect((await runCli(['report', 'all', 'good'], { HOME, A2A_HOME: host.url, A2A_KEY: 'ENVKEY' })).code).toBe(0)
    const report = host.seen.find(s => s.path === '/a2a/direct')
    expect(report?.headers['x-api-key']).toBe('ENVKEY')
    expect(report?.body.message).toBe('[a2a-net cli report] all good')
    const SAVED = tmpHomeDir()
    await runCli(['init', 'scout', '--home', `${host.url}/`], { HOME: SAVED })
    expect(JSON.parse(readFileSync(join(SAVED, '.a2a', 'cli.json'), 'utf8')).home).toBe(host.url)
    host.seen.length = 0
    expect((await runCli(['route', 'ops', 'via', 'saved'], { HOME: SAVED })).code).toBe(0)
    expect(host.seen.map(s => s.path)).toEqual(['/a2a/direct'])
  })

  it('--json keeps the raw reply; a refusal exits 1 with the host\'s reason', async () => {
    const host = await stubHost(() => ({ status: 403, body: { error: 'caller not admitted' } }))
    servers.push(host.server)
    const HOME = tmpHomeDir()
    await runCli(['init', 'scout'], { HOME })
    const refused = await runCli(['route', 'ops', 'hi', '--home', host.url], { HOME })
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('caller not admitted')
    const raw = await runCli(['route', 'ops', 'hi', '--home', host.url, '--json'], { HOME })
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
    expect((await runCli(['teams'], { HOME, A2A_HOME: host.url })).code).toBe(0)
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
    await runCli(['init', 'scout'], { HOME })
    const out = await runCli(['whoami', '--home', host.url], { HOME })
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
    const denied = await runCli(['tasks', '--home', host.url], { HOME })
    expect(denied.code).toBe(1)
    expect(denied.stderr).toContain('set $A2A_KEY')
    keyed = false
    const table = await runCli(['tasks', '--home', host.url], { HOME })
    expect(table.stdout).toContain('… 5 more (--json lists all)')
    const json = await runCli(['tasks', '--home', host.url, '--json'], { HOME })
    expect((JSON.parse(json.stdout) as { pending: unknown[] }).pending).toHaveLength(25)
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
    expect((await runCli(['init', 'scout'], { HOME }, cli)).code).toBe(0)
    const publish = await runCli(['publish'], { HOME }, cli)
    expect(publish.code).toBe(1)
    expect(publish.stderr).toContain('run `pnpm build`')
  })
})
