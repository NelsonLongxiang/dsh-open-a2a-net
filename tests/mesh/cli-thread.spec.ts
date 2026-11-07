// @vitest-environment node
/**
 * superagent p1-context-read on a real host: the host tags every mailbox
 * delivery with its task and context (wire face and local face), the CLI
 * journals the routes the host took, and `a2a thread <context_id>` reads one
 * conversation back from both sides — newest first, paged, read-only.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, cliEnv, reservePort } from './harness.ts'
import { signCard } from '../../src/card.ts'

const { privateKey } = generateKeyPairSync('ed25519')
const HANDLE = 'thread-cli/a1b2c3d4e5f60718'
const PEER = 'thread-peer/a1b2c3d4e5f60719'
const peerKey = generateKeyPairSync('ed25519').privateKey

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

type Entry = { dir: 'in' | 'out'; at: number; seq?: number; task_id?: string; from?: string; team?: string; text: string }
type Thread = { handle: string; context_id: string; entries: Entry[]; more: boolean; next_before: string | null; unscoped: number; mail_lost: number | null }

function cli(home: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
  })
}
const thread = async (home: string, args: string[]): Promise<Thread> => {
  const out = await cli(home, ['thread', ...args])
  expect(out.code, out.stderr).toBe(0)
  return JSON.parse(out.stdout) as Thread
}

describe('superagent p1: thread <context_id> (real host)', () => {
  it('tags mailbox rows on both faces, journals taken routes, and pages one conversation read-only', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-thread', team: 'dsh', sessionNodes: true, port: await reservePort() })
    try {
      const deposit = async (name: string, handle: string, key: typeof privateKey) => {
        const card = signCard({ name, session: `cli-${name}`, team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, key)
        const dep = await fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }) }).then(r => r.json() as Promise<{ ok?: boolean }>)
        expect(dep.ok).toBe(true)
      }
      await deposit('thread-cli', HANDLE, privateKey)
      await deposit('thread-peer', PEER, peerKey)
      // The peer CLI writes to the reader over the wire face, as the CLI does.
      const peerSend = async (message: string, taskId: string, contextId: string) => {
        const callerUrl = `${a.baseUrl}/a2a/cli/${encodeURIComponent(PEER)}`
        const ts = Date.now()
        const sig = edSign(undefined, Buffer.from(JSON.stringify(['thread-peer', callerUrl, ts])), peerKey).toString('base64')
        const r = await fetch(`${a.baseUrl}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': 'thread-peer', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': sig }, body: JSON.stringify({ team: HANDLE, message, caller_session: PEER, wait: false, task_id: taskId, context_id: contextId }) }).then(res => res.json() as Promise<{ delivered?: boolean; context_id?: string }>)
        expect(r.delivered, JSON.stringify(r)).toBe(true)
        expect(r.context_id).toBe(contextId)
      }
      const inboxOf = async (handle: string) => (await fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inbox', handle }) }).then(r => r.json())) as { mail: Array<{ seq: number; text: string; task_id?: string; context_id?: string }> }

      const home = mkdtempSync(join(tmpdir(), 'cli-thread-'))
      writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: 'thread-cli', uuid: 'a1b2c3d4e5f60718', handle: HANDLE, home: a.baseUrl, privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })

      await peerSend('ask one', 'peer-task-1', 'ctx-a')
      await peerSend('other talk', 'peer-task-2', 'ctx-b')
      // The local face: a session on the home host routes to the deposited handle in-process.
      const local = await a.ctx.tools.get('a2a_route')?.execute({ team: HANDLE, message: 'local note', context_id: 'ctx-a' }, { signal: new AbortController().signal } as never) as { ok?: boolean }
      expect(local?.ok, JSON.stringify(local)).toBe(true)
      // The reader answers in ctx-a; the host takes it, so it is journaled under that context.
      const routed = await cli(home, ['route', PEER, 'answer one', '--context', 'ctx-a', '--task', 'reader-task-1'])
      expect(routed.code, routed.stderr).toBe(0)
      await peerSend('ask two', 'peer-task-3', 'ctx-a')
      // A route without --context is journaled under the context the host chose and named in its reply.
      const fresh = await cli(home, ['route', PEER, 'new topic', '--task', 'reader-task-2', '--json'])
      expect(fresh.code, fresh.stderr).toBe(0)
      const freshCtx = (JSON.parse(fresh.stdout) as { context_id: string }).context_id
      expect(freshCtx).toMatch(/^ctx-/)

      // The host tagged the rows it mailed: the reader's (wire + local face) and the peer's.
      const mine = await inboxOf(HANDLE)
      expect(mine.mail.map(m => [m.context_id, m.task_id ?? null])).toEqual([['ctx-a', 'peer-task-3'], ['ctx-a', expect.any(String)], ['ctx-b', 'peer-task-2'], ['ctx-a', 'peer-task-1']])
      const theirs = await inboxOf(PEER)
      expect(theirs.mail.map(m => [m.context_id, m.task_id])).toEqual([[freshCtx, 'reader-task-2'], ['ctx-a', 'reader-task-1']])

      const all = await thread(home, ['ctx-a'])
      expect(all).toMatchObject({ handle: HANDLE, context_id: 'ctx-a', more: false, next_before: null, unscoped: 0, mail_lost: 0 })
      expect(all.entries.map(e => [e.dir, e.dir === 'in' ? e.task_id ?? e.seq : e.task_id])).toEqual([
        ['in', 'peer-task-3'], ['out', 'reader-task-1'], ['in', expect.anything()], ['in', 'peer-task-1'],
      ])
      expect(all.entries[1]).toMatchObject({ dir: 'out', team: PEER, text: 'answer one' })
      expect(all.entries[3].text).toContain('ask one')
      expect(all.entries[2].text).toContain('local note')
      // Pages: two, then the rest from the cursor the first page handed back — same rows, no repeats.
      const p1 = await thread(home, ['ctx-a', '--limit', '2'])
      expect(p1.more).toBe(true)
      expect(p1.next_before).not.toBeNull()
      const p2 = await thread(home, ['ctx-a', '--limit', '2', '--before', p1.next_before!])
      expect(p2).toMatchObject({ more: false, next_before: null })
      expect([...p1.entries, ...p2.entries]).toEqual(all.entries)

      expect((await thread(home, ['ctx-b'])).entries.map(e => e.text)).toEqual([expect.stringContaining('other talk')])
      expect((await thread(home, [freshCtx])).entries).toMatchObject([{ dir: 'out', task_id: 'reader-task-2', text: 'new topic' }])
      expect((await thread(home, ['ctx-none'])).entries).toEqual([])
      // Read-only: no inbox cursor appears, and the journal holds exactly the two taken routes.
      expect(existsSync(join(home, 'inbox.cursor'))).toBe(false)
      expect(readFileSync(join(home, 'sent.jsonl'), 'utf8').trim().split('\n').map(l => (JSON.parse(l) as { task_id: string }).task_id)).toEqual(['reader-task-1', 'reader-task-2'])
    } finally {
      await a.dispose()
    }
  }, 60_000)
})
