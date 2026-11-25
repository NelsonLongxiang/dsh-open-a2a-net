// @vitest-environment node
/** #933: `a2a-net user pair` — the token reaches the delegate book once, never stdout or stderr; a refusal or expiry exits 1. */
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cliEnv } from '../mesh/harness.ts'

const CLI = join(process.cwd(), 'cli/a2a.mjs')
const TOKEN = 'dshod_' + 'p'.repeat(43)

/** A node whose pairing answers: start, then the given poll answers in turn (the last repeats). */
async function node(polls: Array<Record<string, unknown>>, start: Record<string, unknown> = {}): Promise<{ url: string; seen: string[]; close: () => Promise<void> }> {
  const seen: string[] = []
  let i = 0
  const s: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += String(c) })
    req.on('end', () => {
      const body = JSON.parse(raw || '{}') as { action?: string; secret?: string }
      seen.push(`${req.url} ${String(body.action)}${body.secret !== undefined ? ' secret=' + body.secret : ''}`)
      const reply = body.action === 'start'
        ? { ok: true, id: 'pair-1', code: 'ABCD-EFGH', secret: 's3cret', expiresAt: new Date(Date.now() + 600_000).toISOString(), ...start }
        : polls[Math.min(i++, polls.length - 1)]
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply))
    })
  })
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${String((s.address() as { port: number }).port)}`, seen, close: () => new Promise<void>(resolve => s.close(() => resolve())) }
}

function run(home: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(process.execPath, [CLI, ...args], { env: cliEnv(home), timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({ code: error === null ? 0 : Number((error as { code?: unknown }).code ?? 1), stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

describe('#933 user pair', () => {
  it('waits, then saves the token once to the book; prints the code and never the token', async () => {
    const n = await node([{ state: 'waiting' }, { state: 'approved', token: TOKEN, delegateId: 'd-9' }])
    const home = mkdtempSync(join(tmpdir(), 'cli-pair-'))
    try {
      const out = await run(home, ['user', 'pair', '--home', n.url, '--name', 'laptop', '--days', '7', '--poll-ms', '200'])
      expect(out.code).toBe(0)
      expect(out.stderr).toContain('ABCD-EFGH')
      expect(out.stdout).toContain('paired with')
      for (const text of [out.stdout, out.stderr]) { expect(text).not.toContain(TOKEN); expect(text).not.toContain('s3cret') }
      const book = JSON.parse(readFileSync(join(home, 'owner-delegates.json'), 'utf8')) as { homes: Record<string, { token: string; id: string; name: string }> }
      expect(book.homes[n.url]).toMatchObject({ token: TOKEN, id: 'd-9', name: 'laptop' })
      expect(n.seen[0]).toBe('/__dsh_a2a/owner-delegates/pair start')
      expect(n.seen.slice(1).every(line => line === '/__dsh_a2a/owner-delegates/pair poll secret=s3cret')).toBe(true)
    } finally { rmSync(home, { recursive: true, force: true }); await n.close() }
  })
  it('a refusal on the node exits 1 with the reason and saves nothing', async () => {
    const n = await node([{ state: 'denied' }])
    const home = mkdtempSync(join(tmpdir(), 'cli-pair-'))
    try {
      const out = await run(home, ['user', 'pair', '--home', n.url, '--poll-ms', '200'])
      expect(out.code).toBe(1)
      expect(out.stderr).toContain('refused')
      expect(existsSync(join(home, 'owner-delegates.json'))).toBe(false)
    } finally { rmSync(home, { recursive: true, force: true }); await n.close() }
  })
  it('expiry exits 1: told by the node, or the code running out while still waiting', async () => {
    const told = await node([{ state: 'expired' }])
    const waited = await node([{ state: 'waiting' }], { expiresAt: new Date(Date.now() - 4_500).toISOString() })
    const home = mkdtempSync(join(tmpdir(), 'cli-pair-'))
    try {
      for (const n of [told, waited]) {
        const out = await run(home, ['user', 'pair', '--home', n.url, '--poll-ms', '200'])
        expect(out.code).toBe(1)
        expect(out.stderr).toContain('expired')
      }
      expect(existsSync(join(home, 'owner-delegates.json'))).toBe(false)
    } finally { rmSync(home, { recursive: true, force: true }); await told.close(); await waited.close() }
  })
  it('a node that will not start a pairing exits 1', async () => {
    const n = await node([{ state: 'waiting' }], { ok: false, code: 'busy', error: '3 pairings already wait for the owner' })
    const home = mkdtempSync(join(tmpdir(), 'cli-pair-'))
    try {
      const out = await run(home, ['user', 'pair', '--home', n.url])
      expect(out.code).toBe(1)
      expect(out.stderr).toContain('already wait')
    } finally { rmSync(home, { recursive: true, force: true }); await n.close() }
  })
})
