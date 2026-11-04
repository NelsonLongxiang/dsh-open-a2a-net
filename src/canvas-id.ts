/**
 * Owner-qualified canvas ids (#282 S2, design docs/design/simplify-2026-11.md D1).
 * `<zone>/canvas/<name>@<fp8>`: the suffix is the first 8 hex of sha256 over the
 * owner's signed card public key (SPKI DER), so a host that changes address keeps
 * its id. The suffix selects a signing key, not a URL: as on master, a seeded peer
 * serving that key's signed card core counts as an alias of the same owner, and the
 * card's canvasOrg itself is not signed. A bare `<zone>/canvas/<name>` keeps routing
 * exactly as before; the suffix only selects among owners.
 */
import { createHash } from 'node:crypto'

const QUALIFIED = /^(.+\/canvas\/[^/]+)@([0-9a-f]{8})$/

/** First 8 hex of sha256 over the base64 SPKI DER public key; '' when there is no key. */
export function canvasOwnerFingerprint(publicKey: string | undefined): string {
  if (publicKey === undefined || publicKey === '') return ''
  return createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex').slice(0, 8)
}

/** Split `<zone>/canvas/<name>@<fp8>` into the plain team and the owner fingerprint. */
export function splitCanvasOwner(team: string): { team: string; owner?: string } {
  const m = QUALIFIED.exec(team)
  return m === null ? { team } : { team: m[1]!, owner: m[2]! }
}

/** The display/routing id of a canvas team owned by the card holding `publicKey`. */
export function qualifiedCanvasId(team: string, publicKey: string | undefined): string {
  const fp = canvasOwnerFingerprint(publicKey)
  return fp === '' ? team : `${team}@${fp}`
}
