/**
 * Owner-settings persistence (gh#34): the three unlock knobs a remote
 * build-out needs — teamJoinAllowlist / teamScopeInfo / announce — written
 * into the HOME patch layer (DSH_HOME/cordis.patch.yml), the authoritative
 * config surface (the 3081 lesson: the home-level patch wins over the
 * profile layer). A conservative line editor: it locates the a2a entry's
 * config: block and sets exactly these three keys, never touching anything
 * else; a missing entry is appended in the canonical short-id form.
 * @module @nelsonlongxiang/dsh-open-a2a-net/owner-settings
 */

export interface OwnerSettings {
  teamJoinAllowlist?: string[]
  teamScopeInfo?: boolean
  announce?: boolean
  seatNames?: Record<string, string>
}

/** A label shaped like a routable address (`dsh/66abc2cf`, `zone/canvas/x`, `name/<16 hex>`) would pass for another
 *  session in the directory and in `a2a-net teams <query>`; labels are display-only, so that shape is refused. */
const ADDRESS_SHAPED = /^[A-Za-z0-9._-]+\/\S+$/

/** Shared validation for boot config and owner POST; labels are plain text, never handles or authority. */
export function parseSeatNames(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 1024) return undefined
  const entries = Object.entries(value)
  if (entries.some(([id, name]) => !/^session-[a-zA-Z0-9-]{8,128}$/.test(id) || typeof name !== 'string' || name.trim() === '' || [...name.trim()].length > 64 || /[\p{Cc}\p{Cf}\u2028\u2029\ufffd]/u.test(name) || !/[^\p{Z}\p{C}\p{M}]/u.test(name) || ADDRESS_SHAPED.test(name.trim()))) return undefined
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

/** The exact keys this module may touch, in wire order. */
const KEYS = ['teamJoinAllowlist', 'teamScopeInfo', 'announce', 'seatNames'] as const

export function applyOwnerSettings(patchYaml: string, changes: OwnerSettings): { yaml: string; restartNeeded: boolean } {
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
  if (changes.teamScopeInfo !== undefined) writes.push(`    teamScopeInfo: ${changes.teamScopeInfo ? 'true' : 'false'}`)
  if (changes.announce !== undefined) writes.push(`    announce: ${changes.announce ? 'true' : 'false'}`)
  if (changes.seatNames !== undefined) writes.push(`    seatNames: ${JSON.stringify(changes.seatNames)}`)
  if (writes.length === 0) return { yaml: patchYaml, restartNeeded }

  if (entryStart === -1) {
    // Append a canonical entry (the home patch is a top-level list).
    const trailing = patchYaml.endsWith('\n') ? '' : '\n'
    return { yaml: `${patchYaml}${trailing}- id: a2a\n  config:\n${writes.join('\n')}\n`, restartNeeded }
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
    lines.splice(entryStart + 1, 0, '  config:', ...writes)
    return { yaml: lines.join('\n'), restartNeeded }
  }
  // Rewrite exactly our keys inside the block; keep foreign lines verbatim.
  const blockIndent = '    '
  let insertAt = configAt + 1
  for (const key of KEYS) {
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
          // A map may have been authored as block YAML. Replace its nested rows too, not just the heading.
          if (key === 'seatNames') while (j + 1 < lines.length && (/^ {5,}\S/.test(lines[j + 1] ?? '') || /^\s*$/.test(lines[j + 1] ?? ''))) lines.splice(j + 1, 1)
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
