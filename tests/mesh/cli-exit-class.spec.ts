// @vitest-environment node
/**
 * superagent p3 G3 (design P3-7): `route` / `receipt` with `--json --exit-class` exit with the class — 0 sent (or the same
 * receipt replayed), 4 gone, 5 a different receipt for the task, 1 retry or any other failure — and without the switch every
 * exit code stays as it was. Real loopback host and real CLI; throwaway keys in tmp/ homes.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from '../temp-dirs.ts'
import { bootNode, cliEnv, postJson, reservePort, type MeshNode } from './harness.ts'
import { signCard } from '../../src/card.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

type Id = { name: string; uuid: string; key: KeyObject }
const ident = (name: string, uuid: string): Id => ({ name, uuid, key: generateKeyPairSync('ed25519').privateKey })
const handleOf = (id: Id) => `${id.name}/${id.uuid}`
const SRC = ident('xc-src', 'a1b2c3d4e5f60930')
const WRITER = ident('xc-w', 'a1b2c3d4e5f60931')

const cli = (home: string, args: string[]) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
  let stdout = '', stderr = ''
  child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
  child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
})
async function deposit(node: MeshNode, id: Id): Promise<string> {
  const card = signCard({ name: id.name, session: `cli-${id.name}`, team: handleOf(id), capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, id.key)
  expect(((await (await postJson(node.baseUrl, '/__dsh_a2a/cli-deposit', { action: 'publish', card: JSON.stringify(card) })).json()) as { ok?: boolean }).ok).toBe(true)
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
  const home = mkdtempSync(join(process.cwd(), 'tmp', 'exit-class-'))
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: id.name, uuid: id.uuid, handle: handleOf(id), home: node.baseUrl, privateKeyPem: id.key.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
  return home
}

describe('superagent p3 G3: --exit-class', () => {
  it('route and receipt exit with the class only when asked to', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-exit-class', team: 'dsh', sessionNodes: true, port: await reservePort() })
    try {
      const src = await deposit(a, SRC)
      const writer = await deposit(a, WRITER)
      const X = ['--json', '--exit-class']
      // sent
      const routed = await cli(writer, ['route', handleOf(SRC), 'work please', '--task', 'w-1', '--context', 'ctx-1', ...X])
      expect(routed.code).toBe(0)
      expect(JSON.parse(routed.stdout)).toMatchObject({ class: 'sent' })
      // the receipt, then the same receipt again (a replay): both 0
      expect((await cli(src, ['receipt', 'w-1', ...X, '--', 'done'])).code).toBe(0)
      expect((await cli(src, ['receipt', 'w-1', ...X, '--', 'done'])).code).toBe(0)
      // a different receipt for the same task: 5 with the switch, 1 without (unchanged)
      expect((await cli(src, ['receipt', 'w-1', '--outcome', 'failed', ...X, '--', 'actually failed'])).code).toBe(5)
      expect((await cli(src, ['receipt', 'w-1', '--outcome', 'failed', '--json', '--', 'actually failed'])).code).toBe(1)
      expect((await cli(src, ['receipt', 'w-1', '--outcome', 'failed', '--', 'actually failed'])).code).toBe(1)
      // a target this host cannot route to: retry (1), as --json prints it
      const unknown = await cli(writer, ['route', 'nobody/0000000000000000', 'hello', '--task', 'w-2', ...X])
      expect(JSON.parse(unknown.stdout)).toMatchObject({ class: 'retry' })
      expect(unknown.code).toBe(1)
      // the same task id for a different message can never succeed: gone is 4 with the switch, 1 without (unchanged)
      const gone = await cli(writer, ['route', handleOf(SRC), 'another message', '--task', 'w-1', '--context', 'ctx-1', ...X])
      expect(JSON.parse(gone.stdout)).toMatchObject({ class: 'gone' })
      expect(gone.code).toBe(4)
      expect((await cli(writer, ['route', handleOf(SRC), 'another message', '--task', 'w-1', '--context', 'ctx-1', '--json'])).code).toBe(1)
      // a body above the host's route cap (-32001) can never be resent: gone on the delivery path too
      // (Windows caps a command line near 32k: the argument itself would fail with ENAMETOOLONG before the CLI runs)
      if (process.platform !== 'win32') {
        const big = 'x'.repeat(600_000)
        const tooLarge = await cli(writer, ['route', handleOf(SRC), big, '--task', 'w-4', ...X])
        expect(JSON.parse(tooLarge.stdout)).toMatchObject({ code: -32001, class: 'gone' })
        expect(tooLarge.code).toBe(4)
        expect((await cli(writer, ['route', handleOf(SRC), big, '--task', 'w-5', '--json'])).code).toBe(1)
      }
      // the switch needs --json
      expect((await cli(writer, ['route', handleOf(SRC), 'x', '--exit-class'])).code).toBe(2)
    } finally {
      await a.dispose()
    }
  }, 90_000)
})
