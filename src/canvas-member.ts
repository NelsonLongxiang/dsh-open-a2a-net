/** Session-member provenance (#334). fp8 selects an owner; only a full key anchors it. */
import { createPublicKey } from 'node:crypto'
import { canvasOwnerFingerprint } from './canvas-id.ts'
import { CLI_HANDLE_RE } from './cli-deposit.ts'

export interface QualifiedMember { handle: string; fingerprint: string }
/** CLI handles keep their existing home/deposit rules and are never parsed as session members. */
export function splitQualifiedMember(ref: string): QualifiedMember | undefined {
  if (CLI_HANDLE_RE.test(ref)) return undefined
  const match = /^([^/\s@]+\/[0-9a-f]{8})@([0-9a-f]{8})$/.exec(ref)
  return match ? { handle: match[1]!, fingerprint: match[2]! } : undefined
}
export function validMemberOwner(ref: string, key: string): boolean {
  const member = splitQualifiedMember(ref)
  if (!member || !key || canvasOwnerFingerprint(key) !== member.fingerprint) return false
  try {
    const bytes = Buffer.from(key, 'base64'), publicKey = createPublicKey({ key: bytes, format: 'der', type: 'spki' })
    return publicKey.asymmetricKeyType === 'ed25519' && publicKey.export({ format: 'der', type: 'spki' }).equals(bytes) && bytes.toString('base64') === key
  } catch { return false }
}
export function qualifiedSessionMember(handle: string, key: string): string | undefined {
  const ref = handle + '@' + canvasOwnerFingerprint(key)
  return validMemberOwner(ref, key) ? ref : undefined
}
export type MemberProvenance = 'local-id' | 'confirmed-local' | 'confirmed-remote' | 'unknown' | 'cli' | 'conflict'
export function memberProvenance(ref: string, ownerKey: string | undefined, ownKey: string): MemberProvenance {
  if (CLI_HANDLE_RE.test(ref)) return 'cli'
  if (!ref.includes('/')) return 'local-id'
  const qualified = splitQualifiedMember(ref)
  if (!qualified) return ref.includes('@') ? 'conflict' : 'unknown'
  if (ownerKey === undefined) return qualified.fingerprint === canvasOwnerFingerprint(ownKey) ? 'confirmed-local' : 'unknown'
  if (!validMemberOwner(ref, ownerKey)) return 'conflict'
  if (qualified.fingerprint === canvasOwnerFingerprint(ownKey) && ownerKey !== ownKey) return 'conflict'
  return ownerKey === ownKey ? 'confirmed-local' : 'confirmed-remote'
}
