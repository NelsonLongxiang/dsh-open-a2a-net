/**
 * #936: the web profile's declaration of this plugin — its `package.json` dependency and its `pnpm-lock.yaml` entries —
 * kept in step with what node operations install, so a later `pnpm install` in the profile does not put the old package
 * back. Only this plugin's own declaration and lock entries are touched; any other line stays byte for byte. A lockfile
 * whose shape is not the one recognised here is left alone and reported, never guessed at.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/node-declaration
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const OWN = '@nelsonlongxiang/dsh-open-a2a-net'

/** How the profile should declare the package: its npm version, or `file:` the tarball that was installed. */
export type DeclareAs = 'npm' | 'file'

/** The new declaration, worked out before anything is written. */
export interface Declaration { readonly spec: string; readonly manifest: string; readonly lock?: string }

/**
 * The profile directory of a package root: the directory holding the first `node_modules` on its path.
 * @param root - the package root.
 * @returns the profile directory, or undefined when the root is not under node_modules.
 */
export function profileDirOf(root: string): string | undefined {
  const parts = root.split(sep)
  const at = parts.indexOf('node_modules')
  return at <= 0 ? undefined : parts.slice(0, at).join(sep) || sep
}

/** The lockfile's integrity string of a tarball (sha512, base64), as npm and pnpm write it. */
export const integrityOf = (tgz: Buffer): string => `sha512-${createHash('sha512').update(tgz).digest('base64')}`

/**
 * The profile's package.json with this plugin declared as `spec`; formatting otherwise kept (indent, final newline).
 * @returns the new text, or why it cannot be rewritten.
 */
export function rewriteManifest(text: string, spec: string): { ok: true; text: string } | { ok: false; why: string } {
  let pkg: { dependencies?: Record<string, unknown> }
  try { pkg = JSON.parse(text) as typeof pkg } catch { return { ok: false, why: 'the profile package.json is not JSON' } }
  if (pkg.dependencies === undefined || typeof pkg.dependencies !== 'object' || !(OWN in pkg.dependencies)) return { ok: false, why: `the profile package.json does not declare ${OWN}` }
  pkg.dependencies[OWN] = spec
  const indent = /\n( +|\t)"/.exec(text)?.[1] ?? '  '
  return { ok: true, text: JSON.stringify(pkg, null, indent) + (text.endsWith('\n') ? '\n' : '') }
}

const IMPORTER = `      '${OWN}':`

/**
 * The lockfile with this plugin's three entries moved to the new package (lockfile v9: the importer's specifier and
 * version, the `packages` entry with its resolution, the `snapshots` entry). Anything not exactly in that shape is refused.
 * @param text - the lockfile.
 * @param spec - what package.json now declares.
 * @param ref - the importer's new version: the npm version, or `file:<path relative to the profile>`.
 * @param integrity - the installed tarball's integrity.
 * @param version - the installed package's version.
 * @returns the new text, or why it was not rewritten.
 */
export function rewriteLock(text: string, spec: string, ref: string, integrity: string, version: string): { ok: true; text: string } | { ok: false; why: string } {
  if (!/^lockfileVersion: '9\.\d+'/m.test(text)) return { ok: false, why: 'the lockfile is not version 9' }
  const lines = text.split('\n')
  const importers = lines.flatMap((line, i) => line === IMPORTER ? [i] : [])
  if (importers.length !== 1) return { ok: false, why: `the lockfile names ${OWN} under the importers ${String(importers.length)} times, not once` }
  const at = importers[0]!
  const spec0 = /^        specifier: (.+)$/.exec(lines[at + 1] ?? ''), ref0 = /^        version: (.+)$/.exec(lines[at + 2] ?? '')
  if (spec0 === null || ref0 === null) return { ok: false, why: 'the importer entry is not specifier then version' }
  const oldKey = `  '${OWN}@${ref0[1]}':`, newKey = `  '${OWN}@${ref}':`
  // #937 review 2: entries for the new package already there would be doubled; refuse rather than merge.
  // #937 re-review: in any form — an entry block, `{}`, or an inline mapping on the key's own line.
  if (newKey !== oldKey && lines.some(line => line.startsWith(newKey))) return { ok: false, why: `the lockfile already has entries for ${ref}` }
  const keyed = lines.flatMap((line, i) => line === oldKey || line === `${oldKey} {}` ? [i] : [])
  if (keyed.length !== 2) return { ok: false, why: `the lockfile has ${String(keyed.length)} package and snapshot entries for ${ref0[1]}, not 2` }
  const pkgAt = keyed.find(i => lines[i] === oldKey && (lines[i + 1] ?? '').startsWith('    resolution: {'))
  if (pkgAt === undefined) return { ok: false, why: 'the packages entry has no resolution line' }
  const file = ref.startsWith('file:')
  const out = [...lines]
  out[at + 1] = `        specifier: ${spec}`
  out[at + 2] = `        version: ${ref}`
  for (const i of keyed) out[i] = lines[i] === oldKey ? newKey : `${newKey} {}`
  out[pkgAt + 1] = file ? `    resolution: {integrity: ${integrity}, tarball: ${ref}}` : `    resolution: {integrity: ${integrity}}`
  // A file: entry carries the package's version on its own line; an npm entry does not.
  let end = pkgAt + 2
  while (end < out.length && out[end]!.startsWith('    ')) end++
  const versionAt = out.slice(pkgAt + 2, end).findIndex(line => line.startsWith('    version: '))
  if (versionAt >= 0) { if (file) out[pkgAt + 2 + versionAt] = `    version: ${version}`; else out.splice(pkgAt + 2 + versionAt, 1) }
  else if (file) out.splice(pkgAt + 2, 0, `    version: ${version}`)
  return { ok: true, text: out.join('\n') }
}

