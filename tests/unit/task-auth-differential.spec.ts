/**
 * gh#114 S1 regression guard (from the independent review of PR #126): the
 * admission refusals of src/task-auth.ts must equal the closures they
 * replaced. OLD = the three closures copied verbatim from 078cd9f
 * src/index.ts:2660-2838 (only `config`/stores renamed to a world object) —
 * frozen on purpose: a change to admission text or behaviour must update
 * this copy deliberately. NEW = src/task-auth.ts behind a copy of the
 * `admissionRecords` adapter in src/index.ts.
 */
import { describe, expect, it } from 'vitest'
import { callerAdmission, joinedFaceAdmission, refusalOf, sameZoneAdmission, type AdmissionRecords, type PeerOrgEntry } from '../../src/task-auth.ts'

// ---- host-shaped stores ----------------------------------------------------
interface W {
  config: { team: string; teamScopeRouting: boolean }
  memberships: { session: string; teams: string[] }[]
  joined: string[]
  canvas: { name: string; members: string[] }[]
  cardCache: Map<string, { card?: unknown }>
  sessionNodes: Map<string, { id: unknown }>
  cli: Set<string>
}
function id8(id: string): string { // verbatim src/index.ts:1259
  const bare = id.replace(/^session-/, '')
  const imported = bare.match(/^import-([0-9a-fA-F]+)/)
  if (imported !== null) return `import-${imported[1]!.slice(0, 8)}`
  return bare.slice(0, 8)
}
function stores(w: W) {
  const config = w.config
  const teamMemberships = { list: () => w.memberships }
  const joinedSessions = { list: () => w.joined }
  const canvasStore = {
    list: (): readonly string[] => w.canvas.map(t => t.name),
    membersOf: (name: string): readonly string[] => { const e = w.canvas.find(t => t.name === name); return e === undefined ? [] : [...e.members] },
    remoteMembersOf(name: string): readonly string[] { return this.membersOf(name).filter(id => id.includes('/')) },
    teamsOf: (id: string): readonly string[] => w.canvas.filter(t => t.members.includes(id)).map(t => t.name),
  }
  const canvasTeamOf = (name: string): string => `${config.team}/canvas/${name}`
  const cardCache = w.cardCache
  const sessionNodes = w.sessionNodes
  const cliDeposits = { get: (h: string) => (w.cli.has(h) ? { h } : undefined) }
  return { config, teamMemberships, joinedSessions, canvasStore, canvasTeamOf, cardCache, sessionNodes, cliDeposits }
}

