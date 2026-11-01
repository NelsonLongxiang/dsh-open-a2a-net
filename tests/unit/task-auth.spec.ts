/**
 * gh#114 S1 pins: every admission rule of the closed set on the pure
 * decision (src/task-auth.ts), its basis, the refusal texts the faces have
 * always shown, and golden vectors for the allowlist version hash.
 */
import { describe, expect, it } from 'vitest'
import {
  VIA_OF, allowlistVersion, callerAdmission, canonicalAllowlist, joinedFaceAdmission, refusalOf, sameZoneAdmission,
  type AdmissionRecords, type AdmissionRule, type AllowlistInputs, type PeerOrgEntry,
} from '../../src/task-auth.ts'

const ZONE = 'dsh'
/** Session ids whose id8 is their first 8 chars, as the host's id8 does for long ids. */
const A = 'aaaaaaaa-1111'
const B = 'bbbbbbbb-2222'
const C = 'cccccccc-3333'

interface World {
  scopeOff?: boolean
  memberships?: { session: string; teams: string[] }[]
  joined?: string[]
  canvas?: Record<string, string[]>
  orgs?: PeerOrgEntry[][]
  live?: string[]
  cli?: string[]
}

function records(w: World = {}): AdmissionRecords {
  const canvas = w.canvas ?? {}
  return {
    zone: ZONE,
    teamScopeRouting: w.scopeOff !== true,
    id8: id => id.slice(0, 8),
    canvasTeamOf: name => `${ZONE}/canvas/${name}`,
    memberships: () => w.memberships ?? [],
    joined: () => w.joined ?? [],
    canvasNames: () => Object.keys(canvas),
    canvasTeamsOf: sessionId => Object.keys(canvas).filter(name => canvas[name]!.includes(sessionId)),
    canvasMembersOf: name => canvas[name] ?? [],
    canvasRemoteMembersOf: name => (canvas[name] ?? []).filter(m => m.includes('/')),
    peerOrgs: () => w.orgs ?? [],
    liveNodeIds: () => w.live ?? [],
    cliDeposited: handle => (w.cli ?? []).includes(handle),
  }
}

const ruleOf = (verdict: ReturnType<typeof callerAdmission>): AdmissionRule | undefined => (verdict.ok ? verdict.rule : undefined)

