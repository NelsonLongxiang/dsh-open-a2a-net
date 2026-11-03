// @vitest-environment node
/**
 * #91 file channel F3 with the real CLI (docs/design/file-channel.md §3.4): `a2a file send` stages
 * each file on the home host and routes ONE message of reference lines; `a2a file fetch` pulls a
 * referenced file from the home host with the CLI's own envelope, checks it, and saves it. A file
 * on another host is refused up front: a CLI identity proves itself only on its home host.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { createHash, createPrivateKey } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, reservePort, steerText, tmpHome } from './harness.ts'
import { signCard } from '../../src/card.ts'

const CLI = join(process.cwd(), 'cli', 'a2a.mjs')
const HANDLE = 'ops-cli/a1b2c3d4e5f60718'
const sha = (b: string): string => createHash('sha256').update(b).digest('hex')

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
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

const post = async (url: string, body: unknown): Promise<Record<string, any>> =>
  await (await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Record<string, any>

describe('#91 F3 — a2a file send / file fetch (real CLI, real host)', () => {
  it('send stages and routes one message of references; fetch pulls it back from the home host, checked and saved', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-f3', team: 'dsh', sessionNodes: true, port: await reservePort(), home: tmpHome() })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })).ok).not.toBe(false)
      const HOME = mkdtempSync(join(tmpdir(), 'a2a-f3-'))
      const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: a.baseUrl, A2A_RETRY_BASE_MS: '10' }
      expect((await runCli(['init', 'ops-cli', '--uuid', 'a1b2c3d4e5f60718'], env)).code).toBe(0)
      const id = JSON.parse(readFileSync(join(HOME, 'cli.json'), 'utf8')) as { privateKeyPem: string }
      const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, createPrivateKey(id.privateKeyPem))
      expect((await post(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).ok).toBe(true)

      const work = mkdtempSync(join(tmpdir(), 'a2a-f3-files-'))
      writeFileSync(join(work, '月报.xlsx'), '一月')
      writeFileSync(join(work, 'b.csv'), 'a,b')
      // To a session on the host: ONE steered message carrying both references.
      const toSession = await runCli(['file', 'send', join(work, '月报.xlsx'), join(work, 'b.csv'), 'dsh/01234567', '--note', '请查收'], env)
      expect(toSession.code, toSession.stderr).toBe(0)
      const text = JSON.parse(steerText(a.steered[a.steered.length - 1])).content[0].text as string
      expect(text).toContain('请查收')
      expect(text).toContain(`[A2A file] v1 sha256=${sha('一月')} size=${String(Buffer.byteLength('一月'))} name=${encodeURIComponent('月报.xlsx')} from=${new URL(a.baseUrl).origin}`)
      expect(text).toContain(`sha256=${sha('a,b')}`)

      // To the CLI itself (its mailbox), then fetch it back.
      writeFileSync(join(work, '自己的.txt'), '回给自己')
      expect((await runCli(['file', 'send', join(work, '自己的.txt'), HANDLE], env)).code).toBe(0)
      const inbox = await runCli(['inbox', '--json'], env)
      const parsed = JSON.parse(inbox.stdout) as unknown
      const rows = (Array.isArray(parsed) ? parsed : ((parsed as { mail?: unknown[]; messages?: unknown[] }).mail ?? (parsed as { messages?: unknown[] }).messages ?? [])) as Array<Record<string, unknown>>
      const mailText = rows.map(r => String(r.text ?? r.body ?? '')).join('\n')
      const line = /\[A2A file\] v1 \S+ \S+ \S+ \S+/.exec(mailText)?.[0]
      expect(line, inbox.stdout).toBeDefined()
      const out = mkdtempSync(join(tmpdir(), 'a2a-f3-out-'))
      const fetched = await runCli(['file', 'fetch', line!, '--out', out], env)
      expect(fetched.code, fetched.stderr).toBe(0)
      expect(readFileSync(join(out, `${sha('回给自己').slice(0, 12)}-自己的.txt`), 'utf8')).toBe('回给自己')

      // Not granted to the CLI: refused with the host's code.
      const theirs = /\[A2A file\] v1 \S+ \S+ \S+ \S+/.exec(text)![0]
      const refused = await runCli(['file', 'fetch', theirs, '--out', out], env)
      expect(refused.code).not.toBe(0)
      expect(refused.stderr).toContain('not-granted')
      // A file on another host: refused before any request.
      const elsewhere = await runCli(['file', 'fetch', line!.replace(new URL(a.baseUrl).origin, 'http://10.0.0.9:3080'), '--out', out], env)
      expect(elsewhere.code).not.toBe(0)
      expect(elsewhere.stderr).toContain('proves itself only on its home host')
    } finally {
      await a.dispose()
    }
  }, 120_000)
})
