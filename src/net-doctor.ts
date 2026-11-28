/**
 * #838 A: the network doctor. A read-only, offline view of how this host's four hot network keys are set: the effective
 * value, which layer it came from, whether the home-layer file and the running value agree, and the checks the host can
 * make on its own (no network, no peer call).
 *
 * What it must not do: turn a peer's report about us into an action. The rejected-request rows (`claimRejectsRecent`) are
 * the caller's own, unverified declarations (caller and callerUrl are self-reported and the signature did not verify), so
 * they only become a hint about what the OTHER host might change; this module never drafts a change for either host from
 * them. Credentials never appear in the output (apiKey and linkKeys are not read here).
 * @module @nelsonlongxiang/dsh-open-a2a-net/net-doctor
 */

import { normalizeOriginClaimByPeer, originClaimByPeerWarning } from './origin-claim-by-peer.ts'
import { createsConfigBlock, NETWORK_KEYS, type NetworkKey } from './owner-settings.ts'

export type NetLayer = 'default' | 'profile' | 'home'

/** The schema defaults of the four keys (src/config.ts), for the layer reading. */
export const NET_KEY_DEFAULTS: Readonly<Record<NetworkKey, unknown>> = { peers: [], originClaimUrl: '', originClaimAudiences: [], originClaimByPeer: {} }

/** The a2a `config:` block of the home patch file, as far as it could be read. */
export interface HomeBlock {
  readonly blockPresent: boolean
  readonly values: Partial<Record<NetworkKey, unknown>>
  /** Keys present in the file whose value shape this reader does not parse: reported, never guessed. */
  readonly unparsed: readonly NetworkKey[]
}

const unquote = (text: string): string => { const t = text.trim(); return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t }

/** Read the four network keys out of the home patch's a2a block. The writer emits JSON (a YAML flow); hand-written block lists are read too. */
export function readHomeBlock(patchYaml: string): HomeBlock {
  if (createsConfigBlock(patchYaml)) return { blockPresent: false, values: {}, unparsed: [] }
  const lines = patchYaml.split('\n')
  const start = lines.findIndex(line => /^(\s*)-\s*id:\s*'?(a2a)'?\s*$/.test(line))
  let at = start + 1
  while (at < lines.length && !/^\s{2}config:\s*$/.test(lines[at] ?? '')) at += 1
  const values: Partial<Record<NetworkKey, unknown>> = {}
  const unparsed: NetworkKey[] = []
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^\S/.test(line)) break
    for (const key of NETWORK_KEYS) {
      const m = new RegExp(`^ {4}${key}:\\s*(.*)$`).exec(line)
      if (m === null) continue
      const rest = (m[1] ?? '').trim()
      if (rest !== '') {
        try { values[key] = JSON.parse(rest) } catch { key === 'originClaimUrl' ? (values[key] = unquote(rest)) : unparsed.push(key) }
        continue
      }
      const items: string[] = []
      let j = i + 1
      let mapLike = false
      for (; j < lines.length; j += 1) {
        const next = lines[j] ?? ''
        const item = /^ {4,}-\s+(.+)$/.exec(next)
        if (item !== null) { items.push(unquote(item[1] ?? '')); continue }
        if (/^ {5,}\S/.test(next)) { mapLike = true; continue }
        if (/^\s*$/.test(next)) continue
        break
      }
      if (mapLike) unparsed.push(key)
      else values[key] = key === 'originClaimUrl' ? '' : key === 'originClaimByPeer' ? {} : items
    }
  }
  return { blockPresent: true, values, unparsed }
}