describe('gh#114 S1: every admission rule, with its basis', () => {
  it('scope-off: team-scope routing disabled admits anyone, basis open', () => {
    const v = callerAdmission(records({ scopeOff: true }), 'anything')
    expect(v).toEqual({ ok: true, via: 'open', rule: 'scope-off', basis: [] })
  })

  it('host-face: the bare zone team', () => {
    expect(callerAdmission(records(), ZONE)).toEqual({ ok: true, via: 'host-face', rule: 'host-face', basis: [] })
  })

  it('roster-shared: a declared team another local session also declares', () => {
    const r = records({ memberships: [{ session: A, teams: ['dsh/team-x'] }, { session: B, teams: ['dsh/team-x'] }], joined: [A, B] })
    expect(callerAdmission(r, 'dsh/aaaaaaaa')).toEqual({ ok: true, via: 'joined-session', rule: 'roster-shared', basis: ['dsh/team-x'] })
  })

  it('canvas-shared: canvas membership is a link record (W2②); the target-level basis is the shared canvas', () => {
    const r = records({ joined: [A, B], canvas: { ops: [A, B] } })
    expect(callerAdmission(r, 'dsh/aaaaaaaa', 'dsh/bbbbbbbb')).toEqual({ ok: true, via: 'canvas-member', rule: 'canvas-shared', basis: ['dsh/canvas/ops'] })
  })

  it('the rule is the first branch that hit, and basis keeps every shared team', () => {
    const r = records({ memberships: [{ session: A, teams: ['dsh/canvas/ops'] }], joined: [A, B], canvas: { ops: [A, B], qa: [A, B] } })
    const v = callerAdmission(r, 'dsh/aaaaaaaa', 'dsh/bbbbbbbb')
    expect(v).toMatchObject({ rule: 'roster-shared', basis: ['dsh/canvas/ops', 'dsh/canvas/qa'] })
  })

  it('remote-ref-samezone: a same-zone handle with no local session, on a canvas remote ref (#43)', () => {
    const r = records({ canvas: { ops: [A, 'dsh/dddddddd'] }, joined: [A] })
    expect(callerAdmission(r, 'dsh/dddddddd')).toEqual({ ok: true, via: 'canvas-member', rule: 'remote-ref-samezone', basis: ['dsh/canvas/ops'] })
  })

  it('peer-org: a warm card org naming the caller and one of this host\'s handles (gh#71 ②)', () => {
    const r = records({ joined: [A], orgs: [[{ team: 'dsh/canvas/far', members: ['dsh/eeeeeeee', 'dsh/aaaaaaaa'] }]], memberships: [{ session: A, teams: ['dsh/canvas/far'] }] })
    expect(callerAdmission(r, 'dsh/eeeeeeee')).toEqual({ ok: true, via: 'peer-org', rule: 'peer-org', basis: ['peer-org:dsh/canvas/far'] })
  })

  it('remote-ref-foreign: a foreign-zone handle the operator added as a remote member (N3/N4)', () => {
    const r = records({ canvas: { ops: [A, 'qa/11112222'], qa: ['qa/11112222'] } })
    expect(callerAdmission(r, 'qa/11112222')).toEqual({ ok: true, via: 'canvas-member', rule: 'remote-ref-foreign', basis: ['dsh/canvas/ops', 'dsh/canvas/qa'] })
  })

  it('node-fact: a joined session id, its pseudo-handle, or a live node label', () => {
    const r = records({ joined: ['agent-1'], live: ['node-label-7'] })
    expect(ruleOf(callerAdmission(r, 'agent-1'))).toBe('node-fact')
    expect(ruleOf(callerAdmission(r, 'dsh/agent-1'))).toBe('node-fact')
    expect(ruleOf(callerAdmission(r, 'node-label-7'))).toBe('node-fact')
    expect(VIA_OF['node-fact']).toBe('joined-session')
  })

  it('cli-deposit: a deposited CLI handle (gh#45)', () => {
    const r = records({ cli: ['ops-cli/a1b2c3d4e5f60718'] })
    expect(callerAdmission(r, 'ops-cli/a1b2c3d4e5f60718')).toEqual({ ok: true, via: 'cli-deposit', rule: 'cli-deposit', basis: [] })
  })

  it('local-exempt is in the closed set for the local dispatch path (S2 stamps it); joinedFaceAdmission leaves other labels alone', () => {
    expect(VIA_OF['local-exempt']).toBe('host-face')
    expect(joinedFaceAdmission(records(), undefined)).toBeUndefined()
    expect(joinedFaceAdmission(records(), 'dsh')).toBeUndefined()
    expect(joinedFaceAdmission(records(), 'qa/11112222')).toBeUndefined()
    expect(joinedFaceAdmission(records({ joined: [A, B], canvas: { ops: [A, B] } }), 'dsh/aaaaaaaa', 'dsh/bbbbbbbb')).toMatchObject({ ok: true, rule: 'canvas-shared' })
  })
})

describe('gh#114 S1: refusal texts are the faces\' texts, byte for byte', () => {
  it('anonymous, teamless, unroutable, target-level, foreign, free-form', () => {
    expect(refusalOf(callerAdmission(records(), ''))).toBe('caller_session is required — anonymous deliveries are refused (S3 phase-3b). Pass caller_session as <zone>/<id8>.')
    expect(refusalOf(callerAdmission(records(), 'dsh/99999999'))).toBe('caller "dsh/99999999" declares no team membership on this host\'s roster — a teamless node has no network (S3 phase-3 admission). Declare a shared team on both ends, or route through a teamed member.')
    expect(refusalOf(callerAdmission(records({ memberships: [{ session: A, teams: ['dsh/lonely'] }], joined: [A] }), 'dsh/aaaaaaaa')))
      .toBe('caller "dsh/aaaaaaaa" declares teams [dsh/lonely] — none is routable on this node (shared-team admission). Declare a shared team on both ends, or route through a teamed member.')
    expect(refusalOf(callerAdmission(records({ joined: [A, B, C], canvas: { ops: [A, C], qa: [B] } }), 'dsh/aaaaaaaa', 'dsh/bbbbbbbb')))
      .toBe('caller "dsh/aaaaaaaa" shares no team with target "dsh/bbbbbbbb" — declared [dsh/canvas/ops], target links [dsh/canvas/qa] (F5 target-level admission: a host-level link alone does not open every session team).')
    expect(refusalOf(callerAdmission(records(), 'qa/11112222'))).toBe('caller "qa/11112222" has no operator-established link on this node — cross-host admission requires a canvas remote membership this host\'s operator added (N3/N4: the caller\'s own card claims are self-description, not links). Ask this host\'s operator to add the member in the A2A workbench, or route through a linked member.')
    expect(refusalOf(callerAdmission(records(), 'someone'))).toBe('caller_session "someone" matches no node fact on this host (joined session id, live node label, or deposited CLI handle) — free-form caller labels are self-description and are not admissible (N3). Pass caller_session as <zone>/<id8> with an operator-established link.')
  })

  it('a target-level peer-org link opens the target, is labelled peer-org, and never adds to the caller\'s declared list', () => {
    const r = records({ joined: [A, B], memberships: [{ session: A, teams: ['dsh/canvas/far'] }], orgs: [[{ team: 'dsh/canvas/far', members: ['dsh/aaaaaaaa', 'dsh/bbbbbbbb'] }]] })
    // Only the cached org links the target: without the cache this is refused, so the rule is peer-org (review of PR #126 P2).
    expect(sameZoneAdmission(r, 'dsh/aaaaaaaa', 'dsh/bbbbbbbb')).toEqual({ ok: true, via: 'peer-org', rule: 'peer-org', basis: ['peer-org:dsh/canvas/far'] })
    // When the target's own roster also holds the team, the firm basis wins.
    const firm = records({ joined: [A, B], memberships: [{ session: A, teams: ['dsh/canvas/far'] }, { session: B, teams: ['dsh/canvas/far'] }], orgs: [[{ team: 'dsh/canvas/far', members: ['dsh/aaaaaaaa', 'dsh/bbbbbbbb'] }]] })
    expect(sameZoneAdmission(firm, 'dsh/aaaaaaaa', 'dsh/bbbbbbbb')).toMatchObject({ rule: 'roster-shared', basis: ['dsh/canvas/far'] })
    const lonely = records({ joined: [A, B], orgs: [[{ team: 'dsh/canvas/far', members: ['dsh/aaaaaaaa', 'dsh/bbbbbbbb'] }]] })
    expect(refusalOf(sameZoneAdmission(lonely, 'dsh/aaaaaaaa', 'dsh/bbbbbbbb'))).toMatch(/^caller "dsh\/aaaaaaaa" declares no team membership/)
  })
})