// ---- OLD (verbatim from base) -----------------------------------------------
function makeOld(w: W) {
  const { config, teamMemberships, joinedSessions, canvasStore, canvasTeamOf, cardCache, sessionNodes, cliDeposits } = stores(w)
  function sameZoneSharedTeamRefusal(caller: string, targetTeam?: string): string | undefined {
    const declared = new Set<string>()
    let callerSessionId: string | undefined
    for (const entry of teamMemberships.list()) {
      if (`${config.team}/${id8(entry.session)}` === caller) {
        callerSessionId = entry.session
        for (const t of entry.teams) declared.add(t)
      }
    }
    if (callerSessionId === undefined) {
      for (const id of joinedSessions.list()) {
        if (`${config.team}/${id8(id)}` === caller) { callerSessionId = id; break }
      }
    }
    if (callerSessionId !== undefined) {
      for (const name of canvasStore.teamsOf(callerSessionId)) declared.add(canvasTeamOf(name))
      // Deliberate update (review of PR #129): a member stored by its zone/id8 handle counts too.
      for (const name of canvasStore.list()) if (canvasStore.membersOf(name).includes(caller)) declared.add(canvasTeamOf(name))
    } else {
      for (const name of canvasStore.list()) {
        if (canvasStore.remoteMembersOf(name).includes(caller)) declared.add(canvasTeamOf(name))
      }
      const ownHandles = new Set<string>([config.team, ...joinedSessions.list().map(id => `${config.team}/${id8(id)}`)])
      for (const cached of cardCache.values()) {
        const org = (cached.card as { canvasOrg?: Array<{ team?: unknown; members?: unknown }> } | undefined)?.canvasOrg
        if (!Array.isArray(org)) continue
        for (const e of org) {
          if (typeof e.team !== 'string' || e.team === '' || !Array.isArray(e.members)) continue
          if (e.members.includes(caller) && e.members.some(m => typeof m === 'string' && ownHandles.has(m))) declared.add(e.team)
        }
      }
    }
    const routable = new Set<string>([config.team])
    for (const id of joinedSessions.list()) routable.add(`${config.team}/${id8(id)}`)
    for (const name of canvasStore.list()) routable.add(canvasTeamOf(name))
    const otherLocalDeclarations = new Set<string>()
    for (const entry of teamMemberships.list()) {
      if (`${config.team}/${id8(entry.session)}` === caller) continue
      for (const t of entry.teams) otherLocalDeclarations.add(t)
    }
    const shared = [...declared].some(t => routable.has(t) || otherLocalDeclarations.has(t))
    if (targetTeam !== undefined && targetTeam !== config.team) {
      let targetLinks: Set<string> | undefined
      // Deliberate update (gh#128): a canvas target resolves as a canvas before the id8 slice.
      const targetIsCanvas = canvasStore.list().some(name => canvasTeamOf(name) === targetTeam)
      const targetId8 = !targetIsCanvas && targetTeam.startsWith(`${config.team}/`) ? targetTeam.slice(config.team.length + 1) : undefined
      if (targetId8 !== undefined) {
        const targetSession = joinedSessions.list().find(sessionId => id8(sessionId) === targetId8)
          ?? teamMemberships.list().find(entry => id8(entry.session) === targetId8)?.session
        if (targetSession !== undefined) {
          targetLinks = new Set<string>()
          for (const entry of teamMemberships.list()) {
            if (entry.session === targetSession) for (const t of entry.teams) targetLinks.add(t)
          }
          for (const name of canvasStore.teamsOf(targetSession)) targetLinks.add(canvasTeamOf(name))
          for (const name of canvasStore.list()) if (canvasStore.membersOf(name).includes(targetTeam)) targetLinks.add(canvasTeamOf(name))
          for (const cached of cardCache.values()) {
            const org = (cached.card as { canvasOrg?: Array<{ team?: unknown; members?: unknown }> } | undefined)?.canvasOrg
            if (!Array.isArray(org)) continue
            for (const e of org) {
              if (typeof e.team !== 'string' || e.team === '' || !Array.isArray(e.members)) continue
              if (e.members.includes(caller) && e.members.includes(targetTeam)) targetLinks.add(e.team)
            }
          }
        }
      } else {
        const canvasName = canvasStore.list().find(name => canvasTeamOf(name) === targetTeam)
        if (canvasName !== undefined) {
          targetLinks = new Set<string>([targetTeam])
          for (const memberId of canvasStore.membersOf(canvasName)) {
            for (const entry of teamMemberships.list()) if (entry.session === memberId || `${config.team}/${id8(entry.session)}` === memberId) for (const t of entry.teams) targetLinks.add(t)
          }
        }
      }
      if (targetLinks !== undefined) {
        if ([...declared].some(t => targetLinks!.has(t))) return undefined
        return declared.size === 0
          ? `caller "${caller}" declares no team membership on this host's roster — a teamless node has no network (S3 phase-3 admission). Declare a shared team on both ends, or route through a teamed member.`
          : `caller "${caller}" shares no team with target "${targetTeam}" — declared [${[...declared].join(', ')}], target links [${[...targetLinks].join(', ')}] (F5 target-level admission: a host-level link alone does not open every session team).`
      }
    }
    if (shared) return undefined
    return declared.size === 0
      ? `caller "${caller}" declares no team membership on this host's roster — a teamless node has no network (S3 phase-3 admission). Declare a shared team on both ends, or route through a teamed member.`
      : `caller "${caller}" declares teams [${[...declared].join(', ')}] — none is routable on this node (shared-team admission). Declare a shared team on both ends, or route through a teamed member.`
  }
  const joinedFaceCallerShape = /^[a-z0-9-]+\/[0-9a-f]{8}$/i
  function joinedFaceAdmissionRefusal(callerSession: string | undefined, targetTeam?: string): string | undefined {
    if (callerSession === undefined || callerSession === '') return undefined
    if (!joinedFaceCallerShape.test(callerSession)) return undefined
    if (callerSession.slice(0, callerSession.indexOf('/')) !== config.team) return undefined
    return sameZoneSharedTeamRefusal(callerSession, targetTeam)
  }
  function a2aCallerRefusal(caller: string, targetTeam?: string): string | undefined {
    if (!config.teamScopeRouting) return undefined
    if (caller === '') {
      return 'caller_session is required — anonymous deliveries are refused (S3 phase-3b). Pass caller_session as <zone>/<id8>.'
    }
    if (caller === config.team) return undefined
    const zoneShaped = /^[a-z0-9-]+\/[0-9a-f]{8}$/i.test(caller)
    if (zoneShaped) {
      const callerZone = caller.slice(0, caller.indexOf('/'))
      if (callerZone === config.team) {
        return sameZoneSharedTeamRefusal(caller, targetTeam)
      }
      for (const name of canvasStore.list()) {
        if (canvasStore.remoteMembersOf(name).includes(caller)) return undefined
      }
      return `caller "${caller}" has no operator-established link on this node — cross-host admission requires a canvas remote membership this host's operator added (N3/N4: the caller's own card claims are self-description, not links). Ask this host's operator to add the member in the A2A workbench, or route through a linked member.`
    }
    if (joinedSessions.list().includes(caller)) return undefined
    for (const id of joinedSessions.list()) {
      if (`${config.team}/${id8(id)}` === caller) return undefined
    }
    for (const agent of sessionNodes.values()) {
      if (String(agent.id) === caller) return undefined
    }
    if (cliDeposits.get(caller) !== undefined) return undefined
    return `caller_session "${caller}" matches no node fact on this host (joined session id, live node label, or deposited CLI handle) — free-form caller labels are self-description and are not admissible (N3). Pass caller_session as <zone>/<id8> with an operator-established link.`
  }
  return { sameZoneSharedTeamRefusal, joinedFaceAdmissionRefusal, a2aCallerRefusal }
}

