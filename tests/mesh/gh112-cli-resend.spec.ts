// @vitest-environment node
/**
 * gh#112 end-to-end: the real CLI routes through a proxy that lets the
 * first delivery reach the host and then drops the reply. The CLI resends
 * the SAME caller-born task id; the host's idempotency store answers replay,
 * so the target mailbox holds the message exactly once.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, reservePort } from './harness.ts'
import { signCard } from '../../src/card.ts'

const CLI = join(process.cwd(), 'cli', 'a2a.mjs')
const HANDLE = 'ops-cli/a1b2c3d4e5f60718'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH ?? '', ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += String(c) })
    child.stderr.on('data', (c) => { stderr += String(c) })
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/** Forwards every request to `upstream`; the first /a2a/direct reaches it, then its reply is dropped. */
async function lossyProxy(upstream: string): Promise<{ url: string; server: Server; directs: () => number }> {
  let directs = 0
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== 'host' && k !== 'content-length').map(([k, v]) => [k, String(v)]))
      const body = chunks.length === 0 ? undefined : Buffer.concat(chunks)
      const isDirect = req.url === '/a2a/direct'
      if (isDirect) directs += 1
      const dropThis = isDirect && directs === 1
      void globalThis.fetch(`${upstream}${req.url ?? '/'}`, { method: req.method, headers, body }).then(async (up) => {
        const text = await up.text()
        if (dropThis) { req.socket.destroy(); return }
        res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') ?? 'application/json' })
        res.end(text)
      }, () => { req.socket.destroy() })
    })
  })
  const port = await reservePort()
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${String(port)}`, server, directs: () => directs }
}

describe('gh#112 CLI resend through a lost reply (end-to-end)', () => {
  it('the delivery lands once although the CLI sent it twice', async () => {
    const port = await reservePort()
    const a = await bootNode({ name: 'A', session: 'mesh-gh112', team: 'dsh', sessionNodes: true, port })
    const proxy = await lossyProxy(a.baseUrl)
    try {
      const HOME = mkdtempSync(join(tmpdir(), 'a2a-gh112-'))
      const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: proxy.url, A2A_RETRY_BASE_MS: '10' }
      expect((await runCli(['init', 'ops-cli', '--uuid', 'a1b2c3d4e5f60718'], env)).code).toBe(0)
      const id = JSON.parse(readFileSync(join(HOME, 'cli.json'), 'utf8')) as { privateKeyPem: string }
      const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, createPrivateKey(id.privateKeyPem))
      const dep = await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }),
      }).then(async r => await r.json() as { ok: boolean })
      expect(dep.ok).toBe(true)

      const out = await runCli(['route', HANDLE, 'resend probe gh112'], env)
      expect(out.stderr).toBe('')
      expect(out.code).toBe(0)
      expect(proxy.directs()).toBe(2)
      // `completed` (not `outcome unknown (payload-mismatch)`) proves the CLI's fingerprint is the host's;
      // a mailbox delivery is final, so the host recorded it as completed.
      expect(out.stdout).toMatch(/^\[route\] already received → ops-cli\/a1b2c3d4e5f60718 · task direct-[0-9a-f]{12} · completed — not sent a second time\ndelivered to the mailbox of ops-cli\/a1b2c3d4e5f60718 — the CLI polls while online\n$/)

      // review P3: a --sync resend to a mailbox is answered from that recorded outcome, never "rerun later".
      const task = /task (direct-[0-9a-f]{12})/.exec(out.stdout)![1]!
      const sync1 = await runCli(['route', HANDLE, 'sync mailbox probe', '--sync', '--task', `${task}s`], env)
      expect(sync1.code).toBe(0)
      const sync2 = await runCli(['route', HANDLE, 'sync mailbox probe', '--sync', '--task', `${task}s`], env)
      expect(sync2.code).toBe(0)
      expect(sync2.stdout).toContain('· completed — not sent a second time')

      const inbox = await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inbox', handle: HANDLE }),
      }).then(async r => await r.json() as { mail: Array<{ text: string }> })
      expect(inbox.mail.filter(m => m.text.includes('resend probe gh112'))).toHaveLength(1)
    } finally {
      await new Promise(resolve => proxy.server.close(resolve))
      await a.dispose()
    }
  }, 60_000)

  it('review P1: a refused async round whose reply was lost is reported as failed, never as delivered', async () => {
    const port = await reservePort()
    const a = await bootNode({ name: 'A', session: 'mesh-gh112-p1', team: 'dsh', sessionNodes: true, port })
    const proxy = await lossyProxy(a.baseUrl)
    try {
      const HOME = mkdtempSync(join(tmpdir(), 'a2a-gh112-p1-'))
      const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: proxy.url, A2A_RETRY_BASE_MS: '10' }
      expect((await runCli(['init', 'ops-cli', '--uuid', 'a1b2c3d4e5f60718'], env)).code).toBe(0)
      const id = JSON.parse(readFileSync(join(HOME, 'cli.json'), 'utf8')) as { privateKeyPem: string }
      const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, createPrivateKey(id.privateKeyPem))
      await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }),
      })
      // No session node serves ghost-team: the host claims the id, then refuses.
      const out = await runCli(['route', 'dsh/ghost000', 'nobody home'], env)
      expect(proxy.directs()).toBe(2)
      expect(out.code).toBe(1)
      expect(out.stderr).toMatch(/already ran and failed: .*No live DSH session node accepts team/)
      expect(out.stdout).not.toContain('already received')
    } finally {
      await new Promise(resolve => proxy.server.close(resolve))
      await a.dispose()
    }
  }, 60_000)
})
