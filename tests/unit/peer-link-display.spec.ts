import { describe, expect, it } from 'vitest'
import { peerLinkDisplay } from '../../src/peer-link-display.ts'
import type { A2aPeerCard } from '../../src/types.ts'
const card = (key: string, handle?: string) => ({ team: 'dsh', publicKey: key, peers: [], ...(handle ? { sessionTeams: [{ team: handle }] } : {}) }) as unknown as A2aPeerCard
const base = { ownUrl: 'http://self:3080', seeds: [], refs: ['dsh/aaaaaaaa'], ownHandles: new Set<string>() }
describe('host-specific display link facts only', () => {
  it('#311 accepts either the primary origin or an explicit audience alias, still requiring the exact peer seed', () => {
    const b = { ...card('b'), peers: ['http://192.168.3.156:13080/'] }
    const input = { ...base, card: b, cards: [b], refs: [], ownUrl: 'http://100.75.181.127:13080', seeds: ['http://b:13080'] }
    expect(peerLinkDisplay('http://b:13080', input).link).toBe('stranger')
    expect(peerLinkDisplay('http://b:13080', { ...input, ownAudiences: ['http://192.168.3.156:13080'] }).link).toBe('linked')
    expect(peerLinkDisplay('http://other:13080', { ...input, ownAudiences: ['http://192.168.3.156:13080'] }).link).toBe('stranger')
    expect(peerLinkDisplay('http://b:13080', { ...input, ownAudiences: ['http://192.168.3.156:3080'] }).link).toBe('stranger')
    expect(peerLinkDisplay('http://b:13080', { ...input, ownAudiences: ['https://192.168.3.156:13080'] }).link).toBe('stranger')
    expect(peerLinkDisplay('http://b:13080', { ...input, ownAudiences: ['not a URL', ''] }).link).toBe('stranger')
    expect(peerLinkDisplay('http://b:13080', { ...input, card: undefined, ownAudiences: ['http://192.168.3.156:13080'] })).toEqual({ link: 'stranger', verified: false })
  })
  it('#311 keeps the primary own origin in the set even when aliases are configured', () => {
    const b = { ...card('b'), peers: ['http://self:3080'] }
    expect(peerLinkDisplay('http://b', { ...base, refs: [], card: b, cards: [b], seeds: ['http://b'], ownAudiences: ['http://alias:13080'] }).link).toBe('linked')
  })
  it('links only the card actually publishing an exact unique nonlocal member, never the zone or a minimal sibling', () => {
    const b = card('b', 'dsh/aaaaaaaa'), c = card('c', 'dsh/bbbbbbbb')
    expect(peerLinkDisplay('http://b', { ...base, card: b, cards: [b, c] }).link).toBe('linked')
    expect(peerLinkDisplay('http://c', { ...base, card: c, cards: [b, c] }).link).toBe('stranger')
    expect(peerLinkDisplay('http://c', { ...base, card: card('c'), cards: [b, card('c')] }).link).toBe('stranger')
  })
  it('does not infer foreign ownership of a local handle or one claimed by two distinct card keys', () => {
    const b = card('b', 'dsh/aaaaaaaa'), c = card('c', 'dsh/aaaaaaaa')
    expect(peerLinkDisplay('http://b', { ...base, card: b, cards: [b], ownHandles: new Set(['dsh/aaaaaaaa']) }).link).toBe('stranger')
    expect(peerLinkDisplay('http://b', { ...base, card: b, cards: [b, c] }).link).toBe('stranger')
  })
  it('keeps verification independent and bilateral seeding host-specific', () => {
    const b = { ...card('b'), peers: ['http://self:3080'] }
    expect(peerLinkDisplay('http://b', { ...base, card: b, cards: [b], seeds: ['http://b'] })).toEqual({ link: 'linked', verified: true })
    expect(peerLinkDisplay('http://c', { ...base, card: b, cards: [b], seeds: ['http://b'] }).link).toBe('stranger')
    expect(peerLinkDisplay('http://b', { ...base, card: undefined, cards: [] })).toEqual({ link: 'stranger', verified: false })
  })
})
