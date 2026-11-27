/**
 * Owner-settings persistence (gh#34): the three unlock knobs a remote
 * build-out needs — teamJoinAllowlist / teamScope / announce — written
 * into the HOME patch layer (DSH_HOME/cordis.patch.yml), the authoritative
 * config surface (the 3081 lesson: the home-level patch wins over the
 * profile layer). A conservative line editor: it locates the a2a entry's
 * config: block and sets exactly these three keys, never touching anything
 * else; a missing entry is appended in the canonical short-id form.
 * @module @nelsonlongxiang/dsh-open-a2a-net/owner-settings
 */

import { parseDisplayLabel } from './display-label.ts'

export { parseDisplayLabel } from './display-label.ts'

export interface OwnerSettings {
  teamJoinAllowlist?: string[]
  /** One switch for routing and information scope (owner ruling 2026-11-18); a stale teamScopeInfo line stays, ignored. */
  teamScope?: boolean
  announce?: boolean
  seatNames?: Record<string, string>
  /** #808 P2: network keys a blueprint writes (restart needed): peers, originClaimUrl, originClaimAudiences, originClaimByPeer. */
  network?: Partial<Record<NetworkKey, unknown>>
}

/** #808 P2: the network keys the home-layer writer may set besides the owner keys. Never credentials. */
export const NETWORK_KEYS = ['peers', 'originClaimUrl', 'originClaimAudiences', 'originClaimByPeer'] as const
export type NetworkKey = typeof NETWORK_KEYS[number]

/** Shared validation for boot config and owner POST; labels are plain text, never handles or authority. */
export function parseSeatNames(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 1024) return undefined
  const entries = Object.entries(value)
  if (entries.some(([id, name]) => !/^session-[a-zA-Z0-9-]{8,128}$/.test(id) || parseDisplayLabel(name) === undefined)) return undefined
  return Object.fromEntries(entries.map(([id, name]) => [id, (name as string).trim()]))
}

/** Boot config degrades entry-by-entry; owner POST remains all-or-nothing. Never echo label contents in warnings. */
export function loadSeatNames(value: unknown, warn: (reason: string) => void): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) { warn('seatNames: ignored invalid map'); return {} }
  const kept: Record<string, string> = {}
  let count = 0
  for (const [id, name] of Object.entries(value)) {
    const entry = parseSeatNames({ [id]: name })
    if (entry === undefined || count >= 1024) { warn('seatNames: ignored invalid or over-cap entry'); continue }
    Object.assign(kept, entry); count += 1
  }
  return kept
}

/** #812: credentials never copied from one patch layer into another. */
export const SECRET_KEYS = ['apiKey', 'linkKeys'] as const

/**
 * #812: true when a write would create the home layer's a2a `config:` block (no a2a entry, or an entry without one).
 * DSH patches replace an entry's top-level keys whole, so a new block holding only the owner keys would hide every
 * a2a key the profile and bundle layers set (peers, originClaimUrl, originClaimAudiences, ...).
 */
export function createsConfigBlock(patchYaml: string): boolean {
  const lines = patchYaml.split('\n')
  const start = lines.findIndex(line => /^(\s*)-\s*id:\s*'?(a2a)'?\s*$/.test(line))
  if (start === -1) return true
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^\S/.test(line)) return true
    if (/^\s{2}config:\s*$/.test(line)) return false
  }
  return true
}

/**
 * #812: the a2a keys the lower layers set, to carry into a new home `config:` block. While the home layer has no such
 * block, the running config is exactly the lower layers' a2a config; keys equal to the schema default are left out so
 * the home layer does not pin defaults. A credential the lower layers set refuses the write (`blocked`): copying it
 * would spread a secret, dropping it would silently turn auth off.
 */
