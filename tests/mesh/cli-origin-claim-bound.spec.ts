// @vitest-environment node
/**
 * The real CLI's bound OriginClaim (docs/protocol/delivery-origin-auth.md
 * §2.1) on a real host: it verifies at its home with originClaimUnboundWindow
 * CLOSED — recorded as origin-claim, no gauge moves — so CLI traffic no
 * longer holds the window open. Dialled through an address the host does not
 * list (a card-proxy port in front of it), the same envelope names another
 * audience: refused once the window is closed, never resent unsigned, and
 * the CLI names the fix; accepted where the host lists that address, and
 * counted as a bound miss while the window is open.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, reservePort, tmpHome, type MeshNode } from './harness.ts'
import { signCard } from '../../src/card.ts'

const CLI = join(process.cwd(), 'cli', 'a2a.mjs')
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

const post = async (url: string, body: unknown): Promise<Record<string, any>> =>
  await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async r => await r.json() as Record<string, any>)

interface Gauges { legacyInbound: number; unboundInbound: number; boundMissInbound: number; rows: Array<Record<string, any>> }
async function gauges(n: MeshNode): Promise<Gauges> {
  const s = await globalThis.fetch(`${n.baseUrl}/__dsh_a2a/state`).then(async r => await r.json()) as Record<string, any>
  return { legacyInbound: s.legacyInbound, unboundInbound: s.unboundInbound, boundMissInbound: s.boundMissInbound, rows: [...s.tasks, ...(s.archived ?? [])] }
}

/** A card-proxy: another port on this machine forwarding verbatim to `port` (the host never lists it). */
async function proxyTo(port: number): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const upstream = request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(upstream)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, server }
}

/** A host with one joined session and a deposited CLI identity; the CLI env dials `home`. */
async function cliOn(n: MeshNode, uuid: string): Promise<{ env: (home: string) => Record<string, string> }> {
  expect((await post(`${n.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })).ok).not.toBe(false)
  const HOME = mkdtempSync(join(tmpdir(), 'a2a-bound-'))
  expect((await runCli(['init', 'ops-cli', '--uuid', uuid], { HOME, A2A_CLI_HOME: HOME })).code).toBe(0)
  const id = JSON.parse(readFileSync(join(HOME, 'cli.json'), 'utf8')) as { privateKeyPem: string }
  const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: `ops-cli/${uuid}`, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, createPrivateKey(id.privateKeyPem))
  expect((await post(`${n.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).ok).toBe(true)
  return { env: home => ({ HOME, A2A_CLI_HOME: HOME, A2A_HOME: home, A2A_RETRY_BASE_MS: '10' }) }
}

describe('CLI bound OriginClaim (real host, §2.1)', () => {
  it('window closed: accepted bound at its home; through an unlisted proxy address refused wrong-audience, not resent, fix named', async () => {
    const port = await reservePort()
    const proxy = await proxyTo(port)
    const a = await bootNode({ name: 'A', session: 'mesh-cli-bound-a', team: 'dsh', sessionNodes: true, teamScopeRouting: true, port, home: tmpHome(), originClaimUnboundWindow: false })
    try {
      const cli = await cliOn(a, 'a1b2c3d4e5f60718')
      const before = await gauges(a)

      const home = await runCli(['route', TARGET, 'bound at home', '--task', 'direct-bound000001'], cli.env(a.baseUrl))
      expect(home.code, home.stderr).toBe(0)
      let after = await gauges(a)
      expect(after.rows.find(t => t.taskId === 'direct-bound000001')?.auth).toMatchObject({ caller: 'ops-cli/a1b2c3d4e5f60718', proof: 'cli-identity', via: 'cli-deposit' })
      // Verified by the bound form alone: nothing counted against the window.
      expect([after.legacyInbound, after.unboundInbound, after.boundMissInbound]).toEqual([before.legacyInbound, before.unboundInbound, before.boundMissInbound])

      const far = await runCli(['route', TARGET, 'through the proxy', '--task', 'direct-bound000002'], cli.env(proxy.url))
      expect(far.code).toBe(1)
      expect(far.stdout + far.stderr).toMatch(/OriginClaim verification failed \(wrong-audience\)/)
      expect(far.stderr).toContain(`OriginClaim wrong-audience: this CLI dialled ${proxy.url}`)
      expect(far.stderr).toContain(`add "${proxy.url}" to originClaimAudiences`)
      expect(far.stderr).not.toContain('resending once unsigned')
      after = await gauges(a)
      // No unsigned resend slipped through the legacy window, and the id never landed.
      expect(after.legacyInbound).toBe(before.legacyInbound)
      expect(after.rows.find(t => t.taskId === 'direct-bound000002')).toBeUndefined()
    } finally {
      await a.dispose()
      proxy.server.close()
    }
  }, 60_000)

  it('the proxy address listed in originClaimAudiences verifies bound with the window closed; unlisted with the window open it falls back and counts a bound miss', async () => {
    const portB = await reservePort()
    const portC = await reservePort()
    const proxyB = await proxyTo(portB)
    const proxyC = await proxyTo(portC)
    const b = await bootNode({ name: 'B', session: 'mesh-cli-bound-b', team: 'dsh', sessionNodes: true, teamScopeRouting: true, port: portB, home: tmpHome(), originClaimUnboundWindow: false, originClaimAudiences: [proxyB.url] })
    const c = await bootNode({ name: 'C', session: 'mesh-cli-bound-c', team: 'dsh', sessionNodes: true, teamScopeRouting: true, port: portC, home: tmpHome(), originClaimUnboundWindow: true })
    try {
      const onB = await cliOn(b, 'b1b2c3d4e5f60718')
      const listed = await runCli(['route', TARGET, 'via a listed proxy', '--task', 'direct-bound000003'], onB.env(proxyB.url))
      expect(listed.code, listed.stderr).toBe(0)
      const gb = await gauges(b)
      expect(gb.rows.find(t => t.taskId === 'direct-bound000003')?.auth).toMatchObject({ proof: 'cli-identity', via: 'cli-deposit' })
      expect([gb.unboundInbound, gb.boundMissInbound]).toEqual([0, 0])

      const onC = await cliOn(c, 'c1b2c3d4e5f60718')
      const before = await gauges(c)
      const open = await runCli(['route', TARGET, 'via an unlisted proxy', '--task', 'direct-bound000004'], onC.env(proxyC.url))
      expect(open.code, open.stderr).toBe(0)
      // Silent at the CLI while the window is open: the host's gauge is where it shows.
      expect(open.stderr).toBe('')
      const gc = await gauges(c)
      expect(gc.rows.find(t => t.taskId === 'direct-bound000004')?.auth).toMatchObject({ proof: 'cli-identity', via: 'cli-deposit' })
      expect(gc.unboundInbound - before.unboundInbound).toBe(1)
      expect(gc.boundMissInbound - before.boundMissInbound).toBe(1)
      // `a2a status` prints the gauges beside the address this CLI dials.
      const status = await runCli(['status'], onC.env(proxyC.url))
      expect(status.stdout).toContain(`boundMissInbound=${String(gc.boundMissInbound)}`)
      expect(status.stdout).toContain(`dialled as ${proxyC.url}`)
      // #64: and which caller missed by which origin — what the operator adds to originClaimAudiences.
      expect(status.stdout).toMatch(new RegExp(`miss +\\S+ dialled ${new URL(proxyC.url).origin.replace(/[.]/g, '\\.')} ×\\d+`))
    } finally {
      await b.dispose()
      await c.dispose()
      proxyB.server.close()
      proxyC.server.close()
    }
  }, 60_000)
})
