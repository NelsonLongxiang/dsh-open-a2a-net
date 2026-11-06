// @vitest-environment node
/**
 * superagent p1-receipt-cmd on a real host: `a2a receipt <task_id>` is the one
 * formal-receipt shape for a CLI identity. It finds the sender in the mailbox and
 * carries disposition result / attention in the v2 envelope, which the host
 * lifts onto the receiver's mailbox row. A task gets one receipt: a second,
 * different one is refused by idempotency. Where the caller holds an owed row,
 * an attention receipt settles it without an outcome — never shown as completed.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, cliEnv, postJson, reservePort, runContext, tmpHome } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { TaskLedger } from '../../src/task-ledger.ts'

const WORKER = { name: 'rcpt-worker', uuid: 'a1b2c3d4e5f60718', key: generateKeyPairSync('ed25519').privateKey }
const ASKER = { name: 'rcpt-asker', uuid: 'a1b2c3d4e5f60719', key: generateKeyPairSync('ed25519').privateKey }
const handleOf = (id: typeof WORKER) => `${id.name}/${id.uuid}`

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

type Archived = { taskId: string; outcome?: string; disposition?: string; endedBy?: string }
type Mail = { text: string; task_id?: string; context_id?: string; disposition?: string }

describe('superagent p1: receipt <task_id> (real host)', () => {
  it('reaches the asker with disposition result or attention, one receipt per task', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-receipt', team: 'dsh', sessionNodes: true, port: await reservePort() })
    try {
      const homes: Record<string, string> = {}
      for (const id of [WORKER, ASKER]) {
        const card = signCard({ name: id.name, session: `cli-${id.name}`, team: handleOf(id), capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, id.key)
        const dep = await fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }) }).then(r => r.json() as Promise<{ ok?: boolean }>)
        expect(dep.ok).toBe(true)
        const home = mkdtempSync(join(tmpdir(), 'cli-receipt-'))
        writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: id.name, uuid: id.uuid, handle: handleOf(id), home: a.baseUrl, privateKeyPem: id.key.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
        homes[id.name] = home
      }
      const ask = async (task: string, text: string) => {
        const out = await cli(homes[ASKER.name], ['route', handleOf(WORKER), text, '--task', task, '--context', `ctx-${task}`])
        expect(out.code, out.stderr).toBe(0)
      }
      const askerMail = async (): Promise<Mail[]> => ((await fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inbox', handle: handleOf(ASKER) }) }).then(r => r.json())) as { mail: Mail[] }).mail

      await ask('job-1', 'please build it')
      await ask('job-2', 'which branch?')
      // Result: the worker names only the task; the target is the mailbox row's sender.
      const done = await cli(homes[WORKER.name], ['receipt', 'job-1', 'built', 'and', 'tested'])
      expect(done.code, done.stderr).toBe(0)
      expect(done.stdout).toContain(`delivered → ${handleOf(ASKER)} · task receipt-job-1`)
      const q = await cli(homes[WORKER.name], ['receipt', 'job-2', '--attention', 'main or next/0.8?', '--json'])
      expect(q.code, q.stderr).toBe(0)
      expect(JSON.parse(q.stdout)).toMatchObject({ delivered: true, class: 'sent', task_id: 'receipt-job-2', context_id: 'ctx-job-2' })

      // The asker branches on the field, not the text; the receipt rides the task's own context.
      const mail = await askerMail()
      const attention = mail.find(m => m.text.includes('task job-2'))
      expect(attention).toMatchObject({ disposition: 'attention', context_id: 'ctx-job-2', task_id: 'receipt-job-2' })
      expect(attention!.text).toContain('[A2A receipt] task job-2 main or next/0.8?\n{"idempotencyKey":"job-2","disposition":"attention"}')
      const result = mail.find(m => m.text.includes('task job-1'))
      expect(result).toMatchObject({ disposition: 'result', context_id: 'ctx-job-1' })
      expect(result!.text).toContain('[A2A receipt] task job-1 built and tested\n{"outcome":"completed","idempotencyKey":"job-1","disposition":"result"}')

      // One receipt per task: a later, different receipt (attention first, result after) is refused.
      const second = await cli(homes[WORKER.name], ['receipt', 'job-2', 'answered myself'])
      expect(second.code).toBe(1)
      expect(second.stderr).toContain('a task gets one receipt')
      // Resending the same receipt is a replay, not a second delivery.
      const again = await cli(homes[WORKER.name], ['receipt', 'job-2', '--attention', 'main or next/0.8?'])
      expect(again.code, again.stderr).toBe(0)
      expect(again.stdout).toContain('already received')
      expect((await askerMail()).filter(m => m.text.includes('task job-2'))).toHaveLength(1)

      // The local face lifts the field too: a session on the home host hands back a question in-process.
      const local = await a.ctx.tools.get('a2a_route')?.execute({ team: handleOf(ASKER), message: '[A2A receipt] task job-9 local question\n{"idempotencyKey":"job-9","disposition":"attention"}' }, { signal: new AbortController().signal } as never) as { ok?: boolean }
      expect(local?.ok, JSON.stringify(local)).toBe(true)
      expect((await askerMail()).find(m => m.text.includes('task job-9'))).toMatchObject({ disposition: 'attention' })
      // A message that is not a receipt carries no disposition, whatever its text says.
      await ask('job-3', '{"disposition":"attention"}')
      const plain = await cli(homes[WORKER.name], ['inbox', '--json'])
      expect((JSON.parse(plain.stdout) as Mail[]).find(m => m.task_id === 'job-3')?.disposition).toBeUndefined()

      // The worker's own thread shows the receipt it sent in that context.
      const thread = JSON.parse((await cli(homes[WORKER.name], ['thread', 'ctx-job-2'])).stdout) as { entries: Array<{ dir: string; task_id?: string }> }
      expect(thread.entries.map(e => [e.dir, e.task_id])).toEqual([['out', 'receipt-job-2'], ['in', 'job-2']])
      // No sender to find and no --to: refused before anything is sent.
      const orphan = await cli(homes[WORKER.name], ['receipt', 'job-unknown', 'done'])
      expect(orphan.code).toBe(2)
      expect(orphan.stderr).toContain('pass --to <team>')
    } finally {
      await a.dispose()
    }
  }, 60_000)

  it('an owed row an attention receipt settles reads unclassified + attention on every view, never completed', async () => {
    const SID = 'session-aaaaaaaa11112222'
    const home = tmpHome()
    mkdirSync(join(home, 'a2a'), { recursive: true })
    // The owed rows and their receipts go through the real ledger; the node then boots on that file.
    const ledger = new TaskLedger(join(home, 'a2a', 'tasks.json'))
    ledger.track('owed-q', 'dsh/bbbbbbbb', 'http://peer', 'ctx-q', 'ask a question')
    ledger.track('owed-r', 'dsh/bbbbbbbb', 'http://peer', 'ctx-r', 'do the work')
    ledger.resolveFromMessage('[A2A receipt] task owed-q which branch?\n{"idempotencyKey":"owed-q","disposition":"attention"}')
    ledger.resolveFromMessage('[A2A receipt] task owed-r done\n{"outcome":"completed","idempotencyKey":"owed-r","disposition":"result"}')
    const a = await bootNode({ name: 'A', session: 'mesh-receipt-ledger', team: 'dsh', agentId: SID, sessionNodes: true, home, port: await reservePort() })
    try {
      expect((await postJson(a.baseUrl, '/__dsh_a2a/join', { id: SID })).status).toBe(200)
      const s = await fetch(`${a.baseUrl}/__dsh_a2a/state`).then(r => r.json()) as { archived: Archived[] }
      expect(s.archived.find(r => r.taskId === 'owed-q')).toMatchObject({ outcome: 'unclassified', disposition: 'attention', endedBy: 'receipt' })
      expect(s.archived.find(r => r.taskId === 'owed-r')).toMatchObject({ outcome: 'completed', disposition: 'result' })
      const cliHome = mkdtempSync(join(tmpdir(), 'cli-receipt-tasks-'))
      const tasks = await cli(cliHome, ['tasks', '--home', a.baseUrl])
      expect(tasks.stdout).toContain('owed-q unclassified disposition=attention')
      expect(tasks.stdout).toContain('owed-r completed disposition=result')
      const tool = a.ctx.tools.get('a2a_tasks')! as unknown as { execute: (args: unknown, ctx: unknown) => Promise<{ archive: Archived[] }>; output: { render: (args: unknown, value: unknown) => Array<{ text: string }> } }
      const view = await tool.execute({}, runContext(a.agents.agent))
      expect(view.archive.find(r => r.taskId === 'owed-q')).toMatchObject({ disposition: 'attention' })
      const text = tool.output.render({}, view)[0]!.text
      expect(text).toMatch(/owed-q .*which branch\? \[attention: settled with a question, not completed\]/)
      expect(text).not.toMatch(/owed-r .*\[attention/)
    } finally {
      await a.dispose()
    }
  }, 60_000)
})
