// @vitest-environment node
/** #953 P1: `a2a-net user canvas label` and the label in `a2a-net teams`, against a stub (loopback only, a made-up delegate). */
import { mkdtempSync } from '../temp-dirs.ts'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cliEnv } from './harness.ts'

let server: Server, base = '', seen: Array<{ method: string; url: string; headers: Record<string, unknown>; body: string }> = [], answer: unknown = {}, identity = ''
const CLI = join(process.cwd(), 'cli/a2a.mjs')

beforeEach(async () => {
  seen = []; answer = {}
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      const payload = JSON.stringify(answer)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`
  identity = mkdtempSync(join(tmpdir(), 'cli-canvas-label-'))
  writeFileSync(join(identity, 'owner-delegates.json'), JSON.stringify({ homes: { [base]: { token: 'dshod_made-up-fixture', id: 'd-1', name: 'fixture' } } }))
})
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })

// Async on purpose: the stub answers from this very process, which a synchronous spawn would block.
const run = (...args: string[]): Promise<{ code: number | null; out: string; err: string }> => new Promise(resolve => {
  const child = spawn(process.execPath, [CLI, '--home', base, '--key', 'fixture-control-key', ...args], { env: cliEnv(identity) })
  let out = '', err = ''
  child.stdout.on('data', c => { out += String(c) }); child.stderr.on('data', c => { err += String(c) })
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
  child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }) })
})

describe('user canvas label', () => {
  it('sets a label (the words after the name are the label), sending the delegate and the key, and says the address is unchanged', async () => {
    answer = { ok: true, name: 'alpha', label: '采集队 一组', teams: ['alpha'] }
    const r = await run('user', 'canvas', 'label', 'alpha', '采集队', '一组')
    expect(r.code).toBe(0)
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/__dsh_a2a/canvas' })
    expect(seen[0]!.headers['x-dsh-owner-delegate']).toBe('dshod_made-up-fixture'); expect(seen[0]!.headers['x-api-key']).toBe('fixture-control-key')
    expect(JSON.parse(seen[0]!.body)).toEqual({ action: 'set-label', name: 'alpha', label: '采集队 一组' })
    expect(r.out).toContain('label "采集队 一组" (address unchanged)'); expect(r.out).not.toContain('dshod_')
  })
  it('--clear sends clear and no label; a label that starts with a dash goes after --', async () => {
    answer = { ok: true, name: 'alpha', label: null, teams: ['alpha'] }
    const r = await run('user', 'canvas', 'label', 'alpha', '--clear')
    expect(r.code).toBe(0); expect(JSON.parse(seen[0]!.body)).toEqual({ action: 'set-label', name: 'alpha', clear: true }); expect(r.out).toContain('label cleared')
    answer = { ok: true, name: 'alpha', label: '-x', teams: ['alpha'] }
    await run('user', 'canvas', 'label', 'alpha', '--', '-x')
    expect(JSON.parse(seen[1]!.body).label).toBe('-x')
  })
  it.each([['neither a label nor --clear', ['alpha']], ['both', ['alpha', '名', '--clear']], ['no name', []], ['another word than label', ['rename', 'alpha', 'x']]])('%s is a usage error (exit 2) and sends nothing', async (_n, rest) => {
    const r = await run('user', 'canvas', ...(rest[0] === 'rename' ? rest : ['label', ...rest]))
    expect(r.code).toBe(2); expect(seen).toEqual([])
  })
  it('a refusal from the host exits non-zero', async () => {
    answer = { ok: false, code: 'label', error: 'a label is plain text' }
    expect((await run('user', 'canvas', 'label', 'alpha', 'dsh/66abc2cf')).code).toBe(1)
  })
})

describe('a2a-net teams', () => {
  it('shows a canvas team by its label, keeps the address column, matches a query against the label, and --json keeps name and adds label', async () => {
    answer = { zone: 'dsh', session: 'host-a', ownerHost: base, canvas: { teams: [{ name: 'alpha', label: '采集队', id: 'dsh/canvas/alpha@abcd1234', members: [] }, { name: 'beta', id: 'dsh/canvas/beta@abcd1234', members: [] }] } }
    const all = await run('teams')
    expect(all.out).toContain('dsh/canvas/alpha@abcd1234'); expect(all.out).toContain('采集队'); expect(all.out).toMatch(/beta/)
    const hit = await run('teams', '采集')
    expect(hit.out).toContain('dsh/canvas/alpha@abcd1234'); expect(hit.out).not.toContain('dsh/canvas/beta')
    const json = JSON.parse((await run('teams', '--json')).out) as Array<Record<string, unknown>>
    expect(json.find(r => r.team === 'dsh/canvas/alpha@abcd1234')).toMatchObject({ name: 'alpha', label: '采集队' })
    expect(json.find(r => r.team === 'dsh/canvas/beta@abcd1234')).not.toHaveProperty('label')
  })
})
