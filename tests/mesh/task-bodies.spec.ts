// @vitest-environment node
/**
 * Inbound task bodies end to end (market request 2026-11-14): a real CLI route to a session on a real node keeps the
 * delivery's text, and a2a_task_read returns it to that session only.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, reservePort, runContext, tmpHome } from './harness.ts'
import { signCard } from '../../src/card.ts'

const CLI = join(process.cwd(), 'cli', 'a2a.mjs')
beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH ?? '', ...env } })
    let stdout = '', stderr = ''
    child.stdout.on('data', c => { stdout += String(c) })
    child.stderr.on('data', c => { stderr += String(c) })
    child.on('close', code => resolve({ code: code ?? -1, stdout, stderr }))
  })
}
const post = async (url: string, body: unknown): Promise<Record<string, any>> =>
  await (await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Record<string, any>

describe('inbound task bodies (real CLI, real node)', () => {
  it('the receiving session reads the delivered text by task id; another session cannot', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-tb', team: 'dsh', sessionNodes: true, port: await reservePort(), home: tmpHome() })
    try {
      expect((await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-0123456789abcdef' })).ok).not.toBe(false)
      const HOME = mkdtempSync(join(tmpdir(), 'a2a-tb-'))
      const env = { HOME, A2A_CLI_HOME: HOME, A2A_HOME: a.baseUrl, A2A_RETRY_BASE_MS: '10' }
      expect((await runCli(['init', 'ops-cli', '--uuid', 'a1b2c3d4e5f60718'], env)).code).toBe(0)
      const id = JSON.parse(readFileSync(join(HOME, 'cli.json'), 'utf8')) as { privateKeyPem: string }
      const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: 'ops-cli/a1b2c3d4e5f60718', capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, createPrivateKey(id.privateKeyPem))
      expect((await post(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { action: 'publish', card: JSON.stringify(card) })).ok).toBe(true)

      const routed = await runCli(['route', 'dsh/01234567', '--task', 'direct-tb0000000001', '请把第 3 段镜像重新上传，完成后回执'], env)
      expect(routed.code, routed.stderr).toBe(0)

      const read = a.ctx.tools.get('a2a_task_read')!
      const mine = await read.execute({ task_id: 'direct-tb0000000001' }, runContext(a.agents.agent)) as Record<string, unknown>
      expect(mine).toMatchObject({ ok: true, task_id: 'direct-tb0000000001', from: 'ops-cli/a1b2c3d4e5f60718', text: '请把第 3 段镜像重新上传，完成后回执' })
      const theirs = await read.execute({ task_id: 'direct-tb0000000001' }, runContext({ id: 'session-ffffffffffffffff' } as never)) as Record<string, unknown>
      expect(theirs).toMatchObject({ ok: false, code: 'not-found' })
      expect(JSON.stringify(theirs)).not.toContain('镜像')
    } finally {
      await a.dispose()
    }
  }, 120_000)
})
