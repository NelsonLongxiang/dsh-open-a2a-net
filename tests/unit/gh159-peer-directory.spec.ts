/** Security and projection guards for remote canvas directory rows (#159). */
import { describe, expect, it } from 'vitest'
import { CANVAS_MEMBER_CAP, CANVAS_NAME_MAX, CANVAS_TEAM_CAP } from '../../src/canvas-store.ts'
import { advertisedCanvasTeams, canvasTargetAmbiguous, peerDirectoryRows, sessionCandidateMatches } from '../../src/peer-directory.ts'
import type { A2aPeerCard } from '../../src/types.ts'

const card = (org: NonNullable<A2aPeerCard['canvasOrg']>): A2aPeerCard => ({
  name: 'peer', session: 'peer-session', team: 'zone', capabilities: { roster: true },
  expiresAt: 4_000_000_000_000, publicKey: 'key', signature: 'signature',
  lanIp: '192.0.2.10',
  sessionTeams: [{ team: 'zone/12345678', name: 'seat', description: 'live' }],
  teamMemberships: [{ node: 'zone/12345678', team: 'team/shared' }],
  canvasOrg: org,
})

describe('gh#159 peer directory projection', () => {
  it('keeps session rows unchanged and adds canvas rows only when requested', () => {
    const peer = card([{ name: '研发协作', team: 'zone/canvas/研发协作', members: ['home/aaaaaaaa'] }])
    const original = peerDirectoryRows(peer, 'http://peer', false)
    expect(original).toEqual([
      { team: 'zone', session: 'peer-session', name: 'peer', description: '', origin: 'peer-session (192.0.2.10)', via: 'http://peer' },
      { team: 'zone/12345678', session: 'peer-session', name: 'seat', description: 'live', origin: 'peer-session (192.0.2.10)', via: 'http://peer', teams: ['team/shared'] },
    ])
    expect(peerDirectoryRows(peer, 'http://peer', true)).toEqual([
      ...original,
      { team: 'zone/canvas/研发协作', session: 'peer-session', name: '研发协作', description: 'canvas team', origin: 'peer-session (192.0.2.10)', via: 'http://peer', canvasMembers: ['home/aaaaaaaa'] },
    ])
  })

  it('decorates canvas rows with a published roster without turning it into member data', () => {
    const team = 'zone/canvas/研发协作'
    const peer: A2aPeerCard = {
      ...card([{ name: '研发协作', team, members: ['home/aaaaaaaa'] }]),
      teamMemberships: [{ node: team, team: 'team/shared' }],
    }
    const group = peerDirectoryRows(peer, 'http://peer', true).find(row => row.team === team)
    expect(group).toMatchObject({ origin: 'peer-session (192.0.2.10)', via: 'http://peer', teams: ['team/shared'] })
    expect(group?.canvasMembers).toEqual(['home/aaaaaaaa'])
    expect(group).not.toHaveProperty('members')
  })

  it('rejects foreign namespaces, mismatched names, malformed names and duplicate teams', () => {
    const org = [
      { name: 'ok', team: 'zone/canvas/ok', members: [] },
      { name: 'ok', team: 'zone/canvas/ok', members: ['home/aaaaaaaa'] },
      { name: 'other', team: 'foreign/canvas/other', members: [] },
      { name: 'wrong', team: 'zone/canvas/not-wrong', members: [] },
      { name: '', team: 'zone/canvas/', members: [] },
      { name: ' slash/name', team: 'zone/canvas/ slash/name', members: [] },
      { name: '123', team: 'zone/canvas/123', members: [] },
      { name: ' x ', team: 'zone/canvas/ x ', members: [] },
      { name: 'too-many', team: 'zone/canvas/too-many', members: Array(CANVAS_MEMBER_CAP + 1).fill('home/aaaaaaaa') },
      { name: 'a'.repeat(CANVAS_NAME_MAX + 1), team: 'zone/canvas/' + 'a'.repeat(CANVAS_NAME_MAX + 1), members: [] },
    ]
    expect(advertisedCanvasTeams(card(org))).toEqual([org[0]])
  })

  it('preserves a legitimate session under a zone ending in canvas', () => {
    const peer: A2aPeerCard = {
      ...card([]), team: 'zone/canvas',
      sessionTeams: [{ team: 'zone/canvas/12345678', name: 'seat', description: 'live' }],
    }
    expect(sessionCandidateMatches(peer, 'zone/canvas/12345678')).toBe(true)
    expect(peerDirectoryRows(peer, 'http://peer', false).some(row => row.team === 'zone/canvas/12345678')).toBe(true)
  })

  it('preserves a nested-zone session even when its suffix is a valid canvas name', () => {
    const peer: A2aPeerCard = {
      ...card([]), team: 'zone/canvas',
      sessionTeams: [{ team: 'zone/canvas/abcdef12', name: 'seat', description: 'live' }],
    }
    expect(sessionCandidateMatches(peer, 'zone/canvas/abcdef12')).toBe(true)
    expect(peerDirectoryRows(peer, 'http://peer', false).some(row => row.team === 'zone/canvas/abcdef12')).toBe(true)
  })

  it('cannot smuggle a foreign canvas target into a session claim', () => {
    const peer: A2aPeerCard = {
      ...card([]),
      sessionTeams: [{ team: 'other/canvas/ops', name: 'spoof', description: '' }],
    }
    expect(sessionCandidateMatches(peer, 'other/canvas/ops')).toBe(false)
    expect(peerDirectoryRows(peer, 'http://peer', false).some(row => row.team === 'other/canvas/ops')).toBe(false)
  })

  it('rejects distinct member-canvas owners but deduplicates aliases of the same card', () => {
    const team = 'zone/canvas/ops'
    const first = card([{ name: 'ops', team, members: ['home/aaaaaaaa'] }])
    const other = { ...first, session: 'other-host', publicKey: 'other-key' }
    const caller = { id: 'session-a', handle: 'home/aaaaaaaa' }
    const resolve = (): string => 'session-a'
    expect(canvasTargetAmbiguous([first, first], team, caller, resolve, false)).toBe(false)
    expect(canvasTargetAmbiguous([first, other], team, caller, resolve, false)).toBe(true)
    expect(canvasTargetAmbiguous([first, other], team, undefined, undefined, false)).toBe(true)
    const unshared = { ...other, canvasOrg: [{ name: 'ops', team, members: ['home/bbbbbbbb'] }] }
    expect(canvasTargetAmbiguous([first, unshared], team, caller, resolve, false)).toBe(false)
  })

  it('bounds a peer canvas claim to the existing host canvas-team cap', () => {
    const org = Array.from({ length: CANVAS_TEAM_CAP + 5 }, (_, i) => ({ name: 'team-' + i, team: 'zone/canvas/team-' + i, members: [] }))
    expect(advertisedCanvasTeams(card(org))).toHaveLength(CANVAS_TEAM_CAP)
  })
})
