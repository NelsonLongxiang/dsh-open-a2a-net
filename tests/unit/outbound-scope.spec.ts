import { describe, expect, it } from 'vitest'
import { outboundScope, type OutboundScopeRecords } from '../../src/outbound-scope.ts'
function world(over: Partial<OutboundScopeRecords> = {}): OutboundScopeRecords {
  return { zone: 'alpha', teamsOf: () => [], membersOf: () => [], id8: id => id.slice(0, 8), canvasNames: () => [], canvasMembers: () => [], canvasTeam: name => 'alpha/canvas/' + name, peerOrgs: () => [], warmPeers: async () => {}, ...over }
}
const caller = 'ops-cli/0123456789abcdef'
const target = 'beta/abcdef01'
describe('shared outbound sender scope behavior', () => {
  it('v5-B2: a peer\'s superagent team canvas takes requests from a session that declares any team; a teamless one has no network', async () => {
    const team = { team: 'beta/canvas/team', members: ['beta/aaaaaaaa'], superagentTeam: true }
    const r = world({ peerOrgs: () => [[team]] })
    // Teamless: still refused (S3), bare or qualified.
    expect((await outboundScope(r, caller, caller, 'beta/canvas/team')).ok).toBe(false)
    // A seat on any canvas of its own host, or a roster team: the team canvas takes it, bare or with the owner's fingerprint.
    const seated = { ...r, canvasNames: () => ['mine'], canvasMembers: () => [caller] }
    expect((await outboundScope(seated, caller, caller, 'beta/canvas/team')).ok).toBe(true)
    expect((await outboundScope(seated, caller, caller, 'beta/canvas/team@0123abcd')).ok).toBe(true)
    expect((await outboundScope({ ...r, teamsOf: () => ['alpha/roster'] }, caller, caller, 'beta/canvas/team')).ok).toBe(true)
    // An ordinary peer canvas is unchanged: the caller must sit in it.
    expect((await outboundScope({ ...seated, peerOrgs: () => [[{ ...team, superagentTeam: undefined }]] }, caller, caller, 'beta/canvas/team')).ok).toBe(false)
  })
  it('a canvas that lists only the target never authorizes an unrelated caller', async () => {
    const r = world({ canvasNames: () => ['ops'], canvasMembers: () => [target] })
    expect((await outboundScope(r, caller, caller, target)).ok).toBe(false)
    expect((await outboundScope({ ...r, canvasMembers: () => [caller, target] }, caller, caller, target)).ok).toBe(true)
  })
  it('a peer canvas org must name both the caller and requested target/group', async () => {
    const entry = { team: 'beta/canvas/ops', members: [target] }
    const r = world({ peerOrgs: () => [[entry]] })
    expect((await outboundScope(r, caller, caller, target)).ok).toBe(false)
    expect((await outboundScope({ ...r, peerOrgs: () => [[{ ...entry, members: [caller, target] }]] }, caller, caller, target)).ok).toBe(true)
    expect((await outboundScope({ ...r, peerOrgs: () => [[{ ...entry, members: [caller] }]] }, caller, caller, target)).ok).toBe(false)
    expect((await outboundScope({ ...r, peerOrgs: () => [[{ ...entry, members: [caller] }]] }, caller, caller, entry.team)).ok).toBe(true)
  })
})