// ---- NEW adapter (copy of PR index.ts:2665-2689) ----------------------------
function makeRecords(w: W): AdmissionRecords {
  const { config, teamMemberships, joinedSessions, canvasStore, canvasTeamOf, cardCache, sessionNodes, cliDeposits } = stores(w)
  return {
    zone: config.team,
    get teamScopeRouting() { return config.teamScopeRouting },
    id8,
    canvasTeamOf,
    memberships: () => teamMemberships.list(),
    joined: () => joinedSessions.list(),
    canvasNames: () => canvasStore.list(),
    canvasTeamsOf: sessionId => canvasStore.teamsOf(sessionId),
    canvasMembersOf: name => canvasStore.membersOf(name),
    canvasRemoteMembersOf: name => canvasStore.remoteMembersOf(name),
    peerOrgs: function * () {
      for (const cached of cardCache.values()) {
        const org = (cached.card as { canvasOrg?: PeerOrgEntry[] } | undefined)?.canvasOrg
        if (Array.isArray(org)) yield org
      }
    },
    liveNodeIds: () => [...sessionNodes.values()].map(agent => String(agent.id)),
    cliDeposited: handle => cliDeposits.get(handle) !== undefined,
  }
}

// ---- random worlds ----------------------------------------------------------
let seed = 0x1263
const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
const some = <T>(xs: readonly T[], p = 0.35): T[] => xs.filter(() => rnd() < p)

