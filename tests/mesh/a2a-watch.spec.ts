// @vitest-environment node
/**
 * superagent a2a Source (p2a-source-code) against a real loopback host and the real `a2a-net` CLI: the Source's own
 * deposited identity reads its mailbox with `inbox --after`, translates rows into Triggers, judges trust from the host's
 * `proof` and `admission` fields only (p3: a trusted proof plus an operator link), keeps its cursor, replays without second Triggers, renews its deposit and reads thread context.
 * Temporary homes live under tmp/ (gitignored) and are removed when the file's tests end (tests/temp-dirs.ts). Each holds a
 * throwaway test identity's private key in cli.json (mode 0600), as the CLI keeps one; no real key, host token or A2A_KEY
 * is written anywhere, and nothing is logged. No production host is contacted: the host runs on loopback.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from '../temp-dirs.ts'
import { bootNode, cliEnv, reservePort } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { a2aKind, KV, pollMailbox, renewDeposit, scope, watch, type A2aConfig } from '../../src/superagent/a2a-watch.ts'
import { key, type Health, type SourceContext, type Trigger } from '../../src/superagent/source-types.ts'

const SOURCE = { name: 'shadow-src', uuid: 'a1b2c3d4e5f60718', key: generateKeyPairSync('ed25519').privateKey }
const WRITER = { name: 'shadow-writer', uuid: 'a1b2c3d4e5f60719', key: generateKeyPairSync('ed25519').privateKey }
const handleOf = (id: typeof SOURCE) => `${id.name}/${id.uuid}`
const OBSERVE: A2aConfig = { mode: 'observe', pollSeconds: 30, renewMinutes: 60 }

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

/** superagent's Commands as the Source sees it: `a2a-net` is the real CLI under the Source identity's home. */
function commandsFor(home: string) {
  const commands = {
    withSignal: () => commands,
    run: async (program: string, args: string[]) => {
      if (program !== 'a2a-net') throw new Error(`unexpected program ${program}`)
      const out = await cli(home, args)
      if (out.code !== 0) throw new Error(`a2a-net exited ${String(out.code)}`)
      return out.stdout
    },
  }
  return commands
}

