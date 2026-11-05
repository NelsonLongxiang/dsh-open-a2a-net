/** #311: prefer LAN addresses over overlay CGNAT without depending on adapter names. */
import { isIPv4 } from 'node:net'

export interface IPv4InterfaceAddress {
  readonly family: string
  readonly internal: boolean
  readonly address: string
}

/** RFC1918 > other external IPv4 > CGNAT (100.64/10); ties retain enumeration order. */
export function selectLanIPv4(interfaces: Readonly<Record<string, readonly IPv4InterfaceAddress[] | undefined>>): string {
  let selected = '', best = Infinity
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isIPv4(entry.address)) continue
      const [a, b] = entry.address.split('.').map(Number)
      const rank = a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)
        ? 0 : a === 100 && b! >= 64 && b! <= 127 ? 2 : 1
      if (rank < best) { selected = entry.address; best = rank }
    }
  }
  return selected
}