export function lowerLayerSeed(effective: Readonly<Record<string, unknown>>, defaults: Readonly<Record<string, unknown>>): { ok: true; seed: Record<string, unknown> } | { ok: false; blocked: string[] } {
  const seed: Record<string, unknown> = {}
  const blocked: string[] = []
  for (const [key, value] of Object.entries(effective)) {
    if (value === undefined || typeof value === 'function') continue
    if (JSON.stringify(value) === JSON.stringify(defaults[key])) continue
    if ((SECRET_KEYS as readonly string[]).includes(key)) { blocked.push(key); continue }
    seed[key] = value
  }
  return blocked.length > 0 ? { ok: false, blocked } : { ok: true, seed }
}

/** The exact keys this module may touch, in wire order. */
const KEYS = ['teamJoinAllowlist', 'teamScope', 'announce', 'seatNames'] as const

export function applyOwnerSettings(patchYaml: string, changes: OwnerSettings, seed: Readonly<Record<string, unknown>> = {}): { yaml: string; restartNeeded: boolean } {
  const lines = patchYaml.split('\n')
  // Find the a2a entry: `- id: a2a` / `- id: 'a2a'` variants.
  let entryStart = -1
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)-\s*id:\s*'?(a2a)'?\s*$/.exec(lines[i] ?? '')
    if (m !== null) { entryStart = i; break }
  }
  let restartNeeded = false
  if (changes.announce !== undefined) restartNeeded = true
  const writes: string[] = []
  if (changes.teamJoinAllowlist !== undefined) {
    writes.push(changes.teamJoinAllowlist.length === 0
      ? '    teamJoinAllowlist: []'
      : `    teamJoinAllowlist: [${changes.teamJoinAllowlist.map(name => `'${name.replace(/'/g, "''")}'`).join(', ')}]`)
  }
  if (changes.teamScope !== undefined) writes.push(`    teamScope: ${changes.teamScope ? 'true' : 'false'}`)
  if (changes.announce !== undefined) writes.push(`    announce: ${changes.announce ? 'true' : 'false'}`)
  if (changes.seatNames !== undefined) writes.push(`    seatNames: ${JSON.stringify(changes.seatNames)}`)
  for (const key of NETWORK_KEYS) if (changes.network !== undefined && Object.hasOwn(changes.network, key)) { writes.push(`    ${key}: ${JSON.stringify(changes.network[key])}`); restartNeeded = true }
  if (writes.length === 0) return { yaml: patchYaml, restartNeeded }
  // #812: a new config block starts from the lower layers' keys (JSON is YAML flow); the keys written now win.
  const written = new Set(writes.map(w => w.trim().split(':')[0]!))
  const seeded = Object.entries(seed).filter(([key]) => !written.has(key) && !(key === 'teamScopeInfo' && changes.teamScope !== undefined)).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)

  if (entryStart === -1) {
    // Append a canonical entry (the home patch is a top-level list).
    const trailing = patchYaml.endsWith('\n') ? '' : '\n'
    return { yaml: `${patchYaml}${trailing}- id: a2a\n  config:\n${[...seeded, ...writes].join('\n')}\n`, restartNeeded }
  }
  // Locate the config: block inside the entry (the entry's own indentation
  // is two spaces under the `- id:` line).
  let i = entryStart + 1
  let configAt = -1
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (/^\S/.test(line)) break // next top-level entry
    if (/^\s{2}config:\s*$/.test(line)) { configAt = i; break }
    i += 1
  }
  if (configAt === -1) {
    // Insert a config: block right after the id line.
    lines.splice(entryStart + 1, 0, '  config:', ...seeded, ...writes)
    return { yaml: lines.join('\n'), restartNeeded }
  }
  // Rewrite exactly our keys inside the block; keep foreign lines verbatim.
  const blockIndent = '    '
  let insertAt = configAt + 1
  for (const key of [...KEYS, ...NETWORK_KEYS]) {
    let found = false
    let j = configAt + 1
    while (j < lines.length) {
      const line = lines[j] ?? ''
      if (/^\S/.test(line) || /^\s{2}\S/.test(line) && !/^\s{4}/.test(line) && !/^\s{2}config:/.test(lines[configAt] ?? '')) {
        if (!line.startsWith(blockIndent) && !/^\s*$/.test(line) && j > configAt) {
          // leaving the block when a line is less indented than the keys
          if (!line.startsWith('    ')) break
        }
      }
      const kv = new RegExp(`^\\s*${key}:`).exec(line)
      if (kv !== null) {
        const write = writes.find(w => w.trim().startsWith(`${key}:`))
        if (write !== undefined) {
          lines[j] = write; found = true
          // A map or list may have been authored as block YAML (nested rows, or `- item` rows at the key's own indent):
          // replace them too, not just the heading.
          while (j + 1 < lines.length && (/^ {5,}\S/.test(lines[j + 1] ?? '') || /^ {4}-\s/.test(lines[j + 1] ?? '') || /^\s*$/.test(lines[j + 1] ?? '') && /^ {4,}\S/.test(lines[j + 2] ?? ''))) lines.splice(j + 1, 1)
        }
        break
      }
      if (/^\s*-\s*id:/.test(line)) break
      j += 1
    }
    if (!found) {
      const write = writes.find(w => w.trim().startsWith(`${key}:`))
      if (write !== undefined) { lines.splice(insertAt, 0, write); insertAt += 1 }
    }
  }
  return { yaml: lines.join('\n'), restartNeeded }
}

