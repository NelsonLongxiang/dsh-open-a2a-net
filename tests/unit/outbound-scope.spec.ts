import { describe, expect, it } from 'vitest'
import { outboundScope, type OutboundScopeRecords } from '../../src/outbound-scope.ts'
function world(over: Partial<OutboundScopeRecords> = {}): OutboundScopeRecords {
  return { zone: 'alpha', teamsOf: () => [], membersOf: () => [], id8: id => id.slice(0, 8), canvasNames: () => [], canvasMembers: () => [], canvasTeam: name => 'alpha/canvas/' + name, peerOrgs: () => [], warmPeers: async () => {}, ...over }
}
const caller = 'ops-cli/0123456789abcdef'
const target = 'beta/abcdef01'
describe('shared outbound sender scope behavior', () => {
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
