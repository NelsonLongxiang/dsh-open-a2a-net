/**
 * Node operations for the control API's user scope: the owner (or an owner delegate) updates this plugin on a node,
 * rolls it back, and restarts the node, through one control route instead of a shell on that node.
 *
 * Scope is deliberately narrow:
 * - only this plugin's own package directory is replaced, never the profile, its lockfile or another plugin;
 * - a tarball whose `dependencies` differ from the running package is refused (an unpack-only install cannot add a
 *   dependency) unless the caller says `forceDeps`;
 * - a source checkout is never overwritten: the running package must live under a `node_modules` directory;
 * - every swap keeps the previous directory as a backup (the newest three are kept) and the package's own
 *   `node_modules` moves across, so a rollback is two renames;
 * - one operation at a time, every operation is appended to `<dir>/log.jsonl`;
 * - #898 review: a tarball's entries are checked before and after unpacking — only plain files and directories under
 *   `package/`, no absolute or `..` paths, no symbolic or hard links, no devices — and a package version is one safe
 *   segment, so neither the running directory nor a backup can be pointed outside its place.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/node-ops
 */
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/** This package's name: the only package node operations replace. */
export const OWN_PACKAGE = '@nelsonlongxiang/dsh-open-a2a-net'

/** How many previous package directories stay as backups. */
export const KEEP_BACKUPS = 3

/** One kept backup. */
export interface NodeOpsBackup { readonly id: string; readonly version: string; readonly at: string }

/** What an operation answered. */
export type NodeOpsResult =
  | { readonly ok: true; readonly from: string; readonly to: string; readonly backup?: string }
  | { readonly ok: false; readonly code: string; readonly error: string }

/** Everything node operations touch, so the tests can point them at a scratch tree. */
export interface NodeOpsPaths {
  /** The running package's root directory. */
  readonly root: string
  /** `<dsh-home>/a2a/node-ops`: stage, backups and the log. */
  readonly dir: string
}

/**
 * The package root that holds a file of this package: the nearest directory upward whose package.json names it.
 * @param from - a file inside the package.
 * @returns the root, or undefined when none is found.
 */
export function ownPackageRoot(from: string): string | undefined {
  let at = dirname(from)
  for (;;) {
    try { if ((JSON.parse(readFileSync(join(at, 'package.json'), 'utf8')) as { name?: unknown }).name === OWN_PACKAGE) return at } catch { /* keep walking */ }
    const up = dirname(at)
    if (up === at) return undefined
    at = up
  }
}

/** #898 review: a version is one safe path segment (it names a backup directory). */
export const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/

const readPackage = (root: string): { version: string; dependencies: string } => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown; dependencies?: unknown }
  if (pkg.name !== OWN_PACKAGE) throw new Error(`package.json names ${String(pkg.name)}, not ${OWN_PACKAGE}`)
  const version = String(pkg.version ?? '')
  if (!SAFE_VERSION.test(version) || version.includes('..')) throw new Error(`package.json version ${JSON.stringify(version)} is not a plain version`)
  const deps = pkg.dependencies !== null && typeof pkg.dependencies === 'object' ? pkg.dependencies as Record<string, unknown> : {}
  return { version, dependencies: JSON.stringify(Object.keys(deps).sort().map(k => [k, deps[k]])) }
}

/**
 * #898 review: why a tarball's listing is refused, or undefined when every entry is a plain file or directory under
 * `package/` with a relative path. Reads the verbose listing (`tar -tvzf`), whose first column is the entry type on GNU
 * tar, bsdtar and Windows tar.exe alike.
 */
export function tarballListingRefusal(names: readonly string[], verbose: readonly string[]): string | undefined {
  if (names.length === 0) return 'the tarball is empty'
  for (const raw of names) {
    const name = raw.replace(/\\/g, '/')
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return `absolute path in the tarball: ${raw}`
    if (name.split('/').includes('..')) return `a .. path in the tarball: ${raw}`
    if (name !== 'package' && name !== 'package/' && !name.startsWith('package/')) return `an entry outside package/: ${raw}`
  }
  for (const line of verbose) {
    if (line.trim() === '') continue
    const type = line[0]
    if (type !== '-' && type !== 'd') return `the tarball holds a link or special file: ${line.trim()}`
    if (/ -> | link to /.test(line)) return `the tarball holds a link: ${line.trim()}`
  }
  return undefined
}

