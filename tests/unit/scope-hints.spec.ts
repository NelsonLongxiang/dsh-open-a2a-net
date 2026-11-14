/**
 * Production feedback 2026-11-14: owner-board scope hints — a peer canvas that holds a local session beside a peer
 * session this host declares nowhere yields one suggestion; a declared, foreign-only or unpublished pair yields none.
 */
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { signCard } from '../../src/card.ts'
import { qualifiedSessionMember } from '../../src/canvas-member.ts'
import { scopeHints, type ScopeHintInput } from '../../src/scope-hints.ts'
import type { A2aPeerCard } from '../../src/types.ts'

const key = generateKeyPairSync('ed25519')
function card(members: string[], sessions = [{ team: 'zone-b/e91be1aa', name: '服务器运维', description: '' }, { team: 'zone-b/593729a1', name: 'other', description: '' }]): A2aPeerCard {
  return { ...signCard({ name: 'peer-b', session: 'peer-host-b', team: 'zone-b', capabilities: { roster: true }, expiresAt: Date.now() + 3_600_000 }, key.privateKey),
    sessionTeams: sessions, canvasOrg: [{ name: 'prod', team: 'zone-b/canvas/prod', members }] }
}
function input(c: A2aPeerCard, over: Partial<ScopeHintInput> = {}): ScopeHintInput {
  return {
    cards: [{ url: 'http://peer-b', card: c }],
    resolveLocal: ref => ref === 'home-zone/446ce672' ? 'session-446ce672' : ref === 'home-zone/unjoined1' ? 'session-unjoined1' : undefined,
    joined: id => id === 'session-446ce672',
    handleOf: id => 'home-zone/' + id.slice('session-'.length),
    canvasesOf: id => id === 'session-446ce672' ? ['基础设施组'] : [],
    declared: () => false,
    ...over,
  }
}

describe('scope hints', () => {
  it('names the undeclared peer session that shares a peer canvas with a local session, with its key-pinned ref', () => {
    const hints = scopeHints(input(card(['home-zone/446ce672', 'zone-b/e91be1aa'])))
    expect(hints).toEqual([{ peer: 'http://peer-b', peerCanvas: 'zone-b/canvas/prod', remote: 'zone-b/e91be1aa', memberRef: qualifiedSessionMember('zone-b/e91be1aa', card([]).publicKey), name: '服务器运维',
      local: [{ id: 'session-446ce672', handle: 'home-zone/446ce672', joined: true, canvases: ['基础设施组'] }] }])
  })

  it('stays quiet once this host declares the peer session, bare or key-pinned', () => {
    const c = card(['home-zone/446ce672', 'zone-b/e91be1aa'])
    const ref = qualifiedSessionMember('zone-b/e91be1aa', c.publicKey)!
    expect(scopeHints(input(c, { declared: r => r === 'zone-b/e91be1aa' }))).toEqual([])
    expect(scopeHints(input(c, { declared: r => r === ref }))).toEqual([])
  })

  it('gives no hint for a canvas without a local session, or for a member the card does not publish as its own session', () => {
    expect(scopeHints(input(card(['zone-b/e91be1aa', 'zone-b/593729a1'])))).toEqual([])
    expect(scopeHints(input(card(['home-zone/446ce672', 'zone-c/12345678'])))).toEqual([])
  })

  it('reports an unjoined local session so the board can offer to join it first', () => {
    const hints = scopeHints(input(card(['home-zone/unjoined1', 'zone-b/e91be1aa'])))
    expect(hints).toHaveLength(1)
    expect(hints[0]!.local).toEqual([{ id: 'session-unjoined1', handle: 'home-zone/unjoined1', joined: false, canvases: [] }])
  })
})