/**
 * #808 P2 / #812: the one home-layer a2a write, for the owner-settings route and the team builder's network ops alike.
 * Reads the home patch, seeds a new config block from the lower layers (credentials refuse), writes `changes`.
 * @param home - the DSH home (the patch file is <home>/cordis.patch.yml).
 * @param effective - the running a2a config (exactly the lower layers while the home block is absent).
 * @param defaults - the schema defaults (left out of a seed).
 */
export function writeHomeA2a(home: string, changes: OwnerSettings, effective: Readonly<Record<string, unknown>>, defaults: Readonly<Record<string, unknown>>,
  fs: { exists(p: string): boolean; read(p: string): string; write(p: string, s: string): void; mkdir(p: string): void }): { ok: true; restartNeeded: boolean; path: string } | { ok: false; code: 'credentials'; error: string; path: string } {
  const path = home.replace(/\/+$/, '') + '/cordis.patch.yml'
  const current = fs.exists(path) ? fs.read(path) : ''
  let seed: Record<string, unknown> = {}
  if (createsConfigBlock(current)) {
    const lower = lowerLayerSeed(effective, defaults)
    if (!lower.ok) return { ok: false, code: 'credentials', path, error: `the profile layer sets ${lower.blocked.join(', ')}: a new home-layer a2a config would hide it and credentials are not copied between layers; add the a2a config (with ${lower.blocked.join(', ')}) to ${path} first` }
    seed = lower.seed
  }
  const { yaml, restartNeeded } = applyOwnerSettings(current, changes, seed)
  fs.mkdir(home)
  fs.write(path, yaml)
  // #817 R2: every home-layer a2a write this boot, from the owner panel and from blueprints alike, in one overlay.
  const overlay = WRITTEN_SINCE_BOOT.get(path) ?? {}
  for (const key of ['teamJoinAllowlist', 'teamScope', 'announce', 'seatNames'] as const) if (changes[key] !== undefined) overlay[key] = changes[key]
  for (const [key, value] of Object.entries(changes.network ?? {})) overlay[key] = value
  WRITTEN_SINCE_BOOT.set(path, overlay)
  return { ok: true, restartNeeded, path }
}

const WRITTEN_SINCE_BOOT = new Map<string, Record<string, unknown>>()

/** #817 R2: the a2a keys written to this home layer since boot (they take effect on restart), whoever wrote them. */
export function homeA2aWrittenSinceBoot(home: string): Readonly<Record<string, unknown>> {
  return { ...WRITTEN_SINCE_BOOT.get(home.replace(/\/+$/, '') + '/cordis.patch.yml') }
}