/** #898 review: why an unpacked tree is refused (a link, a special file, a hard-linked file), or undefined. */
export function unpackedTreeRefusal(root: string): string | undefined {
  const top = lstatSync(root)
  if (!top.isDirectory() || top.isSymbolicLink()) return 'package/ is not a plain directory'
  const stack = [root]
  while (stack.length > 0) {
    const at = stack.pop()!
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      const st = lstatSync(path)
      if (st.isSymbolicLink()) return `a symbolic link in the package: ${path.slice(root.length + 1)}`
      if (st.isDirectory()) { stack.push(path); continue }
      if (!st.isFile()) return `a special file in the package: ${path.slice(root.length + 1)}`
      if (st.nlink > 1) return `a hard-linked file in the package: ${path.slice(root.length + 1)}`
    }
  }
  return undefined
}

/** The host's node operations: one at a time, each logged. */
export class NodeOps {
  private busy = false

  /**
   * @param paths - the running package root and the node-ops directory.
   * @param now - the clock.
   */
  constructor(private readonly paths: NodeOpsPaths, private readonly now: () => Date = () => new Date()) {}

  private get backups(): string { return join(this.paths.dir, 'backups') }

  /**
   * The kept backups, newest first.
   * @returns the backups.
   */
  listBackups(): NodeOpsBackup[] {
    let names: string[] = []
    try { names = readdirSync(this.backups) } catch { return [] }
    const rows: NodeOpsBackup[] = []
    for (const id of names) {
      try {
        const at = readFileSync(join(this.backups, id, '.node-ops-at'), 'utf8').trim()
        rows.push({ id, version: readPackage(join(this.backups, id)).version, at })
      } catch { /* not one of ours */ }
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at))
  }

  /**
   * What the node runs and what it keeps.
   * @returns the status.
   */
  status(): Record<string, unknown> {
    let version = '?'
    try { version = readPackage(this.paths.root).version } catch { /* reported as '?' */ }
    let last: unknown[] = []
    try { last = readFileSync(join(this.paths.dir, 'log.jsonl'), 'utf8').trim().split('\n').slice(-5).map(line => JSON.parse(line) as unknown) } catch { /* no log yet */ }
    return {
      ok: true, package: OWN_PACKAGE, version, installed: this.refusal() === undefined, pid: process.pid,
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(), node: process.version, platform: process.platform,
      busy: this.busy, backups: this.listBackups(), last,
    }
  }

  /** Why this node's package may not be replaced, or undefined when it may. */
  private refusal(): NodeOpsResult | undefined {
    if (!this.paths.root.split(sep).includes('node_modules')) return { ok: false, code: 'not-installed', error: `${this.paths.root} is not under node_modules (a source checkout is never replaced)` }
    return undefined
  }

  private log(entry: Record<string, unknown>): void {
    try { mkdirSync(this.paths.dir, { recursive: true }); appendFileSync(join(this.paths.dir, 'log.jsonl'), `${JSON.stringify({ at: this.now().toISOString(), ...entry })}\n`, { encoding: 'utf8', mode: 0o600 }) } catch { /* the delegate audit still has the call */ }
  }

  private exclusive(op: string, who: string, run: () => NodeOpsResult): NodeOpsResult {
    if (this.busy) return { ok: false, code: 'busy', error: 'another node operation is running' }
    this.busy = true
    let out: NodeOpsResult
    try { out = run() } catch (error) { out = { ok: false, code: 'failed', error: String((error as Error).message ?? error) } } finally { this.busy = false }
    this.log({ op, who, ...out })
    return out
  }

  /** Move the running root aside as a new backup, carrying its node_modules into `next`; undo on failure. */
  private swap(next: string, from: string): string {
    mkdirSync(this.backups, { recursive: true })
    if (!SAFE_VERSION.test(from) || from.includes('..')) throw new Error(`refusing a backup named after version ${JSON.stringify(from)}`)
    // A short random tail keeps two swaps in the same millisecond apart (#898 review P2).
    const id = `${this.now().toISOString().replace(/[:.]/g, '-')}-${from}-${randomUUID().slice(0, 8)}`
    const backup = join(this.backups, id)
    // #898 review: the backup is a direct child of backups/, whatever the version says.
    if (dirname(resolve(backup)) !== resolve(this.backups)) throw new Error(`backup ${id} would leave ${this.backups}`)
    const modules = join(this.paths.root, 'node_modules')
    const carried = existsSync(modules) && !existsSync(join(next, 'node_modules'))
    if (carried) renameSync(modules, join(next, 'node_modules'))
    try {
      renameSync(this.paths.root, backup)
    } catch (error) {
      if (carried) renameSync(join(next, 'node_modules'), modules)
      throw error
    }
    try {
      renameSync(next, this.paths.root)
    } catch (error) {
      renameSync(backup, this.paths.root)
      if (carried) renameSync(join(next, 'node_modules'), modules)
      throw error
    }
    writeFileSync(join(backup, '.node-ops-at'), `${this.now().toISOString()}\n`, 'utf8')
    for (const old of this.listBackups().slice(KEEP_BACKUPS)) rmSync(join(this.backups, old.id), { recursive: true, force: true })
    return id
  }

  /**
   * Replace this plugin with the package in a tarball.
   * @param tgz - the `npm pack` tarball.
   * @param sha256 - its expected digest (hex); a mismatch refuses.
   * @param who - the caller, for the log.
   * @param forceDeps - accept a tarball whose dependencies differ.
   * @returns what happened.
   */
  install(tgz: Buffer, sha256: string, who: string, forceDeps = false): NodeOpsResult {
    return this.exclusive('install', who, () => {
      const refused = this.refusal()
      if (refused !== undefined) return refused
      const digest = createHash('sha256').update(tgz).digest('hex')
      if (digest !== sha256.toLowerCase()) return { ok: false, code: 'sha256', error: `the tarball's sha256 is ${digest}, not ${sha256}` }
      const stage = join(this.paths.dir, `stage-${randomUUID()}`)
      mkdirSync(stage, { recursive: true })
      try {
        const file = join(stage, 'package.tgz')
        writeFileSync(file, tgz)
        // #898 review: look before unpacking — paths and entry types — and again after, on the tree itself.
        const list = (flags: string): string[] => execFileSync('tar', [flags, 'package.tgz'], { cwd: stage, windowsHide: true, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }).split(/\r?\n/).filter(line => line !== '')
        const listed = tarballListingRefusal(list('-tzf'), list('-tvzf'))
        if (listed !== undefined) return { ok: false, code: 'tarball', error: listed }
        execFileSync('tar', ['-xzf', 'package.tgz'], { cwd: stage, windowsHide: true, stdio: 'ignore', timeout: 60_000 })
        const entries = readdirSync(stage).filter(name => name !== 'package.tgz')
        if (entries.length !== 1 || entries[0] !== 'package') return { ok: false, code: 'tarball', error: 'the tarball must hold exactly one package/ directory' }
        const next = join(stage, 'package')
        const tree = unpackedTreeRefusal(next)
        if (tree !== undefined) return { ok: false, code: 'tarball', error: tree }
        let incoming: { version: string; dependencies: string }
        try { incoming = readPackage(next) } catch (error) { return { ok: false, code: 'tarball', error: String((error as Error).message ?? error) } }
        const running = readPackage(this.paths.root)
        if (incoming.dependencies !== running.dependencies && !forceDeps) return { ok: false, code: 'deps-changed', error: 'the tarball\'s dependencies differ from the running package; an unpack-only install cannot add them (forceDeps overrides)' }
        const backup = this.swap(next, running.version)
        return { ok: true, from: running.version, to: incoming.version, backup }
      } finally {
        rmSync(stage, { recursive: true, force: true })
      }
    })
  }

  /**
   * Put a backup back in place (the newest when no id is given); the replaced directory becomes a backup itself.
   * @param who - the caller, for the log.
   * @param id - the backup.
   * @returns what happened.
   */
  rollback(who: string, id?: string): NodeOpsResult {
    return this.exclusive('rollback', who, () => {
      const refused = this.refusal()
      if (refused !== undefined) return refused
      const target = id === undefined ? this.listBackups()[0] : this.listBackups().find(row => row.id === id)
      if (target === undefined) return { ok: false, code: 'no-backup', error: id === undefined ? 'no backup is kept' : `no backup ${id}` }
      const running = readPackage(this.paths.root)
      // Out of the backups directory first, so pruning after the swap can never pick the directory being restored.
      const next = join(this.paths.dir, `restore-${randomUUID()}`)
      renameSync(join(this.backups, target.id), next)
      rmSync(join(next, '.node-ops-at'), { force: true })
      try {
        const backup = this.swap(next, running.version)
        return { ok: true, from: running.version, to: target.version, backup }
      } catch (error) {
        if (existsSync(next)) { writeFileSync(join(next, '.node-ops-at'), `${target.at}\n`, 'utf8'); renameSync(next, join(this.backups, target.id)) }
        throw error
      }
    })
  }

  /**
   * Log a restart request and its answer.
   * @param who - the caller.
   * @param answer - what the restart route said.
   */
  logRestart(who: string, answer: Record<string, unknown>): void { this.log({ op: 'restart', who, ...answer }) }
}
