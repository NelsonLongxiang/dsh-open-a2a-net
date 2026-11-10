// @vitest-environment jsdom
/** The right bar's decisions view (docs/design/superagent-decision-cards.md). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeamDecisionsTab, canApprove, type DecisionRow } from '../../src/client/TeamDecisionsTab.tsx'
import { en } from '../../src/client/locales.ts'

const t = ((key: string, values?: Record<string, string>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), (en as Record<string, string>)[key] ?? key)) as never
const card = (over: Partial<DecisionRow> = {}): DecisionRow => ({ id: 'd-1', teamId: '', team: 'ops', question: '要不要升级？', level: 'P2', options: ['升级', '不升'], recommended: '升级', source: 'router', ...over })

function serve(decisions: DecisionRow[], post: () => { status: number; body: unknown } = () => ({ status: 200, body: { ok: true } })) {
  const list = [...decisions]
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { const r = post(); if (r.status === 200 && (r.body as { ok?: boolean }).ok === true) list.length = 0; return { ok: r.status < 300, status: r.status, json: async () => r.body } as Response }
    return { ok: true, status: 200, json: async () => ({ decisions: [...list] }) } as Response
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const posts = (f: ReturnType<typeof serve>) => f.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>)
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the decisions view', () => {
  it('marks the recommendation, and approves it with one click at P2', async () => {
    const f = serve([card()])
    render(<TeamDecisionsTab t={t} />)
    await screen.findByText('要不要升级？')
    expect(screen.getByText(en['team.recommended']).parentElement!.textContent).toContain('升级')
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await screen.findByText(en['team.noDecisions'])
    expect(posts(f)).toEqual([{ id: 'd-1', how: 'approve' }])
  })
  it.each(['P0', 'P1'])('offers no one-click at %s: an option must be chosen', async (level) => {
    const f = serve([card({ level })])
    render(<TeamDecisionsTab t={t} />)
    await screen.findByText('要不要升级？')
    expect(screen.queryByRole('button', { name: en['team.approve'] })).toBeNull()
    const confirm = screen.getByRole('button', { name: en['team.confirmChoice'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /不升/ }))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => { expect(posts(f)).toEqual([{ id: 'd-1', how: 'choose', option: '不升' }]) })
  })
  it('sends the team and a note', async () => {
    const f = serve([card({ teamId: 'aaaaaaaa' })])
    render(<TeamDecisionsTab t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '改成周五' } })
    fireEvent.click(screen.getByRole('button', { name: en['team.confirmChoice'] }))
    await waitFor(() => { expect(posts(f)).toEqual([{ id: 'd-1', teamId: 'aaaaaaaa', how: 'choose', note: '改成周五' }]) })
  })
  it('shows why a decision was refused, and keeps the card', async () => {
    serve([card()], () => ({ status: 403, body: { ok: false, error: '需要登录' } }))
    render(<TeamDecisionsTab t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('需要登录') })
    expect(screen.getByText('要不要升级？')).toBeTruthy()
  })
  it.each([['router', 'team.fromRouter'], ['observer', 'team.fromObserver'], ['ticket', 'team.fromMember']] as const)('says who raised a %s card', async (source, key) => {
    serve([card({ source })])
    render(<TeamDecisionsTab t={t} />)
    await screen.findByText(new RegExp(en[key]))
  })
  it('says when nothing is waiting', async () => {
    serve([])
    render(<TeamDecisionsTab t={t} />)
    await screen.findByText(en['team.noDecisions'])
  })
  it('never offers one click without a recommendation', () => {
    expect(canApprove(card({ level: 'P3', recommended: '' }))).toBe(false)
    expect(canApprove(card({ level: 'P3' }))).toBe(true)
  })
})

describe('files on a card (C8)', () => {
  function serveWithBlob(decisions: DecisionRow[]) {
    const list = [...decisions]
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/__dsh_a2a/blob')) return { ok: true, status: 200, json: async () => ({ ok: true, ref: `[A2A file] v1 sha256=${'a'.repeat(64)} size=2 name=n.txt from=http://h` }) } as Response
      if (init?.method === 'POST') { list.length = 0; return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response }
      return { ok: true, status: 200, json: async () => ({ decisions: [...list] }) } as Response
    })
    vi.stubGlobal('fetch', fetcher)
    return fetcher
  }
  it('lists the proposer\'s files as downloads from this card', async () => {
    serve([card({ teamId: 'aaaaaaaa', files: [{ sha256: 'b'.repeat(64), size: 2048, name: '方案.md' }] })])
    render(<TeamDecisionsTab t={t} />)
    const link = await screen.findByRole('link', { name: /方案\.md/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`/__dsh_a2a/superagent/decisions/file?card=d-1&sha256=${'b'.repeat(64)}&teamId=aaaaaaaa`)
    expect(link.textContent).toContain('2.0 KB')
  })
  it('stages the owner\'s files to the card\'s team and sends their references with the decision', async () => {
    const f = serveWithBlob([card({ address: 'dsh/canvas/ops' })])
    const { container } = render(<TeamDecisionsTab t={t} />)
    await screen.findByText('要不要升级？')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['hi'], 'n.txt')] } })
    await screen.findByText('n.txt')
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await screen.findByText(en['team.noDecisions'])
    const urls = f.mock.calls.map(([url]) => url)
    expect(urls.find(url => url.startsWith('/__dsh_a2a/blob'))).toContain(encodeURIComponent('dsh/canvas/ops'))
    const decided = f.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.startsWith('/__dsh_a2a/blob')).map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>)
    expect(decided).toEqual([{ id: 'd-1', how: 'approve', files: [`[A2A file] v1 sha256=${'a'.repeat(64)} size=2 name=n.txt from=http://h`] }])
  })
  it('refuses to send files when the card names no team address, and keeps the card', async () => {
    serveWithBlob([card()])
    const { container } = render(<TeamDecisionsTab t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['hi'], 'n.txt')] } })
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain(en['team.noFileTarget']) })
    expect(screen.getByText('要不要升级？')).toBeTruthy()
  })
})
