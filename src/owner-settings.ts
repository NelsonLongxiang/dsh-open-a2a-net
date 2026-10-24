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
}

/** The exact keys this module may touch, in wire order. */
const KEYS = ['teamJoinAllowlist', 'teamScopeInfo', 'announce'] as const

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
        if (write !== undefined) { lines[j] = write; found = true }
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
