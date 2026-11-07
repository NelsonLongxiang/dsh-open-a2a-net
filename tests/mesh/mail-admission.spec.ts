// @vitest-environment node
/**
 * superagent p1-mail-admission on a real host: each mailbox row carries the admission rule the host matched (a
 * deposited CLI caller cli-deposit, the host's own face local-exempt, a canvas-linked session canvas-shared), and
 * `a2a-net admission` recomputes it from the host's current links — answered to the identity itself only. The owner
 * removes the link on this (the Source's) home host and the recheck flips to not admitted. Throwaway keys; loopback.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync, sign as edSign, type KeyObject } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from '../temp-dirs.ts'
import { bootNode, cliEnv, postJson, reservePort, runContext, type MeshNode } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { admissionQueryPayload } from '../../src/cli-deposit.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

type Id = { name: string; uuid: string; key: KeyObject }
const ident = (name: string, uuid: string): Id => ({ name, uuid, key: generateKeyPairSync('ed25519').privateKey })
const handleOf = (id: Id) => `${id.name}/${id.uuid}`
const SRC = ident('adm-src', 'a1b2c3d4e5f60910')
const WRITER = ident('adm-w', 'a1b2c3d4e5f60911')
const SID = 'session-0123456789abcdef'
const SESSION_LABEL = 'dsh/01234567'

const control = async (node: MeshNode, body: unknown) => await (await postJson(node.baseUrl, '/__dsh_a2a/cli-deposit', body)).json() as Record<string, unknown>
const deposit = async (node: MeshNode, id: Id) => {
  const card = signCard({ name: id.name, session: `cli-${id.name}`, team: handleOf(id), capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, id.key)
  expect((await control(node, { action: 'publish', card: JSON.stringify(card) })).ok).toBe(true)
}
const send = async (node: MeshNode, from: Id, team: string, taskId: string) => {
  const callerUrl = `${node.baseUrl}/a2a/cli/${encodeURIComponent(handleOf(from))}`
  const ts = Date.now()
  const sig = edSign(undefined, Buffer.from(JSON.stringify([from.name, callerUrl, ts])), from.key).toString('base64')
  return await fetch(`${node.baseUrl}/a2a/direct`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-A2A-Caller': from.name, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': sig }, body: JSON.stringify({ team, message: `work ${taskId}`, caller_session: handleOf(from), task_id: taskId, context_id: `ctx-${taskId}`, wait: false }) }).then(r => r.json() as Promise<Record<string, unknown>>)
}
const mail = async (node: MeshNode, id: Id) => (await control(node, { action: 'inbox', handle: handleOf(id) }) as { mail: Array<{ task_id?: string; admission?: string; from: string }> }).mail
function cliHome(node: MeshNode, id: Id): string {
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
  const home = mkdtempSync(join(process.cwd(), 'tmp', 'mail-admission-'))
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name: id.name, uuid: id.uuid, handle: handleOf(id), home: node.baseUrl, privateKeyPem: id.key.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
  return home
}
const cli = (home: string, args: string[]) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
  let stdout = '', stderr = ''
  child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
  child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
})

describe('superagent p1-mail-admission', () => {
  it('rows carry the matched rule; the recheck follows the current links; only the identity itself is answered', async () => {
    const a = await bootNode({ name: 'A', session: 'mesh-admission', team: 'dsh', agentId: SID, sessionNodes: true, port: await reservePort() })
    try {
      for (const id of [SRC, WRITER]) await deposit(a, id)
      // A deposited CLI caller on this host.
      expect(await send(a, WRITER, handleOf(SRC), 'w-1')).toMatchObject({ delivered: true })
      // The host's own face (no session): local-exempt.
      const route = a.ctx.tools.get('a2a_route')! as unknown as { execute: (args: unknown, ctx: unknown) => Promise<Record<string, unknown>> }
      expect(await route.execute({ team: handleOf(SRC), message: 'from the host face', async: true }, runContext())).toMatchObject({ ok: true })
      // A joined session the owner linked with the Source in a canvas.
      expect((await postJson(a.baseUrl, '/__dsh_a2a/join', { id: SID })).status).toBe(200)
      for (const id of [SID, handleOf(SRC)]) expect((await (await postJson(a.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })).json() as { ok?: boolean }).ok).toBe(true)
      expect(await route.execute({ team: handleOf(SRC), message: 'from a linked session', async: true }, runContext(a.agents.agent))).toMatchObject({ ok: true })
      const rows = await mail(a, SRC)
      expect(rows.find(r => r.task_id === 'w-1')?.admission).toBe('cli-deposit')
      expect(rows.filter(r => r.from === 'unknown').map(r => r.admission)).toEqual(['local-exempt'])
      expect(rows.filter(r => r.from === SESSION_LABEL).map(r => r.admission)).toEqual(['canvas-shared'])

      // The recheck through the real CLI, under the Source's own identity.
      const home = cliHome(a, SRC)
      const ask = async (caller: string, local = false) => JSON.parse((await cli(home, ['admission', caller, ...(local ? ['--local'] : []), '--json'])).stdout) as Record<string, unknown>
      expect(await ask(handleOf(WRITER))).toEqual({ caller: handleOf(WRITER), admitted: true, rule: 'cli-deposit' })
      expect(await ask(SESSION_LABEL, true)).toEqual({ caller: SESSION_LABEL, admitted: true, rule: 'canvas-shared' })
      // The two faces judge differently: the host's own face (rows from "unknown") is local-exempt on the local face,
      // while the wire face admits no free-form label.
      expect(await ask('unknown', true)).toEqual({ caller: 'unknown', admitted: true, rule: 'local-exempt' })
      expect(await ask('unknown')).toEqual({ caller: 'unknown', admitted: false })
      // The owner removes the session from the canvas on this (the Source's) home host: the recheck sees it at once.
      expect((await (await postJson(a.baseUrl, '/__dsh_a2a/canvas', { action: 'remove-member', name: 'ops', id: SID })).json() as { ok?: boolean }).ok).toBe(true)
      const after = await ask(SESSION_LABEL, true)
      expect(after).toMatchObject({ caller: SESSION_LABEL, admitted: false })
      expect(after).not.toHaveProperty('rule')

      // Identity binding: another identity's key for the Source's handle, a tampered field, a stale stamp — all {ok:false}, nothing else.
      const query = (signer: Id, handle: string, caller: string, ts = Date.now(), sentCaller = caller) => control(a, { action: 'admission', handle, caller: sentCaller, ingress: 'wire', ts,
        sig: edSign(null, Buffer.from(admissionQueryPayload(handle, caller, 'wire', ts)), signer.key).toString('base64') })
      expect(await query(SRC, handleOf(SRC), handleOf(WRITER))).toEqual({ ok: true, admitted: true, rule: 'cli-deposit' })
      expect(await query(WRITER, handleOf(SRC), handleOf(WRITER))).toEqual({ ok: false })
      expect(await query(SRC, handleOf(SRC), handleOf(WRITER), Date.now(), SESSION_LABEL)).toEqual({ ok: false })
      expect(await query(SRC, handleOf(SRC), handleOf(WRITER), Date.now() - 10 * 60_000)).toEqual({ ok: false })
      expect(await control(a, { action: 'admission', handle: handleOf(SRC), caller: handleOf(WRITER), ingress: 'wire', ts: Date.now() })).toEqual({ ok: false })
      // The CLI under another identity can only ever ask about itself; asking with no caller is a usage error.
      expect((await cli(cliHome(a, WRITER), ['admission'])).code).toBe(2)
    } finally {
      await a.dispose()
    }
  }, 90_000)
})
