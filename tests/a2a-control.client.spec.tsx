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
let stateGroups: string[] = []
let statePeers: { url: string; score?: number }[] = []
let stateInFlight: { team: string; peer: string; startedAt: number }[] = []
let stateTasks: { taskId: string; team: string; peer: string; startedAt: number; status: string }[] = []
let stateRemote: { team: string; name: string; origin?: string; workspace?: string }[] = []
let stateActivity: { ts: number; dir: 'in' | 'out'; team: string; peer: string; ok: boolean }[] = []
let stateVersion: string | undefined
type CanvasTeamFixture = { name: string; team: string; members: Array<{ id: string; team: string; joined: boolean; live: boolean }> }
let stateCanvas: readonly CanvasTeamFixture[] | undefined = undefined
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
    stateCanvas = undefined
    stateSessions = [row()]
    stateGroups = []
    statePeers = []
    stateInFlight = []
    stateTasks = []
    stateRemote = []
    stateActivity = []
    stateVersion = undefined
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
      return stateOk ? jsonResponse({ nodes: true, ...(stateVersion === undefined ? {} : { version: stateVersion }), sessions: stateSessions, groups: stateGroups, peers: statePeers, activity: stateActivity, inFlight: stateInFlight, tasks: stateTasks, remote: stateRemote, ...(stateCanvas === undefined ? {} : { canvas: { teams: stateCanvas } }) }) : jsonResponse({ error: 'gone' }, false)
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
    expect(await screen.findByText('Parser porting session')).toBeTruthy()
    expect(screen.queryByText(/^v[0-9]/)).toBeNull()
  })

  it('lists tasks owed a receipt with their wait age', async () => {
    // A distinct session team keeps the owed-row assertions unambiguous.
    stateSessions = [row({ team: 'dsh/agent-9' })]
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
    expect(await screen.findByText('Parser porting session')).toBeTruthy()
    expect(screen.queryByText('Owed receipts')).toBeNull()
  })

  it('renders the canvas section when the host serves the canvas face', async () => {
    stateCanvas = [
      {
        name: 'alpha',
        team: 'dsh/canvas/alpha',
        members: [
          { id: 'agent-1', team: 'dsh/agent-1', joined: true, live: true },
          { id: 'session-cold1', team: 'dsh/cold1', joined: true, live: false },
        ],
      },
      { name: 'beta', team: 'dsh/canvas/beta', members: [{ id: 'agent-1', team: 'dsh/agent-1', joined: true, live: true }] },
    ]
    mountControl()
    openPopover()
    // Both teams visible; agent-1 appears as a member chip in BOTH teams —
    // the one-node-many-teams view is the point of the canvas.
    expect(await screen.findByText('Canvas teams (arbitrary grouping)')).toBeTruthy()
    const alphaHead = await screen.findByText(/alpha · 2/)
    expect(alphaHead).toBeTruthy()
    expect(screen.getByText(/beta · 1/)).toBeTruthy()
    const chips = screen.getAllByText('Parser porting session')
    expect(chips.length).toBeGreaterThanOrEqual(2)
  })

  it('omits the canvas section when the host does not serve the canvas face', async () => {
    stateSessions = [row()]
    stateCanvas = undefined
    mountControl()
    openPopover()
    expect(await screen.findByText('Parser porting session')).toBeTruthy()
    expect(screen.queryByText('Canvas teams (arbitrary grouping)')).toBeNull()
  })

  it('creates a canvas team from the section input', async () => {
    stateCanvas = []
    let created: string | undefined
    fetchMock.mockImplementation(((input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        created = typeof init?.body === 'string' ? init.body : ''
        return jsonResponse({ ok: true, name: 'gamma', teams: [{ name: 'gamma', team: 'dsh/canvas/gamma', members: [] }] })
      }
      return jsonResponse({ nodes: true, sessions: [], groups: [], peers: [], activity: [], inFlight: [], tasks: [], remote: [], canvas: { teams: created === undefined ? [] : [{ name: 'gamma', team: 'dsh/canvas/gamma', members: [] }] } })
    }))
    mountControl()
    openPopover()
    // fetchMock serves the canvas face with an empty team list from the
    // first poll, so the section renders before anything is created.
    await screen.findByPlaceholderText('New team name')
    fireEvent.change(screen.getByPlaceholderText('New team name'), { target: { value: 'gamma' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => {
      expect(created).toBe(JSON.stringify({ action: 'create', name: 'gamma' }))
    })
    await screen.findByText(/gamma · 0/)
  })

  it('adds a member through the joined-only picker and removes one from a chip', async () => {
    stateSessions = [row({ joined: true }), row({ id: 'unjoined-1', label: 'dsh-host-ab12cd34-unjoined-1', team: 'dsh/unjoined-1', joined: false })]
    stateCanvas = [{ name: 'alpha', team: 'dsh/canvas/alpha', members: [] }]
    const postedBodies: string[] = []
    fetchMock.mockImplementation(((input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = typeof init?.body === 'string' ? init.body : ''
        postedBodies.push(body)
        // The host applies mutations immediately; mirror that so the
        // refresh this handler triggers already carries the new membership.
        if (body.includes('add-member')) {
          stateCanvas = [{ name: 'alpha', team: 'dsh/canvas/alpha', members: [{ id: 'agent-1', team: 'dsh/agent-1', joined: true, live: true }] }]
        }
        return jsonResponse({ ok: true })
      }
      return jsonResponse({ nodes: true, sessions: stateSessions, groups: [], peers: [], activity: [], inFlight: [], tasks: [], remote: [], canvas: { teams: stateCanvas } })
    }))
    mountControl()
    openPopover()
    fireEvent.click(await screen.findByRole('button', { name: '+ Add member' }))
    // The picker lists only joined sessions — the unjoined row stays out
    // of the picker (no membership without join consent), though it still
    // appears in the regular session listing above.
    await waitFor(() => {
      const options = Array.from(document.querySelectorAll('button[class*="groupOption"]'))
      expect(options.length).toBe(1)
      expect((options[0]?.textContent ?? '').includes('unjoined-1')).toBe(false)
    })
    const option = Array.from(document.querySelectorAll('button[class*="groupOption"]'))[0]!
    fireEvent.click(option)
    await waitFor(() => {
      expect(postedBodies).toContain(JSON.stringify({ action: 'add-member', name: 'alpha', id: 'agent-1' }))
    })
    // A member chip's × removes from that team.
    stateCanvas = [{ name: 'alpha', team: 'dsh/canvas/alpha', members: [{ id: 'agent-1', team: 'dsh/agent-1', joined: true, live: true }] }]
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from this team' }))
    await waitFor(() => {
      expect(postedBodies.some(body => body.includes('remove-member'))).toBe(true)
    })
  })

  it('deletes a canvas team with its memberships', async () => {
    stateCanvas = [{ name: 'alpha', team: 'dsh/canvas/alpha', members: [{ id: 'agent-1', team: 'dsh/agent-1', joined: true, live: true }] }]
    const postedBodies: string[] = []
    fetchMock.mockImplementation(((input: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        postedBodies.push(typeof init?.body === 'string' ? init.body : '')
        return jsonResponse({ ok: true })
      }
      return jsonResponse({ nodes: true, sessions: [row()], groups: [], peers: [], activity: [], inFlight: [], tasks: [], remote: [], canvas: { teams: stateCanvas } })
    }))
    mountControl()
    openPopover()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(postedBodies).toContain(JSON.stringify({ action: 'remove', name: 'alpha' }))
    })
  })
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

  it('dims an in-flight row whose reply wait is stale', async () => {
    stateInFlight = [{ team: 'dsh/agent-1', peer: 'local', startedAt: Date.now() - 150_000 }]
    mountControl()
    openPopover()
    expect(await screen.findByText('Routing activity')).toBeTruthy()
    // The stale row carries the explanatory tooltip instead of implying an active pulse.
    expect(screen.getByTitle(/Reply wait past 120s/)).toBeTruthy()
  })
  it('renders remote teams grouped by their publishing host', async () => {
    stateRemote = [
      { team: 'dsh', name: 'Test home node', origin: 'dsh-host-host-alpha (10.20.30.40)', workspace: 'D:/work/demo-plugin' },
      { team: 'dsh/peer-backup', name: 'Doctor backup', origin: 'dsh-host-host-alpha (10.20.30.40)' },
      { team: 'fleet', name: 'Other host', origin: 'dsh-host-aa11bb22 (10.20.30.41)' },
    ]
    mountControl()
    openPopover()
    expect(await screen.findByText('Remote teams (by host)')).toBeTruthy()
    // One collapsible header per origin, counting its rows.
    expect(screen.getByText(/dsh-host-host-alpha .* 2/)).toBeTruthy()
    expect(screen.getByText(/dsh-host-aa11bb22 .* 1/)).toBeTruthy()
    // The workspace rides the row as its natural-group tag.
    expect(screen.getByText('D:/work/demo-plugin')).toBeTruthy()
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

  it('filters session rows through the search box', async () => {
    stateSessions = [row(), row({ id: 'agent-2', label: 'dsh-host-ab12cd34-agent-2', team: 'dsh/agent-2', name: 'Telemetry review', description: 'check notices wiring' })]
    mountControl()
    openPopover()
    expect(await screen.findByText('Parser porting session')).toBeTruthy()
    expect(screen.getByText('Telemetry review')).toBeTruthy()
    // Searching narrows to the matching row only.
    fireEvent.change(screen.getByLabelText('Search sessions (name / team / excerpt)'), { target: { value: 'telemetry' } })
    expect(screen.queryByText('Parser porting session')).toBeNull()
    expect(screen.getByText('Telemetry review')).toBeTruthy()
    // Searching by team substring also matches.
    fireEvent.change(screen.getByLabelText('Search sessions (name / team / excerpt)'), { target: { value: 'dsh/agent-1' } })
    expect(screen.getByText('Parser porting session')).toBeTruthy()
    expect(screen.queryByText('Telemetry review')).toBeNull()
  })

  it('renders grouped sessions under their group heads and assigns through the picker', async () => {
    stateSessions = [row(), row({ id: 'agent-2', label: 'dsh-host-ab12cd34-agent-2', team: 'dsh/agent-2', name: 'Telemetry review', group: 'ops' })]
    stateGroups = ['ops']
    mountControl()
    openPopover()
    // The ungrouped head counts the row without a group; the ops group head
    // renders with its member.
    expect(await screen.findByText(/Ungrouped · 1/)).toBeTruthy()
    expect(screen.getByText(/ops · 1/)).toBeTruthy()
    expect(screen.getByText('Telemetry review')).toBeTruthy()
    // The group tag pill shows on the assigned row.
    expect(screen.getByText('ops')).toBeTruthy()
    // The picker's assign posts to the groups route.
    fireEvent.click(screen.getAllByLabelText('Set group')[0]!)
    fireEvent.click(screen.getByText('Clear group'))
    await waitFor(() => {
      expect(posts).toContainEqual({ url: '/__dsh_a2a/groups', body: JSON.stringify({ action: 'assign', id: 'agent-1', name: '' }) })
    })
  })
})
