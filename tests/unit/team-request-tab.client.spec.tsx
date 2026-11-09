// @vitest-environment jsdom
/** The right bar's request view (docs/design/superagent-multi-team.md, M7). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeamRequestTab } from '../../src/client/TeamRequestTab.tsx'
import { TEAM_REQUEST_KIND, registerTeamRequest } from '../../src/client/team-request.ts'
import { en } from '../../src/client/locales.ts'

const t = ((key: string, values?: Record<string, string>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), (en as Record<string, string>)[key] ?? key)) as never
const bound = { settings: { canvas: 'ops', router: 'session-r', sources: { workbench: true } } }

function serve(state: unknown, status = 200, post: () => { status: number; body: unknown } = () => ({ status: 200, body: { ok: true, triggerId: 'wb-1' } })) {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const reply = init?.method === 'POST' ? post() : { status, body: state }
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
const posts = (f: ReturnType<typeof serve>) => f.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>)
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
    ['no canvas', { settings: { sources: { workbench: true } } }],
    ['no router', { settings: { canvas: 'ops', sources: { workbench: true } } }],
    ['the workbench Source off', { settings: { canvas: 'ops', router: 'r', sources: { workbench: false } } }],
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
    await waitFor(() => { expect(c.types).toHaveLength(1) })
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
