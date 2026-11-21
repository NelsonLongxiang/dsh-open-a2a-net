/**
 * Expiring signed agent cards (GNUnet HELLO semantics): the card carries its
 * own expiry and an Ed25519 signature over identity, team, capabilities, and
 * expiry, so only the key holder can extend a card's life. Expiry and the
 * signature are enforced wherever a card is parsed — no background cleanup.
 * Design basis: .agents/notes/proposed/feature/2026-08-16-gnunet-prior-art-for-a2a-topology.md (slice 1).
 * @module @nelsonlongxiang/dsh-open-a2a-net/card
 */
import { createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
/** Card validity budget. GNUnet HELLO default (2 days). */
export const CARD_TTL_MS = 172_800_000;
/** Announce re-sign cadence: four publication opportunities per TTL. */
export const CARD_REFRESH_MS = CARD_TTL_MS / 4;
/** Deterministic signing payload: field order is fixed by JSON.stringify of this literal shape. */
function canonicalPayload(core) {
    return JSON.stringify({
        capabilities: core.capabilities,
        expiresAt: core.expiresAt,
        name: core.name,
        ...(core.records !== undefined ? { records: core.records } : {}),
        session: core.session,
        team: core.team,
    });
}
/**
 * Encode a public key as the base64 SPKI DER the card carries.
 * @param publicKey - the signing node's Ed25519 public key.
 * @returns the base64 SPKI DER string.
 */
export function encodePublicKey(publicKey) {
    return publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}
/**
 * Sign one card core with the node's Ed25519 private key.
 * @param core - the card's lifecycle-relevant fields, expiry included.
 * @param privateKey - the signing node's Ed25519 private key.
 * @returns the wire card: the core plus the public key and signature.
 */
export function signCard(core, privateKey) {
    const signature = edSign(undefined, Buffer.from(canonicalPayload(core), 'utf8'), privateKey).toString('base64');
    return { ...core, publicKey: encodePublicKey(createPublicKey(privateKey)), signature };
}
/**
 * Validate the signed records member: absent stays absent; any other shape
 * rejects the card. Records are authority claims, so a malformed list is a
 * malformed card — unlike the unsigned referral hints, which only drop.
 * @param wire - the shape-checked card candidate.
 * @returns the validated records, `undefined` when the card carries none, or
 * `null` when the member is malformed (the caller rejects the card).
 */
function zoneRecords(wire) {
    if (wire.records === undefined)
        return undefined;
    if (!Array.isArray(wire.records))
        return null;
    for (const entry of wire.records) {
        const record = entry;
        if (record?.type !== 'delegate')
            return null;
        if (typeof record.name !== 'string' || record.name === '')
            return null;
        if (typeof record.url !== 'string' || record.url === '')
            return null;
        if (record.publicKey !== undefined && typeof record.publicKey !== 'string')
            return null;
    }
    return wire.records;
}
/**
 * The unsigned `peers` referral list passes through only as an array of
 * strings; any other shape drops the field instead of rejecting the card,
 * because cards from nodes without gossip carry none.
 * @param wire - the shape-checked card candidate.
 * @returns the verified referral list, or `undefined` when absent or malformed.
 */
function referrals(wire) {
    if (!Array.isArray(wire.peers) || !wire.peers.every(url => typeof url === 'string'))
        return undefined;
    return wire.peers;
}
/**
 * The unsigned `sessionTeams` listing passes through only as an array of
 * well-formed entries; any other shape drops the field instead of rejecting
 * the card, because cards from nodes without joined sessions carry none.
 * A missing description is the D2 `exposureExcerpt: off` form, not a
 * malformed node: retain its handle and normalize its excerpt to empty.
 * @param wire - the shape-checked card candidate.
 * @returns the session-team entries, or `undefined` when absent or malformed.
 */
function sessionTeams(wire) {
    if (!Array.isArray(wire.sessionTeams))
        return undefined;
    const entries = [];
    for (const entry of wire.sessionTeams) {
        const team = entry;
        if (typeof team?.team !== 'string' || team.team === '')
            continue;
        if (typeof team.name !== 'string' || (team.description !== undefined && typeof team.description !== 'string') || (team.offline !== undefined && typeof team.offline !== 'boolean'))
            continue;
        entries.push({
            team: team.team,
            name: team.name,
            description: team.description ?? '',
            ...(team.offline !== undefined ? { offline: team.offline } : {}),
            ...(typeof team.workspace === 'string' && team.workspace !== '' ? { workspace: team.workspace } : {}),
        });
    }
    return entries;
}
/**
 * The unsigned `teamMemberships` listing passes through only as an array of
 * well-formed node→team entries; any other shape drops the field instead of
 * rejecting the card — same posture as `sessionTeams`, because cards from
 * nodes that declared no roster teams (or pre-roster versions) carry none.
 * @param wire - the shape-checked card candidate.
 * @returns the membership entries, or `undefined` when absent or malformed.
 */
function teamMemberships(wire) {
    if (!Array.isArray(wire.teamMemberships))
        return undefined;
    const entries = [];
    for (const entry of wire.teamMemberships) {
        const membership = entry;
        if (typeof membership?.node !== 'string' || membership.node === '')
            continue;
        if (typeof membership.team !== 'string' || membership.team === '')
            continue;
        entries.push({ node: membership.node, team: membership.team });
    }
    return entries;
}
/**
 * Verify a parsed card: shape, signature, and expiry, in that order.
 * @param candidate - the JSON value fetched from a peer's agent-card URL.
 * @param now - evaluation time (epoch ms); injected for tests.
 * @returns the verified card, or the first rejection reason.
 */
export function verifyCard(candidate, now) {
    if (typeof candidate !== 'object' || candidate === null)
        return { ok: false, reason: 'malformed' };
    const wire = candidate;
    if (typeof wire.name !== 'string' || typeof wire.session !== 'string' || typeof wire.team !== 'string') {
        return { ok: false, reason: 'malformed' };
    }
    if (typeof wire.expiresAt !== 'number' || typeof wire.publicKey !== 'string' || typeof wire.signature !== 'string') {
        return { ok: false, reason: 'unsigned' };
    }
    const records = zoneRecords(wire);
    if (records === null)
        return { ok: false, reason: 'malformed' };
    if (wire.expiresAt <= now)
        return { ok: false, reason: 'expired' };
    const core = {
        name: wire.name,
        session: wire.session,
        team: wire.team,
        capabilities: wire.capabilities,
        expiresAt: wire.expiresAt,
        ...(records !== undefined ? { records } : {}),
    };
    try {
        const publicKey = createPublicKey({ key: Buffer.from(wire.publicKey, 'base64'), format: 'der', type: 'spki' });
        const valid = edVerify(undefined, Buffer.from(canonicalPayload(core), 'utf8'), publicKey, Buffer.from(wire.signature, 'base64'));
        if (!valid)
            return { ok: false, reason: 'bad-signature' };
    }
    catch {
        return { ok: false, reason: 'malformed' };
    }
    const peers = referrals(wire);
    const teams = sessionTeams(wire);
    const memberships = teamMemberships(wire);
    // gh#41: the unsigned canvas-org listing (full card only) passes through
    // with the same drop-on-malformed posture as sessionTeams — cards from
    // pre-0.6.26 nodes carry none.
    const canvasOrg = [];
    if (Array.isArray(wire.canvasOrg)) {
        for (const entry of wire.canvasOrg) {
            const org = entry;
            if (typeof org?.team !== 'string' || org.team === '')
                continue;
            canvasOrg.push({
                name: typeof org.name === 'string' ? org.name : '',
                team: org.team,
                members: Array.isArray(org.members) ? org.members.filter((m) => typeof m === 'string') : [],
            });
        }
    }
    return {
        ok: true,
        card: {
            ...core,
            expiresAt: wire.expiresAt,
            ...(peers !== undefined ? { peers } : {}),
            ...(teams !== undefined && teams.length > 0 ? { sessionTeams: teams } : {}),
            ...(memberships !== undefined && memberships.length > 0 ? { teamMemberships: memberships } : {}),
            ...(canvasOrg.length > 0 ? { canvasOrg } : {}),
            ...(typeof wire.lanIp === 'string' && wire.lanIp !== '' ? { lanIp: wire.lanIp } : {}),
            ...(typeof wire.version === 'string' && wire.version !== '' ? { version: wire.version } : {}),
            publicKey: wire.publicKey,
            signature: wire.signature,
        },
    };
}
