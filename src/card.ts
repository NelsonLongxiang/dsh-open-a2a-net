/**
 * Expiring signed agent cards (GNUnet HELLO semantics): the card carries its
 * own expiry and an Ed25519 signature over identity, team, capabilities, and
 * expiry, so only the key holder can extend a card's life. Expiry and the
 * signature are enforced wherever a card is parsed — no background cleanup.
 * Design basis: .agents/notes/proposed/feature/2026-08-16-gnunet-prior-art-for-a2a-topology.md (slice 1).
 * @module @nelsonlongxiang/dsh-open-a2a-net/card
 */

import { createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto'
import type { A2aPeerCard, A2aSessionTeamInfo, ZoneRecord } from './types.ts'

/** Card validity budget. GNUnet HELLO default (2 days). */
export const CARD_TTL_MS = 172_800_000
/** Announce re-sign cadence: four publication opportunities per TTL. */
export const CARD_REFRESH_MS = CARD_TTL_MS / 4

/**
 * The card fields the signature commits to; every field is lifecycle-relevant.
 * `peers` is deliberately not a core field: a referral is verified as its own
 * card at fetch time (hostlist semantics), so a tampered referral list only
 * produces fetch failures, which the caller's peer store penalizes. `records`
 * is a core field: a delegation is an authority claim over a name, and only
 * the zone key holder may publish one. Cards without records sign exactly the
 * field set above, so their signatures stay byte-identical.
 */
export type CardCore = Pick<A2aPeerCard, 'name' | 'session' | 'team' | 'capabilities' | 'expiresAt' | 'records'>

/** Why a parsed card was rejected at verification. */
export type CardRejection = 'malformed' | 'unsigned' | 'expired' | 'bad-signature'

/** The verification outcome: the card, or the rejection reason. */
export type CardVerification = { readonly ok: true; readonly card: A2aPeerCard } | { readonly ok: false; readonly reason: CardRejection }

/** Deterministic signing payload: field order is fixed by JSON.stringify of this literal shape. */
function canonicalPayload(core: CardCore): string {
  return JSON.stringify({
    capabilities: core.capabilities,
    expiresAt: core.expiresAt,
    name: core.name,
    ...(core.records !== undefined ? { records: core.records } : {}),
    session: core.session,
    team: core.team,
  })
}

/**
 * Encode a public key as the base64 SPKI DER the card carries.
 * @param publicKey - the signing node's Ed25519 public key.
 * @returns the base64 SPKI DER string.
 */
export function encodePublicKey(publicKey: KeyObject): string {
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
}

/**
 * Sign one card core with the node's Ed25519 private key.
 * @param core - the card's lifecycle-relevant fields, expiry included.
 * @param privateKey - the signing node's Ed25519 private key.
 * @returns the wire card: the core plus the public key and signature.
 */
export function signCard(core: CardCore, privateKey: KeyObject): A2aPeerCard {
  const signature = edSign(undefined, Buffer.from(canonicalPayload(core), 'utf8'), privateKey).toString('base64')
  return { ...core, publicKey: encodePublicKey(createPublicKey(privateKey)), signature }
}

/** The wire shape a parsed card must have before crypto is attempted. */
interface WireCard {
  readonly name?: unknown
  readonly session?: unknown
  readonly team?: unknown
  readonly capabilities?: unknown
  readonly expiresAt?: unknown
  readonly peers?: unknown
  readonly sessionTeams?: unknown
  readonly records?: unknown
  readonly lanIp?: unknown
  readonly publicKey?: unknown
  readonly signature?: unknown
}

/**
 * Validate the signed records member: absent stays absent; any other shape
 * rejects the card. Records are authority claims, so a malformed list is a
 * malformed card — unlike the unsigned referral hints, which only drop.
 * @param wire - the shape-checked card candidate.
 * @returns the validated records, `undefined` when the card carries none, or
 * `null` when the member is malformed (the caller rejects the card).
 */
function zoneRecords(wire: WireCard): readonly ZoneRecord[] | undefined | null {
  if (wire.records === undefined) return undefined
  if (!Array.isArray(wire.records)) return null
  for (const entry of wire.records) {
    const record = entry as Partial<ZoneRecord> | null
    if (record?.type !== 'delegate') return null
    if (typeof record.name !== 'string' || record.name === '') return null
    if (typeof record.url !== 'string' || record.url === '') return null
    if (record.publicKey !== undefined && typeof record.publicKey !== 'string') return null
  }
  return wire.records as readonly ZoneRecord[]
}

/**
 * The unsigned `peers` referral list passes through only as an array of
 * strings; any other shape drops the field instead of rejecting the card,
 * because cards from nodes without gossip carry none.
 * @param wire - the shape-checked card candidate.
 * @returns the verified referral list, or `undefined` when absent or malformed.
 */
function referrals(wire: WireCard): readonly string[] | undefined {
  if (!Array.isArray(wire.peers) || !wire.peers.every(url => typeof url === 'string')) return undefined
  return wire.peers
}

/**
 * The unsigned `sessionTeams` listing passes through only as an array of
 * well-formed entries; any other shape drops the field instead of rejecting
 * the card, because cards from nodes without joined sessions carry none.
 * @param wire - the shape-checked card candidate.
 * @returns the session-team entries, or `undefined` when absent or malformed.
 */
function sessionTeams(wire: WireCard): readonly A2aSessionTeamInfo[] | undefined {
  if (!Array.isArray(wire.sessionTeams)) return undefined
  const entries: A2aSessionTeamInfo[] = []
  for (const entry of wire.sessionTeams) {
    const team = entry as Partial<A2aSessionTeamInfo> | null
    if (typeof team?.team !== 'string' || team.team === '') continue
    if (typeof team.name !== 'string' || typeof team.description !== 'string') continue
    entries.push({
      team: team.team,
      name: team.name,
      description: team.description,
      ...(typeof team.workspace === 'string' && team.workspace !== '' ? { workspace: team.workspace } : {}),
    })
  }
  return entries
}

/**
 * Verify a parsed card: shape, signature, and expiry, in that order.
 * @param candidate - the JSON value fetched from a peer's agent-card URL.
 * @param now - evaluation time (epoch ms); injected for tests.
 * @returns the verified card, or the first rejection reason.
 */
export function verifyCard(candidate: unknown, now: number): CardVerification {
  if (typeof candidate !== 'object' || candidate === null) return { ok: false, reason: 'malformed' }
  const wire = candidate as WireCard
  if (typeof wire.name !== 'string' || typeof wire.session !== 'string' || typeof wire.team !== 'string') {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof wire.expiresAt !== 'number' || typeof wire.publicKey !== 'string' || typeof wire.signature !== 'string') {
    return { ok: false, reason: 'unsigned' }
  }
  const records = zoneRecords(wire)
  if (records === null) return { ok: false, reason: 'malformed' }
  if (wire.expiresAt <= now) return { ok: false, reason: 'expired' }
  const core: CardCore = {
    name: wire.name,
    session: wire.session,
    team: wire.team,
    capabilities: wire.capabilities,
    expiresAt: wire.expiresAt,
    ...(records !== undefined ? { records } : {}),
  }
  try {
    const publicKey = createPublicKey({ key: Buffer.from(wire.publicKey, 'base64'), format: 'der', type: 'spki' })
    const valid = edVerify(
      undefined,
      Buffer.from(canonicalPayload(core), 'utf8'),
      publicKey,
      Buffer.from(wire.signature, 'base64'),
    )
    if (!valid) return { ok: false, reason: 'bad-signature' }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const peers = referrals(wire)
  const teams = sessionTeams(wire)
  return {
    ok: true,
    card: {
      ...core,
      expiresAt: wire.expiresAt,
      ...(peers !== undefined ? { peers } : {}),
      ...(teams !== undefined && teams.length > 0 ? { sessionTeams: teams } : {}),
      ...(typeof wire.lanIp === 'string' && wire.lanIp !== '' ? { lanIp: wire.lanIp } : {}),
      publicKey: wire.publicKey,
      signature: wire.signature,
    },
  }
}
