// @vitest-environment node
/** docs/design/superagent-reliability.md R6: what keeps a team from working. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { QUIET_MINUTES } from '../../src/superagent/host/index.ts'

async function team(loaded: Set<string>) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const clock = { ms: Date.parse('2026-11-10T00:00:00Z') }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-health-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
    sessionLoaded: (id: string) => loaded.has(id), now: () => new Date(clock.ms).toISOString(),
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const open = (): string => { const a = h.request('做事') as { triggerId: string }; h.pass(); return (routeItem(h, { trigger_id: a.triggerId, kind: 'accept', title: '做事', scope: 's', reason: 'r' } as never) as { ticket_id: string }).ticket_id }
  return { h, clock, open }
}

describe('the health check', () => {
  it('is empty when the router and members are loaded and nothing is stuck', async () => {
    const m = await team(new Set(['session-r', 'session-a']))
    expect(m.h.health()).toEqual([])
    await m.h.stop()
  })
  it('names a router or member session that is not loaded', async () => {
    const m = await team(new Set(['session-a']))
    expect(m.h.health()).toEqual([{ code: 'router-not-loaded', session: 'session-r' }])
    const n = await team(new Set(['session-r']))
    expect(n.h.health()).toEqual([{ code: 'member-not-loaded', session: 'session-a' }])
    await m.h.stop(); await n.h.stop()
  })
  it('names a working ticket with no change for an hour, and the state carries it', async () => {
    const m = await team(new Set(['session-r', 'session-a']))
    const ticket = m.open()
    await vi.waitFor(() => { expect(m.h.executor.bindingOf('session-a')?.ticketId).toBe(ticket) })
    expect(m.h.health(m.clock.ms + (QUIET_MINUTES - 1) * 60_000)).toEqual([])
    expect(m.h.health(m.clock.ms + (QUIET_MINUTES + 5) * 60_000)).toEqual([expect.objectContaining({ code: 'ticket-quiet', ticketId: ticket, title: '做事' })])
    expect(m.h.state()).toHaveProperty('health')
    await m.h.stop()
  })
})