/**
 * #937 re-review: the dependencies the lockfile's `snapshots` entry lists for this plugin at `ref`, name to resolved
 * version, or undefined when there is no such entry. Only the `dependencies` block counts; a peer suffix is dropped.
 */
export function lockedDependencies(text: string, ref: string): Record<string, string> | undefined {
  const lines = text.split('\n')
  const from = lines.indexOf('snapshots:')
  if (from < 0) return undefined
  const key = `  '${OWN}@${ref}':`
  const at = lines.findIndex((line, i) => i > from && (line === key || line === `${key} {}`))
  if (at < 0) return undefined
  const found: Record<string, string> = {}
  if (lines[at] === `${key} {}`) return found
  let inDeps = false
  for (let i = at + 1; i < lines.length && lines[i]!.startsWith('    '); i++) {
    const line = lines[i]!
    if (/^    \S/.test(line)) { inDeps = line === '    dependencies:'; continue }
    const m = /^      '?([^':]+?)'?: '?([^'\s(]+)/.exec(line)
    if (inDeps && m !== null) found[m[1]!] = m[2]!
  }
  return found
}

const plain = (v: string): number[] | undefined => { const m = /^v?=?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim()); return m === null ? undefined : [Number(m[1]), Number(m[2]), Number(m[3])] }
const atLeast = (v: number[], w: number[]): boolean => v[0]! !== w[0]! ? v[0]! > w[0]! : v[1]! !== w[1]! ? v[1]! > w[1]! : v[2]! >= w[2]!

/**
 * #937 re-review B4: whether a locked version satisfies a dependency's spec, for the plain forms only — an exact version,
 * `^`, `~` and `*`. Anything else (other ranges, pre-releases, tags, URLs) is undefined: not confirmed, never guessed.
 */
export function versionSatisfies(version: string, spec: string): boolean | undefined {
  const s = spec.trim()
  const v = plain(version)
  if (v === undefined) return undefined
  if (s === '*' || s === '' || s === 'x') return true
  const exact = plain(s)
  if (exact !== undefined) return v.join('.') === exact.join('.')
  const caret = /^\^(.+)$/.exec(s), tilde = /^~(.+)$/.exec(s)
  const w = plain((caret ?? tilde)?.[1] ?? '')
  if (w === undefined) return undefined
  if (!atLeast(v, w)) return false
  if (tilde !== null) return v[0] === w[0] && v[1] === w[1]
  return w[0]! > 0 ? v[0] === w[0] : w[1]! > 0 ? v[0] === 0 && v[1] === w[1] : v.join('.') === w.join('.')
}

/**
 * #937 re-review: why the lockfile does not describe a package's dependencies — a missing or extra name, a locked version
 * outside the package's spec, or a spec that cannot be checked. Empty when it does.
 */
export function dependencyGaps(locked: Record<string, string>, dependencies: readonly (readonly [string, string])[]): string[] {
  const gaps: string[] = []
  const wanted = new Map(dependencies)
  for (const [name, spec] of wanted) {
    const at = locked[name]
    if (at === undefined) { gaps.push(`${name} ${spec} is not in the lockfile`); continue }
    const ok = versionSatisfies(at, spec)
    if (ok === undefined) gaps.push(`${name}: cannot confirm that locked ${at} meets ${spec}`)
    else if (!ok) gaps.push(`${name}: locked ${at} does not meet ${spec}`)
  }
  for (const name of Object.keys(locked)) if (!wanted.has(name)) gaps.push(`${name} is in the lockfile but not a dependency`)
  return gaps
}

/**
 * The new declaration for a package just installed, worked out in full before anything is written.
 * @param profile - the profile directory.
 * @param as - npm version or file:.
 * @param version - the installed version.
 * @param integrity - the installed tarball's integrity.
 * @param tarball - for `file`: where the installed tarball is kept.
 * @returns both texts (the lockfile only when the profile has one), or why the declaration is left as it is.
 */
