// @vitest-environment node
/** #838 A: the effective network view and the offline checks. */
import { describe, expect, it } from 'vitest'
import { effectiveNetView, localFindings, NET_KEY_DEFAULTS, readHomeBlock, REJECT_HINTS } from '../../src/net-doctor.ts'

const running = (extra: Record<string, unknown> = {}) => ({ peers: [] as string[], originClaimUrl: '', originClaimAudiences: [] as string[], originClaimByPeer: {} as Record<string, string>, ...extra }) as never
const base = { announce: true, claimRejects: [], boundMisses: [] }

describe('readHomeBlock', () => {
  it('reads what the home writer writes (JSON flow values) and says the block is present', () => {
    const yaml = '- id: a2a\n  config:\n    peers: ["http://a.example:1"]\n    originClaimUrl: "http://self.example:3"\n    originClaimByPeer: {"http://a.example:1":"http://x.example:3"}\n    announce: true\n'
    expect(readHomeBlock(yaml)).toEqual({ blockPresent: true, values: { peers: ['http://a.example:1'], originClaimUrl: 'http://self.example:3', originClaimByPeer: { 'http://a.example:1': 'http://x.example:3' } }, unparsed: [] })
  })
  it('reads a hand-written block list, and reports a block-style map as unparsed instead of guessing', () => {
    const yaml = '- id: a2a\n  config:\n    peers:\n      - http://a.example:1\n      - "http://b.example:2"\n    originClaimByPeer:\n      http://a.example:1: http://x\n'
    const block = readHomeBlock(yaml)
    expect(block.values.peers).toEqual(['http://a.example:1', 'http://b.example:2'])
    expect(block.unparsed).toEqual(['originClaimByPeer'])
  })
  it('no a2a entry, or an entry without config, is no block', () => {
    expect(readHomeBlock('')).toMatchObject({ blockPresent: false, values: {} })
    expect(readHomeBlock('- id: a2a\n')).toMatchObject({ blockPresent: false })
  })
})

describe('effectiveNetView', () => {
  const none = { blockPresent: false, values: {}, unparsed: [] as never[] }
  it('without a home block a value equal to the default is default and any other is the profile layer', () => {
    const view = effectiveNetView({ running: running({ peers: ['http://a'] }), defaults: NET_KEY_DEFAULTS, home: none })
    expect(view.rows.find(r => r.key === 'peers')).toMatchObject({ source: 'profile', fileState: 'none' })
    expect(view.rows.find(r => r.key === 'originClaimUrl')).toMatchObject({ source: 'default' })
    expect(view.notes).toEqual([])
  })
  it('a key the home file names is home, and a file value that differs from the running one is reported (#812/#814 shape)', () => {
    const view = effectiveNetView({ running: running({ peers: ['http://a'] }), defaults: NET_KEY_DEFAULTS, home: { blockPresent: true, values: { peers: ['http://b'], originClaimUrl: '' }, unparsed: [] } })
    expect(view.rows.find(r => r.key === 'peers')).toMatchObject({ source: 'home', fileState: 'differs', file: ['http://b'] })
    expect(view.rows.find(r => r.key === 'originClaimUrl')).toMatchObject({ source: 'home', fileState: 'same' })
    expect(view.notes.join(' ')).toContain('falls back to the schema default')
    expect(view.notes.join(' ')).toContain('differs from the running value')
  })
  it('with a home block, a key it does not name is the default, whatever the running value claims to be', () => {
    const view = effectiveNetView({ running: running(), defaults: NET_KEY_DEFAULTS, home: { blockPresent: true, values: { peers: [] }, unparsed: [] } })
    expect(view.rows.find(r => r.key === 'originClaimAudiences')).toMatchObject({ source: 'default', fileState: 'none' })
  })
  it('a key present but not parsed is home with an unparsed state', () => {
    const view = effectiveNetView({ running: running(), defaults: NET_KEY_DEFAULTS, home: { blockPresent: true, values: {}, unparsed: ['originClaimByPeer'] } })
    expect(view.rows.find(r => r.key === 'originClaimByPeer')).toMatchObject({ source: 'home', fileState: 'unparsed' })
  })
})

describe('localFindings', () => {
  it('flags an empty originClaimUrl on a loopback-bound announcing host (#814), and stays quiet when it is set, bound to the LAN, or not announcing', () => {
    expect(localFindings({ ...base, running: running(), boundHost: '127.0.0.1' }).map(f => f.code)).toContain('claim-url-loopback')
    expect(localFindings({ ...base, running: running({ originClaimUrl: 'http://self.example:3' }), boundHost: '127.0.0.1' })).toEqual([])
    expect(localFindings({ ...base, running: running(), boundHost: '0.0.0.0' })).toEqual([])
    expect(localFindings({ ...base, announce: false, running: running(), boundHost: '127.0.0.1' })).toEqual([])
  })
  it('flags an originClaimByPeer key that is not a peer, and not one that is', () => {
    const peers = ['http://a.example:1']
    expect(localFindings({ ...base, running: running({ peers, originClaimByPeer: { 'http://typo.example:1': 'http://x.example:3' } }) }).map(f => f.code)).toContain('by-peer-not-in-peers')
    expect(localFindings({ ...base, running: running({ peers, originClaimByPeer: { 'http://a.example:1': 'http://x.example:3' } }) }).map(f => f.code)).not.toContain('by-peer-not-in-peers')
  })
  it('flags one peer written two ways, not two different peers', () => {
    expect(localFindings({ ...base, running: running({ peers: ['http://a.example:1', 'http://a.example:1/'] }) }).map(f => f.code)).toContain('peer-duplicate-spelling')
    expect(localFindings({ ...base, running: running({ peers: ['http://a.example:1', 'http://b.example:1'] }) }).map(f => f.code)).not.toContain('peer-duplicate-spelling')
  })
  it('an audience miss is reported against THIS host', () => {
    const rows = localFindings({ ...base, running: running(), boundMisses: [{ caller: 'zone-b', audience: 'http://x.example:9', count: 3, lastAt: 1 }] })
    expect(rows).toEqual([expect.objectContaining({ code: 'audience-miss', about: 'this-host' })])
    expect(rows[0]!.message).toContain('originClaimAudiences on THIS host')
  })
  it('a refused inbound request becomes an UNVERIFIED hint about the peer, never a change for this host', () => {
    const rows = localFindings({ ...base, running: running(), claimRejects: [{ caller: 'zone-b', callerUrl: 'http://b.example:1', reason: 'bad-sig', count: 2, lastAt: 1 }] })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ code: 'peer-rejected:bad-sig', about: 'peer-declared-unverified', severity: 'info' })
    expect(rows[0]!.message).toContain('UNVERIFIED')
    expect(rows[0]!.message).toContain(REJECT_HINTS['bad-sig']!)
  })
  it('every refusal code the verifier can give has a hint', () => {
    for (const code of ['absent', 'bad-caller-shape', 'bad-ts', 'no-card', 'bad-sig', 'not-derivable', 'wrong-audience', 'unbound-closed', 'body-mismatch', 'verification-timeout']) expect(REJECT_HINTS[code], code).toBeTruthy()
  })
  it('the output never names a credential field', () => {
    const rows = localFindings({ ...base, running: running({ peers: ['http://a'] }), boundHost: '127.0.0.1', claimRejects: [{ caller: 'c', callerUrl: 'u', reason: 'bad-sig', count: 1, lastAt: 1 }] })
    expect(JSON.stringify(rows)).not.toMatch(/apiKey|linkKeys/)
  })
})
