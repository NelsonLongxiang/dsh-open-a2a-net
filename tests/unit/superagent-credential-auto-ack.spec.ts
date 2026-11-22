// @vitest-environment node
/**
 * Owner 2026-11-23: a credential-access audit card nobody decided within the team's credentialAckMinutes (default 15,
 * 0 off) is closed as 「知道了」 by the host; no other card kind and no other option. It keeps an audit record, stays on
 * the panel marked as closed on a timeout, and the owner may still decide it.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'

const CALL = { command: 'curl -H "Authorization: Bearer sk-test-0000000000000000" http://localhost:9890/mcp' }

async function host(settings: Record<string, unknown> = {}) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const clock = { now: Date.parse('2026-11-23T01:00:00.000Z') }
  const h = new SuperagentHost({ canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined,
    home: mkdtempSync(join(tmpdir(), 'sa-ack-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
    now: () => new Date(clock.now).toISOString(), sessionName: (id: string) => id } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', ...settings }, () => true)).toMatchObject({ ok: true })
  const card = () => h.decisionCards().find(c => c.by === 'credential:session-m')
  return { h, clock, card }
}

describe('credential audit card: closed as 知道了 on a timeout', () => {
  it('after 15 minutes by default: decided 「知道了（超时自动）」 with an audit record, still on the panel', async () => {
    const { h, clock, card } = await host()
    h.auditCall('session-m', 'member', 'bash', CALL)
    clock.now += 14 * 60_000
    expect(h.ackCredentialCards()).toBe(0)
    expect(card()?.decided).toBeUndefined()
    clock.now += 60_000
    expect(h.ackCredentialCards()).toBe(1)
    expect(card()).toMatchObject({ decided: { text: '决定：知道了（超时自动）' }, autoAck: { by: 'host', rule: 'credential-ack-timeout', minutes: 15, at: new Date(clock.now).toISOString() } })
    expect(h.ackCredentialCards()).toBe(0)
    await h.stop()
  })

  it('the owner may still decide it: the decision replaces 知道了, the audit record stays, it leaves the panel', async () => {
    const { h, clock, card } = await host()
    h.auditCall('session-m', 'member', 'bash', CALL)
    clock.now += 15 * 60_000; h.ackCredentialCards()
    const id = card()!.id
    expect(h.decide(id, 'choose', '在团队设置里禁用这个工具')).toMatchObject({ ok: true })
    expect(card()).toBeUndefined()
    const stored = (h as unknown as { decisions: { get(id: string): { decided?: { text: string }; autoAck?: unknown } } }).decisions.get(id)
    expect(stored?.decided?.text).toBe('决定：在团队设置里禁用这个工具')
    expect(stored?.autoAck).toMatchObject({ rule: 'credential-ack-timeout' })
    await h.stop()
  })

  it('a closed card stays on the panel for a day, then leaves it', async () => {
    const { h, clock, card } = await host()
    h.auditCall('session-m', 'member', 'bash', CALL)
    clock.now += 15 * 60_000; h.ackCredentialCards()
    clock.now += 23 * 60 * 60_000
    expect(card()?.autoAck).toBeDefined()
    clock.now += 60 * 60_000 + 1
    expect(card()).toBeUndefined()
    await h.stop()
  })

  it('0 turns it off; another value is honoured; a bad value is refused', async () => {
    const off = await host({ credentialAckMinutes: 0 })
    off.h.auditCall('session-m', 'member', 'bash', CALL)
    off.clock.now += 2 * 24 * 60 * 60_000
    expect(off.h.ackCredentialCards()).toBe(0)
    expect(off.card()?.decided).toBeUndefined()
    await off.h.stop()
    const five = await host({ credentialAckMinutes: 5 })
    five.h.auditCall('session-m', 'member', 'bash', CALL)
    five.clock.now += 5 * 60_000
    expect(five.h.ackCredentialCards()).toBe(1)
    expect(five.h.saveSettings({ credentialAckMinutes: 2.5 }, () => true)).toMatchObject({ ok: false })
    expect(five.h.saveSettings({ credentialAckMinutes: -1 }, () => true)).toMatchObject({ ok: false })
    expect(five.h.saveSettings({ credentialAckMinutes: 1441 }, () => true)).toMatchObject({ ok: false })
    expect(five.h.saveSettings({ credentialAckMinutes: 1440 }, () => true)).toMatchObject({ ok: true })
    await five.h.stop()
  })

  it('no other card is closed, not even another health card', async () => {
    const { h, clock } = await host()
    const book = (h as unknown as { decisions: { propose(input: Record<string, unknown>): { ok: boolean; id?: string }; get(id: string): { decided?: unknown } | undefined } }).decisions
    const other = book.propose({ source: 'health', by: 'disk:low', question: 'q', at: new Date(clock.now).toISOString(), spec: { level: 'P1', options: ['知道了', '去处理'], recommended: '知道了' } })
    const observer = book.propose({ source: 'observer', by: 'session-o', question: 'q2', at: new Date(clock.now).toISOString(), spec: { level: 'P2', options: ['知道了', '别的'], recommended: '知道了' } })
    clock.now += 3 * 24 * 60 * 60_000
    expect(h.ackCredentialCards()).toBe(0)
    expect(book.get(other.id!)?.decided).toBeUndefined()
    expect(book.get(observer.id!)?.decided).toBeUndefined()
    await h.stop()
  })

  it('the host tick closes it, while the team is paused too', async () => {
    const { h, clock, card } = await host({ paused: true })
    h.auditCall('session-m', 'member', 'bash', CALL)
    clock.now += 15 * 60_000
    h.pass()
    expect(card()).toMatchObject({ decided: { text: '决定：知道了（超时自动）' }, autoAck: { rule: 'credential-ack-timeout' } })
    await h.stop()
  })

  it('#823 review: the timeout is a rule field, so only the owner\'s browser may change it', () => {
    expect(touchesRules({ credentialAckMinutes: 5 })).toBe(true)
    expect(touchesRules({ credentialAckMinutes: 0 })).toBe(true)
  })
})
