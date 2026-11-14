// @vitest-environment node
/**
 * #91 file channel F3 with the real CLI (docs/design/file-channel.md §3.4): `a2a file send` stages
 * each file on the home host and routes ONE message of reference lines; `a2a file fetch` pulls a
 * referenced file from the home host with the CLI's own envelope, checks it, and saves it. A file
 * on another host is refused up front: a CLI identity proves itself only on its home host.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, createPrivateKey } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
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
  for (const mode of ['old-host', 'forged-error-body', 'malformed-alias', 'redirect']) it('#332 refuses ' + mode + ' metadata without sending blob credentials elsewhere', async () => {
    let elsewhere = 0, blobRequests = 0
    const sink = createServer((_req, res) => { elsewhere++; res.end('{}') })
    await new Promise<void>(resolve => sink.listen(0, '127.0.0.1', resolve))
    const alias = 'http://127.0.0.1:' + String((sink.address() as AddressInfo).port)
    const homeServer = createServer((req, res) => {
      if (req.url?.startsWith('/a2a/blob')) { blobRequests++; res.writeHead(403); res.end('{}'); return }
      expect(req.headers['x-api-key']).toBe('home-only-key')
      if (mode === 'redirect') { res.writeHead(302, { Location: alias + '/capture' }); res.end(); return }
      if (mode === 'old-host') { res.writeHead(404); res.end('{}'); return }
      res.writeHead(mode === 'forged-error-body' ? 503 : 200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ownerHost: mode === 'malformed-alias' ? alias.replace('http://', 'http://user:password@') : alias,
        host: { originClaimAudiences: mode === 'malformed-alias' ? alias : [alias] } }))
    })
    await new Promise<void>(resolve => homeServer.listen(0, '127.0.0.1', resolve))
    const HOME = mkdtempSync(join(tmpdir(), 'a2a-alias-invalid-'))
    const home = 'http://127.0.0.1:' + String((homeServer.address() as AddressInfo).port)
    try {
      const ref = '[A2A file] v1 sha256=' + sha('x') + ' size=1 name=x from=' + alias
      const result = await runCli(['file', 'fetch', ref], { HOME, A2A_CLI_HOME: HOME, A2A_HOME: home, A2A_KEY: 'home-only-key' })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain(mode === 'redirect' ? 'not followed' : 'proves itself only on its home host')
      expect(elsewhere).toBe(0)
      expect(blobRequests).toBe(0)
    } finally {
      homeServer.closeAllConnections(); sink.closeAllConnections()
      await Promise.all([new Promise<void>(r => homeServer.close(() => r())), new Promise<void>(r => sink.close(() => r()))])
    }
  })

  for (const source of ['ownerHost', 'originClaimAudiences']) it('#332 ' + source + ' aliases resolve through home, never the reference URL; identity/grants stay enforced', async () => {
    let aliasRequests = 0
    const sink = createServer((_req, res) => { aliasRequests++; res.writeHead(500); res.end('must never dial') })
    await new Promise<void>(resolve => sink.listen(0, '127.0.0.1', resolve))
    const alias = 'http://127.0.0.1:' + String((sink.address() as AddressInfo).port)
    const key = 'alias-test-key'
    const a = await bootNode({ name: 'alias-home', session: 'alias-home', team: 'dsh', sessionNodes: true, apiKey: key,
      ...(source === 'ownerHost' ? { originClaimUrl: alias } : { originClaimAudiences: [alias] }) })
    const control = async (path: string, body: unknown) => await fetch(a.baseUrl + path, { method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
    try {
      const HOME = mkdtempSync(join(tmpdir(), 'a2a-alias-cli-'))
      const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: a.baseUrl, A2A_KEY: key }
      expect((await runCli(['init', 'ops-cli', '--uuid', 'a1b2c3d4e5f60718'], env)).code).toBe(0)
      const id = JSON.parse(readFileSync(join(HOME, 'cli.json'), 'utf8'))
      const card = signCard({ name: 'ops-cli', session: 'cli-alias', team: HANDLE, capabilities: {}, expiresAt: Date.now() + 60_000 }, createPrivateKey(id.privateKeyPem))
      expect((await control('/__dsh_a2a/cli-deposit', { action: 'publish', card: JSON.stringify(card) })).ok).toBe(true)
      const bytes = Buffer.from('alias bytes')
      const stage = await fetch(a.baseUrl + '/__dsh_a2a/blob?to=' + encodeURIComponent(HANDLE) + '&name=alias.txt', { method: 'POST', headers: { 'X-API-Key': key }, body: bytes }).then(r => r.json())
      expect(stage.ok).toBe(true)
      const ref = '[A2A file] v1 sha256=' + stage.sha256 + ' size=' + bytes.length + ' name=alias.txt from=' + alias
      const out = mkdtempSync(join(tmpdir(), 'a2a-alias-out-'))
      const fetched = await runCli(['file', 'fetch', ref, '--out', out], env)
      expect(fetched.code, fetched.stderr).toBe(0)
      expect(readFileSync(join(out, stage.sha256.slice(0, 12) + '-alias.txt'))).toEqual(bytes)
      const wrongHash = await runCli(['file', 'fetch', ref.replace('size=' + bytes.length, 'size=' + (bytes.length + 1)), '--out', out], env)
      expect(wrongHash.code).not.toBe(0)
      expect(wrongHash.stderr).toContain('nothing saved')
      const undeclared = await runCli(['file', 'fetch', ref.replace(alias, 'http://127.0.0.1:1'), '--out', out], env)
      expect(undeclared.code).not.toBe(0)
      expect(undeclared.stderr).toContain('proves itself only on its home host')
      const other = mkdtempSync(join(tmpdir(), 'a2a-alias-other-'))
      expect((await runCli(['init', 'ops-cli', '--uuid', 'a1b2c3d4e5f60718'], { ...env, A2A_CLI_HOME: other })).code).toBe(0)
      const wrongKey = await runCli(['file', 'fetch', ref, '--out', out], { ...env, A2A_CLI_HOME: other })
      expect(wrongKey.code).not.toBe(0)
      expect(wrongKey.stderr).toContain('untrusted-origin')
      expect(aliasRequests).toBe(0)
    } finally { await a.dispose(); sink.closeAllConnections(); await new Promise<void>(resolve => sink.close(() => resolve())) }
  }, 30_000)

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

  it('file grants / file revoke: each CLI identity sees and revokes only its own grants on its home host', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-grants', team: 'dsh', sessionNodes: true, port: await reservePort(), home: tmpHome() })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })).ok).not.toBe(false)
      const identity = async (name: string, uuid: string) => {
        const HOME = mkdtempSync(join(tmpdir(), `a2a-grants-${name}-`))
        const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: a.baseUrl, A2A_RETRY_BASE_MS: '10' }
        expect((await runCli(['init', name, '--uuid', uuid], env)).code).toBe(0)
        const id = JSON.parse(readFileSync(join(HOME, 'cli.json'), 'utf8')) as { privateKeyPem: string }
        const card = signCard({ name, session: `cli-${name}`, team: `${name}/${uuid}`, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, createPrivateKey(id.privateKeyPem))
        expect((await post(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).ok).toBe(true)
        return env
      }
      const ops = await identity('ops-cli', 'a1b2c3d4e5f60718')
      const other = await identity('other-cli', '0f1e2d3c4b5a6978')
      const work = mkdtempSync(join(tmpdir(), 'a2a-grants-files-'))
      writeFileSync(join(work, 'chunk-01.bin'), '分块一')
      writeFileSync(join(work, 'self.txt'), '给自己')
      const sent = await runCli(['file', 'send', join(work, 'chunk-01.bin'), 'dsh/01234567', '--task', 'direct-image001'], ops)
      expect(sent.code, sent.stderr).toBe(0)
      expect((await runCli(['file', 'send', join(work, 'self.txt'), HANDLE], ops)).code).toBe(0)

      const listOf = async (env: Record<string, string>) => JSON.parse((await runCli(['file', 'grants', '--json'], env)).stdout) as { ok: boolean; grants: Array<Record<string, any>>; usage: Record<string, number> }
      const mine = await listOf(ops)
      expect(mine.ok).toBe(true)
      expect(mine.grants.map(g => g.name).sort()).toEqual(['chunk-01.bin', 'self.txt'])
      expect(mine.grants.find(g => g.name === 'chunk-01.bin')).toMatchObject({ to: 'dsh/01234567', taskId: 'direct-image001', fetched: false, sha256: sha('分块一') })
      expect(mine.usage).toMatchObject({ files: 2, maxFiles: 256, maxBytes: 1024 * 1024 * 1024 })
      expect((await listOf(other)).grants).toEqual([])

      // Adversarial: another identity cannot revoke it (answered as missing), and the grant still serves.
      const stolen = await runCli(['file', 'revoke', sha('分块一'), 'dsh/01234567', '--json'], other)
      expect(stolen.code).not.toBe(0)
      expect(JSON.parse(stolen.stdout)).toMatchObject({ ok: false, code: 'not-found' })
      expect((await listOf(ops)).grants).toHaveLength(2)

      // An unsigned request is refused outright.
      const unsigned = await globalThis.fetch(`${a.baseUrl}/a2a/blob-grants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'list' }) })
      expect(unsigned.status).toBe(403)
      expect((await globalThis.fetch(`${a.baseUrl}/a2a/blob-stage`, { method: 'POST', body: `${JSON.stringify({ to: 'dsh/01234567', name: 'x' })}\nbytes` })).status).toBe(403)

      // #692 review F1: the other identity sends the SAME bytes to the SAME target — a grant of its own; its revoke
      // takes back only that one, and the first sender's grant and bytes stay.
      expect((await runCli(['file', 'send', join(work, 'chunk-01.bin'), 'dsh/01234567'], other)).code).toBe(0)
      expect((await listOf(other)).grants).toHaveLength(1)
      const own = JSON.parse((await runCli(['file', 'revoke', sha('分块一'), 'dsh/01234567', '--json'], other)).stdout)
      expect(own).toMatchObject({ ok: true, reclaimed: false })
      expect((await listOf(ops)).grants.find(g => g.name === 'chunk-01.bin')).toMatchObject({ to: 'dsh/01234567', taskId: 'direct-image001' })

      // #692 review F2: a control-key stage naming the identity in by= is the operator's grant, not the identity's.
      const forged = await (await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/blob?to=dsh%2F01234567&name=forged.bin&by=${encodeURIComponent('other-cli/0f1e2d3c4b5a6978')}`, { method: 'POST', body: '冒名' })).json() as Record<string, unknown>
      expect(forged.ok).toBe(true)
      expect((await listOf(other)).grants).toEqual([])
      expect(JSON.parse((await runCli(['file', 'revoke', sha('冒名'), 'dsh/01234567', '--json'], other)).stdout)).toMatchObject({ ok: false, code: 'not-found' })

      // A fetch is seen by the sender.
      const inbox = JSON.parse((await runCli(['inbox', '--json'], ops)).stdout) as unknown
      const rows = (Array.isArray(inbox) ? inbox : ((inbox as { mail?: unknown[] }).mail ?? [])) as Array<Record<string, unknown>>
      const line = /\[A2A file\] v1 \S+ \S+ \S+ \S+/.exec(rows.map(r => String(r.text ?? '')).join('\n'))![0]
      expect((await runCli(['file', 'fetch', line, '--out', mkdtempSync(join(tmpdir(), 'a2a-grants-out-'))], ops)).code).toBe(0)
      expect((await listOf(ops)).grants.find(g => g.name === 'self.txt')).toMatchObject({ fetched: true, fetches: 1 })

      // The owner revokes: the space is free at once.
      const revoked = await runCli(['file', 'revoke', sha('分块一'), 'dsh/01234567'], ops)
      expect(revoked.code, revoked.stderr).toBe(0)
      expect(revoked.stdout).toContain('bytes freed')
      const after = await listOf(ops)
      expect(after.grants.map(g => g.name)).toEqual(['self.txt'])
      // self.txt, and the operator's forged.bin (its own namespace).
      expect(after.usage.files).toBe(2)
    } finally {
      await a.dispose()
    }
  }, 120_000)
})
