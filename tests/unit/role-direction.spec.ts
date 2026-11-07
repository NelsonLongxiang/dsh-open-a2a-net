/**
 * v3.1 PR-1: role canvas direction admission, as a pure decision.
 * Covers one host, several physical nodes, and several DSH instances on one
 * machine sharing a zone label (told apart only by their pinned owner keys).
 */
import { describe, expect, it } from 'vitest'
import { roleDirection, seatsOf, addressParty, localSessionOf, ROLE_REFUSAL_RULES, type Party, type RoleRecords } from '../../src/role-direction.ts'

const OWN_FP = '0000aaaa'
const B_FP = '1111bbbb'
const C_FP = '2222cccc'
const B_KEY = 'KEY-B'
const C_KEY = 'KEY-C'
const id8 = (id: string): string => id.replace(/^session-/, '').slice(0, 8)

interface Fixture { routers: Record<string, string>; canvases: Record<string, string[]>; keys?: Record<string, string>; sessions?: string[]; zone?: string }
function records(f: Fixture): RoleRecords {
  return {
    zone: f.zone ?? 'dsh',
    ownFingerprint: OWN_FP,
    id8,
    routers: () => Object.entries(f.routers),
    canvasMembersOf: name => f.canvases[name] ?? [],
    canvasTeamOf: name => `${f.zone ?? 'dsh'}/canvas/${name}`,
    ownerKeyOf: ref => f.keys?.[ref],
    localSessions: () => f.sessions ?? ['session-a0000000aaaa', 'session-b1111111bbbb', 'session-c2222222cccc', 'session-d3333333dddd'],
  }
}
const R = 'session-a0000000aaaa', M1 = 'session-b1111111bbbb', M2 = 'session-c2222222cccc', O = 'session-d3333333dddd'
const local = (session: string): Party => ({ kind: 'local', session })
const host: Party = { kind: 'other', label: 'host-sess' }

/** One host: router R, members M1/M2 in role canvas crew; O sits with M1 in a plain canvas side. */
const oneHost = records({ routers: { crew: R }, canvases: { crew: [R, M1, M2], side: [M1, O] } })

