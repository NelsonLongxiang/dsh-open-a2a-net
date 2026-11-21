import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootNode, type MeshNode } from './harness.ts'
import { REMINDER_LONG_MS, REMINDER_MIN_MS } from '../../src/reconciliation-state.ts'

afterEach(() => vi.restoreAllMocks())
const post = (n: MeshNode, route: string, value: unknown) => fetch(n.baseUrl + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }).then(r => r.json())
const state = (n: MeshNode) => fetch(n.baseUrl + '/__dsh_a2a/state').then(r => r.json())
const reminder = (m: any) => m.content[0].text.startsWith('[A2A reconciliation reminder]')
function park(n: MeshNode, pending: any[] = []) {
  const agent = n.agents.agent! as any
  agent.session.id = String(agent.id)
  agent.inbox = { nextTurn: pending, nextStep: [], remove: (id: string) => { const i = pending.findIndex(m => m.id === id); if (i < 0) return false; pending.splice(i, 1); return true } }
  agent.followup = (m: any) => { pending.push(m) }
  return { agent, pending }
}
const tick = async (n: MeshNode) => { const agent = n.agents.agent! as any; agent.status = 'idle'; n.ctx.emit('agent/status', { agent, status: 'idle' }); await new Promise(r => setImmediate(r)) }
const options = { name: 'cap', session: 'cap', team: 'beta', silent: true, sessionNodes: true, teamScopeRouting: false, asyncNudgeDelayMs: 86400000, taskStaleTtlMs: 7 * 86400000, initialStatus: 'running' as const }

describe('real plugin reconciliation inbox capacity', () => {
  it('a maintenance-like idle receiver keeps one reminder across scans and plugin restart', async () => {
    let n = await bootNode(options), now = Date.now(); const home = n.home
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    let f = park(n)
    try {
      await post(n, '/__dsh_a2a/join', { id: String(f.agent.id) })
      const sent = await post(n, '/a2a/direct', { team: 'beta/01234567', caller_session: 'alpha/aaaaaaaa', callback: 'alpha/aaaaaaaa', task_id: 'queue-debt', message: 'real task, not reminder', wait: false })
      expect(sent.delivered).toBe(true)
      await tick(n); expect(f.pending.filter(reminder)).toHaveLength(1)
      const first = f.pending.find(reminder)
      now += REMINDER_MIN_MS; await tick(n); now += REMINDER_LONG_MS; await tick(n)
      expect(f.pending.filter(reminder)).toEqual([first])
      expect((await state(n)).tasks[0]).toMatchObject({ reminderAttempts: 1, reminderDelivered: 1, status: 'pending' })
      const restoredInbox = JSON.parse(JSON.stringify(f.pending))
      await n.dispose(); n = await bootNode({ ...options, home }); f = park(n, restoredInbox)
      now += REMINDER_LONG_MS; await tick(n)
      expect(f.pending.filter(reminder)).toHaveLength(1)
      expect(f.pending.find(reminder).id).toBe(first.id)
      expect((await state(n)).tasks[0].reminderAttempts).toBe(1)
      const index = f.pending.findIndex(reminder); const claimed = f.pending.splice(index, 1)[0]
      n.ctx.emit('agent/inbox/claimed', { agent: f.agent, message: claimed, turn: 1 })
      await tick(n)
      expect(f.pending.filter(reminder)).toHaveLength(1)
      expect(f.pending.find(reminder).id).not.toBe(first.id)
      expect((await state(n)).tasks[0].reminderAttempts).toBe(2)
      // Neither reminder is an ordinary task delivery or a new receipt debt.
      const raw = JSON.parse(readFileSync(join(home, 'a2a/tasks.json'), 'utf8'))
      expect(raw.tasks).toHaveLength(1)
      expect(raw.taskDeliveries.every((d: any) => !String(d.messageId).startsWith('a2a-reconciliation-'))).toBe(true)
    } finally { clock.mockRestore(); await n.dispose() }
  })
  it('an actual terminal receipt removes only the queued summary on the next scan', async () => {
    const n = await bootNode(options), f = park(n)
    try {
      await post(n, '/__dsh_a2a/join', { id: String(f.agent.id) })
      await post(n, '/a2a/direct', { team: 'beta/01234567', caller_session: 'alpha/aaaaaaaa', task_id: 'paid-debt', message: 'business text', wait: false })
      await tick(n); expect(f.pending.filter(reminder)).toHaveLength(1)
      const business = f.pending.find(m => m.source?.taskId === 'paid-debt')
      const receipt = await post(n, '/a2a/direct', { team: 'beta/01234567', caller_session: 'alpha/aaaaaaaa', task_id: 'actual-receipt', message: '[A2A receipt] task paid-debt completed by target', wait: false })
      expect(receipt.delivered).toBe(true)
      await tick(n)
      expect(f.pending.filter(reminder)).toHaveLength(0)
      expect(f.pending).toContain(business)
      expect((await state(n)).tasks).toHaveLength(0)
    } finally { await n.dispose() }
  })
})
