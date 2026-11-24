// @vitest-environment jsdom
/** The right bar's decisions view (docs/design/superagent-decision-cards.md). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DecisionList, STAGE_REUSE_MS, canApprove, inputMet, inputOf, type DecisionRow } from '../../src/client/TeamDecisionsTab.tsx'
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
    render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    expect(screen.getByText(en['team.recommended']).parentElement!.textContent).toContain('升级')
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await waitFor(() => { expect(screen.queryByText('要不要升级？')).toBeNull() })
    expect(posts(f)).toEqual([{ id: 'd-1', how: 'approve' }])
  })
  it.each(['P0', 'P1'])('offers no one-click at %s: an option must be chosen', async (level) => {
    const f = serve([card({ level })])
    render(<DecisionList t={t} />)
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
    render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '改成周五' } })
    fireEvent.click(screen.getByRole('button', { name: en['team.confirmChoice'] }))
    await waitFor(() => { expect(posts(f)).toEqual([{ id: 'd-1', teamId: 'aaaaaaaa', how: 'choose', note: '改成周五' }]) })
  })
  it('shows why a decision was refused, and keeps the card', async () => {
    serve([card()], () => ({ status: 403, body: { ok: false, error: '需要登录' } }))
    render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('需要登录') })
    expect(screen.getByText('要不要升级？')).toBeTruthy()
  })
  it.each([['router', 'team.fromRouter'], ['observer', 'team.fromObserver'], ['ticket', 'team.fromMember']] as const)('says who raised a %s card', async (source, key) => {
    serve([card({ source })])
    render(<DecisionList t={t} />)
    await screen.findByText(new RegExp(en[key]))
  })
  it('shows nothing when nothing is waiting (the right bar team view needs no empty section)', async () => {
    serve([])
    const { container } = render(<DecisionList t={t} />)
    await waitFor(() => { expect(fetch).toHaveBeenCalled() })
    expect(container.innerHTML).toBe('')
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
    render(<DecisionList t={t} />)
    const link = await screen.findByRole('link', { name: /方案\.md/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`/__dsh_a2a/superagent/decisions/file?card=d-1&sha256=${'b'.repeat(64)}&teamId=aaaaaaaa`)
    expect(link.textContent).toContain('2.0 KB')
  })
  it('stages the owner\'s files to the card\'s team and sends their references with the decision', async () => {
    const f = serveWithBlob([card({ address: 'dsh/canvas/ops' })])
    const { container } = render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['hi'], 'n.txt')] } })
    await screen.findByText('n.txt')
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await waitFor(() => { expect(screen.queryByText('要不要升级？')).toBeNull() })
    const urls = f.mock.calls.map(([url]) => url)
    expect(urls.find(url => url.startsWith('/__dsh_a2a/blob'))).toContain(encodeURIComponent('dsh/canvas/ops'))
    // #772: no `by` parameter — the host never read one; the staging route's authority is the control credential.
    expect(urls.find(url => url.startsWith('/__dsh_a2a/blob'))).not.toContain('by=')
    const decided = f.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.startsWith('/__dsh_a2a/blob')).map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>)
    expect(decided).toEqual([{ id: 'd-1', how: 'approve', files: [`[A2A file] v1 sha256=${'a'.repeat(64)} size=2 name=n.txt from=http://h`] }])
  })
  it('#771 review: a refused decision sent again reuses the files already staged (no second staged copy)', async () => {
    let refuse = true
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/__dsh_a2a/blob')) return { ok: true, status: 200, json: async () => ({ ok: true, ref: `[A2A file] v1 sha256=${'a'.repeat(64)} size=2 name=n.txt from=http://h` }) } as Response
      if (init?.method === 'POST') return refuse ? { ok: false, status: 403, json: async () => ({ ok: false, error: 'browser owner proof required' }) } as Response : { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
      return { ok: true, status: 200, json: async () => ({ decisions: [card({ address: 'dsh/canvas/ops' })] }) } as Response
    })
    vi.stubGlobal('fetch', f)
    const { container } = render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['hi'], 'n.txt')] } })
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await screen.findByText(/browser owner proof required/)
    refuse = false
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await waitFor(() => { expect(f.mock.calls.filter(([url, init]) => init?.method === 'POST' && !String(url).startsWith('/__dsh_a2a/blob'))).toHaveLength(2) })
    expect(f.mock.calls.filter(([url]) => String(url).startsWith('/__dsh_a2a/blob'))).toHaveLength(1)
  })
  function stagingHost(o: { failBlob?: (name: string) => boolean; refuseDecision?: () => boolean } = {}) {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/__dsh_a2a/blob')) {
        const name = new URL(url, 'http://x').searchParams.get('name') ?? ''
        if (o.failBlob?.(name) === true) return { ok: false, status: 507, json: async () => ({ ok: false, error: 'the file channel is full' }) } as Response
        return { ok: true, status: 200, json: async () => ({ ok: true, ref: `[A2A file] v1 ${name}` }) } as Response
      }
      if (init?.method === 'POST') return o.refuseDecision?.() === true ? { ok: false, status: 403, json: async () => ({ ok: false, error: 'browser owner proof required' }) } as Response : { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
      return { ok: true, status: 200, json: async () => ({ decisions: [card({ address: 'dsh/canvas/ops' })] }) } as Response
    })
    vi.stubGlobal('fetch', f)
    const blobs = (name: string): number => f.mock.calls.filter(([url]) => String(url).startsWith('/__dsh_a2a/blob') && new URL(String(url), 'http://x').searchParams.get('name') === name).length
    const decisions = () => f.mock.calls.filter(([url, init]) => init?.method === 'POST' && !String(url).startsWith('/__dsh_a2a/blob')).map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>)
    return { f, blobs, decisions }
  }

  it('#773 review: the files staged before a mid-way failure are kept, so the retry stages only what failed', async () => {
    let failB = true
    const h = stagingHost({ failBlob: name => name === 'b.txt' && failB })
    const { container } = render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')] } })
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await screen.findByText(/the file channel is full/)
    failB = false
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await waitFor(() => { expect(h.decisions()).toHaveLength(1) })
    expect([h.blobs('a.txt'), h.blobs('b.txt')]).toEqual([1, 2])
    expect(h.decisions()[0]).toEqual({ id: 'd-1', how: 'approve', files: ['[A2A file] v1 a.txt', '[A2A file] v1 b.txt'] })
  })

  it('#773 review: a staged copy close to the channel\'s 24 hours is staged again, never reused', async () => {
    const real = Date.now
    let now = real()
    Date.now = () => now
    try {
      let refuse = true
      const h = stagingHost({ refuseDecision: () => refuse })
      const { container } = render(<DecisionList t={t} />)
      await screen.findByText('要不要升级？')
      fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['a'], 'a.txt')] } })
      fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
      await screen.findByText(/browser owner proof required/)
      // Just under the limit: reused.
      now += STAGE_REUSE_MS - 1
      fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
      await waitFor(() => { expect(h.decisions()).toHaveLength(2) })
      expect(h.blobs('a.txt')).toBe(1)
      // At the limit: staged again before it is sent.
      now += 1
      refuse = false
      fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
      await waitFor(() => { expect(h.decisions()).toHaveLength(3) })
      expect(h.blobs('a.txt')).toBe(2)
      expect(STAGE_REUSE_MS).toBeLessThan(24 * 60 * 60_000)
    } finally { Date.now = real }
  })
  it('#775 review (A10, right bar): a file removed after staging is not sent with the retried decision', async () => {
    let refuse = true
    const h = stagingHost({ refuseDecision: () => refuse })
    const { container } = render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')] } })
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await screen.findByText(/browser owner proof required/)
    fireEvent.click(screen.getByRole('button', { name: (en as Record<string, string>)['team.removeFile']!.replace('{name}', 'b.txt') }))
    refuse = false
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await waitFor(() => { expect(h.decisions()).toHaveLength(2) })
    expect([h.blobs('a.txt'), h.blobs('b.txt')]).toEqual([1, 1])
    expect(h.decisions()[1]).toEqual({ id: 'd-1', how: 'approve', files: ['[A2A file] v1 a.txt'] })
  })
  it('#771 review: two different files that share a name and size are both kept', async () => {
    serve([card({ address: 'dsh/canvas/ops' })])
    const { container } = render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['aa'], 'r.md', { lastModified: 1 }), new File(['bb'], 'r.md', { lastModified: 2 })] } })
    await waitFor(() => { expect(screen.getAllByText(/r\.md/)).toHaveLength(2) })
  })
  it('refuses to send files when the card names no team address, and keeps the card', async () => {
    serveWithBlob([card()])
    const { container } = render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['hi'], 'n.txt')] } })
    fireEvent.click(screen.getByRole('button', { name: en['team.approve'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain(en['team.noFileTarget']) })
    expect(screen.getByText('要不要升级？')).toBeTruthy()
  })
})

describe('#888 D4: options that need the owner to fill something in', () => {
  const text = { 不升: { kind: 'text' as const, prompt: '写下不升的原因' } }
  it('marks the option and shows its prompt; confirming waits for the words', async () => {
    const f = serve([card({ inputs: text, needsInput: true, recommendedNeedsInput: false })])
    render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    expect(screen.getByText(en['team.needsInput'])).toBeTruthy()
    expect(screen.getByText('写下不升的原因')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /不升/ }))
    const confirm = screen.getByRole('button', { name: en['team.confirmChoice'] }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: en['team.decisionNote'] }), { target: { value: '太贵' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => { expect(posts(f)).toEqual([{ id: 'd-1', how: 'choose', option: '不升', note: '太贵' }]) })
  })
  it('no one-click approval when the recommendation needs input', async () => {
    serve([card({ inputs: { 升级: { kind: 'text', prompt: 'p' } }, needsInput: true, recommendedNeedsInput: true })])
    render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    expect(screen.queryByRole('button', { name: en['team.approve'] })).toBeNull()
    expect(canApprove(card({ recommendedNeedsInput: true }))).toBe(false)
  })
  it('a file option without a team canvas says why it cannot be answered', async () => {
    serve([card({ inputs: { 不升: { kind: 'file', prompt: '附合同' } }, needsInput: true })])
    render(<DecisionList t={t} />)
    await screen.findByText('要不要升级？')
    fireEvent.click(screen.getByRole('radio', { name: /不升/ }))
    expect(screen.getByText(en['team.inputNoFileTarget'])).toBeTruthy()
    expect((screen.getByRole('button', { name: en['team.confirmChoice'] }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('counts split by whether the recommendation needs input, without host-closed cards', async () => {
    serve([card({ id: 'a', inputs: { 升级: { kind: 'text', prompt: 'p' } }, needsInput: true, recommendedNeedsInput: true }), card({ id: 'b', question: '二', inputs: text, needsInput: true }), card({ id: 'c', question: '三' }), card({ id: 'd', question: '四', autoAck: { at: 'x', minutes: 30 } })])
    render(<DecisionList t={t} />)
    await screen.findByText('二')
    expect(screen.getByText(`${en['team.countNeedsInput'].replace('{count}', '1')} · ${en['team.countDirect'].replace('{count}', '2')}`)).toBeTruthy()
  })
  it('inputMet: text needs words, file needs a file, text+file both', () => {
    const row = card({ inputs: { a: { kind: 'text', prompt: 'p' }, b: { kind: 'file', prompt: 'p' }, c: { kind: 'text+file', prompt: 'p' } } })
    expect(inputMet(row, 'a', ' ', 1)).toBe(false)
    expect(inputMet(row, 'a', 'x', 0)).toBe(true)
    expect(inputMet(row, 'b', 'x', 0)).toBe(false)
    expect(inputMet(row, 'b', '', 1)).toBe(true)
    expect(inputMet(row, 'c', 'x', 0)).toBe(false)
    expect(inputMet(row, 'c', 'x', 1)).toBe(true)
    expect(inputMet(row, '升级', '', 0)).toBe(true)
  })
})

describe('#888 D5: a card the host took automatically', () => {
  it('shows the note and is left out of the split count', async () => {
    serve([card({ id: 'a', question: '一', autoApproved: { at: '2026-11-24T10:30:00.000Z', minutes: 30 }, inputs: { 不升: { kind: 'text', prompt: 'p' } }, needsInput: true }), card({ id: 'b', question: '二', inputs: { 不升: { kind: 'text', prompt: 'p' } }, needsInput: true })])
    render(<DecisionList t={t} />)
    await screen.findByText('一')
    expect(screen.getByText(/Taken automatically: 「升级」/)).toBeTruthy()
    expect(screen.getByText(`${en['team.countNeedsInput'].replace('{count}', '0')} · ${en['team.countDirect'].replace('{count}', '1')}`)).toBeTruthy()
  })
})

describe('#892 review follow-up: inputOf reads own keys only', () => {
  it('an option called constructor or toString has no inherited input', () => {
    const row = card({ options: ['constructor', '乙'], recommended: 'constructor', inputs: { 乙: { kind: 'text', prompt: 'p' } } })
    expect(inputOf(row, 'constructor')).toBeUndefined()
    expect(inputOf(row, 'toString')).toBeUndefined()
    expect(inputMet(row, 'constructor', '', 0)).toBe(true)
    expect(inputOf(row, '乙')).toEqual({ kind: 'text', prompt: 'p' })
  })
})

describe('#894 review B3: the main count leaves out cards the host already closed or took', () => {
  it('one waiting and one taken automatically shows 1', async () => {
    serve([card({ id: 'a', question: '一', autoApproved: { at: '2026-11-24T10:30:00.000Z', minutes: 30 } }), card({ id: 'b', question: '二' }), card({ id: 'c', question: '三', autoAck: { at: '2026-11-24T10:30:00.000Z', minutes: 15 } })])
    render(<DecisionList t={t} />)
    await screen.findByText('一')
    expect(screen.getByText(en['team.decisionsCount'].replace('{count}', '1'))).toBeTruthy()
  })
})
