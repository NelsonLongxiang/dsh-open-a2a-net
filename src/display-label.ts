/** A label shaped like a routable address (`dsh/66abc2cf`, `zone/canvas/x`, `name/<16 hex>`) would pass for another
 *  session in the directory and in `a2a-net teams <query>`; labels are display-only, so that shape is refused. */
const ADDRESS_SHAPED = /^[A-Za-z0-9._-]+\/\S+$/

/**
 * #953: a canvas team's display label, by the seat-name rules: plain text, 1..64 characters, no controls, not shaped like an
 * address. Display only: the team's name stays its routable address.
 * @param value - the candidate.
 * @returns the trimmed label, or undefined when it is not acceptable.
 */
export function parseDisplayLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text === '' || [...text].length > 64 || /[\p{Cc}\p{Cf}\u2028\u2029\ufffd]/u.test(value) || !/[^\p{Z}\p{C}\p{M}]/u.test(value) || ADDRESS_SHAPED.test(text)) return undefined
  return text
}