const SESSIONS = ['aaaaaaaa-1111', 'aaaaaaaa-2222' /* id8 collision */, 'session-bbbbbbbb-3', 'cccccccc', 'import-ddddddddeeee', 'agent-1', 'AAAAAAAA-9']
const CANVAS = ['ops', 'qa', 'far', 'x']
const TEAMS = ['dsh', 'dsh/team-x', 'dsh/team-y', 'dsh/canvas/ops', 'dsh/canvas/qa', 'dsh/canvas/far', 'dsh/aaaaaaaa', 'dsh/bbbbbbbb', 'qa/team', 'dsh/canvas/nope']
const REMOTES = ['dsh/dddddddd', 'dsh/eeeeeeee', 'qa/11112222', 'dsh/aaaaaaaa', 'other/abcdef01', 'dsh/canvas/ops']
const CALLERS = ['', 'dsh', 'DSH', 'dsh/aaaaaaaa', 'dsh/AAAAAAAA', 'dsh/bbbbbbbb', 'dsh/cccccccc', 'dsh/dddddddd', 'dsh/eeeeeeee', 'dsh/99999999', 'qa/11112222', 'other/abcdef01', 'DSH/aaaaaaaa',
  'agent-1', 'dsh/agent-1', 'aaaaaaaa-1111', 'node-7', '7', 'ops-cli/a1b2c3d4e5f60718', 'someone', 'dsh/import-dd', 'dsh/import-dddddddd', 'dsh/canvas/ops']
const TARGETS: (string | undefined)[] = [undefined, 'dsh', 'dsh/aaaaaaaa', 'dsh/bbbbbbbb', 'dsh/cccccccc', 'dsh/agent-1', 'dsh/import-dddddddd', 'dsh/zzzzzzzz', 'dsh/canvas/ops', 'dsh/canvas/far', 'canvas/ops', 'qa/11112222', '', 'dsh/', 'dshx/aaaaaaaa']
const ORG_ENTRIES: unknown[] = [
  { team: 'dsh/canvas/far', members: ['dsh/eeeeeeee', 'dsh/aaaaaaaa'] },
  { team: 'dsh/team-x', members: ['dsh/dddddddd', 'dsh'] },
  { team: 'dsh/team-z', members: ['dsh/aaaaaaaa', 'dsh/bbbbbbbb'] },
  { team: 'far-team', members: ['dsh/eeeeeeee', 'dsh/cccccccc', 7] },
  { team: '', members: ['dsh/eeeeeeee', 'dsh'] },
  { team: 5, members: ['dsh/eeeeeeee', 'dsh'] },
  { team: 'dsh/team-y', members: 'dsh/eeeeeeee' },
  { team: 'dsh/team-y', members: ['dsh/dddddddd', 'dsh/import-dddddddd'] },
  {},
]

function world(): W {
  const joined = some(SESSIONS, 0.5)
  const memberships = some(SESSIONS, 0.45).map(s => ({ session: s, teams: some(TEAMS, 0.25) }))
  if (rnd() < 0.2 && memberships.length > 0) memberships.push({ session: memberships[0]!.session, teams: some(TEAMS, 0.3) }) // duplicate roster rows
  const canvas = some(CANVAS, 0.6).map(name => ({ name, members: [...some(SESSIONS, 0.3), ...some(REMOTES, 0.25)] }))
  const cardCache = new Map<string, { card?: unknown }>()
  const nCards = Math.floor(rnd() * 3)
  for (let i = 0; i < nCards; i++) {
    const shape = rnd()
    cardCache.set(`u${i}`, shape < 0.1 ? {} : shape < 0.2 ? { card: { canvasOrg: 'nope' } } : { card: { canvasOrg: some(ORG_ENTRIES, 0.4) } })
  }
  const sessionNodes = new Map<string, { id: unknown }>()
  for (const id of some(['node-7', 7, 'agent-1', 'dsh/aaaaaaaa'], 0.3)) sessionNodes.set(String(id), { id })
  return {
    config: { team: 'dsh', teamScopeRouting: rnd() > 0.1 },
    memberships, joined, canvas, cardCache, sessionNodes,
    cli: new Set(some(['ops-cli/a1b2c3d4e5f60718', 'someone'], 0.3)),
  }
}