describe('superagent p2a: a2a Source on a real host (shadow mode)', () => {
  it('reads its mailbox, trusts only host proof, keeps its cursor, replays without second Triggers', async () => {
    mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
    const a = await bootNode({ name: 'A', session: 'mesh-a2a-watch', team: 'dsh', sessionNodes: true, port: await reservePort() })
    try {
      const homes: Record<string, string> = {}
      for (const id of [SOURCE, WRITER]) {
        const card = signCard({ name: id.name, session: `cli-${id.name}`, team: handleOf(id), capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, id.key)
        const dep = await fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }) }).then(r => r.json() as Promise<{ ok?: boolean }>)
        expect(dep.ok).toBe(true)
        const home = mkdtempSync(join(process.cwd(), 'tmp', 'p2a-a2a-watch-'))
        writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: id.name, uuid: id.uuid, handle: handleOf(id), home: a.baseUrl, privateKeyPem: id.key.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
        homes[id.name] = home
      }
      const signal = { signal: new AbortController().signal } as never
      // The host's own face (in-process, but local-exempt: no link), a deposited CLI caller (cli-identity + cli-deposit: a
      // linked caller since S36), and an in-process receipt from the host face (unlinked before it is a receipt).
      expect((await a.ctx.tools.get('a2a_route')?.execute({ team: handleOf(SOURCE), message: 'from the home host', context_id: 'ctx-local' }, signal) as { ok?: boolean })?.ok).toBe(true)
      expect((await cli(homes[WRITER.name], ['route', handleOf(SOURCE), 'from a cli', '--task', 'w-1', '--context', 'ctx-cli'])).code).toBe(0)
      expect((await a.ctx.tools.get('a2a_route')?.execute({ team: handleOf(SOURCE), message: '[A2A receipt] task job-1 done' }, signal) as { ok?: boolean })?.ok).toBe(true)

      const state = new Map<string, unknown>()
      const ids = new Set<string>()
      const taken: Array<{ trigger: Trigger; result: string }> = []
      const reports: Array<[string, Health]> = []
      const ctx: SourceContext = {
        commands: commandsFor(homes[SOURCE.name]), ready: Promise.resolve(), configured: () => true,
        config: <C extends Record<string, unknown>>() => OBSERVE as unknown as C,
        // The Engine's intake as far as the Source can see it: stored once by id, filtered by the kind's scope.
        receive: async trigger => {
          const result = ids.has(trigger.id) ? 'duplicate' : scope(trigger).listened ? 'stored' : 'filtered'
          ids.add(trigger.id); taken.push({ trigger, result }); return result as 'stored' | 'duplicate' | 'filtered'
        },
        state: { get: <V>(k: string) => state.get(k) as V | undefined, set: (k, v) => { if (v === undefined) state.delete(k); else state.set(k, v) } },
        threads: { describe: () => {} },
        tickets: { get: () => undefined },
        report: (entry, h) => { reports.push([entry, h]) },
      }

      const first = await pollMailbox(ctx, new AbortController().signal)
      expect(first).toMatchObject({ read: 3, triggers: 3, duplicateCopies: 0, unreadable: 0 })
      expect(reports).toEqual([])
      const byText = (s: string) => taken.find(t => t.trigger.text.includes(s))!
      const local = byText('from the home host')
      expect(local.trigger.meta).toMatchObject({ proof: 'in-process', admission: 'local-exempt', contextId: 'ctx-local', s13Strength: 'explicit-if-allowed' })
      expect(local.trigger.id).toBe(key('a2a', local.trigger.actor.id, String(local.trigger.meta.taskId)))
      expect(local).toMatchObject({ result: 'filtered', trigger: { human: false, addressed: 'direct', threads: [{ source: 'a2a', id: 'ctx-local' }] } })
      expect(scope(local.trigger)).toEqual({ listened: false, reason: 'unlinked' })
      expect(byText('from a cli')).toMatchObject({ result: 'stored', trigger: { actor: { id: handleOf(WRITER) }, meta: { proof: 'cli-identity', admission: 'cli-deposit', taskId: 'w-1' } } })
      expect(scope(byText('task job-1').trigger)).toEqual({ listened: false, reason: 'unlinked' })
      // D1: one record per mailbox row, in seq order, without the text.
      const records = state.get(KV.rows) as Array<{ seq: number; outcome: string; task_id: string | null }>
      expect(records.map(r => r.outcome)).toEqual(taken.slice(0, 3).map(t => scope(t.trigger).listened ? 'stored' : `filtered:${(scope(t.trigger) as { reason: string }).reason}`))
      expect(records.map(r => r.seq)).toEqual([1, 2, 3])
      expect((records as Array<{ proof: string | null; receipt_for: string | null; admission: string | null }>).map(r => [r.proof, r.receipt_for, r.admission])).toEqual([['in-process', null, 'local-exempt'], ['cli-identity', null, 'cli-deposit'], ['in-process', 'job-1', 'local-exempt']])
      expect(JSON.stringify(records)).not.toContain('from the home host')
      const cursor = state.get(KV.cursor)
      expect(cursor).toMatch(/^[^:]+:3$/)

      // Caught up: nothing new, the cursor stays.
      expect(await pollMailbox(ctx, new AbortController().signal)).toMatchObject({ read: 0, triggers: 0, next: cursor })
      // A replay from the start (a lost cursor) makes no second Trigger.
      state.delete(KV.cursor)
      expect(await pollMailbox(ctx, new AbortController().signal)).toMatchObject({ read: 3, triggers: 3 })
      expect(taken.slice(3).map(t => t.result)).toEqual(['duplicate', 'duplicate', 'duplicate'])
      expect((state.get(KV.rows) as unknown[]).length).toBe(3)
      // Plan P: a header for each read that brought rows (the first and the replay), none of them a loss, and one heartbeat
      // (the first round: none before it) — the caught-up empty read writes nothing.
      const pages = state.get(KV.pages) as Array<{ lost: number | null; epochChanged: boolean; heartbeat?: true; rounds?: number; rows?: number }>
      expect(pages.map(p => [p.lost, p.epochChanged, p.heartbeat ?? false])).toEqual([[0, false, false], [0, false, true], [0, false, false]])
      expect(pages[1]).toMatchObject({ rounds: 1, rows: 3 })

      // Thread context through the real `a2a-net thread`.
      const part = await a2aKind.threadContext.read(ctx.commands, local.trigger, 'thread', undefined, OBSERVE)
      expect(part.messages).toEqual([expect.objectContaining({ from: local.trigger.actor.id, text: expect.stringContaining('from the home host'), bot: true })])
      // The deposit renews through the real `a2a-net publish`.
      expect(await renewDeposit(ctx, OBSERVE, new AbortController().signal)).toBe(true)
      expect(typeof state.get(KV.renewedAt)).toBe('number')
      // Shadow mode: no reply can go anywhere.
      expect(a2aKind.channel.allowed(byText('from a cli').trigger.channel!.address, OBSERVE)).toBe(false)

      // superagent awaiting setup (no GitHub repository yet): observe mode still reads the real mailbox and takes every row
      // in, while the Engine holds evaluation and sending; a non-observe mode waits for setup and runs nothing.
      const pending = new Map<string, unknown>()
      const pendingReports: Array<[string, Health]> = []
      const pendingTaken: Trigger[] = []
      const awaiting = (config: A2aConfig): SourceContext => ({ ...ctx, configured: () => false, config: <C extends Record<string, unknown>>() => config as unknown as C,
        receive: async trigger => { pendingTaken.push(trigger); return scope(trigger).listened ? 'stored' : 'filtered' },
        state: { get: <V>(k: string) => pending.get(k) as V | undefined, set: (k, v) => { if (v === undefined) pending.delete(k); else pending.set(k, v) } },
        report: (entry, h) => { pendingReports.push([entry, h]) } })
      const stop = new AbortController()
      const run = watch(awaiting(OBSERVE), stop.signal)
      await vi.waitFor(() => { expect(pendingReports.some(([entry, h]) => entry === 'a2a' && h.state === 'ready')).toBe(true) }, { timeout: 30_000 })
      stop.abort(); await run
      expect(pendingReports.some(([, h]) => h.code === 'setupPending')).toBe(false)
      expect(pendingTaken.map(t => t.meta.proof)).toEqual(['in-process', 'cli-identity', 'in-process'])
      const gated: Array<[string, Health]> = []
      const commandsSeen: string[][] = []
      await watch({ ...awaiting({ ...OBSERVE, mode: 'reply' } as unknown as A2aConfig), report: (entry, h) => { gated.push([entry, h]) },
        commands: { withSignal: () => ({ withSignal: () => { throw new Error('unused') }, run: async (_p: string, args: string[]) => { commandsSeen.push(args); return '' } }), run: async () => '' } as never }, new AbortController().signal)
      expect(gated).toEqual([['a2a', expect.objectContaining({ state: 'paused', code: 'setupPending' })]])
      expect(commandsSeen).toEqual([])
    } finally {
      await a.dispose()
    }
  }, 90_000)
})
