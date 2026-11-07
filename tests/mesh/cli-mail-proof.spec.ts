// @vitest-environment node
/**
 * superagent p1-mail-proof on real hosts: every CLI mailbox row carries, as a
 * field, the proof verdict the host reached when it took the delivery — the
 * same verdict the wire face writes into the text header — and a receipt row
 * names the task it answers. A reader branches on fields, never on the text.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, cliEnv, reservePort } from './harness.ts'
import { signCard } from '../../src/card.ts'

const LEGACY_OPEN_SCOPE = { teamScopeRouting: false, teamScopeInfo: false } as const
const READER = { name: 'proof-reader', uuid: 'a1b2c3d4e5f60718', key: generateKeyPairSync('ed25519').privateKey }
const WRITER = { name: 'proof-writer', uuid: 'a1b2c3d4e5f60719', key: generateKeyPairSync('ed25519').privateKey }
const handleOf = (id: typeof READER) => `${id.name}/${id.uuid}`

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

function cli(home: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

type Mail = { text: string; task_id?: string; proof?: string; receipt_for?: string; context_id?: string }

/** The verdict the wire face writes into the text header, read back as the field must say it. */
const headerVerdict = (text: string): string | undefined => {
  const m = /^\[A2A direct\] \(task \S+\) (已验证来源 \S+|未验证（([^）]+)）)/.exec(text)
  return m === null ? undefined : m[2] ?? 'origin-claim'
}

describe('superagent p1: mailbox rows carry proof and receipt_for (real hosts)', () => {
  it('the field says what the header says on the wire face, in-process on the local face, and a receipt names its task', async () => {
    const portA = await reservePort()
    const portB = await reservePort()
    const a = await bootNode({ ...LEGACY_OPEN_SCOPE, name: 'A', session: 'mesh-proof-a', team: 'dsh', sessionNodes: true, port: portA, peers: [`http://127.0.0.1:${String(portB)}`] })
    const b = await bootNode({ ...LEGACY_OPEN_SCOPE, name: 'B', session: 'mesh-proof-b', team: 'dsh', agentId: 'session-bbbbbbbb33334444', sessionNodes: true, port: portB, peers: [`http://127.0.0.1:${String(portA)}`] })
    try {
      const homes: Record<string, string> = {}
      for (const id of [READER, WRITER]) {
        const card = signCard({ name: id.name, session: `cli-${id.name}`, team: handleOf(id), capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, id.key)
        const dep = await fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }) }).then(r => r.json() as Promise<{ ok?: boolean }>)
        expect(dep.ok).toBe(true)
        const home = mkdtempSync(join(tmpdir(), 'cli-proof-'))
        writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: id.name, uuid: id.uuid, handle: handleOf(id), home: a.baseUrl, privateKeyPem: id.key.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
        homes[id.name] = home
      }
      const mail = async (): Promise<Mail[]> => ((await fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inbox', handle: handleOf(READER) }) }).then(r => r.json())) as { mail: Mail[] }).mail
      const signal = { signal: new AbortController().signal } as never

      // Wire face, a deposited CLI caller.
      const fromCli = await cli(homes[WRITER.name], ['route', handleOf(READER), 'from a cli', '--task', 'w-cli', '--context', 'ctx-p'])
      expect(fromCli.code, fromCli.stderr).toBe(0)
      // Wire face, a session on another host.
      const fromPeer = await b.ctx.tools.get('a2a_route')?.execute({ team: handleOf(READER), message: 'from a peer session' }, signal) as { ok?: boolean }
      expect(fromPeer?.ok, JSON.stringify(fromPeer)).toBe(true)
      // Local face: a session on the home host itself.
      const fromLocal = await a.ctx.tools.get('a2a_route')?.execute({ team: handleOf(READER), message: 'from the home host' }, signal) as { ok?: boolean }
      expect(fromLocal?.ok, JSON.stringify(fromLocal)).toBe(true)
      // A receipt on each face.
      const wireReceipt = await cli(homes[WRITER.name], ['route', handleOf(READER), '[A2A receipt] task job-w done', '--task', 'w-rcpt'])
      expect(wireReceipt.code, wireReceipt.stderr).toBe(0)
      const localReceipt = await a.ctx.tools.get('a2a_route')?.execute({ team: handleOf(READER), message: '[A2A receipt] task job-l which?\n{"disposition":"attention"}' }, signal) as { ok?: boolean }
      expect(localReceipt?.ok, JSON.stringify(localReceipt)).toBe(true)

      const rows = await mail()
      const byText = (s: string) => rows.find(r => r.text.includes(s))!
      expect(byText('from a cli')).toMatchObject({ proof: 'cli-identity', task_id: 'w-cli' })
      expect(byText('from a cli').receipt_for).toBeUndefined()
      expect(byText('from the home host')).toMatchObject({ proof: 'in-process' })
      expect(byText('task job-w')).toMatchObject({ proof: 'cli-identity', receipt_for: 'job-w' })
      expect(byText('task job-l')).toMatchObject({ proof: 'in-process', receipt_for: 'job-l' })
      // Every wire row: the field is exactly the verdict its own header states; no local row has a header.
      const wire = rows.filter(r => r.text.startsWith('[A2A direct]'))
      expect(wire.length).toBe(3)
      for (const r of wire) expect(r.proof, r.text.slice(0, 120)).toBe(headerVerdict(r.text))
      expect(byText('from a peer session').proof).toBeDefined()
      for (const r of rows.filter(x => !x.text.startsWith('[A2A direct]'))) expect(r.proof).toBe('in-process')

      // thread hands the fields on to its reader.
      const thread = JSON.parse((await cli(homes[READER.name], ['thread', 'ctx-p'])).stdout) as { entries: Array<{ dir: string; proof?: string; task_id?: string }> }
      expect(thread.entries).toMatchObject([{ dir: 'in', task_id: 'w-cli', proof: 'cli-identity' }])
    } finally {
      await a.dispose()
      await b.dispose()
    }
  }, 90_000)
})