describe('one host', () => {
  it('seats: router, members, outsider', () => {
    expect(seatsOf(oneHost, local(R))).toEqual([{ canvas: 'crew', role: 'router' }])
    expect(seatsOf(oneHost, local(M1))).toEqual([{ canvas: 'crew', role: 'member' }])
    expect(seatsOf(oneHost, local(O))).toEqual([])
  })
  it('router → member dispatch is the only admitted non-receipt direction', () => {
    expect(roleDirection(oneHost, { caller: local(R), target: 'dsh/b1111111' })).toMatchObject({ governed: true, ok: true, rule: 'role-dispatch' })
    // Handle, session id and own-qualified handle all name the same local member.
    expect(roleDirection(oneHost, { caller: local(R), target: M2 })).toMatchObject({ ok: true, rule: 'role-dispatch' })
    expect(roleDirection(oneHost, { caller: local(R), target: `dsh/c2222222@${OWN_FP}` })).toMatchObject({ ok: true, rule: 'role-dispatch' })
  })
  const refusals: Array<[string, Party, string, string]> = [
    ['member → router (work)', local(M1), 'dsh/a0000000', 'role-member-initiates'],
    ['member → member', local(M1), 'dsh/c2222222', 'role-member-initiates'],
    ['member → plain-canvas teammate', local(M1), 'dsh/d3333333', 'role-member-initiates'],
    ['outsider → router', local(O), 'dsh/a0000000', 'role-router-inbound'],
    ['host face → router', host, 'dsh/a0000000', 'role-router-inbound'],
    ['outsider → member', local(O), 'dsh/b1111111', 'role-boundary'],
    ['CLI identity → member', { kind: 'other', label: 'cli/0123456789abcdef' }, 'dsh/b1111111', 'role-boundary'],
    ['router → outsider', local(R), 'dsh/d3333333', 'role-boundary'],
    ['router → remote stranger', local(R), 'zeta/12345678', 'role-boundary'],
    ['anyone → the role canvas as a team', local(R), 'dsh/canvas/crew', 'role-canvas-address'],
    ['owner-qualified role canvas id', local(O), `dsh/canvas/crew@${OWN_FP}`, 'role-canvas-address'],
  ]
  for (const [label, caller, target, rule] of refusals) {
    it(`refuses ${label} as ${rule}`, () => {
      const v = roleDirection(oneHost, { caller, target })
      expect(v).toMatchObject({ governed: true, ok: false, rule })
      if (v.governed && !v.ok) { expect(v.refusal.startsWith(`[${rule}] `)).toBe(true); expect(v.next).not.toBe('') }
    })
  }
  it('ungoverned traffic is left to the ordinary rules', () => {
    expect(roleDirection(oneHost, { caller: local(O), target: 'dsh/canvas/side' })).toEqual({ governed: false })
    expect(roleDirection(records({ routers: {}, canvases: { crew: [R, M1] } }), { caller: local(M1), target: 'dsh/c2222222' })).toEqual({ governed: false })
  })
  it('receipts: only the member a task went to, back to the router that sent it', () => {
    const owed = { taskId: 't1', from: 'dsh/a0000000', to: 'dsh/b1111111' }
    expect(roleDirection(oneHost, { caller: local(M1), target: 'dsh/a0000000', receipt: owed })).toMatchObject({ ok: true, rule: 'role-receipt' })
    // The host courier (receipt autosend) carries it for the ledger's member.
    expect(roleDirection(oneHost, { caller: host, target: 'dsh/a0000000', receipt: owed, courier: true })).toMatchObject({ ok: true, rule: 'role-receipt' })
    // Another member, an outsider, a missing row, a task the router never sent: all refused.
    expect(roleDirection(oneHost, { caller: local(M2), target: 'dsh/a0000000', receipt: owed })).toMatchObject({ ok: false, rule: 'role-receipt-unowed' })
    expect(roleDirection(oneHost, { caller: local(O), target: 'dsh/a0000000', receipt: owed })).toMatchObject({ ok: false, rule: 'role-receipt-unowed' })
    expect(roleDirection(oneHost, { caller: local(M1), target: 'dsh/a0000000', receipt: { taskId: 'tx' } })).toMatchObject({ ok: false, rule: 'role-receipt-unowed' })
    expect(roleDirection(oneHost, { caller: local(M1), target: 'dsh/a0000000', receipt: { taskId: 't2', from: 'dsh/d3333333', to: 'dsh/b1111111' } })).toMatchObject({ ok: false, rule: 'role-receipt-unowed' })
    // A courier receipt for an outsider's task (to = O) is not a member's.
    expect(roleDirection(oneHost, { caller: host, target: 'dsh/a0000000', receipt: { taskId: 't3', from: 'dsh/a0000000', to: 'dsh/d3333333' }, courier: true })).toMatchObject({ ok: false, rule: 'role-receipt-unowed' })
    // Receipts never go router → member, nor member → member.
    expect(roleDirection(oneHost, { caller: local(R), target: 'dsh/b1111111', receipt: owed })).toMatchObject({ ok: false, rule: 'role-boundary' })
    expect(roleDirection(oneHost, { caller: local(M1), target: 'dsh/c2222222', receipt: owed })).toMatchObject({ ok: false, rule: 'role-member-initiates' })
  })
  it('a session in two role canvases is refused, not guessed', () => {
    const two = records({ routers: { crew: R, other: O }, canvases: { crew: [R, M1], other: [O, M1] } })
    expect(roleDirection(two, { caller: local(R), target: 'dsh/b1111111' })).toMatchObject({ ok: false, rule: 'role-ambiguous' })
  })
  it('a router ref that left the canvas seats no router: its members reach nobody (fail closed)', () => {
    const gone = records({ routers: { crew: R }, canvases: { crew: [M1, M2] } })
    expect(seatsOf(gone, local(R))).toEqual([])
    expect(roleDirection(gone, { caller: local(R), target: 'dsh/b1111111' })).toMatchObject({ ok: false, rule: 'role-boundary' })
  })
  it('rule names form the closed set', () => {
    expect([...ROLE_REFUSAL_RULES].sort()).toEqual(['role-ambiguous', 'role-boundary', 'role-canvas-address', 'role-member-initiates', 'role-receipt-unowed', 'role-router-inbound'])
  })
})