describe('gh#128: a canvas target is judged at target level (F5), not host level', () => {
  it('a member of another canvas no longer reaches a canvas team it is not in', () => {
    const r = records({ joined: [A, B], canvas: { ops: [A, B], qa: [B] } })
    // Before gh#128 this was ok (rule canvas-shared) on the host-level basis.
    expect(refusalOf(callerAdmission(r, 'dsh/aaaaaaaa', 'dsh/canvas/qa')))
      .toBe('caller "dsh/aaaaaaaa" shares no team with target "dsh/canvas/qa" — declared [dsh/canvas/ops], target links [dsh/canvas/qa] (F5 target-level admission: a host-level link alone does not open every session team).')
  })

  it('a member of the canvas, and a caller sharing a roster team with one of its members, still get in', () => {
    const r = records({ joined: [A, B, C], canvas: { ops: [A, B], qa: [B] }, memberships: [{ session: B, teams: ['dsh/team-x'] }, { session: C, teams: ['dsh/team-x'] }] })
    expect(callerAdmission(r, 'dsh/bbbbbbbb', 'dsh/canvas/qa')).toMatchObject({ ok: true, rule: 'roster-shared' })
    expect(callerAdmission(r, 'dsh/aaaaaaaa', 'dsh/canvas/ops')).toEqual({ ok: true, via: 'canvas-member', rule: 'canvas-shared', basis: ['dsh/canvas/ops'] })
    expect(callerAdmission(r, 'dsh/cccccccc', 'dsh/canvas/qa')).toMatchObject({ ok: true, rule: 'roster-shared', basis: ['dsh/team-x'] })
  })

  it('review of PR #129: a local session the canvas stores by handle (gh#41 fleet edit) is a member, as caller and as target', () => {
    const r = records({ joined: [A, B], canvas: { ops: ['dsh/aaaaaaaa', 'dsh/bbbbbbbb'], qa: [A] } })
    expect(joinedFaceAdmission(r, 'dsh/aaaaaaaa', 'dsh/canvas/ops')).toMatchObject({ ok: true, rule: 'canvas-shared', basis: ['dsh/canvas/ops'] })
    expect(callerAdmission(r, 'dsh/bbbbbbbb', 'dsh/canvas/ops')).toMatchObject({ ok: true, rule: 'canvas-shared' })
    expect(callerAdmission(r, 'dsh/aaaaaaaa', 'dsh/bbbbbbbb')).toMatchObject({ ok: true, rule: 'canvas-shared', basis: ['dsh/canvas/ops'] })
    // A handle-stored member's roster teams link the canvas target too.
    const roster = records({ joined: [A, B, C], canvas: { ops: ['dsh/bbbbbbbb'] }, memberships: [{ session: B, teams: ['dsh/team-x'] }, { session: C, teams: ['dsh/team-x'] }] })
    expect(callerAdmission(roster, 'dsh/cccccccc', 'dsh/canvas/ops')).toMatchObject({ ok: true, rule: 'roster-shared', basis: ['dsh/team-x'] })
  })

  it('a remote member ref of the canvas gets in; an unknown canvas name keeps the host-level basis', () => {
    const r = records({ joined: [A], canvas: { ops: [A, 'dsh/dddddddd'] } })
    expect(callerAdmission(r, 'dsh/dddddddd', 'dsh/canvas/ops')).toMatchObject({ ok: true, rule: 'remote-ref-samezone' })
    expect(callerAdmission(r, 'dsh/aaaaaaaa', 'dsh/canvas/none')).toMatchObject({ ok: true, rule: 'canvas-shared' })
  })
})

