// @vitest-environment node
/**
 * gh#133 on a real host: the real CLI's OriginClaim now verifies — the
 * delivery's authorization record says `origin-claim` and legacyInbound does
 * not move. The CLI derivation is narrow: only this host's own deposit face,
 * only the deposited key, only the delivery and log faces.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { createPrivateKey, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, reservePort, tmpHome } from './harness.ts'
import { signCard } from '../../src/card.ts'

const CLI = join(process.cwd(), 'cli', 'a2a.mjs')
const HANDLE = 'ops-cli/a1b2c3d4e5f60718'
const TARGET = 'dsh/01234567'

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

const post = async (url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, any> }> =>
  await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> }))

const sign = (key: Parameters<typeof edSign>[2], caller: string, url: string): Record<string, string> => {
  const ts = Date.now()
  return { 'X-A2A-Caller': caller, 'X-A2A-Caller-Url': url, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': edSign(undefined, Buffer.from(JSON.stringify([caller, url, ts])), key).toString('base64') }
}

describe('gh#133 CLI OriginClaim (real host)', () => {
  it('the real CLI\'s route is recorded as origin-claim and does not count as legacy', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-gh133', team: 'dsh', sessionNodes: true, teamScopeRouting: true, port: await reservePort(), home: tmpHome() })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })).status).toBe(200)
      const HOME = mkdtempSync(join(tmpdir(), 'a2a-gh133-'))
      const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: a.baseUrl, A2A_RETRY_BASE_MS: '10' }
      expect((await runCli(['init', 'ops-cli', '--uuid', 'a1b2c3d4e5f60718'], env)).code).toBe(0)
      const id = JSON.parse(readFileSync(join(HOME, 'cli.json'), 'utf8')) as { privateKeyPem: string }
      const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, createPrivateKey(id.privateKeyPem))
      expect((await post(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).body.ok).toBe(true)
      const legacyBefore = (await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/state`).then(async r => await r.json()) as { legacyInbound: number }).legacyInbound

      const out = await runCli(['route', TARGET, 'signed by the cli', '--task', 'direct-gh133000001'], env)
      expect(out.code, out.stderr).toBe(0)
      const state = await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/state`).then(async r => await r.json()) as { legacyInbound: number; tasks: Array<Record<string, any>>; archived?: Array<Record<string, any>> }
      const row = [...state.tasks, ...(state.archived ?? [])].find(t => t.taskId === 'direct-gh133000001')
      // The claim names the full handle, so it covers exactly this identity (review of PR #135 P1).
      expect(row?.auth).toMatchObject({ caller: HANDLE, proof: 'origin-claim', claim: { caller: HANDLE, origin: new URL(a.baseUrl).origin }, via: 'cli-deposit' })
      expect(state.legacyInbound).toBe(legacyBefore)
    } finally {
      await a.dispose()
    }
  }, 60_000)

  it('the derivation stays narrow: wrong key, a wrong name, a look-alike card under another key, and the canvas and log faces all refuse', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-gh133-b', team: 'dsh', sessionNodes: true, teamScopeRouting: true, port: await reservePort(), home: tmpHome() })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })).status).toBe(200)
      const { privateKey } = generateKeyPairSync('ed25519')
      const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, privateKey)
      expect((await post(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).body.ok).toBe(true)
      const face = `${a.baseUrl}/a2a/cli/${encodeURIComponent(HANDLE)}`
      const deliver = async (headers: Record<string, string>, taskId: string) =>
        (await post(`${a.baseUrl}/a2a/direct`, { team: TARGET, message: 'x', caller_session: HANDLE, wait: false, task_id: taskId }, headers)).body

      // The deposited key over its own face: verified.
      expect((await deliver(sign(privateKey, 'ops-cli', face), 'direct-gh133-ok')).delivered).toBe(true)
      // Another key over the same face: the served card is the deposited one, so the signature fails.
      const other = generateKeyPairSync('ed25519').privateKey
      expect(String((await deliver(sign(other, 'ops-cli', face), 'direct-gh133-k')).error)).toMatch(/OriginClaim verification failed \(bad-sig\)/)
      // A name that is not the handle's own: not derivable.
      expect(String((await deliver(sign(privateKey, 'someone', face), 'direct-gh133-n')).error)).toMatch(/\(not-derivable\)/)
      // Another origin's look-alike face serving a card for the same handle under ANOTHER key: the host never
      // fetches it — the deposited card decides, so the other key's signature fails.
      const lookalike = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, other)
      const mirror = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(lookalike)) })
      await new Promise<void>(resolve => mirror.listen(0, '127.0.0.1', () => resolve()))
      try {
        const foreignFace = `http://127.0.0.1:${String((mirror.address() as { port: number }).port)}/a2a/cli/${encodeURIComponent(HANDLE)}`
        expect(String((await deliver(sign(other, 'ops-cli', foreignFace), 'direct-gh133-o')).error)).toMatch(/\(bad-sig\)/)
      } finally {
        mirror.close()
      }
      // The canvas face does not accept CLI derivation (only delivery does).
      const op = await post(`${a.baseUrl}/a2a/canvas-op`, { op: 'create', name: 'x' }, sign(privateKey, 'ops-cli', face))
      expect(String(op.body.error)).toMatch(/OriginClaim verification failed \(not-derivable\)/)
    } finally {
      await a.dispose()
    }
  }, 60_000)

  it('review of PR #135: a namesake CLI cannot claim another handle, no CLI may take the zone\'s name, and an unreachable home address still verifies', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-gh133-c', team: 'dsh', sessionNodes: true, teamScopeRouting: true, port: await reservePort(), home: tmpHome() })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })).status).toBe(200)
      const keyA = generateKeyPairSync('ed25519').privateKey
      const keyB = generateKeyPairSync('ed25519').privateKey
      const handleA = 'ops-cli/aaaaaaaaaaaaaaaa'
      const handleB = 'ops-cli/bbbbbbbbbbbbbbbb'
      for (const [handle, key] of [[handleA, keyA], [handleB, keyB]] as const) {
        const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, key)
        expect((await post(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).body.ok).toBe(true)
      }
      const rows = async (): Promise<Array<Record<string, any>>> => {
        const state = await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/state`).then(async r => await r.json()) as { tasks: Array<Record<string, any>>; archived?: Array<Record<string, any>> }
        return [...state.tasks, ...(state.archived ?? [])]
      }
      // P1-a: A signs over its own face but names B as caller_session: delivered (B is deposited), never proven as B.
      const faceA = `${a.baseUrl}/a2a/cli/${encodeURIComponent(handleA)}`
      const namesake = await post(`${a.baseUrl}/a2a/direct`, { team: TARGET, message: 'as B', caller_session: handleB, wait: false, task_id: 'direct-gh133-ns' }, sign(keyA, 'ops-cli', faceA))
      expect(namesake.body.delivered, JSON.stringify(namesake.body)).toBe(true)
      expect((await rows()).find(t => t.taskId === 'direct-gh133-ns')?.auth).toMatchObject({ caller: handleB, proof: 'claim-mismatch', claim: { caller: handleA } })

      // P1-b: a CLI named after this host's zone is refused at deposit.
      const zoneKey = generateKeyPairSync('ed25519').privateKey
      const zoneCard = signCard({ name: 'dsh', session: 'cli-dsh', team: 'dsh/cccccccccccccccc', capabilities: { route: true }, expiresAt: Date.now() + 172_800_000 }, zoneKey)
      const zoneDeposit = await post(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(zoneCard) })
      expect(zoneDeposit.body.ok).toBe(false)
      expect(String(zoneDeposit.body.error)).toMatch(/may not be named after this host's zone/)

      // P1-c: a home address the host cannot dial back (a proxy behind a cookie, a tailnet IP): still origin-claim.
      const unreachable = `http://127.0.0.1:1/behind/a/proxy/a2a/cli/${encodeURIComponent(handleA)}`
      const far = await post(`${a.baseUrl}/a2a/direct`, { team: TARGET, message: 'via proxy', caller_session: handleA, wait: false, task_id: 'direct-gh133-px' }, sign(keyA, 'ops-cli', unreachable))
      expect(far.body.delivered, JSON.stringify(far.body)).toBe(true)
      expect((await rows()).find(t => t.taskId === 'direct-gh133-px')?.auth).toMatchObject({ caller: handleA, proof: 'origin-claim', claim: { caller: handleA } })

      // The log face no longer accepts CLI derivation (least privilege: the CLI never reads it).
      const log = await globalThis.fetch(`${a.baseUrl}/a2a/log?id=session-0123456789abcdef&caller_session=${encodeURIComponent(handleA)}`, { headers: sign(keyA, 'ops-cli', faceA) })
        .then(async r => await r.json() as Record<string, any>)
      expect(log.ok).toBe(false)
      expect(String(log.error)).toMatch(/OriginClaim verification failed \(not-derivable\)/)
    } finally {
      await a.dispose()
    }
  }, 60_000)
})
