// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { bootNode } from './harness.ts'

const user = (task: string) => ({ type: 'user/message', data: { content: [{ type: 'text', text: '[A2A direct] (task ' + task + ') sender sent:' }] } })
const text = (value: string) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: value }] } } })
const turnStart = () => ({ type: 'turn/start', data: {} })
const turnEnd = (kind = 'completed') => ({ type: 'turn/end', data: { reason: { kind } } })
const tick = async () => await new Promise<void>(resolve => setImmediate(resolve))

describe('#306 task-bound synchronous waits', () => {
  it('ignores prior same-id history, unrelated and other-task finals, then returns only this reading turn', async () => {
    const n = await bootNode({ name: 'sync306', session: 'sync306', team: 'dsh', sessionNodes: true, silent: true })
    try {
      await fetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: String(n.agents.agent!.id) }) })
      const agent = n.agents.agent as any
      agent.session.events.push(turnStart(), user('wanted'), text('old same-id answer'), turnEnd())
      let settled = false
      const pending = fetch(n.baseUrl + '/a2a/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: 'dsh/01234567', caller_session: 'dsh', task_id: 'wanted', message: 'new task', wait: true }) }).then(async r => { const body = await r.json(); settled = true; return body })
      await vi.waitFor(() => expect(n.steered).toHaveLength(1))
      agent.session.events.push(turnStart(), text('unrelated running work'), turnEnd())
      n.ctx.emit('agent/status', { agent, status: 'idle' })
      await tick()
      expect(settled).toBe(false)
      agent.session.events.push(turnStart(), user('wanted-prefix'), text('another task answer'), turnEnd())
      n.ctx.emit('agent/status', { agent, status: 'idle' })
      await tick()
      expect(settled).toBe(false)
      agent.session.events.push(turnStart(), user('wanted'), text('own answer'), turnEnd(), turnStart(), text('next turn answer'), turnEnd())
      n.ctx.emit('agent/status', { agent, status: 'idle' })
      const result = await pending
      expect(result).toMatchObject({ routed: true, task_status: 'TASK_STATE_COMPLETED', result: { text: 'own answer' } })
      expect(JSON.stringify(result)).not.toContain('next turn answer')
    } finally { await n.dispose() }
  })
  for (const kind of ['aborted', 'failed']) it('a ' + kind + ' consuming turn cannot return its partial text or a later turn as completion', async () => {
    const n = await bootNode({ name: 'negative306', session: 'negative306-' + kind, team: 'dsh', sessionNodes: true, silent: true })
    try {
      await fetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: String(n.agents.agent!.id) }) })
      const agent = n.agents.agent as any
      const pending = fetch(n.baseUrl + '/a2a/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team: 'dsh/01234567', caller_session: 'dsh', task_id: 'bad-' + kind, message: 'task', wait: true }) }).then(r => r.json())
      await vi.waitFor(() => expect(n.steered).toHaveLength(1))
      agent.session.events.push(turnStart(), user('bad-' + kind), text('partial answer'), turnEnd(kind), turnStart(), text('later unrelated answer'), turnEnd())
      n.ctx.emit('agent/status', { agent, status: 'idle' })
      const result = await pending
      expect(result.result?.text).toBe('The consuming turn produced no completed reply.')
      expect(result.reply_final).not.toBe(true)
      expect(JSON.stringify(result)).not.toContain('partial answer')
      expect(JSON.stringify(result)).not.toContain('later unrelated answer')
    } finally { await n.dispose() }
  })
})
