// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TeamHealthBanner } from '../../src/client/TeamHealthBanner.tsx'
import { en } from '../../src/client/locales.ts'

const t = ((key: string, values?: Record<string, string>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), (en as Record<string, string>)[key] ?? key)) as never
const serve = (health: unknown[]) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ decisions: [], health }) }) as Response))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the health banner', () => {
  it('says how many problems and what they are, with the team', async () => {
    serve([{ code: 'router-not-loaded', team: 'ops', session: 'session-a0000000aaaa' }, { code: 'ticket-quiet', team: 'docs', title: '写文档', minutes: 75 }])
    render(<TeamHealthBanner t={t} />)
    expect((await screen.findByRole('alert')).textContent).toContain('2')
    expect(screen.getByText(/ops：Router session a0000000/)).toBeTruthy()
    expect(screen.getByText(/docs：Ticket “写文档” has had no activity for 75 minutes/)).toBeTruthy()
  })
  it('says a router\'s turn failed, and why', async () => {
    serve([{ code: 'router-turn-failed', team: 'ops', session: 'session-a0000000aaaa', detail: 'GoUsageLimitError: usage limit reached' }])
    render(<TeamHealthBanner t={t} />)
    expect(await screen.findByText(/ops：Router session a0000000's last turn failed \(GoUsageLimitError: usage limit reached\)/)).toBeTruthy()
  })
  it('says how many tickets are queued and what they wait for', async () => {
    serve([{ code: 'tickets-queued', team: 'ops', reason: 'member-busy', session: 'session-a0000000aaaa', count: 3, minutes: 90, title: 'R1 整改' }, { code: 'tickets-queued', team: 'ops', reason: 'no-repo-member', repo: 'acme/widgets', count: 1, minutes: 70, title: '修文档' }])
    render(<TeamHealthBanner t={t} />)
    expect(await screen.findByText(/ops：3 ticket\(s\) queued for over 90 minutes \(oldest: “R1 整改”\): waiting for member a0000000/)).toBeTruthy()
    expect(screen.getByText(/only members working in acme\/widgets can take them, and the team has none/)).toBeTruthy()
  })
  it('owner decision card 2026-11-23: names the member when the host has a name, the short id only when it has none', async () => {
    serve([{ code: 'member-not-loaded', team: 'ops', session: 'session-9b542ad3aaaa', name: 'open-a2a-net-开发 (9b542ad3)' }, { code: 'tickets-queued', team: 'docs', reason: 'member-busy', session: 'session-9b542ad3aaaa', name: 'open-a2a-net-开发 (9b542ad3)', count: 6, minutes: 63, title: '设计 issue' }, { code: 'router-not-loaded', team: 'qa', session: 'session-c0000000cccc' }])
    render(<TeamHealthBanner t={t} />)
    expect(await screen.findByText(/ops：.*open-a2a-net-开发 \(9b542ad3\)/)).toBeTruthy()
    expect(screen.getByText(/docs：.*waiting for member open-a2a-net-开发 \(9b542ad3\)/)).toBeTruthy()
    expect(screen.getByText(/qa：Router session c0000000/)).toBeTruthy()
  })
  it('follow-up of the #846 review: a member name is shown without control characters and at most 120 long', async () => {
    serve([
      { code: 'member-not-loaded', team: 'ops', session: 'session-9b542ad3aaaa', name: 'ab\u0007c\u202ed\nline2' },
      { code: 'member-not-loaded', team: 'docs', session: 'session-9b542ad3aaaa', name: 'y'.repeat(400) },
      { code: 'member-not-loaded', team: 'qa', session: 'session-9b542ad3aaaa', name: '\u0007\u202e' },
    ])
    render(<TeamHealthBanner t={t} />)
    expect(await screen.findByText(/ops：.*abcd line2/)).toBeTruthy()
    // Anchored on both sides: exactly 119 characters and the ellipsis, so a limit of 121 or 119 fails too.
    expect(screen.getByText(/docs：.*[^y]y{119}…[^y]/)).toBeTruthy()
    expect(screen.getByText(/qa：.*9b542ad3/)).toBeTruthy()
    const all = document.body.textContent ?? ''
    expect(/[\u0007\u202e]/.test(all)).toBe(false)
    expect(/y{121}/.test(all)).toBe(false)
  })
  it('shows nothing when the teams are healthy', async () => {
    serve([])
    render(<TeamHealthBanner t={t} />)
    await new Promise(r => setTimeout(r, 20))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