describe('gh#114 S1: allowlist version (golden vectors)', () => {
  const inputs: AllowlistInputs = {
    zone: 'dsh',
    scope: [true, true],
    joined: ['dsh/bbbbbbbb', 'dsh/aaaaaaaa', 'dsh/aaaaaaaa'],
    roster: [['dsh/aaaaaaaa', 'dsh/team-x'], ['dsh/aaaaaaaa', 'dsh/team-x']],
    canvas: [['dsh/canvas/ops', ['dsh/bbbbbbbb', 'dsh/aaaaaaaa']]],
    cli: ['review-seat/f62b3c7aa9f44276'],
    links: ['http://100.75.181.127:13080'],
  }

  it('canonical JSON: fixed key order, sorted and deduplicated arrays, no whitespace', () => {
    expect(canonicalAllowlist(inputs)).toBe('{"zone":"dsh","scope":[true,true],"joined":["dsh/aaaaaaaa","dsh/bbbbbbbb"],"roster":[["dsh/aaaaaaaa","dsh/team-x"]],"canvas":[["dsh/canvas/ops",["dsh/aaaaaaaa","dsh/bbbbbbbb"]]],"cli":["review-seat/f62b3c7aa9f44276"],"links":["http://100.75.181.127:13080"]}')
  })

  it('the version is al1: + 16 hex, stable under input order, and moves with any input', () => {
    const v = allowlistVersion(inputs)
    expect(v).toBe('al1:f0833e50cbaafd15') // computed independently: python3 hashlib.sha256 over the canonical string above
    expect(allowlistVersion({ ...inputs, joined: [...inputs.joined].reverse(), canvas: [['dsh/canvas/ops', ['dsh/aaaaaaaa', 'dsh/bbbbbbbb']]] })).toBe(v)
    expect(allowlistVersion({ ...inputs, cli: [] })).not.toBe(v)
    expect(allowlistVersion({ ...inputs, scope: [true, false] })).not.toBe(v)
  })

  it('a canvas team listed twice is one team: members are unioned, so order never matters (review of PR #126 P2)', () => {
    const base = { zone: 'dsh', scope: [true, true] as const, joined: [], roster: [], cli: [], links: [] }
    const ab = allowlistVersion({ ...base, canvas: [['dsh/canvas/ops', ['dsh/a']], ['dsh/canvas/ops', ['dsh/b']]] })
    expect(allowlistVersion({ ...base, canvas: [['dsh/canvas/ops', ['dsh/b']], ['dsh/canvas/ops', ['dsh/a']]] })).toBe(ab)
    expect(allowlistVersion({ ...base, canvas: [['dsh/canvas/ops', ['dsh/a', 'dsh/b']]] })).toBe(ab)
  })

  it('non-ASCII: UTF-16 code-unit order, no normalization (golden vector)', () => {
    const v = allowlistVersion({ zone: 'dsh', scope: [true, false], joined: ['dsh/😀', 'dsh/！', 'dsh/é'], roster: [], canvas: [['dsh/canvas/ops', ['dsh/b', 'dsh/a']]], cli: [], links: [] })
    // Computed independently: python3, sorted by s.encode('utf-16-be'), json.dumps(ensure_ascii=False, separators=(',', ':')), sha256.
    expect(v).toBe('al1:7bba72a05146248e')
    expect(allowlistVersion({ zone: 'dsh', scope: [true, false], joined: ['dsh/cafe\u0301'], roster: [], canvas: [], cli: [], links: [] }))
      .not.toBe(allowlistVersion({ zone: 'dsh', scope: [true, false], joined: ['dsh/café'], roster: [], canvas: [], cli: [], links: [] }))
  })
})
