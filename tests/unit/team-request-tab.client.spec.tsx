// @vitest-environment jsdom
/** The right bar's request view (docs/design/superagent-multi-team.md, M7). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeamRequestTab } from '../../src/client/TeamRequestTab.tsx'
import { TEAM_REQUEST_KIND, registerTeamRequest } from '../../src/client/team-request.ts'
import { en } from '../../src/client/locales.ts'

const t = ((key: string, values?: Record<string, string>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), (en as Record<string, string>)[key] ?? key)) as never
const row = (id: string, canvas: string, open = true) => ({ id, canvas, address: `dsh/canvas/${canvas}`, open })
const bound = { teams: [row('', 'ops')] }

const REF = (name: string) => `[A2A file] v1 sha256=${'a'.repeat(64)} size=1 name=${name} from=http://h`
function serve(state: unknown, status = 200, post: () => { status: number; body: unknown } = () => ({ status: 200, body: { ok: true, triggerId: 'wb-1' } }), blob: (url: string) => { status: number; body: unknown } = url => ({ status: 200, body: { ok: true, ref: REF(new URL(url, 'http://x').searchParams.get('name')!) } })) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const reply = url.startsWith('/__dsh_a2a/blob') ? blob(url) : init?.method === 'POST' ? post() : { status, body: state }
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const posts = (f: ReturnType<typeof serve>) => f.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.startsWith('/__dsh_a2a/blob')).map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>)
const box = () => screen.getByPlaceholderText(en['team.placeholder']) as HTMLTextAreaElement

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the request view', () => {
  it('lists the team, sends the text as a request, clears the box and says so', async () => {
    const f = serve(bound)
    render(<TeamRequestTab t={t} />)
    fireEvent.change(await waitFor(box), { target: { value: '  把文档补上  ' } })
    expect(screen.getByRole('option', { name: 'ops' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('ops') })
    expect(posts(f)).toEqual([{ action: 'request', text: '  把文档补上  ' }])
    expect(box().value).toBe('')
  })

  it('sends with Ctrl+Enter, not with Enter, and never an empty box', async () => {
    const f = serve(bound)
    render(<TeamRequestTab t={t} />)
    const input = await waitFor(box)
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    fireEvent.change(input, { target: { value: '做' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(posts(f)).toHaveLength(0)
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await waitFor(() => { expect(posts(f)).toHaveLength(1) })
  })

  it('keeps the text and shows why when the host refuses', async () => {
    serve(bound, 200, () => ({ status: 200, body: { ok: false, error: 'text is required' } }))
    render(<TeamRequestTab t={t} />)
    fireEvent.change(await waitFor(box), { target: { value: '做' } })
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('text is required') })
    expect(box().value).toBe('做')
  })

  it.each([
    ['no team', { teams: [] }],
    ['a team that cannot take requests', { teams: [row('', 'ops', false)] }],
  ])('offers no box with %s', async (_name, state) => {
    serve(state)
    render(<TeamRequestTab t={t} />)
    await screen.findByText(en['team.none'])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('says when the page lacks the key, and when the host cannot be read', async () => {
    serve({}, 401)
    render(<TeamRequestTab t={t} />)
    await screen.findByText(en['team.denied'])
    cleanup()
    serve({}, 500)
    render(<TeamRequestTab t={t} />)
    await screen.findByText(en['team.unreadable'])
  })
})

describe('one view for requests and decisions', () => {
  it('shows the waiting decisions above the request box, and nothing of them when none waits', async () => {
    const decisions = [{ id: 'd-1', teamId: '', team: 'ops', question: '要不要升级？', level: 'P2', options: ['升级', '不升'], recommended: '升级', source: 'router' }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.startsWith('/__dsh_a2a/superagent/decisions') ? { decisions, health: [] } : bound }) as Response))
    render(<TeamRequestTab t={t} />)
    expect(await screen.findByText('要不要升级？')).toBeTruthy()
    expect(screen.getByText('Waiting for your decision (1)')).toBeTruthy()
    expect(screen.getByRole('button', { name: en['team.approve'] })).toBeTruthy()
    expect(box()).toBeTruthy()
    cleanup()
    serve(bound)
    render(<TeamRequestTab t={t} />)
    await waitFor(box)
    expect(screen.queryByText(/Waiting for your decision/)).toBeNull()
  })
})

describe('several teams', () => {
  it('lists those that can take a request, and sends to the one chosen', async () => {
    const f = serve({ teams: [row('', 'ops'), row('aaaaaaaa', 'docs'), row('bbbbbbbb', 'idle', false)] })
    render(<TeamRequestTab t={t} />)
    fireEvent.change(await waitFor(box), { target: { value: '写文档' } })
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['ops', 'docs'])
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'aaaaaaaa' } })
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(posts(f)).toHaveLength(1) })
    expect(posts(f)[0]).toEqual({ action: 'request', text: '写文档', teamId: 'aaaaaaaa' })
    expect(screen.getByRole('status').textContent).toContain('docs')
  })
  it('grants files to the team chosen', async () => {
    const f = serve({ teams: [row('', 'ops'), row('aaaaaaaa', 'docs')] })
    render(<TeamRequestTab t={t} />)
    await waitFor(box)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'aaaaaaaa' } })
    fireEvent.change(screen.getByLabelText(en['team.addFiles'], { selector: 'input' }), { target: { files: [new File(['x'], 'a.txt')] } })
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(posts(f)).toHaveLength(1) })
    expect(f.mock.calls.map(([url]) => url).find(url => url.startsWith('/__dsh_a2a/blob'))).toContain(encodeURIComponent('dsh/canvas/docs'))
  })
})

describe('a team on another instance', () => {
  const remote = { id: 'remote:z/canvas/far@abcd1234', canvas: 'far', address: 'z/canvas/far@abcd1234', open: true, remote: true, host: 'node-b' }
  it('says whose message it is, sends it as this session, and names the sender', async () => {
    const f = serve({ teams: [row('', 'ops'), remote] }, 200, () => ({ status: 200, body: { delivered: true, sender: 'dsh/aaaaaaaa' } }))
    render(<TeamRequestTab t={t} sessionId="session-aaaaaaaa" />)
    fireEvent.change(await waitFor(box), { target: { value: '远端的活' } })
    expect(screen.queryByText(en['team.remoteHint'])).toBeNull()
    expect(screen.getByRole('option', { name: 'far（node-b）' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: remote.id } })
    expect(screen.getByText(en['team.remoteHint'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('dsh/aaaaaaaa') })
    expect(posts(f)).toEqual([{ action: 'send', address: remote.address, session: 'session-aaaaaaaa', text: '远端的活' }])
    expect(f.mock.calls.find(([, init]) => init?.method === 'POST')![0]).toBe('/__dsh_a2a/superagent/teams')
  })
  it('keeps the text and shows why when the route is refused', async () => {
    serve({ teams: [remote] }, 200, () => ({ status: 200, body: { ok: false, error: 'join this session first' } }))
    render(<TeamRequestTab t={t} sessionId="session-aaaaaaaa" />)
    fireEvent.change(await waitFor(box), { target: { value: '做' } })
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('join this session first') })
    expect(box().value).toBe('做')
  })
})

describe('files', () => {
  const stagedUrls = (f: ReturnType<typeof serve>) => f.mock.calls.map(([url]) => url).filter(url => url.startsWith('/__dsh_a2a/blob'))
  const add = async (...files: File[]) => { const input = await waitFor(() => screen.getByLabelText(en['team.addFiles'], { selector: 'input' })); fireEvent.change(input, { target: { files } }) }
  const file = (name: string, size = 3) => new File(['x'.repeat(size)], name)

  it('stages each file for the team and sends one reference line each, after the text', async () => {
    const f = serve(bound)
    render(<TeamRequestTab t={t} />)
    fireEvent.change(await waitFor(box), { target: { value: '看这个' } })
    await add(file('a.txt'), file('b.txt'))
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(posts(f)).toHaveLength(1) })
    expect(stagedUrls(f)).toEqual(['a.txt', 'b.txt'].map(name => `/__dsh_a2a/blob?to=${encodeURIComponent('dsh/canvas/ops')}&name=${name}&by=owner`))
    expect(posts(f)[0]).toEqual({ action: 'request', text: ['看这个', REF('a.txt'), REF('b.txt')].join('\n') })
    await waitFor(() => { expect(screen.queryByText('a.txt')).toBeNull() })
  })

  it('can send files with no text', async () => {
    const f = serve(bound)
    render(<TeamRequestTab t={t} />)
    await add(file('a.txt'))
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(posts(f)[0]).toEqual({ action: 'request', text: REF('a.txt') }) })
  })

  it('sends no request when a file is refused, and keeps the text and the files', async () => {
    const f = serve(bound, 200, undefined, () => ({ status: 507, body: { ok: false, error: 'store is full' } }))
    render(<TeamRequestTab t={t} />)
    fireEvent.change(await waitFor(box), { target: { value: '看这个' } })
    await add(file('a.txt'))
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('store is full') })
    expect(posts(f)).toHaveLength(0)
    expect(box().value).toBe('看这个')
    expect(screen.getByText('a.txt')).toBeTruthy()
  })

  it('removes a file, ignores the same file twice, and refuses what the channel cannot take', async () => {
    serve(bound)
    render(<TeamRequestTab t={t} />)
    await add(file('a.txt'))
    await add(file('a.txt'))
    expect(screen.getAllByText('a.txt')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Remove {name}'.replace('{name}', 'a.txt') }))
    expect(screen.queryByText('a.txt')).toBeNull()
    const big = file('big.bin'); Object.defineProperty(big, 'size', { value: 64 * 1024 * 1024 + 1 })
    await add(big)
    expect(screen.getByRole('status').textContent).toContain('big.bin')
    await add(...Array.from({ length: 17 }, (_, i) => file(`f${String(i)}.txt`)))
    expect(screen.getByRole('status').textContent).toContain('16')
    expect(screen.queryByText('f0.txt')).toBeNull()
  })
})

describe('dragging files in', () => {
  const file = (name: string) => new File(['x'], name)
  const transfer = (files: File[], over: Record<string, unknown> = {}) => ({ types: ['Files'], files, items: files.map(() => ({ webkitGetAsEntry: () => ({ isDirectory: false }) })), ...over })
  const view = async () => { await waitFor(box); return box().closest('label')!.parentElement! }

  it('takes several files dropped anywhere on the view, and they are all sent', async () => {
    const f = serve(bound)
    render(<TeamRequestTab t={t} />)
    await waitFor(box)
    fireEvent.drop(screen.getByText(en['team.pick']), { dataTransfer: transfer([file('a.txt'), file('b.txt'), file('c.txt')]) })
    for (const name of ['a.txt', 'b.txt', 'c.txt']) expect(screen.getByText(name)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['team.send'] }))
    await waitFor(() => { expect(posts(f)).toHaveLength(1) })
    expect(String(posts(f)[0]!.text).split('\n')).toEqual([REF('a.txt'), REF('b.txt'), REF('c.txt')])
  })

  it('takes a drop on the text box too, and adds to what is already there', async () => {
    serve(bound)
    render(<TeamRequestTab t={t} />)
    fireEvent.drop(await waitFor(box), { dataTransfer: transfer([file('a.txt')]) })
    fireEvent.drop(box(), { dataTransfer: transfer([file('b.txt'), file('c.txt')]) })
    for (const name of ['a.txt', 'b.txt', 'c.txt']) expect(screen.getByText(name)).toBeTruthy()
  })

  it('marks the view while files are over it', async () => {
    serve(bound)
    render(<TeamRequestTab t={t} />)
    const root = await view()
    fireEvent.dragOver(root, { dataTransfer: transfer([]) })
    expect(root.className).toContain('dragging')
    fireEvent.dragLeave(root, { dataTransfer: transfer([]), relatedTarget: document.body })
    expect(root.className).not.toContain('dragging')
  })

  it('refuses a folder and adds nothing from that drop', async () => {
    serve(bound)
    render(<TeamRequestTab t={t} />)
    fireEvent.drop(await view(), { dataTransfer: transfer([file('a.txt'), file('dir')], { items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }, { webkitGetAsEntry: () => ({ isDirectory: true }) }] }) })
    expect(screen.getByRole('status').textContent).toBe(en['team.noFolders'])
    expect(screen.queryByText('a.txt')).toBeNull()
  })

  it('leaves a drag of text to the browser', async () => {
    serve(bound)
    render(<TeamRequestTab t={t} />)
    const notPrevented = fireEvent.drop(await waitFor(box), { dataTransfer: { types: ['text/plain'], files: [], items: [] } })
    expect(notPrevented).toBe(true)
  })
})

describe('registration', () => {
  function client() {
    const types: Array<Record<string, any>> = [], slots: Array<Record<string, unknown>> = []
    const scope = {
      sidebarRightTabs: { register: (definition: Record<string, any>) => { types.push(definition); return () => {} } },
      slots: { inject: (_name: string, build: () => () => void) => build(), register: (options: Record<string, unknown>) => { slots.push(options); return () => {} } },
      locale: { bind: () => t },
      effect: (run: () => () => void) => { run() },
    }
    const inject = vi.fn((_services: string[], run: (s: typeof scope) => void) => { run(scope) })
    return { ctx: { inject } as never, inject, types, slots }
  }
  it('adds a tab type with a guide card and its body, under the same id', async () => {
    serve(bound)
    const c = client()
    registerTeamRequest(c.ctx, 'a2aNet')
    await waitFor(() => { expect(c.types).toHaveLength(2) })
    expect(c.types[1]).toMatchObject({ kind: 'a2a-team-decisions' })
    // One view: only the team view has a guide card; an old decisions tab shows the same view.
    expect(c.types[1]).not.toHaveProperty('guide')
    expect(c.slots[1]).toMatchObject({ name: 'sidebar.right.pane.tab', key: c.types[1]!.id })
    expect(c.types[0]).toMatchObject({ kind: TEAM_REQUEST_KIND, guide: [{ id: 'new' }] })
    expect(c.slots[0]).toMatchObject({ name: 'sidebar.right.pane.tab', key: c.types[0]!.id })
  })
  it('adds nothing on a host without superagent', async () => {
    const f = serve({}, 404)
    const c = client()
    registerTeamRequest(c.ctx, 'a2aNet')
    await waitFor(() => { expect(f).toHaveBeenCalled() })
    await Promise.resolve()
    expect(c.inject).not.toHaveBeenCalled()
  })
})