export interface EffectiveRow {
  readonly key: NetworkKey
  readonly running: unknown
  readonly source: NetLayer
  /** The value the home file holds for this key, when it holds one. */
  readonly file?: unknown
  /** same: file and running agree; differs: the file was written but the running value is another (restart pending, or the reload ignored it); none: the file does not name the key; unparsed: present, shape not read. */
  readonly fileState: 'same' | 'differs' | 'none' | 'unparsed'
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export function effectiveNetView(args: { readonly running: Readonly<Record<NetworkKey, unknown>>; readonly defaults: Readonly<Record<string, unknown>>; readonly home: HomeBlock }): { readonly rows: readonly EffectiveRow[]; readonly notes: readonly string[] } {
  const { running, defaults, home } = args
  const rows = NETWORK_KEYS.map((key): EffectiveRow => {
    const inFile = Object.hasOwn(home.values, key)
    const unparsed = home.unparsed.includes(key)
    // A home a2a block replaces the lower layers' a2a keys whole (#812/#814): a key it does not name is the schema default.
    const source: NetLayer = inFile || unparsed ? 'home' : home.blockPresent ? 'default' : sameValue(running[key], defaults[key]) ? 'default' : 'profile'
    return {
      key, running: running[key], source,
      ...(inFile ? { file: home.values[key] } : {}),
      fileState: unparsed ? 'unparsed' : !inFile ? 'none' : sameValue(home.values[key], running[key]) ? 'same' : 'differs',
    }
  })
  const notes: string[] = []
  if (home.blockPresent) notes.push('The home layer sets an a2a config block: every a2a key it does not name falls back to the schema default, whatever the profile layer says (#812/#814). The profile layer itself is not visible from here.')
  if (rows.some(row => row.fileState === 'differs')) notes.push('A key whose file value differs from the running value was written but is not what runs: it takes effect on restart, or the hot reload ignored it as malformed (the log says which).')
  return { rows, notes }
}

export interface DoctorFinding {
  readonly code: string
  readonly severity: 'warn' | 'info'
  /** Whose configuration the finding is about. */
  readonly about: 'this-host' | 'peer-declared-unverified'
  readonly message: string
}

/** What a rejected inbound request usually means for the host that sent it. A hint only: the row it came from is unverified. */
export const REJECT_HINTS: Readonly<Record<string, string>> = {
  'bad-caller-shape': 'the caller headers were malformed: its originClaimUrl should be one root card URL',
  'bad-ts': 'the clocks differ by more than the signature window: sync time on either host',
  'no-card': 'this host could not fetch the caller card: the caller originClaimUrl must be a card URL this host can reach, and the caller must be in this host peers',
  'bad-sig': 'the signature did not verify: usual cause is the caller originClaimUrl unset while it is bound to loopback (#814), or its key changed',
  'not-derivable': 'the caller URL is not a card URL this host can derive: it should be the root card URL or a seeded mounted card',
  'wrong-audience': 'the caller signed for an address this host does not list: add the address the caller actually dials to this host originClaimAudiences (see audienceMisses)',
  'unbound-closed': 'the caller sent only the unbound signature after that window closed: the caller needs the audience-bound form',
  'body-mismatch': 'the body changed in transit (a proxy rewrote it)',
  'verification-timeout': 'this host timed out reaching the caller card URL: check reachability from this host',
  absent: 'no origin claim at all: the caller is not a signing peer',
}

export interface DoctorRejectRow { readonly caller: string; readonly callerUrl: string; readonly reason: string; readonly count: number; readonly lastAt: number }
export interface DoctorMissRow { readonly caller: string; readonly audience: string; readonly count: number; readonly lastAt: number }

const originOfUrl = (url: string): string => { try { return new URL(url).origin } catch { return '' } }
const canonical = (url: string): string => { try { const u = new URL(url); return u.origin + u.pathname.replace(/\/+$/, '') } catch { return url } }

/** The checks this host can make about itself, offline. */
export function localFindings(args: {
  readonly running: Readonly<Record<NetworkKey, unknown>>
  readonly announce: boolean
  /** The address the web server is bound to, when known. */
  readonly boundHost?: '127.0.0.1' | '0.0.0.0' | undefined
  readonly claimRejects: readonly DoctorRejectRow[]
  readonly boundMisses: readonly DoctorMissRow[]
}): DoctorFinding[] {
  const out: DoctorFinding[] = []
  const peers = Array.isArray(args.running.peers) ? args.running.peers as string[] : []
  const byPeer = (args.running.originClaimByPeer ?? {}) as Record<string, string>
  const url = typeof args.running.originClaimUrl === 'string' ? args.running.originClaimUrl : ''
  if (args.announce && url === '' && args.boundHost === '127.0.0.1') {
    out.push({ code: 'claim-url-loopback', severity: 'warn', about: 'this-host', message: 'originClaimUrl is empty and the web server is bound to loopback: the card URL this host declares is 127.0.0.1, which no peer can fetch, so peers will see bad-sig (#814). Set originClaimUrl to the card URL peers reach.' })
  }
  for (const row of normalizeOriginClaimByPeer(byPeer).ignored) out.push({ code: 'by-peer-ignored', severity: 'warn', about: 'this-host', message: originClaimByPeerWarning(row) })
  const peerOrigins = new Set(peers.map(originOfUrl).filter(origin => origin !== ''))
  for (const key of Object.keys(byPeer)) {
    const origin = originOfUrl(key)
    if (origin !== '' && !peerOrigins.has(origin)) out.push({ code: 'by-peer-not-in-peers', severity: 'warn', about: 'this-host', message: `originClaimByPeer names ${key}, which is not in peers (no peer has that origin): the mapping can never apply. Check the spelling or add the peer.` })
  }
  const seen = new Map<string, string>()
  for (const peer of peers) {
    const c = canonical(peer)
    const prior = seen.get(c)
    if (prior !== undefined && prior !== peer) out.push({ code: 'peer-duplicate-spelling', severity: 'warn', about: 'this-host', message: `peers lists ${prior} and ${peer}: one peer written two ways. Keep one.` })
    else seen.set(c, peer)
  }
  for (const row of args.boundMisses) {
    out.push({ code: 'audience-miss', severity: 'warn', about: 'this-host', message: `A verified caller (${row.caller}) signed for ${row.audience}, which this host does not list as an audience (${String(row.count)}x). If that is the address it should dial, add it to originClaimAudiences on THIS host.` })
  }
  for (const row of args.claimRejects) {
    out.push({ code: `peer-rejected:${row.reason}`, severity: 'info', about: 'peer-declared-unverified', message: `A request that declared itself ${row.caller === '' ? 'anonymous' : row.caller} (${row.callerUrl === '' ? 'no URL' : row.callerUrl}) was refused ${String(row.count)}x as ${row.reason}. UNVERIFIED: the caller is self-reported. Hint for the host that sent it: ${REJECT_HINTS[row.reason] ?? 'see docs/protocol/delivery-origin-auth.md'}` })
  }
  return out
}
