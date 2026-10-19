// @vitest-environment jsdom
/**
 * A2aControl behavior (panel-slim shape): the panel is the recent network
 * activity feed — in-flight routes, owed receipts, and the routing ring —
 * plus the stage links that navigate to the planning view where session
 * and team management now live (docs/design/panel-activity-feed.md).
 * Covers: popover toggle + outside close, the version badge, unread badge
 * for inbound activity while closed, feed polling and failure quietness,
 * the stale-wait dimming, the fail text mark, and the empty state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { A2aControlProps } from '../../src/client/A2aControl.tsx'
import { A2aControl } from '../../src/client/A2aControl.tsx'
import { en } from '../../src/client/locales.ts'

const t: A2aControlProps['t'] = key => (en as Record<string, string>)[key] ?? key

const openSession = vi.fn<(id: string) => void>()

// The slim control no longer reads the sessions hook; the stubs keep the
// runtime seat shape satisfied without anything to read.
const useSessionsStub = (<S,>(sel: (s: { byId: Record<string, { displayTitle?: string }> }) => S): S =>
  sel({ byId: {} })) as A2aControlProps['useSessions']
const neverHook = (() => { throw new Error('control must not read global hooks') }) as never

interface SlimSessionRow {
  readonly id: string
  readonly team: string
}

let stateSessions: SlimSessionRow[] = []
let stateInFlight: { team: string; peer: string; startedAt: number }[] = []
let stateTasks: { taskId: string; team: string; peer: string; startedAt: number; status: string }[] = []
let stateActivity: { ts: number; dir: 'in' | 'out'; team: string; peer: string; ok: boolean }[] = []
let stateVersion: string | undefined
let stateHasCanvas = false
let stateOk = true
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

function jsonResponse(body: unknown, ok = true): Promise<Response> {
  return Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => body } as Response)
}

function mountControl({ wide = true }: { wide?: boolean } = {}) {
  return render(<A2aControl wide={wide} t={t} useSessions={useSessionsStub} useWorkspaces={neverHook} openSession={openSession} />)
}

describe('A2aControl (activity feed)', () => {
  beforeEach(() => {
    stateSessions = [{ id: 'agent-1', team: 'dsh/agent-1' }]
    stateInFlight = []
    stateTasks = []
    stateActivity = []
    stateVersion = undefined
    stateHasCanvas = false
    stateOk = true
    openSession.mockReset()
    fetchMock.mockReset()
    fetchMock.mockImplementation(((input: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({ id: 'agent-1' })
      return stateOk
        ? jsonResponse({
          nodes: true,
          ...(stateVersion === undefined ? {} : { version: stateVersion }),
          sessions: stateSessions,
          activity: stateActivity,
          inFlight: stateInFlight,
          tasks: stateTasks,
          ...(stateHasCanvas ? { canvas: { teams: [] } } : {}),
        })
        : jsonResponse({ error: 'gone' }, false)
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

  it('shows the plugin version badge when the state route reports one', async () => {
    stateVersion = '0.5.4'
    mountControl()
    openPopover()
    expect(await screen.findByText('v0.5.4')).toBeTruthy()
  })

  it('omits the version badge when the state route omits the field', async () => {
    mountControl()
    openPopover()
    expect(await screen.findByText('A2A network activity')).toBeTruthy()
    expect(screen.queryByText(/^v[0-9]/)).toBeNull()
  })

  it('lists tasks owed a receipt with their wait age', async () => {
    stateTasks = [
      { taskId: 'direct-aa', team: 'dsh/agent-1', peer: 'local', startedAt: Date.now() - 65_000, status: 'pending' },
      { taskId: 'direct-bb', team: 'team-x', peer: 'http://192.168.1.4:41243', startedAt: Date.now() - 3_600_000, status: 'pending' },
    ]
    mountControl()
    openPopover()
    expect(await screen.findByText('Owed receipts')).toBeTruthy()
    expect(screen.getByText('dsh/agent-1')).toBeTruthy()
    expect(screen.getByText('team-x')).toBeTruthy()
    expect(screen.getByText('1m')).toBeTruthy()
    expect(screen.getByText('1h')).toBeTruthy()
  })

  it('hides the owed-receipts block when no task is pending', async () => {
    mountControl()
    openPopover()
    expect(await screen.findByText('Recent activity')).toBeTruthy()
    expect(screen.queryByText('Owed receipts')).toBeNull()
  })

  it('toggles the popover, shows the feed, and closes on outside pointerdown', async () => {
    stateActivity = [{ ts: Date.now(), dir: 'out', team: 'dsh/agent-1', peer: 'http://10.0.0.2:13080', ok: true }]
    mountControl()
    openPopover()
    expect(await screen.findByText('dsh/agent-1')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('polls the feed while the popover stays open', async () => {
    vi.useFakeTimers()
    try {
      mountControl()
      openPopover()
      await act(async () => { await Promise.resolve() })
      const baseline = fetchMock.mock.calls.length
      await act(async () => { vi.advanceTimersByTime(2_100) })
      expect(fetchMock.mock.calls.length).toBeGreaterThan(baseline)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the last listing when a refresh fails', async () => {
    stateActivity = [{ ts: Date.now(), dir: 'out', team: 'dsh/agent-1', peer: '', ok: true }]
    mountControl()
    openPopover()
    expect(await screen.findByText('dsh/agent-1')).toBeTruthy()
    stateOk = false
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('dsh/agent-1')).toBeTruthy()
  })

  it('dims an in-flight row whose reply wait is stale', async () => {
    stateInFlight = [{ team: 'dsh/agent-1', peer: 'http://10.0.0.2:13080', startedAt: Date.now() - 200_000 }]
    mountControl()
    openPopover()
    const row = await screen.findByText('dsh/agent-1')
    const staleRow = row.closest('[class*="inFlightRow"]')
    expect(staleRow?.className).toMatch(/inFlightStale/)
  })

  it('renders the routing activity ring with direction, peer host, and fail mark', async () => {
    stateActivity = [
      { ts: Date.now(), dir: 'in', team: 'dsh/agent-1', peer: 'http://10.0.0.2:13080', ok: true },
      { ts: Date.now() - 1_000, dir: 'out', team: 'team-x', peer: 'http://192.168.1.4:41243', ok: false },
    ]
    mountControl()
    openPopover()
    expect(await screen.findByText('team-x')).toBeTruthy()
    expect(screen.getByText('192.168.1.4:41243')).toBeTruthy()
    expect(screen.getByLabelText('failed')).toBeTruthy()
    expect(screen.getByLabelText('inbound')).toBeTruthy()
  })

  it('opens the session when an activity row matches a session team', async () => {
    stateActivity = [{ ts: Date.now(), dir: 'out', team: 'dsh/agent-1', peer: '', ok: true }]
    mountControl()
    openPopover()
    const rowEl = await screen.findByText('dsh/agent-1')
    fireEvent.click(rowEl.closest('[data-jump]')!)
    expect(openSession).toHaveBeenCalledWith('agent-1')
  })

  it('shows the empty state with planning-view guidance when no routes exist', async () => {
    mountControl()
    openPopover()
    expect(await screen.findByText(/No network activity yet/)).toBeTruthy()
  })

  it('shows an unread badge for inbound activity that arrived while closed', async () => {
    stateActivity = [
      { ts: Date.now(), dir: 'in', team: 'dsh/agent-1', peer: '', ok: true },
      { ts: Date.now() - 1_000, dir: 'in', team: 'team-x', peer: '', ok: true },
    ]
    mountControl()
    expect(await screen.findByLabelText('2')).toBeTruthy()
  })

  it('links the A2A workbench from the panel header', async () => {
    mountControl()
    openPopover()
    const link = await screen.findByTitle('Open workbench')
    expect(link.getAttribute('href')).toBe('/__dsh_a2a_nexus/')
  })

  it('keeps a single workbench entry point even while the canvas face is up', async () => {
    stateHasCanvas = true
    mountControl()
    openPopover()
    const link = await screen.findByTitle('Open workbench')
    expect(link.getAttribute('href')).toBe('/__dsh_a2a_nexus/')
    expect(screen.queryByTitle('Open planning board')).toBeNull()
    expect(document.querySelectorAll('a[href^="/__dsh_a2a_nexus/"]').length).toBe(1)
  })

  it('no longer renders session management sections (migrated to the planning view)', async () => {
    stateTasks = [{ taskId: 'direct-aa', team: 'dsh/agent-1', peer: 'local', startedAt: Date.now(), status: 'pending' }]
    mountControl()
    openPopover()
    await screen.findByText('Recent activity')
    expect(screen.queryByText('Peers')).toBeNull()
    expect(screen.queryByPlaceholderText(/Search sessions/)).toBeNull()
    expect(screen.queryByText('Canvas teams')).toBeNull()
  })

  // 0.6.7 click-to-reach receive face: the workbench's ↗ jumps open a
  // session here. L1 — same-browser broadcast; L2 — cross-origin window
  // message carrying the team handle for local resolution.
  it('opens a session from an L1 workbench broadcast on the dsh-a2a channel', async () => {
    class MockBroadcastChannel {
      static instances: MockBroadcastChannel[] = []
      public onmessage: ((event: { data: unknown }) => void) | null = null
      public constructor(public readonly name: string) { MockBroadcastChannel.instances.push(this) }
      public postMessage = vi.fn()
      public close(): void {}
    }
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    mountControl()
    await screen.findByText('A2A network') // mounted, listeners bound
    const channel = MockBroadcastChannel.instances.at(-1)!
    expect(channel.name).toBe('dsh-a2a')
    channel.onmessage?.({ data: { type: 'dsh-a2a:open-session', id: 'agent-1' } })
    expect(openSession).toHaveBeenCalledWith('agent-1')
    // Foreign shapes are ignored, not misrouted.
    channel.onmessage?.({ data: { type: 'something-else', id: 'x' } })
    channel.onmessage?.({ data: 'plain string' })
    expect(openSession).toHaveBeenCalledTimes(1)
  })

  it('resolves an L2 cross-origin team handle against local sessions, ignoring strangers', async () => {
    stateActivity = [{ ts: Date.now(), dir: 'out', team: 'dsh/agent-1', peer: '', ok: true }]
    mountControl()
    openPopover()
    // An activity row for the same team proves the state poll has landed
    // and the re-subscribed listener carries the session table.
    await screen.findByText('dsh/agent-1')
    fireEvent(window, new MessageEvent('message', { data: { type: 'dsh-a2a:open-session', team: 'dsh/agent-1' } }))
    expect(openSession).toHaveBeenCalledWith('agent-1')
    fireEvent(window, new MessageEvent('message', { data: { type: 'dsh-a2a:open-session', team: 'stranger/0123abcd' } }))
    expect(openSession).toHaveBeenCalledTimes(1)
  })

  // 0.6.8: the L2 jump is a ?dsh-a2a-open=<handle> deep link — responsive by
  // construction, no sender-side timers. The panel resolves it once per page
  // load, waits for the first /state fetch, strips the param, and drops
  // handles it does not know.
  it('opens the session named by the ?dsh-a2a-open deep link and strips the param', async () => {
    stateVersion = '0.6.8'
    window.history.replaceState(null, '', '/?dsh-a2a-open=dsh%2Fagent-1&keep=1')
    mountControl()
    await waitFor(() => { expect(openSession).toHaveBeenCalledWith('agent-1') })
    // Only its own key is consumed; other query params survive.
    expect(window.location.search).toBe('?keep=1')
    // Once per page load: later re-renders do not re-fire it.
    expect(openSession).toHaveBeenCalledTimes(1)
  })

  it('drops a ?dsh-a2a-open deep link whose handle is unknown once state lands', async () => {
    stateVersion = '0.6.8'
    window.history.replaceState(null, '', '/?dsh-a2a-open=stranger%2F0123abcd')
    mountControl()
    await screen.findByText('A2A network')
    await waitFor(() => { expect(window.location.search).toBe('') })
    expect(openSession).not.toHaveBeenCalled()
  })
})
