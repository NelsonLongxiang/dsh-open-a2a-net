/**
 * Expiring-signed-card unit tests: the four verification rejections and the
 * sign/verify round trip over the acceptance criteria from the prior-art note
 * (slice 1).
 */
import { generateKeyPairSync, createPublicKey } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CARD_REFRESH_MS, CARD_TTL_MS, encodePublicKey, signCard, verifyCard } from '../src/card.ts'

const NOW = 1_700_000_000_000

function core(expiresAt = NOW + 60_000) {
  return { name: 'peer', session: 'sess-9', team: 'research', capabilities: { route: true }, expiresAt }
}

describe('card constants', () => {
  it('defaults to the GNUnet HELLO validity and TTL/4 cadence', () => {
    expect(CARD_TTL_MS).toBe(172_800_000)
    expect(CARD_REFRESH_MS).toBe(CARD_TTL_MS / 4)
    expect(CARD_REFRESH_MS).toBe(43_200_000)
  })
})

describe('signCard / verifyCard round trip', () => {
  it('verifies a freshly signed card', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = signCard(core(), privateKey)
    expect(verifyCard(card, NOW)).toEqual({ ok: true, card })
  })

  it('rejects an expired card at parse regardless of signature validity', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const expired = signCard(core(NOW - 1), privateKey)
    expect(verifyCard(expired, NOW)).toEqual({ ok: false, reason: 'expired' })
    // Expiry boundary: a card valid for exactly one more millisecond passes.
    const last = signCard(core(NOW + 1), privateKey)
    expect(verifyCard(last, NOW).ok).toBe(true)
  })

  it('rejects a tampered card: any committed field change breaks the signature', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = signCard(core(), privateKey)
    expect(verifyCard({ ...card, team: 'other' }, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
    expect(verifyCard({ ...card, expiresAt: NOW + 3_600_000 }, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
    expect(verifyCard({ ...card, name: 'spoof' }, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('rejects unsigned and malformed candidates before crypto runs', () => {
    expect(verifyCard({ name: 'x', session: 's', team: 't' }, NOW)).toEqual({ ok: false, reason: 'unsigned' })
    expect(verifyCard(null, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyCard({ name: 7, session: 's', team: 't' }, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyCard('card', NOW)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects a card whose public key does not decode as a key', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = signCard(core(), privateKey)
    const badKey = verifyCard({ ...card, publicKey: 'not-base64-der!!' }, NOW)
    expect(badKey).toEqual({ ok: false, reason: 'malformed' })
  })

  it('round-trips the public key encoding', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const card = signCard(core(), privateKey)
    expect(card.publicKey).toBe(encodePublicKey(publicKey))
    const decoded = createPublicKey({ key: Buffer.from(card.publicKey, 'base64'), format: 'der', type: 'spki' })
    expect(decoded.asymmetricKeyType).toBe('ed25519')
  })

  it('carries an unsigned peers referral list without breaking the signature', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = signCard(core(), privateKey)
    const peers = ['http://10.0.0.2:1', 'http://10.0.0.3:1']
    expect(verifyCard({ ...card, peers }, NOW)).toEqual({ ok: true, card: { ...card, peers } })
  })

  it('drops a malformed peers field instead of rejecting the card', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = signCard(core(), privateKey)
    expect(verifyCard({ ...card, peers: 'http://10.0.0.2:1' }, NOW)).toEqual({ ok: true, card })
    expect(verifyCard({ ...card, peers: ['http://10.0.0.2:1', 7] }, NOW)).toEqual({ ok: true, card })
  })

  it('signs and verifies zone delegation records', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const records = [{ type: 'delegate' as const, name: 'analysis', url: 'http://10.0.0.2:1' }]
    const card = signCard({ ...core(), records }, privateKey)
    expect(verifyCard(card, NOW)).toEqual({ ok: true, card })
    // Records are committed: any change to one breaks the signature.
    expect(verifyCard({ ...card, records: [{ type: 'delegate', name: 'spoof', url: 'http://10.0.0.2:1' }] }, NOW))
      .toEqual({ ok: false, reason: 'bad-signature' })
    // And removing them from a signed-with-records card breaks it too.
    const { records: _omitted, ...bare } = card
    expect(verifyCard(bare, NOW)).toEqual({ ok: false, reason: 'bad-signature' })
  })

  it('rejects a card whose records member is malformed', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = signCard(core(), privateKey)
    expect(verifyCard({ ...card, records: 'no' }, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyCard({ ...card, records: [{ type: 'delegate', name: '', url: 'http://x' }] }, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyCard({ ...card, records: [{ type: 'delegate', name: 'x', url: '' }] }, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyCard({ ...card, records: [{ type: 'tombstone', name: 'x', url: 'http://x' }] }, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyCard({ ...card, records: [{ type: 'delegate', name: 'x', url: 'http://x', publicKey: 7 }] }, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('card sessionTeams passthrough', () => {
  it('drops malformed entries and a non-array member instead of rejecting the card', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = signCard(core(), privateKey)
    expect(verifyCard({ ...card, sessionTeams: 'no' }, NOW)).toEqual({ ok: true, card })
    expect(verifyCard({ ...card, sessionTeams: [{ team: '', name: 'n', description: 'd' }, 7, { team: 'dsh/ok1', name: 7, description: 'd' }, { team: 'dsh/ok2', name: 'n', description: 7 }, { team: 'dsh/abcd1234', name: 'n', description: 'd' }] }, NOW)).toEqual({
      ok: true,
      card: { ...card, sessionTeams: [{ team: 'dsh/abcd1234', name: 'n', description: 'd' }] },
    })
    // An all-malformed list passes as an empty listing the publisher drops.
    expect(verifyCard({ ...card, sessionTeams: [7, null] }, NOW)).toEqual({ ok: true, card })
  })
})