/**
 * Router on this host (A); members on host B and host C. All three share the zone label `dsh` —
 * the several-instances-on-one-machine case — so only the pinned keys tell them apart.
 */
const MB = `dsh/bbbb0001@${B_FP}`, MC = `dsh/cccc0002@${C_FP}`
const routerHost = records({ routers: { crew: R }, canvases: { crew: [R, MB, MC] }, keys: { [MB]: B_KEY, [MC]: C_KEY } })
const remote = (handle: string, key?: string): Party => ({ kind: 'remote', handle, ...(key !== undefined ? { key } : {}) })

describe('router host, members on other hosts (same zone label)', () => {
  it('a bare remote handle borrows the one pinned key; a qualified one carries it', () => {
    expect(addressParty(routerHost, 'dsh/bbbb0001')).toEqual(remote('dsh/bbbb0001', B_KEY))
    expect(addressParty(routerHost, MC)).toEqual(remote('dsh/cccc0002', C_KEY))
    // Not local: a foreign fingerprint is never this host's session, even under this host's zone.
    expect(localSessionOf(routerHost, MB)).toBeUndefined()
  })
  it('router dispatches to remote members', () => {
    expect(roleDirection(routerHost, { caller: local(R), target: 'dsh/bbbb0001' })).toMatchObject({ ok: true, rule: 'role-dispatch' })
    expect(roleDirection(routerHost, { caller: local(R), target: MC })).toMatchObject({ ok: true, rule: 'role-dispatch' })
  })
  it('wire receipts from a remote member are admitted only with the pinned key', () => {
    const owed = { taskId: 't1', from: 'dsh/a0000000', to: 'dsh/bbbb0001' }
    expect(roleDirection(routerHost, { caller: remote('dsh/bbbb0001', B_KEY), target: 'dsh/a0000000', receipt: owed })).toMatchObject({ ok: true, rule: 'role-receipt' })
    // The outbound row may record the qualified handle.
    expect(roleDirection(routerHost, { caller: remote('dsh/bbbb0001', B_KEY), target: 'dsh/a0000000', receipt: { ...owed, to: MB } })).toMatchObject({ ok: true })
    // Another DSH instance on the same machine with the same zone/id8 but its own key: no seat.
    expect(roleDirection(routerHost, { caller: remote('dsh/bbbb0001', 'KEY-IMPOSTOR'), target: 'dsh/a0000000', receipt: owed })).toMatchObject({ ok: false, rule: 'role-receipt-unowed' })
    expect(roleDirection(routerHost, { caller: remote('dsh/bbbb0001', 'KEY-IMPOSTOR'), target: 'dsh/a0000000' })).toMatchObject({ ok: false, rule: 'role-router-inbound' })
    // Unproven (legacy window, unbound): no key, no seat.
    expect(roleDirection(routerHost, { caller: remote('dsh/bbbb0001'), target: 'dsh/a0000000', receipt: owed })).toMatchObject({ ok: false, rule: 'role-receipt-unowed' })
    // Member C answering B's task.
    expect(roleDirection(routerHost, { caller: remote('dsh/cccc0002', C_KEY), target: 'dsh/a0000000', receipt: owed })).toMatchObject({ ok: false, rule: 'role-receipt-unowed' })
  })
  it('remote members never initiate toward the router', () => {
    expect(roleDirection(routerHost, { caller: remote('dsh/bbbb0001', B_KEY), target: 'dsh/a0000000' })).toMatchObject({ ok: false, rule: 'role-member-initiates' })
  })
  it('a bare handle pinned under two keys is refused as ambiguous', () => {
    const twin = `dsh/bbbb0001@${C_FP}`
    const r = records({ routers: { crew: R, other: O }, canvases: { crew: [R, MB], other: [O, twin] }, keys: { [MB]: B_KEY, [twin]: C_KEY } })
    expect(roleDirection(r, { caller: local(M1), target: 'dsh/bbbb0001' })).toMatchObject({ ok: false, rule: 'role-ambiguous' })
  })
})

