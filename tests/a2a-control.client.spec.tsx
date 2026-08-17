// @vitest-environment jsdom
/**
 * A2aControl behavior: popover toggle + outside close, session rows with
 * title/description/team, join and leave posting to the host routes and
 * refreshing the listing, cold joined rows (wake through the standard open
 * flow, durable title from the client session list), the empty state, and
 * failure quietness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { A2aControlProps, A2aSessionRow } from '../src/client/A2aControl.tsx'
import { A2aControl } from '../src/client/A2aControl.tsx'
import { en } from '../src/client/locales.ts'

const t: A2aControlProps['t'] = key => (en as Record<string, string>)[key] ?? key

// The control reads the sessions list for cold-row titles and never touches
// the workspaces hook; stub the selector seat over a mutable byId map.
let listById: Record<string, { displayTitle?: string }> = {}
const useSessionsStub = (<S,>(sel: (s: { byId: Record<string, { displayTitle?: string }> }) => S): S =>
  sel({ byId: listById })) as A2aControlProps['useSessions']
const neverHook = (() => { throw new Error('control must not read global hooks') }) as never
const openSession = vi.fn<(id: string) => void>()

let stateSessions: A2aSessionRow[] = []
let statePeers: { url: string; score?: number }[] = []
let stateActivity: { ts: number; dir: 'in' | 'out'; team: string; peer: string; ok: boolean }[] = []
let stateOk = true
const posts: Array<{ url: string; body: string }> = []
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, ok = true): Promise<Response> {
  return Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => body } as Response)
}

function mountControl({ wide = true }: { wide?: boolean } = {}) {
  return render(<A2aControl wide={wide} t={t} useSessions={useSessionsStub} useWorkspaces={neverHook} openSession={openSession} />)
}

const row = (overrides: Partial<A2aSessionRow> = {}): A2aSessionRow => ({
  id: 'agent-1',
  label: 'dsh-host-ab12cd34-agent-1',
  team: 'dsh/agent-1',
  name: 'Parser porting session',
  description: 'help me port the parser',
  joined: false,
  ...overrides,
})

describe('A2aControl', () => {
  beforeEach(() => {
    stateSessions = [row()]
    statePeers = []
    stateActivity = []
    stateOk = true
    posts.length = 0
    listById = {}
    openSession.mockReset()
    fetchMock.mockReset()
    fetchMock.mockImplementation(((input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url: input, body: typeof init?.body === 'string' ? init.body : '' })
        return jsonResponse({ id: 'agent-1' })
      }
      return stateOk ? jsonResponse({ nodes: true, sessions: stateSessions, peers: statePeers, activity: stateActivity }) : jsonResponse({ error: 'gone' }, false)
    }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  const openPopover = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'A2A network' }))
  }

  it('toggles the popover, lists session facts, and closes on outside pointerdown', async () => {
    const { container } = mountControl()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    openPopover()
    expect(await screen.findByText('Parser porting session')).toBeTruthy()
    expect(screen.getByText('help me port the parser')).toBeTruthy()
    expect(screen.getByText('dsh/agent-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('joins a session and refreshes the listing', async () => {
    mountControl()
    openPopover()
    // The post-join refresh runs in a microtask, so arm the joined state
    // before the click.
    let joinPosted = false
    fetchMock.mockImplementation(((input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url: input, body: typeof init?.body === 'string' ? init.body : '' })
        joinPosted = true
        return jsonResponse({ id: 'agent-1' })
      }
      return jsonResponse({ nodes: true, sessions: joinPosted ? [row({ joined: true })] : stateSessions })
    }))
    fireEvent.click(await screen.findByRole('button', { name: 'Join' }))
    await waitFor(() => {
      expect(posts).toEqual([{ url: '/__dsh_a2a/join', body: JSON.stringify({ id: 'agent-1' }) }])
    })
    await screen.findByText('Leave')
  })

  it('leaves a joined session', async () => {
    stateSessions = [row({ joined: true })]
    mountControl()
    openPopover()
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }))
    await waitFor(() => {
      expect(posts).toEqual([{ url: '/__dsh_a2a/leave', body: JSON.stringify({ id: 'agent-1' }) }])
    })
  })

  it('shows the empty state when no sessions are joinable', async () => {
    stateSessions = []
    mountControl()
    openPopover()
    expect(await screen.findByText('No joinable sessions')).toBeTruthy()
  })

  it('polls the listing while the popover stays open', async () => {
    vi.useFakeTimers()
    try {
      mountControl()
      openPopover()
      // Flush the open-triggered fetch under the faked clock.
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByText('Parser porting session')).toBeTruthy()
      const fetchCountAfterOpen = fetchMock.mock.calls.length
      stateSessions = [row({ name: 'Serializer session' })]
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      expect(screen.getByText('Serializer session')).toBeTruthy()
      expect(fetchMock.mock.calls.length).toBeGreaterThan(fetchCountAfterOpen)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the last listing when a refresh fails', async () => {
    mountControl()
    openPopover()
    expect(await screen.findByText('Parser porting session')).toBeTruthy()
    stateOk = false
    // Any join toggle triggers a refresh; the failed refresh keeps the rows.
    fireEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => {
      expect(posts).toHaveLength(1)
    })
    expect(await screen.findByText('Parser porting session')).toBeTruthy()
  })

  it('renders a cold joined row with the durable title and wakes through the open flow', async () => {
    stateSessions = [{ id: 'agent-1', label: 'dsh-host-ab12cd34-agent-1', team: 'dsh/agent-1', joined: true, live: false }]
    listById = { 'agent-1': { displayTitle: 'Cold dev session' } }
    mountControl()
    openPopover()
    // The durable list title replaces the absent host facts; the cold marker
    // explains the row state.
    expect(await screen.findByText('Cold dev session')).toBeTruthy()
    expect(screen.getByText('not loaded (waiting to wake after a restart)')).toBeTruthy()
    expect(screen.getByText('dsh/agent-1')).toBeTruthy()
    // Wake goes through the injected open flow, not a host POST: the row's
    // facts block is the click target (its tooltip carries the wake hint).
    fireEvent.click(screen.getByTitle('Wake'))
    expect(openSession).toHaveBeenCalledWith('agent-1')
    expect(posts).toEqual([])
    // Leaving a cold row still drops the persisted intent host-side.
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await waitFor(() => {
      expect(posts).toEqual([{ url: '/__dsh_a2a/leave', body: JSON.stringify({ id: 'agent-1' }) }])
    })
  })

  it('falls back to the row label when the cold session is absent from the list', async () => {
    stateSessions = [{ id: 'agent-9', label: 'dsh-host-ab12cd34-agent-9', team: 'dsh/agent-9', joined: true, live: false }]
    mountControl()
    openPopover()
    expect(await screen.findByText('dsh-host-ab12cd34-agent-9')).toBeTruthy()
  })

  it('opens the session when a live row is clicked', async () => {
    mountControl()
    openPopover()
    // The row's facts block is the click target; no host POST fires.
    fireEvent.click((await screen.findByText('Parser porting session')).closest('button') ?? document.body)
    expect(openSession).toHaveBeenCalledWith('agent-1')
    expect(posts).toEqual([])
  })

  it('renders the peer fleet and the routing activity ring', async () => {
    statePeers = [{ url: 'http://127.0.0.1:41243', score: 10_040 }, { url: 'http://10.20.30.42:3001', score: 9_860 }]
    stateActivity = [
      { ts: Date.now() - 30_000, dir: 'in', team: 'dsh/agent-1', peer: 'dsh-host-peer-beta', ok: true },
      { ts: Date.now() - 5_000, dir: 'out', team: 'shared', peer: 'http://127.0.0.1:41243', ok: false },
    ]
    mountControl()
    openPopover()
    expect(await screen.findByText('Peers')).toBeTruthy()
    // The peer URL appears in both the chip and the activity row's peer
    // column; both occurrences come from the one fleet entry.
    expect(screen.getAllByText('127.0.0.1:41243').length).toBeGreaterThan(0)
    expect(screen.getByText('10.20.30.42:3001')).toBeTruthy()
    expect(screen.getByText('10040')).toBeTruthy()
    expect(screen.getByText('Routing activity')).toBeTruthy()
    // The team name appears on both the session row and the inbound entry.
    expect(screen.getAllByText('dsh/agent-1').length).toBeGreaterThan(1)
    // Relative time tolerates a second of test jitter.
    expect(screen.getByText(/3[01]s/)).toBeTruthy()
  })

  it('shows an unread badge for inbound activity that arrived while closed', async () => {
    stateActivity = [
      { ts: Date.now() - 60_000, dir: 'in', team: 'dsh/agent-1', peer: '', ok: true },
      { ts: Date.now() - 30_000, dir: 'in', team: 'dsh/agent-2', peer: '', ok: true },
    ]
    const { container } = mountControl()
    // The badge renders on the trigger without opening the panel.
    expect(await waitFor(() => { expect(container.querySelector('[aria-label="2"]')).not.toBeNull() }))
    openPopover()
    // Opening clears the unread count.
    await waitFor(() => { expect(container.querySelector('[aria-label="2"]')).toBeNull() })
  })
})
