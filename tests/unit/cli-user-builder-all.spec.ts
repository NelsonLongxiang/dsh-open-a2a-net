// @vitest-environment node
/**
 * #906 review B1: `a2a-net user builder … --all` reads every saved node and reports each one. A 401, a dead delegate, a
 * network failure or an odd reply on one node never stops the others, and the exit code is 0 only when every node answered.
 */
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cliEnv } from '../mesh/harness.ts'

const CLI = join(process.cwd(), 'cli/a2a.mjs')

async function server(status: number, body: unknown): Promise<{ url: string; close: () => Promise<void> }> {
  const s: Server = createServer((_req, res) => { const text = typeof body === 'string' ? body : JSON.stringify(body); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(text) })
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve))
  const port = (s.address() as { port: number }).port
  return { url: `http://127.0.0.1:${String(port)}`, close: () => new Promise<void>(resolve => s.close(() => resolve())) }
}

function run(home: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise(resolve => {
    execFile(process.execPath, [CLI, ...args], { env: cliEnv(home), timeout: 30_000 }, (error, stdout) => {
      resolve({ code: error === null ? 0 : Number((error as { code?: unknown }).code ?? 1), stdout: String(stdout) })
    })
  })
}

describe('#906 review B1: user builder --all', () => {
  it('reads every node past a 401, a dead node and a bad reply; JSON per node; exit 1 when any failed', async () => {
    const ok1 = await server(200, { ok: true, builders: [{ session: 's1', name: 'b1', live: true, joined: true, awaiting: 0, recent: 0 }] })
    const denied = await server(401, { ok: false, error: 'owner delegate expired' })
    const odd = await server(200, 'not json')
    const ok2 = await server(200, { ok: true, builders: [] })
    const deadPort = await server(200, {}); const dead = deadPort.url; await deadPort.close()
    const home = mkdtempSync(join(tmpdir(), 'cli-builder-all-'))
    try {
      const homes = Object.fromEntries([ok1.url, denied.url, dead, odd.url, ok2.url].map(url => [url, { token: 'dlg-test' }]))
      writeFileSync(join(home, 'owner-delegates.json'), JSON.stringify({ homes }))
      const json = await run(home, ['user', 'builder', 'list', '--all', '--json'])
      expect(json.code).toBe(1)
      const out = JSON.parse(json.stdout.trim()) as { ok: boolean; nodes: number; failed: number; results: Array<{ home: string; ok: boolean; code?: string; builders?: unknown[] }> }
      expect(out).toMatchObject({ ok: false, nodes: 5, failed: 3 })
      expect(out.results.map(r => [r.home, r.ok, r.code])).toEqual([[ok1.url, true, undefined], [denied.url, false, 'unauthorized'], [dead, false, 'unreachable'], [odd.url, false, 'bad-reply'], [ok2.url, true, undefined]])
      expect(out.results[0]!.builders).toHaveLength(1)
      const text = await run(home, ['user', 'builder', 'list', '--all'])
      expect(text.code).toBe(1)
      expect(text.stdout).toContain(`${denied.url}  FAILED unauthorized`)
      expect(text.stdout).toContain(`${ok2.url}  no team builder session`)
      // A single node that refuses: reported, exit 1, no crash.
      const single = await run(home, ['user', 'builder', 'list', '--home', denied.url, '--json'])
      expect(single.code).toBe(1)
      expect(JSON.parse(single.stdout.trim())).toMatchObject({ ok: false, nodes: 1, failed: 1 })
      // Every node answers: exit 0.
      writeFileSync(join(home, 'owner-delegates.json'), JSON.stringify({ homes: { [ok1.url]: { token: 'dlg-test' }, [ok2.url]: { token: 'dlg-test' } } }))
      const fine = await run(home, ['user', 'builder', 'inventory', '--all', '--json'])
      expect(fine.code).toBe(0)
      expect(JSON.parse(fine.stdout.trim())).toMatchObject({ ok: true, nodes: 2, failed: 0 })
      // Every node fails: exit 1.
      writeFileSync(join(home, 'owner-delegates.json'), JSON.stringify({ homes: { [denied.url]: { token: 'dlg-test' }, [dead]: { token: 'dlg-test' } } }))
      const none = await run(home, ['user', 'builder', 'list', '--all', '--json'])
      expect(none.code).toBe(1)
      expect(JSON.parse(none.stdout.trim())).toMatchObject({ ok: false, nodes: 2, failed: 2 })
    } finally {
      await Promise.all([ok1.close(), denied.close(), odd.close(), ok2.close()])
      rmSync(home, { recursive: true, force: true })
    }
  }, 60_000)
})
