// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TeamHealthBanner, cleanName as clientCleanName } from '../../src/client/TeamHealthBanner.tsx'
import { cleanName as hostCleanName, NAME_MAX } from '../../src/superagent/host/health-reminders.ts'
import { en } from '../../src/client/locales.ts'

const t = ((key: string, values?: Record<string, string>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), (en as Record<string, string>)[key] ?? key)) as never
const serve = (health: unknown[]) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ decisions: [], health }) }) as Response))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the two name cleaners (host and banner twin)', () => {
  const NAMES = [
    'plain', '开发席 (aaaaaaaa)', 'open-a2a-net-开发 (9b542ad3)',
    '😀'.repeat(200), '😀'.repeat(120), '😀'.repeat(121),
    'x'.repeat(119), 'x'.repeat(120), 'x'.repeat(121), 'x'.repeat(400),
    'a\u0007'.repeat(200), 'x'.repeat(119) + '\u0007x', 'x'.repeat(120) + '\u0007x', '\u200b' + 'x'.repeat(130),
    'e\u0301'.repeat(100), 'a\u0301\u0302b', '\u0301leading-combining',
    '👨\u200d👩\u200d👧', '👨\u200d👩\u200d👧'.repeat(40), 'می\u200cخواهم',
    'a\u200bb\u200eb\u200fb', 'a\u061cb', '\ufeffabc', '\u2060a\u2061b\u2064c',
    '\u202aa\u202bb\u202cc\u202dd\u202ee', '\u2066a\u2067b\u2068c\u2069',
    'a\u0085b\u009fc\u007fd', 'a\u0000b\u001fc',
    'a\u2028b\u2029c', 'a\r\nb', '\ta\tb\t', '  a   b  ', 'a \t b',
    'a\u{E0041}b\u{E007F}', '🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    'http://example.test:8080/x?token=abc',
    '', ' ', '\u0007', '\t \n', '\u200b', '\u202e',
  ]
  it('the banner twin gives exactly what the host gives, for every name (surrogate pairs, combining marks, joiners, isolates, BOM, ALM, C1, line separators, 119/120/121 long)', () => {
    for (const n of NAMES) expect(clientCleanName(n), JSON.stringify(n.slice(0, 40))).toBe(hostCleanName(n))
    // The set is not vacuous: most of it is changed by the cleaner.
    expect(NAMES.filter((n) => hostCleanName(n) !== n).length).toBeGreaterThan(20)
  })
  it('both give the documented results: lengths cut by character, joiners and tag characters kept, invisible marks dropped, blank is no name', () => {
    for (const clean of [hostCleanName, clientCleanName]) {
      expect(clean('x'.repeat(NAME_MAX))).toBe('x'.repeat(NAME_MAX))
      expect(clean('x'.repeat(NAME_MAX + 1))).toBe(`${'x'.repeat(NAME_MAX - 1)}…`)
      expect(clean('x'.repeat(NAME_MAX - 1) + '\u0007x')).toBe('x'.repeat(NAME_MAX))
      expect(clean('x'.repeat(NAME_MAX) + '\u0007x')).toBe(`${'x'.repeat(NAME_MAX - 1)}…`)
      expect(Array.from(clean('😀'.repeat(NAME_MAX + 1))!).length).toBe(NAME_MAX)
      expect(clean('😀'.repeat(NAME_MAX + 1))).toBe(`${'😀'.repeat(NAME_MAX - 1)}…`)
      expect(clean('👨\u200d👩\u200d👧')).toBe('👨\u200d👩\u200d👧')
      expect(clean('می\u200cخواهم')).toBe('می\u200cخواهم')
      expect(clean('a\u200bb\u200ec\u200fd\ufeffe\u061cf')).toBe('abcdef')
      expect(clean('\u2066a\u2069')).toBe('a')
      expect(clean('a\u0085b\u007fc')).toBe('abc')
      expect(clean('a\u2028b\u2029c\td')).toBe('a b c d')
      expect(clean('  a   b  ')).toBe('a b')
      expect(clean('a\u{E0041}b')).toBe('a\u{E0041}b')
      for (const blank of ['', ' ', '\u0007', '\t \n', '\u200b', '\u202e', undefined]) expect(clean(blank)).toBeUndefined()
    }
  })
})

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