describe('gh#114 S1 differential: the replaced closures vs task-auth', () => {
  it('a2aCallerRefusal / sameZoneSharedTeamRefusal / joinedFaceAdmissionRefusal agree on 500 random worlds', () => {
    let n = 0; let admitted = 0; let refused = 0
    for (let k = 0; k < 500; k++) {
      const w = world()
      const old = makeOld(w)
      const rec = makeRecords(w)
      for (const caller of CALLERS) {
        for (const target of TARGETS) {
          const a = old.a2aCallerRefusal(caller, target)
          const b = refusalOf(callerAdmission(rec, caller, target))
          if (a !== b) throw new Error(`a2aCaller diverge ${JSON.stringify({ w: { ...w, cardCache: [...w.cardCache], sessionNodes: [...w.sessionNodes], cli: [...w.cli] }, caller, target, a, b })}`)
          a === undefined ? admitted++ : refused++
          const c = old.sameZoneSharedTeamRefusal(caller, target)
          const d = refusalOf(sameZoneAdmission(rec, caller, target))
          if (c !== d) throw new Error(`sameZone diverge ${JSON.stringify({ caller, target, c, d })}`)
          const e = old.joinedFaceAdmissionRefusal(caller, target)
          const v = joinedFaceAdmission(rec, caller, target)
          const f = v === undefined ? undefined : refusalOf(v)
          if (e !== f) throw new Error(`joinedFace diverge ${JSON.stringify({ caller, target, e, f })}`)
          n++
        }
        // undefined callerSession on the joined face
        expect(joinedFaceAdmission(rec, undefined, undefined)).toBe(old.joinedFaceAdmissionRefusal(undefined, undefined))
      }
    }
    expect(admitted).toBeGreaterThan(10_000)
    expect(refused).toBeGreaterThan(10_000)
    expect(n).toBe(500 * CALLERS.length * TARGETS.length)
  }, 60_000)

  it('reads happen at call time (records object built once, world mutated after)', () => {
    const w: W = { config: { team: 'dsh', teamScopeRouting: true }, memberships: [], joined: [], canvas: [], cardCache: new Map(), sessionNodes: new Map(), cli: new Set() }
    const rec = makeRecords(w)
    expect(callerAdmission(rec, 'x').ok).toBe(false)
    w.config.teamScopeRouting = false
    expect(callerAdmission(rec, 'x')).toMatchObject({ ok: true, rule: 'scope-off' })
    w.config.teamScopeRouting = true
    w.sessionNodes.set('n', { id: 'x' })
    expect(callerAdmission(rec, 'x')).toMatchObject({ ok: true, rule: 'node-fact' })
    w.cli.add('y'); expect(callerAdmission(rec, 'y')).toMatchObject({ ok: true, rule: 'cli-deposit' })
    w.joined.push('aaaaaaaa-1'); w.canvas.push({ name: 'ops', members: ['aaaaaaaa-1', 'qa/11112222'] })
    expect(callerAdmission(rec, 'qa/11112222')).toMatchObject({ ok: true, rule: 'remote-ref-foreign' })
    w.cardCache.set('u', { card: { canvasOrg: [{ team: 'T', members: ['dsh/eeeeeeee', 'dsh/aaaaaaaa'] }] } })
    w.memberships.push({ session: 'aaaaaaaa-1', teams: ['T'] })
    expect(callerAdmission(rec, 'dsh/eeeeeeee')).toMatchObject({ ok: true, rule: 'peer-org' })
  })

  it('peer-org labels exactly the admissions that would vanish without the peer-card cache (review of PR #126 P2)', () => {
    let checked = 0
    for (let k = 0; k < 500; k++) {
      const w = world()
      const rec = makeRecords(w)
      const noOrgs = makeRecords({ ...w, cardCache: new Map() })
      for (const caller of CALLERS) for (const target of TARGETS) {
        const v = callerAdmission(rec, caller, target)
        if (!v.ok) continue
        checked += 1
        const without = callerAdmission(noOrgs, caller, target).ok
        if (v.via === 'peer-org') {
          // Reverse: a peer-org label is never put on a firm admission, and all its basis is cache-owed.
          expect(without, JSON.stringify({ caller, target, v })).toBe(false)
          expect(v.basis.every(team => team.startsWith('peer-org:')), JSON.stringify(v)).toBe(true)
        } else {
          expect(without, JSON.stringify({ caller, target, v })).toBe(true)
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
  }, 60_000)
})
