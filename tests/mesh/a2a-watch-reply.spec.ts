// @vitest-environment node
/**
 * superagent a2a Source in reply mode (p3-source-explicit) against a real loopback host and the real `a2a-net` CLI:
 * - a linked CLI caller's task gets one formal receipt that settles the caller's debt (the Source declares owes);
 * - the next message of the same task arrives as a new a2a- task in the same context;
 * - a session the owner linked in a canvas loses its link on the Source's home host, and the next reply is gone,
 *   with nothing sent (the recheck is ours, not the peer host's: O1, v1.1 item 4).
 * Throwaway keys in tmp/ homes (mode 0600); loopback only; nothing is logged.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from '../temp-dirs.ts'
import { bootNode, cliEnv, postJson, reservePort, runContext, type MeshNode } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { KV, pollMailbox, renewDeposit, scope, sendReply, type A2aConfig } from '../../src/superagent/a2a-watch.ts'
import { key, type Commands, type Health, type OutboundMessage, type SourceContext, type Trigger } from '../../src/superagent/source-types.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

type Id = { name: string; uuid: string; key: KeyObject }
const ident = (name: string, uuid: string): Id => ({ name, uuid, key: generateKeyPairSync('ed25519').privateKey })
const handleOf = (id: Id) => `${id.name}/${id.uuid}`
const SRC = ident('reply-src', 'a1b2c3d4e5f60920')
const WRITER = ident('reply-w', 'a1b2c3d4e5f60921')
const SID = 'session-0123456789abcdef'
const SESSION_LABEL = 'dsh/01234567'
const REPLY: A2aConfig = { mode: 'reply', pollSeconds: 30, renewMinutes: 60 }

function cli(home: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
    let stdout = '', stderr = ''
    child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
  })
}
/** superagent's Commands: a failed command throws an error that keeps the exit code and drops stdout (CliError, G3). */
function commandsFor(home: string, runs: string[][]): Commands {
  const commands: Commands = {
    withSignal: () => commands,
    run: async (program, args) => {
      if (program !== 'a2a-net') throw new Error(`unexpected program ${program}`)
      runs.push(args)
      const out = await cli(home, args)
      if (out.code !== 0) throw Object.assign(new Error(`a2a-net exited ${String(out.code)}`), { exitCode: out.code })
      return out.stdout
    },
  }
  return commands
}
function cliHome(node: MeshNode, id: Id): string {
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
  const home = mkdtempSync(join(process.cwd(), 'tmp', 'p3-reply-'))
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: id.name, uuid: id.uuid, handle: handleOf(id), home: node.baseUrl, privateKeyPem: id.key.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
  return home
}
const control = async (node: MeshNode, body: unknown) => await (await postJson(node.baseUrl, '/__dsh_a2a/cli-deposit', body)).json() as Record<string, unknown>
const deposit = async (node: MeshNode, id: Id) => {
  const card = signCard({ name: id.name, session: `cli-${id.name}`, team: handleOf(id), capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, id.key)
  expect((await control(node, { action: 'publish', card: JSON.stringify(card) })).ok).toBe(true)
}
const mail = async (node: MeshNode, id: Id) => (await control(node, { action: 'inbox', handle: handleOf(id) }) as { mail: Array<Record<string, unknown>> }).mail

describe('superagent p3: a2a Source replies on a real host', () => {
  it('one receipt settles a linked caller, the next message is a new a2a- task in its context, and an unlinked caller gets nothing', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-p3-reply', team: 'dsh', agentId: SID, sessionNodes: true, port: await reservePort() })
    try {
      for (const id of [SRC, WRITER]) await deposit(a, id)
      const srcHome = cliHome(a, SRC)
      const writerHome = cliHome(a, WRITER)
      const runs: string[][] = []
      const state = new Map<string, unknown>()
      const reports: Array<[string, Health]> = []
      const taken: Trigger[] = []
      const ctx: SourceContext = {
        commands: commandsFor(srcHome, runs), ready: Promise.resolve(), configured: () => true,
        config: <C extends Record<string, unknown>>() => REPLY as unknown as C,
        receive: async trigger => { taken.push(trigger); return scope(trigger).listened ? 'stored' : 'filtered' },
        state: { get: <V>(k: string) => state.get(k) as V | undefined, set: (k, v) => { if (v === undefined) state.delete(k); else state.set(k, v) } },
        threads: { describe: () => {} },
        tickets: { get: () => undefined },
        report: (entry, h) => { reports.push([entry, h]) },
      }
      // Reply mode renews with --owes (S33): the caller's route below is booked as a debt the receipt must settle.
      expect(await renewDeposit(ctx, REPLY, new AbortController().signal)).toBe(true)
      expect(runs).toEqual([['publish', '--owes']])

      // 1. A deposited CLI caller (cli-identity + cli-deposit: linked).
      expect((await cli(writerHome, ['route', handleOf(SRC), 'please build it', '--task', 'w-1', '--context', 'ctx-w'])).code).toBe(0)
      const owed = JSON.parse((await cli(writerHome, ['tasks', '--json'])).stdout) as { pending: Array<{ taskId: string }> }
      expect(owed.pending.map(t => t.taskId)).toContain('w-1')
      await pollMailbox(ctx, new AbortController().signal)
      const fromWriter = taken.find(t => t.meta.taskId === 'w-1')!
      expect(scope(fromWriter)).toEqual({ listened: true, observed: false, row: 'mailbox' })
      const reply = (id: string, text: string, t: Trigger): OutboundMessage => ({ id, channel: t.channel!, text, kind: 'reply' })

      runs.length = 0
      expect(await sendReply(ctx, ctx.commands, reply('reply:first', 'the PR is ready', fromWriter))).toBe('sent')
      expect(runs.map(r => r[0])).toEqual(['admission', 'receipt'])
      expect(state.get(KV.answered)).toHaveProperty('w-1')
      await vi.waitFor(async () => {
        const after = JSON.parse((await cli(writerHome, ['tasks', '--json'])).stdout) as { pending: Array<{ taskId: string }>; archived: Array<{ taskId: string; outcome?: string }> }
        expect(after.pending.map(t => t.taskId)).not.toContain('w-1')
        expect(after.archived.find(t => t.taskId === 'w-1')).toMatchObject({ outcome: 'completed' })
      }, { timeout: 20_000 })
      // The same receipt again (a crash before the record): the host's fixed receipt id keeps it to one, and it counts as sent.
      state.delete(KV.answered)
      expect(await sendReply(ctx, ctx.commands, reply('reply:first', 'the PR is ready', fromWriter))).toBe('sent')
      expect((await mail(a, WRITER)).filter(r => r.receipt_for === 'w-1')).toHaveLength(1)

      // 2. The next message of the task: a new task with an a2a- id, in the caller's context.
      runs.length = 0
      expect(await sendReply(ctx, ctx.commands, reply('reply:second', 'merged now', fromWriter))).toBe('sent')
      expect(runs.map(r => r[0])).toEqual(['admission', 'route'])
      const followUp = (await mail(a, WRITER)).find(r => r.task_id === `a2a-${key('reply:second')}`)
      expect(followUp).toMatchObject({ context_id: 'ctx-w', from: handleOf(SRC) })
      expect(String(followUp!.text)).toContain('merged now')

      // 3. A session the owner linked with the Source in a canvas, then unlinked on this (the Source's) home host.
      expect((await postJson(a.baseUrl, '/__dsh_a2a/join', { id: SID })).status).toBe(200)
      for (const id of [SID, handleOf(SRC)]) expect((await (await postJson(a.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })).json() as { ok?: boolean }).ok).toBe(true)
      const route = a.ctx.tools.get('a2a_route')! as unknown as { execute: (args: unknown, ctx: unknown) => Promise<Record<string, unknown>> }
      expect(await route.execute({ team: handleOf(SRC), message: 'from a linked session', async: true }, runContext(a.agents.agent))).toMatchObject({ ok: true })
      await pollMailbox(ctx, new AbortController().signal)
      const fromSession = taken.find(t => t.actor.id === SESSION_LABEL)!
      expect(fromSession.meta).toMatchObject({ proof: 'in-process', admission: 'canvas-shared' })
      expect(fromSession.channel!.address.ingress).toBe('local')
      expect((await (await postJson(a.baseUrl, '/__dsh_a2a/canvas', { action: 'remove-member', name: 'ops', id: SID })).json() as { ok?: boolean }).ok).toBe(true)
      runs.length = 0
      expect(await sendReply(ctx, ctx.commands, reply('reply:session', 'done', fromSession))).toBe('gone')
      expect(runs).toEqual([['admission', SESSION_LABEL, '--local', '--json']])
      expect(reports).toEqual([['a2a-reply', expect.objectContaining({ state: 'error', detail: expect.stringContaining('no longer linked') })]])
      expect(state.get(KV.answered)).not.toHaveProperty(String(fromSession.meta.taskId))
    } finally {
      await a.dispose()
    }
  }, 120_000)
})
