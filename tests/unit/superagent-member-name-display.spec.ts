// @vitest-environment node
/** #851 review, non-blocking 3: every place that shows a member's name cleans it the way the health problems do; only the display changes. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
async function team(names: Record<string, string>) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', ...Object.keys(names)], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-names-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => names[id] ?? id,
    sessionLoaded: () => true, bootSettled: () => true, now: () => '2026-11-23T00:00:00.000Z',
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  return h
}
const RAW_A = 'dev\u0007\u202e\nlead', LONG = 'y'.repeat(400), INVISIBLE = '\u200b\u202e'

describe('member names are shown cleaned everywhere, matched as before', () => {
  it('the member list shows cleaned names: controls dropped, line breaks a space, long names cut, nothing left falls back to the id', async () => {
    const h = await team({ 'session-a': RAW_A, 'session-b': LONG, 'session-c': INVISIBLE })
    const line = h.memberListLine()
    expect(line).toBe("The team's members: dev lead; " + 'y'.repeat(119) + "…; session-c.")
    expect(line).not.toMatch(CONTROL)
    await h.stop()
  })

  it('a member is found by the name as shown, by its raw name and by its id; a name cleaned to nothing only by its id', async () => {
    const h = await team({ 'session-a': RAW_A, 'session-b': LONG, 'session-c': INVISIBLE })
    expect(h.resolveMember('dev lead')).toBe('session-a')
    expect(h.resolveMember('DEV LEAD')).toBe('session-a')
    expect(h.resolveMember(RAW_A)).toBe('session-a')
    expect(h.resolveMember('y'.repeat(119) + '…')).toBe('session-b')
    expect(h.resolveMember(LONG)).toBe('session-b')
    expect(h.resolveMember('session-c')).toBe('session-c')
    expect(h.resolveMember('')).toBeUndefined()
    await h.stop()
  })

  it('two names that read the same once cleaned: neither is picked by that name, the list shows their ids, each is still found by id', async () => {
    const h = await team({ 'session-a': 'dev\u202e', 'session-b': 'dev', 'session-c': 'other' })
    expect(h.memberListLine()).toBe("The team's members: dev (session-a); dev (session-b); other.")
    expect(h.resolveMember('dev')).toBeUndefined()
    expect(h.resolveMember('session-a')).toBe('session-a')
    expect(h.resolveMember('session-b')).toBe('session-b')
    expect(h.resolveMember('other')).toBe('session-c')
    await h.stop()
  })

  it('the router names a member by the name it was shown; an unknown name gets the cleaned list back', async () => {
    const h = await team({ 'session-a': RAW_A, 'session-b': 'plain' })
    const { routeItem } = await import('../../src/superagent/host/tools.ts')
    const ask = (): string => { const a = h.request('做事') as { triggerId: string }; h.pass(); return a.triggerId }
    const missing = routeItem(h, { trigger_id: ask(), kind: 'accept', title: '做事', scope: 's', reason: 'r', member: 'nobody' } as never) as { ok: boolean; error: string }
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain("The team's members: dev lead; plain.")
    expect(missing.error).not.toMatch(CONTROL)
    const taken = routeItem(h, { trigger_id: ask(), kind: 'accept', title: '做事', scope: 's', reason: 'r', member: 'dev lead' } as never) as Record<string, unknown>
    expect(taken).toMatchObject({ ok: true, decision: 'accept' })
    // The ticket went to the member the router named by its shown name.
    expect((h as unknown as { executor: { memberOfTicket(id: string): { member: string } | undefined } }).executor.memberOfTicket(taken.ticket_id as string)?.member).toBe('session-a')
    await h.stop()
  })
})
