// @vitest-environment node
/** A request sent from the team tab to another instance: its receipts are kept for the tab (owner ruling 2026-11-13). */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SidebarSends } from '../../src/sidebar-sends.ts'
import { formatReceipt } from '../../src/receipt.ts'

const send = { taskId: 'direct-0a1b2c3d', session: 'session-aaaaaaaa-1', sender: 'dsh/aaaaaaaa', address: 'dsh/canvas/far@abcd1234', text: '把文档补上' }

describe('the team tab\'s sends', () => {
  it('takes a receipt for its own send, addressed to the team it went out as, and nothing else', () => {
    const s = new SidebarSends(undefined)
    s.register(send)
    expect(s.take('dsh/aaaaaaaa', 'ordinary follow-up text', 'peer', true)).toBe(false)
    expect(s.take('dsh/bbbbbbbb', formatReceipt(send.taskId, 'done', { outcome: 'completed' }), 'peer', true)).toBe(false)
    expect(s.take('dsh/aaaaaaaa', formatReceipt('direct-ffffffff', 'done', { outcome: 'completed' }), 'peer', true)).toBe(false)
    expect(s.take('dsh/aaaaaaaa', formatReceipt(send.taskId, '团队未接这条消息', { outcome: 'rejected', disposition: 'result' }), 'dsh-host-1', true)).toBe(true)
    const [row] = s.of(send.session)
    expect(row).toMatchObject({ taskId: send.taskId, brief: '把文档补上', ended: true, returns: [{ disposition: 'result', outcome: 'rejected', summary: '团队未接这条消息', from: 'dsh-host-1', settled: true }] })
    expect(s.of('session-other')).toEqual([])
  })

  it('keeps progress and acknowledgements open, and an unsettled result does not end the request', () => {
    const s = new SidebarSends(undefined)
    s.register(send)
    expect(s.take('dsh/aaaaaaaa', formatReceipt(`progress-${send.taskId}-1`, '进度', { disposition: 'progress', progress: { n: 1, state: 'working', summary: '在做', at: '2026-11-13T00:00:00Z' } }), 'p', true)).toBe(true)
    expect(s.take('dsh/aaaaaaaa', formatReceipt(send.taskId, '冒充', { outcome: 'completed' }), 'x', false)).toBe(true)
    const [row] = s.of(send.session)
    expect(row!.ended).toBeUndefined()
    expect(row!.returns.map(r => [r.disposition, r.summary, r.settled])).toEqual([['progress', '在做', true], ['result', '冒充', false]])
  })

  it('survives a restart through its file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sidebar-sends-')), 'a2a', 'sidebar-sends.json')
    new SidebarSends(file).register(send)
    expect(JSON.parse(readFileSync(file, 'utf8')).sends).toHaveLength(1)
    const again = new SidebarSends(file)
    expect(again.take('dsh/aaaaaaaa', formatReceipt(send.taskId, 'ok', { outcome: 'completed' }), 'p', true)).toBe(true)
  })

  it('forgets a send after a week', () => {
    let now = Date.parse('2026-11-01T00:00:00Z')
    const s = new SidebarSends(undefined, () => now)
    s.register(send)
    now += 8 * 24 * 3600_000
    s.register({ ...send, taskId: 'direct-11111111' })
    expect(s.of(send.session).map(r => r.taskId)).toEqual(['direct-11111111'])
  })
})
