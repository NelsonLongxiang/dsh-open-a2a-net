// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootNode, runContext, type MeshNode } from '../mesh/harness.ts'
import { CliDepositStore } from '../../src/cli-deposit.ts'
import { signCard } from '../../src/card.ts'
const ID = 'session-0123456789abcdef', TEAM = 'dsh/01234567', CLI = 'answer-cli/aabbccddeeff0011'
const nodes: MeshNode[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const n of nodes.splice(0)) await n.dispose(); vi.unstubAllGlobals() })
const post = async (n: MeshNode, path: string, body: unknown): Promise<any> => await fetch(n.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
const state = async (n: MeshNode): Promise<any> => await fetch(n.baseUrl + '/__dsh_a2a/state').then(r => r.json())
async function setup(extra: Record<string, unknown> = {}) {
  vi.stubGlobal('WebSocket', function () { throw Error('no socket') })
  const n = await bootNode({ name: 'target', session: 'answered-queue', team: 'dsh', sessionNodes: true, settlementAuth: 'enforce', teamScopeRouting: true, ...extra } as never)
  nodes.push(n)
  const agent = n.agents.agent! as any
  agent.steer = (payload: any) => { n.steered.push(payload); agent.session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : payload.content } }) }
  await post(n, '/__dsh_a2a/join', { id: ID })
  await post(n, '/__dsh_a2a/canvas', { action: 'create', name: 'ops' })
  for (const id of [ID, CLI]) await post(n, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id })
  const original = CliDepositStore.prototype.deposit
  let store: CliDepositStore | undefined
  const capture = vi.spyOn(CliDepositStore.prototype, 'deposit').mockImplementation(function(this: CliDepositStore, card: string) { store = this; return original.call(this, card) })
  const { privateKey } = generateKeyPairSync('ed25519')
  const card = JSON.stringify(signCard({ name: 'answer-cli', session: 'cli-answer', team: CLI, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172800000 }, privateKey))
  expect((await post(n, '/__dsh_a2a/cli-deposit', { action: 'publish', card })).ok).toBe(true)
  capture.mockRestore()
  const expire = () => { const row = store!.get(CLI)!; (row as { expiresAt: number }).expiresAt = Date.now() - 1; expect(store!.get(CLI)).toBeUndefined() }
  const dispatch = async (task: string) => await post(n, '/a2a/direct', { team: TEAM, caller_session: 'dsh', callback: CLI, task_id: task, message: 'work ' + task, wait: false })
  return { n, agent, expire, dispatch }
}
describe('#253 answered work is not queued, but remains owed', () => {
  it('an expired CLI prevents receipt delivery while finals release capacity and preserve pending rows', async () => {
    const { n, agent, expire, dispatch } = await setup()
    for (let i = 0; i < 3; i++) expect((await dispatch('auto-' + i)).delivered).toBe(true)
    expect((await dispatch('auto-full')).code).toBe(-32009)
    expire()
    n.agents.roots = () => [] // no owner receiver; block its dispatch before correlation below
    // Simulate both receipt lanes unavailable without changing receipt settlement rules.
    const get = n.ctx.get
    vi.spyOn(n.ctx, 'get').mockImplementation(function(this: any, name: string) { return name === 'webServer' ? undefined : get.call(this, name as never) } as never)
    agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'all consumed work answered' }] } } })
    n.ctx.emit('agent/status', { agent, status: 'idle' })
    await vi.waitFor(async () => {
      const s = await state(n), rows = s.tasks.filter((row: any) => row.taskId.startsWith('auto-'))
      expect(rows).toHaveLength(3)
      expect(rows.every((row: any) => row.status === 'pending' && typeof row.answeredAt === 'number')).toBe(true)
      expect(s.sessions.find((row: any) => row.id === ID).queued).toBe(0)
      expect(s.conservation.conserved).toBe(true)
    })
    expect((await dispatch('auto-new')).delivered).toBe(true)
    expect((await state(n)).sessions.find((row: any) => row.id === ID).queued).toBe(1)
  })
  it('an unrelated final and the host timeout placeholder do not answer unconsumed work', async () => {
    const { n, agent, dispatch } = await setup({ flushTimeoutMs: 30 })
    agent.steer = (payload: unknown) => { n.steered.push(payload) } // not consumed in the session log
    expect((await dispatch('unconsumed')).delivered).toBe(true)
    agent.session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'another turn final' }] } } })
    n.ctx.emit('agent/status', { agent, status: 'idle' })
    await new Promise(resolve => setTimeout(resolve, 80)) // past the deliberate host placeholder deadline
    const s = await state(n)
    expect(s.tasks.find((row: any) => row.taskId === 'unconsumed')).toMatchObject({ status: 'pending' })
    expect(s.tasks.find((row: any) => row.taskId === 'unconsumed').answeredAt).toBeUndefined()
    expect(s.sessions.find((row: any) => row.id === ID).queued).toBe(1)
  })

  it('only the receiving target can mark a failed manually attempted receipt as answered', async () => {
    const { n, agent, expire, dispatch } = await setup()
    expect((await dispatch('manual')).delivered).toBe(true)
    expire()
    const other = { id: SessionId('session-9999999911112222'), session: { events: [] }, steer() {} } as unknown as Agent
    n.agents.roots = () => [agent, other]
    n.ctx.emit('agent/created', { agent: other })
    await post(n, '/__dsh_a2a/join', { id: String(other.id) })
    await post(n, '/__dsh_a2a/canvas', { action: 'add-member', name: 'ops', id: String(other.id) })
    const receipt = { team: CLI, message: '[A2A receipt] task manual answered', async: true }
    await n.ctx.tools.get('a2a_route')!.execute(receipt, runContext(other))
    expect((await state(n)).tasks.find((row: any) => row.taskId === 'manual').answeredAt).toBeUndefined()
    const result = await n.ctx.tools.get('a2a_route')!.execute(receipt, runContext(agent)) as { ok: boolean }
    expect(result.ok).toBe(false)
    const s = await state(n)
    expect(s.tasks.find((row: any) => row.taskId === 'manual')).toMatchObject({ status: 'pending', answeredAt: expect.any(Number) })
    expect(s.sessions.find((row: any) => row.id === ID).queued).toBe(0)
    expect(s.conservation.conserved).toBe(true)
    const runtime = n.ctx.get('tools') as any
    const resultView = await runtime.execute({ name: 'a2a_tasks', arguments: {}, agent, signal: new AbortController().signal, callId: 'answered-schema' })
    expect(resultView.isError, JSON.stringify(resultView.error)).not.toBe(true)
    expect(resultView.value.tasks.find((row: any) => row.taskId === 'manual').answeredAt).toEqual(expect.any(Number))
  })
})
