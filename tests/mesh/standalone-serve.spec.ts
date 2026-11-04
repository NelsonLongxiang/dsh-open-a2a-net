// @vitest-environment node
/**
 * `a2a-net serve` (cli/serve.mjs): the network layer as a standalone node with no DSH sessions.
 * A CLI deposited on the standalone node A routes to a session on a DSH host B; A forwards one hop,
 * B's automatic receipt lands in the CLI mailbox on A and settles under enforce. The node keeps the
 * CLI's deposit and mailbox across its own restart (owner request 2026-11-04: the network must not
 * depend on a DSH instance staying up).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { signCard } from '../../src/card.ts'
import { bootNode, reservePort, type MeshNode } from './harness.ts'
// @ts-expect-error -- plain ESM module without types
import { nodeConfig, startNode, installLine, SERVE_DEPS } from '../../cli/serve.mjs'

beforeEach(() => vi.stubGlobal('WebSocket', function noSocket() { throw Error('no socket') }))
afterEach(() => vi.unstubAllGlobals())

const handle = 'serve-cli/a1b2c3d4e5f60718'
const privateKey = generateKeyPairSync('ed25519').privateKey
const targetId = 'session-bbbbbbbb33334444'
const targetHandle = 'beta/bbbbbbbb'
const post = async (url: string, path: string, body: unknown): Promise<any> => await fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => await r.json())
const state = async (url: string): Promise<any> => await fetch(url + '/__dsh_a2a/state').then(async r => await r.json())
async function cli(home: string, args: string[]) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const p = spawn(process.execPath, [join(process.cwd(), 'cli/a2a.mjs'), ...args], { env: { ...process.env, A2A_CLI_HOME: home } })
    let stdout = '', stderr = ''
    p.stdout.on('data', x => { stdout += String(x) }); p.stderr.on('data', x => { stderr += String(x) })
    p.on('error', reject); p.on('close', code => resolve({ code, stdout, stderr }))
  })
}

describe('a2a-net serve: a standalone network node', () => {
  it('nodeConfig fills defaults, keeps the file keys, forces no session wake, and validates the port', () => {
    const { host, port, config } = nodeConfig({ team: 'lab', peers: ['http://p'], port: 1 }, { port: '2', home: '/tmp/x' })
    expect({ host, port }).toEqual({ host: '127.0.0.1', port: 2 })
    expect(config).toMatchObject({ team: 'lab', peers: ['http://p'], announce: true, sessionNodes: true, wakeJoinedOnBoot: false, dshHome: '/tmp/x' })
    expect(() => nodeConfig({}, { port: 'x' })).toThrow('--port')
    // an empty flag, a boolean or an exponent never become a port (review of #295)
    for (const bad of ['', '1e3', '-1', '65536']) expect(() => nodeConfig({}, { port: bad })).toThrow('--port')
    expect(() => nodeConfig({ port: true }, {})).toThrow('--port')
    expect(nodeConfig({}, { port: '0' }).port).toBe(0)
    expect(installLine('0.6.39')).toContain('@nelsonlongxiang/dsh-open-a2a-net@0.6.39')
    for (const [name, version] of Object.entries(SERVE_DEPS)) expect(installLine('0')).toContain(`${name}@${version}`)
  })

  it('a CLI on the standalone node reaches a DSH session one hop away, gets its receipt, and keeps deposit and mail across a node restart', async () => {
    const pa = await reservePort(), pb = await reservePort()
    const aUrl = 'http://127.0.0.1:' + pa
    const nodeHome = mkdtempSync(join(tmpdir(), 'serve-node-'))
    const opts = nodeConfig({ team: 'alpha', agentName: 'standalone', session: 'standalone-a', peers: ['http://127.0.0.1:' + pb], settlementAuth: 'enforce', teamScopeRouting: true, teamScopeInfo: true, cardCacheTtlMs: 0, forwardDirect: true }, { port: String(pa), home: nodeHome })
    let a = await startNode(opts)
    const b: MeshNode = await bootNode({ name: 'B', session: 'serve-target', team: 'beta', agentId: targetId, port: pb, peers: [aUrl], sessionNodes: true, teamScopeRouting: true, teamScopeInfo: true, settlementAuth: 'enforce', forwardDirect: true, cardCacheTtlMs: 0 } as never)
    const cliHome = mkdtempSync(join(tmpdir(), 'serve-cli-'))
    try {
      writeFileSync(join(cliHome, 'cli.json'), JSON.stringify({ name: 'serve-cli', uuid: 'a1b2c3d4e5f60718', handle, home: aUrl, privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 })
      const card = JSON.stringify(signCard({ name: 'serve-cli', session: 'cli-serve', team: handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, privateKey))
      expect((await post(aUrl, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
      // Links: A puts the CLI and B's session in one canvas; B links the CLI and pins A as its home.
      await post(aUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle })
      await post(aUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: targetHandle })
      await post(b.baseUrl, '/__dsh_a2a/join', { id: targetId })
      expect((await post(b.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: handle, home: aUrl })).ok).toBe(true)
      await post(b.baseUrl, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: targetId })
      const agent = b.agents.agent as any
      agent.steer = (payload: any) => {
        b.steered.push(payload)
        agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } })
        setTimeout(() => { agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done at the DSH host' }] } } }); b.ctx.emit('agent/status', { agent, status: 'idle' }) }, 150)
      }
      const task = 'direct-serve-roundtrip'
      const routed = await cli(cliHome, ['route', targetHandle, 'work for the DSH session', '--task', task])
      expect(routed.code, routed.stderr).toBe(0)
      expect(b.steered).toHaveLength(1)
      await vi.waitFor(async () => {
        const row = (await state(aUrl)).archived.find((r: any) => r.taskId === task)
        expect(row).toMatchObject({ outcome: 'completed', forwarded: true, settledBy: { caller: targetHandle } })
        expect(row.settledBy.chain_role).not.toBe('off-chain')
      }, { timeout: 9000, interval: 100 })
      expect((await cli(cliHome, ['inbox'])).stdout).toContain(task)
      // Restart the standalone node on the same home: the deposit and the mailbox survive.
      await a.close()
      a = await startNode(opts)
      const after = await cli(cliHome, ['status'])
      expect(after.stdout).toContain('ONLINE')
      expect((await cli(cliHome, ['inbox'])).stdout).toContain(task)
    } finally { await a.close(); await b.dispose() }
  }, 40000)
})
