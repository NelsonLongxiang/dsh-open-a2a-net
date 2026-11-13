// @vitest-environment node
/**
 * docs/design/superagent-pi-platform.md PR-C, end to end with the real CLI: a Pi seat publishes with --pi-seat, the owner
 * adds it to the team canvas, its work arrives in its mailbox (as `inbox --after` reads it, with the ticket as task_id),
 * and its `ticket` ops (signed, body-bound) reach the team. An identity that is not the seat is refused; `pi install`
 * copies the extension and never overwrites without --force.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from '../temp-dirs.ts'
import { bootNode, cliEnv, postJson, runContext, tmpHome, type MeshNode } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const R_ID = 'session-aaaaaaaa00001111'
const cli = (home: string, args: string[]) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
  const child = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: cliEnv(home) })
  let stdout = '', stderr = ''
  child.stdout.on('data', d => { stdout += String(d) }); child.stderr.on('data', d => { stderr += String(d) })
  child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }))
})
function identityHome(node: MeshNode, name: string, uuid: string): string {
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true })
  const home = mkdtempSync(join(process.cwd(), 'tmp', 'pi-seat-'))
  const { privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(join(home, 'cli.json'), JSON.stringify({ name, uuid, handle: `${name}/${uuid}`, home: node.baseUrl, privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
  return home
}
const json = async (r: Response): Promise<Record<string, any>> => await r.json() as Record<string, any>

describe('a Pi seat through the CLI', () => {
  it('publishes as a seat, receives its work by mailbox, answers with ticket ops; others are refused; pi install', async () => {
    const A = await bootNode({ name: 'A', session: 'hostA', team: 'dsh', agentId: R_ID, home: tmpHome(), sessionNodes: true, superagent: true } as never)
    try {
      expect((await postJson(A.baseUrl, '/__dsh_a2a/join', { id: R_ID })).status).toBe(200)
      const seat = identityHome(A, 'fleet-pi', '0123456789abcdef'), other = identityHome(A, 'req-cli', 'fedcba9876543210')
      const SEAT = 'fleet-pi/0123456789abcdef', OTHER = 'req-cli/fedcba9876543210'
      expect((await cli(seat, ['publish', '--pi-seat'])).code).toBe(0)
      expect((await cli(other, ['publish'])).code).toBe(0)
      const canvas = async (body: unknown): Promise<Record<string, any>> => await json(await postJson(A.baseUrl, '/__dsh_a2a/canvas', body))
      expect(await canvas({ action: 'add-member', name: 'team', id: R_ID })).toMatchObject({ ok: true })
      expect(await json(await postJson(A.baseUrl, '/__dsh_a2a/superagent', { action: 'settings', settings: { canvas: 'team', router: R_ID } }))).toMatchObject({ ok: true })
      expect(await canvas({ action: 'add-member', name: 'team', id: SEAT })).toMatchObject({ ok: true })
      expect(await canvas({ action: 'add-member', name: 'team', id: OTHER })).toMatchObject({ ok: false, error: expect.stringContaining('not a Pi seat') })

      // A request becomes a ticket; the seat is the only worker, so its work lands in its mailbox.
      const asked = await json(await postJson(A.baseUrl, '/__dsh_a2a/superagent', { action: 'request', text: '给 Pi 席位的活' }))
      await vi.waitFor(() => { expect(A.steered.some(p => String(typeof p === 'string' ? p : JSON.stringify(p)).includes(asked.triggerId))).toBe(true) }, { timeout: 10_000 })
      const routed = await A.ctx.tools.get('superagent_route')!.execute({ items: [{ trigger_id: asked.triggerId, kind: 'accept', title: 'pi 活', scope: '小', reason: '属主' }] }, runContext(A.agents.agent)) as Record<string, any>
      const ticketId = routed.results[0].ticket_id as string
      let read: Record<string, any> = {}
      await vi.waitFor(async () => {
        const out = await cli(seat, ['inbox', '--after', 'start'])
        read = JSON.parse(out.stdout) as Record<string, any>
        expect(read.mail.some((m: any) => m.from === 'superagent' && m.task_id === ticketId)).toBe(true)
      }, { timeout: 10_000 })
      const card = read.mail.find((m: any) => m.task_id === ticketId)
      expect(card.text).toContain('[superagent assignment]')
      expect(card.text).toContain(`a2a-net ticket report --ticket ${ticketId}`)

      // Its signed, body-bound ops reach the team. A question is a decision card: a bare one never leaves the CLI, and one
      // with options and a recommendation reaches the owner as a card.
      expect(JSON.parse((await cli(seat, ['ticket', 'read', '--json'])).stdout)).toEqual({ ok: true })
      expect((await cli(seat, ['ticket', 'report', '--ticket', ticketId, '--state', 'waiting', '--question', '用哪种?', '--', '要你定'])).code).toBe(2)
      expect((await cli(seat, ['ticket', 'report', '--ticket', ticketId, '--state', 'waiting', '--question', '用哪种?', '--options', '甲|乙', '--recommended', '丙', '--', '要你定'])).code).toBe(2)
      const asks = await cli(seat, ['ticket', 'report', '--ticket', ticketId, '--state', 'waiting', '--question', '用哪种?', '--options', '甲|乙', '--recommended', '乙', '--level', 'P1', '--json', '--', '要你定'])
      expect(JSON.parse(asks.stdout), asks.stdout + asks.stderr).toMatchObject({ ok: true })
      const cards = (await json(await globalThis.fetch(`${A.baseUrl}/__dsh_a2a/superagent/decisions`))).decisions as Array<Record<string, any>>
      expect(cards.find(c => c.ticketId === ticketId)).toMatchObject({ options: ['甲', '乙'], recommended: '乙', level: 'P1' })
      const reported = await cli(seat, ['ticket', 'report', '--ticket', ticketId, '--state', 'ready', '--json', '--', '做完了'])
      expect(JSON.parse(reported.stdout), reported.stdout + reported.stderr).toMatchObject({ ok: true })
      expect((await cli(seat, ['ticket', 'idle'])).code).toBe(0)
      // A CLI identity that is not the seat is refused, with the code; rule changes are not a seat's op at all.
      const refused = await cli(other, ['ticket', 'idle', '--json'])
      expect(refused.code).toBe(1)
      expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, code: 'not-member' })
      expect((await cli(seat, ['ticket', 'rules-apply'])).code).toBe(2)

      // pi install copies the shipped extension; it does not overwrite without --force.
      const dir = mkdtempSync(join(process.cwd(), 'tmp', 'pi-ext-'))
      const installed = await cli(seat, ['pi', 'install', '--dir', dir])
      expect(installed.code, installed.stderr).toBe(0)
      expect(readFileSync(join(dir, 'a2a-seat.ts'), 'utf8')).toBe(readFileSync(join(process.cwd(), 'pi/extension/a2a-seat.ts'), 'utf8'))
      expect(installed.stdout).toContain('installing does not join a team')
      expect((await cli(seat, ['pi', 'install', '--dir', dir])).code).toBe(1)
      expect((await cli(seat, ['pi', 'install', '--dir', dir, '--force'])).code).toBe(0)
      expect(existsSync(join(dir, 'a2a-seat.ts'))).toBe(true)
    } finally { await A.dispose() }
  })
})
