// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootNode, runContext } from '../mesh/harness.ts'

// Use valid routable ids, the shared harness, and an Agent (not its id) as the tool context.
// The old skipped fixture used worker00/caller01: nonhex ids that the handle parser rejects.
describe('receipt auto-synthesis', () => {
  it('a local async final reply auto-receipts to its caller and settles the one outbound row', async () => {
    vi.stubGlobal('WebSocket', function () { throw Error('no socket') })
    const n = await bootNode({ name: 'worker', session: 'autosend', team: 'dsh', sessionNodes: true, teamJoinAllowlist: ['dsh/receipt-test'] })
    try {
      const worker = n.agents.agent!
      const caller = { id: SessionId('session-1111222233334444'), session: { events: [] }, steer: vi.fn() } as unknown as Agent
      n.agents.roots = () => [worker, caller]
      n.ctx.emit('agent/created', { agent: caller })
      expect((await fetch(n.baseUrl + '/__dsh_a2a/canvas', { method: 'POST', body: JSON.stringify({ action: 'create', name: 'ops' }) })).status).toBe(200)
      for (const id of [String(worker.id), String(caller.id)]) {
        const response = await fetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id }) })
        expect(response.status).toBe(200)
        await fetch(n.baseUrl + '/__dsh_a2a/canvas', { method: 'POST', body: JSON.stringify({ action: 'add-member', name: 'ops', id }) })
      }
      for (const member of [worker, caller]) {
        const joined = await n.ctx.tools.get('a2a_team_join')!.execute({ team: 'dsh/receipt-test', id: String(member.id) }, runContext(member)) as { ok: boolean }
        expect(joined.ok, JSON.stringify(joined)).toBe(true)
      }
      worker.steer = vi.fn(payload => {
        const session = worker.session as unknown as { events: unknown[] }
        session.events.push({ type: 'user/message', data: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : (payload as any).content } })
        setTimeout(() => {
          session.events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'work done, tests green' }] } } })
          n.ctx.emit('agent/status', { agent: worker, status: 'idle' })
        }, 20)
      })
      const routed = await n.ctx.tools.get('a2a_route')!.execute({ team: 'dsh/01234567', message: 'please do the thing', async: true }, runContext(caller)) as { ok: boolean; task_id: string }
      expect(routed.ok, JSON.stringify(routed)).toBe(true)
      await vi.waitFor(() => expect(caller.steer).toHaveBeenCalledOnce(), { timeout: 3000 })
      expect(JSON.stringify(vi.mocked(caller.steer).mock.calls[0])).toContain('[A2A receipt] task ' + routed.task_id)
      const ledger = await n.ctx.tools.get('a2a_tasks')!.execute({}, runContext()) as { tasks: unknown[]; archive: Array<{ taskId: string; summary: string; sender: unknown }> }
      expect(ledger.tasks).toEqual([])
      expect(ledger.archive.find(row => row.taskId === routed.task_id)).toMatchObject({ summary: 'work done, tests green (auto)', sender: { kind: 'session', id: 'dsh/11112222' } })
    } finally { await n.dispose(); vi.unstubAllGlobals() }
  })
})