export function planDeclaration(profile: string, as: DeclareAs, version: string, integrity: string, tarball?: string, dependencies?: readonly (readonly [string, string])[]): { ok: true; plan: Declaration } | { ok: false; why: string } {
  const manifestPath = join(profile, 'package.json'), lockPath = join(profile, 'pnpm-lock.yaml')
  if (!existsSync(manifestPath)) return { ok: false, why: 'the profile has no package.json' }
  if (as === 'file' && tarball === undefined) return { ok: false, why: 'no kept tarball to declare' }
  const spec = as === 'npm' ? version : `file:${tarball!}`
  const manifest = rewriteManifest(readFileSync(manifestPath, 'utf8'), spec)
  if (!manifest.ok) return manifest
  if (!existsSync(lockPath)) return { ok: true, plan: { spec, manifest: manifest.text } }
  const ref = as === 'npm' ? version : `file:${relative(profile, tarball!).split(sep).join('/')}`
  const lockText = readFileSync(lockPath, 'utf8')
  // #937 re-review: only a lockfile that already lists this package's dependencies may be moved to it; otherwise the lock
  // would claim a package whose dependencies it never resolved (pnpm install in the profile does that).
  if (dependencies !== undefined) {
    const oldRef = /^        version: (.+)$/.exec(lockText.split('\n')[lockText.split('\n').indexOf(IMPORTER) + 2] ?? '')?.[1]
    const listed = oldRef === undefined ? undefined : lockedDependencies(lockText, oldRef)
    const gaps = listed === undefined ? [] : dependencyGaps(listed, dependencies)
    if (gaps.length > 0) return { ok: false, why: `the lockfile does not describe this package's dependencies (${gaps.join('; ')}): run pnpm install in the profile, then node status` }
  }
  const lock = rewriteLock(lockText, spec, ref, integrity, version)
  return lock.ok ? { ok: true, plan: { spec, manifest: manifest.text, lock: lock.text } } : lock
}

/**
 * Whether the profile's declaration, its lockfile and the installed package agree (`node status`).
 * @param profile - the profile directory.
 * @param installed - the version node_modules holds.
 * @returns what each says, and `drift` with the reasons when they disagree.
 */
export function declarationStatus(profile: string | undefined, installed: string, dependencies?: readonly (readonly [string, string])[]): Record<string, unknown> {
  if (profile === undefined) return { drift: false, why: ['not installed under a profile'] }
  const why: string[] = []
  let spec: string | undefined
  try { spec = (JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies?.[OWN] } catch { why.push('the profile package.json cannot be read') }
  if (spec === undefined && why.length === 0) why.push(`the profile package.json does not declare ${OWN}`)
  let lock: { specifier?: string; version?: string; packageVersion?: string } | undefined
  let listed: Record<string, string> | undefined
  try {
    const text = readFileSync(join(profile, 'pnpm-lock.yaml'), 'utf8')
    const lines = text.split('\n')
    const at = lines.indexOf(IMPORTER)
    if (at < 0) why.push(`the lockfile does not name ${OWN}`)
    else {
      lock = { specifier: /^        specifier: (.+)$/.exec(lines[at + 1] ?? '')?.[1], version: /^        version: (.+)$/.exec(lines[at + 2] ?? '')?.[1] }
      const key = lines.indexOf(`  '${OWN}@${lock.version ?? ''}':`)
      for (let i = key + 1; key >= 0 && i < lines.length && lines[i]!.startsWith('    '); i++) { const m = /^    version: (.+)$/.exec(lines[i]!); if (m !== null) lock.packageVersion = m[1] }
      if (lock.version !== undefined) listed = lockedDependencies(text, lock.version)
    }
  } catch { /* no lockfile: nothing to compare */ }
  if (spec !== undefined && lock?.specifier !== undefined && lock.specifier !== spec) why.push('the lockfile was written for another declaration')
  if (spec !== undefined && !spec.startsWith('file:') && spec !== installed) why.push(`package.json declares ${spec}, node_modules holds ${installed}`)
  const locked = lock?.version !== undefined && !lock.version.startsWith('file:') ? lock.version : lock?.packageVersion
  if (locked !== undefined && locked !== installed) why.push(`the lockfile pins ${locked}, node_modules holds ${installed}`)
  // #937 re-review: the lockfile has to know the installed package's dependencies, whatever marker an install left.
  if (dependencies !== undefined && listed !== undefined) for (const gap of dependencyGaps(listed, dependencies)) why.push(`the lockfile does not describe the installed package's dependencies: ${gap}; run pnpm install in the profile`)
  return { ...(spec !== undefined ? { declared: spec } : {}), ...(lock !== undefined ? { lock } : {}), installed, drift: why.length > 0, ...(why.length > 0 ? { why } : {}) }
}