/** Member host (B): its member is local; the router lives on host A under A's pinned key. */
const A_FP = '3333aaaa', A_KEY = 'KEY-A'
const RA = `dsh/a0000000@${A_FP}`
const memberHost = records({ routers: { crew: RA }, canvases: { crew: [RA, M1] }, keys: { [RA]: A_KEY }, sessions: [M1, O] })

describe('member host, router on another host', () => {
  it('takes work only from the proven remote router', () => {
    expect(roleDirection(memberHost, { caller: remote('dsh/a0000000', A_KEY), target: 'dsh/b1111111' })).toMatchObject({ ok: true, rule: 'role-dispatch' })
    expect(roleDirection(memberHost, { caller: remote('dsh/a0000000', 'KEY-OTHER-INSTANCE'), target: 'dsh/b1111111' })).toMatchObject({ ok: false, rule: 'role-boundary' })
    expect(roleDirection(memberHost, { caller: remote('dsh/a0000000'), target: 'dsh/b1111111' })).toMatchObject({ ok: false, rule: 'role-boundary' })
    expect(roleDirection(memberHost, { caller: local(O), target: 'dsh/b1111111' })).toMatchObject({ ok: false, rule: 'role-boundary' })
  })
  it('answers the remote router with a receipt the inbound row owes; nothing else leaves', () => {
    const owed = { taskId: 't1', from: 'dsh/a0000000', to: 'dsh/b1111111' }
    expect(roleDirection(memberHost, { caller: local(M1), target: 'dsh/a0000000', receipt: owed })).toMatchObject({ ok: true, rule: 'role-receipt' })
    expect(roleDirection(memberHost, { caller: host, target: 'dsh/a0000000', receipt: owed, courier: true })).toMatchObject({ ok: true, rule: 'role-receipt' })
    expect(roleDirection(memberHost, { caller: local(M1), target: 'dsh/a0000000' })).toMatchObject({ ok: false, rule: 'role-member-initiates' })
    expect(roleDirection(memberHost, { caller: local(M1), target: 'zeta/99999999' })).toMatchObject({ ok: false, rule: 'role-member-initiates' })
    // A local session pretending its inbound row came from the router: the row's sender must be the router.
    expect(roleDirection(memberHost, { caller: local(M1), target: 'dsh/a0000000', receipt: { ...owed, from: 'dsh/d3333333' } })).toMatchObject({ ok: false, rule: 'role-receipt-unowed' })
  })
})

describe('inverse mutations: each guard is load-bearing', () => {
  it('dropping the router turns every refusal back into ordinary traffic', () => {
    const plain = records({ routers: {}, canvases: { crew: [R, M1, M2], side: [M1, O] } })
    for (const [caller, target] of [[local(M1), 'dsh/c2222222'], [local(O), 'dsh/a0000000'], [local(R), 'dsh/d3333333']] as const) {
      expect(roleDirection(oneHost, { caller, target })).toMatchObject({ governed: true, ok: false })
      expect(roleDirection(plain, { caller, target })).toEqual({ governed: false })
    }
  })
  it('without the pinned key the remote member loses its seat', () => {
    const unpinned = records({ routers: { crew: R }, canvases: { crew: [R, MB] }, keys: {} })
    expect(roleDirection(routerHost, { caller: remote('dsh/bbbb0001', B_KEY), target: 'dsh/a0000000', receipt: { taskId: 't', from: 'dsh/a0000000', to: 'dsh/bbbb0001' } })).toMatchObject({ ok: true })
    expect(roleDirection(unpinned, { caller: remote('dsh/bbbb0001', B_KEY), target: 'dsh/a0000000', receipt: { taskId: 't', from: 'dsh/a0000000', to: 'dsh/bbbb0001' } })).toMatchObject({ ok: false })
  })
  it('a bare remote ref (legacy, unqualified) never seats a remote party', () => {
    const bare = records({ routers: { crew: R }, canvases: { crew: [R, 'dsh/bbbb0001'] }, keys: { 'dsh/bbbb0001': B_KEY } })
    expect(seatsOf(bare, remote('dsh/bbbb0001', B_KEY))).toEqual([])
  })
})
