/**
 * superagent: the team's ygl-trees workspace, created by the host (docs/design/superagent-ygl-memory.md, Y1b).
 *
 * The presets mount `ygl-trees mcp` as MCP server `ygl` against one shared workspace. `db init` is an administration command
 * the MCP server does not offer and a team session cannot run (the router has no shell; a member's shell reaches only its own
 * directory), so until someone ran it every ygl tool answered that there is no database. The host runs it once at start when
 * the workspace has no database. Without the `ygl-trees` command on the host's PATH it does nothing: the tools are absent too.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/ygl-home
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

/** The command ygl-trees installs. `ygl` is only the name the presets give its MCP server (tools `mcp__ygl__*`). */
export const YGL_CLI = 'ygl-trees'
/** The database file `ygl-trees db init` creates in a workspace. */
export const YGL_DB_FILE = 'ygl-trees.db'

/** The team's workspace: the same expression as the presets' mount (cordis.patch.yml). */
export const teamYglHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.SUPERAGENT_YGL_HOME ?? join(env.HOME ?? env.USERPROFILE ?? homedir(), '.ygl-trees-superagent')

/** Runs the ygl-trees CLI and resolves its stdout; rejects with the error when it cannot be started or exits non-zero. */
export type YglRun = (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<string | void>

/** The environment variable that carries the resolved entry script of ygl-trees (#900); the Windows preset reads it. */
export const YGL_BIN_ENV = 'SUPERAGENT_YGL_BIN'

/**
 * #900: the absolute path of the installed ygl-trees entry script, so Windows can run it with this node directly. The npm
 * install on Windows is a `.cmd` shim that only `cmd` starts; `windowsHide` covers only the process spawned directly, so the
 * node.exe under `cmd` → `.cmd` opened a visible console for every team session. Looked up where npm puts a global package:
 * beside each `ygl-trees(.cmd)` on PATH, beside this node, and npm's default Windows prefix; a `ygl-trees` on PATH that is a
 * link straight to the script counts too.
 * @param env - the environment (PATH, APPDATA).
 * @param execPath - this node.
 * @param fs - file access (tests).
 * @param fs.exists - whether a path exists.
 * @param fs.read - a file's text.
 * @param fs.real - a path with its links resolved.
 * @returns the entry script, or undefined when none is found.
 */
export function resolveYglBin(env: NodeJS.ProcessEnv = process.env, execPath: string = process.execPath, fs: { exists: (path: string) => boolean; read: (path: string) => string; real?: (path: string) => string } = { exists: existsSync, read: path => readFileSync(path, 'utf8'), real: realpathSync }): string | undefined {
  const pathDirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(dir => dir !== '')
  for (const dir of pathDirs) {
    try { const target = fs.real?.(join(dir, YGL_CLI)); if (target !== undefined && /\.[cm]?js$/.test(target) && fs.exists(target)) return target } catch { /* not here */ }
  }
  const prefixes = [
    ...pathDirs.filter(dir => fs.exists(join(dir, `${YGL_CLI}.cmd`)) || fs.exists(join(dir, YGL_CLI))),
    dirname(execPath),
    ...(env.APPDATA !== undefined ? [join(env.APPDATA, 'npm')] : []),
  ]
  for (const prefix of prefixes) {
    for (const dir of [join(prefix, 'node_modules', YGL_CLI), join(prefix, '..', 'lib', 'node_modules', YGL_CLI)]) {
      try {
        const bin = (JSON.parse(fs.read(join(dir, 'package.json'))) as { bin?: unknown }).bin
        const rel = typeof bin === 'string' ? bin : bin !== null && typeof bin === 'object' ? (bin as Record<string, unknown>)[YGL_CLI] : undefined
        if (typeof rel === 'string' && fs.exists(join(dir, rel))) return resolve(dir, rel)
      } catch { /* not installed here */ }
    }
  }
  return undefined
}

/**
 * #900: on Windows, publish the resolved entry script for the presets (unless the owner set one); elsewhere nothing changes.
 * @returns the entry script the presets will use, if any.
 */
export function exportYglBin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (process.platform !== 'win32') return env[YGL_BIN_ENV]
  if (env[YGL_BIN_ENV] === undefined || env[YGL_BIN_ENV] === '') { const bin = resolveYglBin(env); if (bin !== undefined) env[YGL_BIN_ENV] = bin }
  return env[YGL_BIN_ENV]
}

/** How the host itself runs ygl-trees: this node on the resolved entry script when there is one (#900), otherwise the command. */
const yglSpawn = (args: readonly string[]): { file: string; args: string[]; shell: boolean } => {
  const bin = process.platform === 'win32' ? process.env[YGL_BIN_ENV] : undefined
  // On Windows without a resolved entry the npm install is a `.cmd` shim, which only a shell starts; the arguments are fixed words.
  return bin !== undefined && bin !== '' ? { file: process.execPath, args: [bin, ...args], shell: false } : { file: YGL_CLI, args: [...args], shell: process.platform === 'win32' }
}

export const defaultYglRun: YglRun = (args, env) => new Promise((resolve, reject) => {
  const run = yglSpawn(args)
  execFile(run.file, run.args, { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 60_000, shell: run.shell, windowsHide: true }, (error, stdout) => { if (error) reject(error); else resolve(String(stdout)) })
})

export type YglHomeOutcome = 'present' | 'created' | 'unavailable' | 'failed'

/**
 * What the installed ygl-trees can do, from its version (owner 2026-11-18, design Y1d/Y1e). Unknown (not installed, or the
 * version could not be read) counts as the oldest: the cards keep the steps that work on every version.
 */
export interface YglCapabilities {
  /** `ygl-trees --version`, when it could be read. */
  readonly version?: string
  /** 0.123.0+: MCP `read agent brief` honours an explicit project (ygl-trees#260), so no `project use` step is needed. */
  readonly briefHonorsProject: boolean
  /** 0.126.0+: kb notes carry a scope, and `kb add`/`kb search` take one (ygl-trees#276). */
  readonly kbScope: boolean
}

export const YGL_UNKNOWN: YglCapabilities = { briefHonorsProject: false, kbScope: false }

const atLeast = (version: string, floor: readonly [number, number, number]): boolean => {
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (parts === null) return false
  const [a, b, c] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  return a !== floor[0] ? a > floor[0] : b !== floor[1] ? b > floor[1] : c >= floor[2]
}

/** The capabilities a `ygl-trees --version` answer stands for. */
export function yglCapabilitiesOf(version: string | undefined): YglCapabilities {
  if (version === undefined || !/^\d+\.\d+\.\d+/.test(version.trim())) return YGL_UNKNOWN
  const v = version.trim()
  return { version: v, briefHonorsProject: atLeast(v, [0, 123, 0]), kbScope: atLeast(v, [0, 126, 0]) }
}

/** Reads `ygl-trees --version`; undefined when it cannot be started or answers nothing usable. */
export type YglVersionRead = () => Promise<string | undefined>

export const defaultYglVersionRead: YglVersionRead = () => new Promise(resolve => {
  const run = yglSpawn(['--version'])
  execFile(run.file, run.args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 15_000, shell: run.shell, windowsHide: true }, (error, stdout) => {
    resolve(error ? undefined : String(stdout).trim().split(/\s+/)[0] || undefined)
  })
})

let capabilities: YglCapabilities = YGL_UNKNOWN
let settled = false

/** Whether the start-up version read has settled (#739 review R1): until then no card that depends on it goes out. */
export const yglSettled = (): boolean => settled

/** What the host last learned about the installed ygl-trees (YGL_UNKNOWN until the start-up read finishes). */
export const yglCapabilities = (): YglCapabilities => capabilities

/**
 * Read the installed version once at start. Below 0.123.0 (or unreadable while the workspace exists) the host says so: the
 * cards then keep the `project use` step, and kb notes are not scoped by team.
 */
export async function refreshYglCapabilities(d: { readonly logger: { warn(format: string, ...args: unknown[]): void }; readonly read?: YglVersionRead }): Promise<YglCapabilities> {
  const version = await (d.read ?? defaultYglVersionRead)().catch(() => undefined)
  capabilities = yglCapabilitiesOf(version)
  settled = true
  if (version !== undefined && !capabilities.kbScope) d.logger.warn('superagent: ygl-trees %s is older than 0.126.0: team kb notes are not scoped by team%s', version, capabilities.briefHonorsProject ? '' : ', and the cards keep the project-use step (0.123.0 fixes it)')
  return capabilities
}

/**
 * Run `start` once the version read has settled (#739 review R1): every card the team engines send depends on it, so they
 * must not start on the unknown default. The read is bounded (15 s), and a failed read settles as unknown. The returned
 * function cancels a start that has not happened yet.
 */
export function startWhenYglKnown(start: () => void, d: { readonly logger: { warn(format: string, ...args: unknown[]): void }; readonly read?: YglVersionRead }): () => void {
  let live = true
  void refreshYglCapabilities(d).finally(() => { if (live) start() })
  return () => { live = false }
}

/** For tests: set what the host knows about ygl-trees. */
export const setYglCapabilitiesForTest = (next: YglCapabilities, isSettled = true): void => { capabilities = next; settled = isSettled }

/**
 * A team's kb scope (design Y1e): `bench:team-<canvas>`. ygl-trees takes ids of [A-Za-z0-9._-]{1,64}; a canvas name outside
 * that becomes `bench:teamh-<hash>`, so the same canvas always gets the same scope. The two forms never meet (#739 review R2):
 * a literal id always has `-` right after `team`, a hashed one `h`, so no canvas name can take another canvas's hashed scope.
 */
export function teamYglScope(canvas: string): string {
  const id = `team-${canvas}`
  return `bench:${/^[A-Za-z0-9._-]{1,64}$/.test(id) ? id : `teamh-${createHash('sha256').update(canvas).digest('hex').slice(0, 16)}`}`
}

/**
 * Create the team's workspace when it has no database.
 * @returns what happened; a failure is logged, never thrown.
 */
export async function ensureTeamYglHome(d: { readonly logger: { warn(format: string, ...args: unknown[]): void }; readonly home?: string; readonly run?: YglRun }): Promise<YglHomeOutcome> {
  const home = d.home ?? teamYglHome()
  if (existsSync(join(home, YGL_DB_FILE))) return 'present'
  try {
    mkdirSync(home, { recursive: true })
    await (d.run ?? defaultYglRun)(['db', 'init'], { ...process.env, YGL_HOME: home })
  } catch (error) {
    const code = (error as { code?: unknown }).code
    // Not installed: ENOENT directly, or (through the Windows shell) exit code 1 with no database written.
    if (code === 'ENOENT' || (process.platform === 'win32' && code === 1 && !existsSync(join(home, YGL_DB_FILE)))) return 'unavailable'
    d.logger.warn('superagent: creating the team ygl-trees workspace failed: %s', String(error).slice(0, 300))
    return 'failed'
  }
  return existsSync(join(home, YGL_DB_FILE)) ? 'created' : 'failed'
}

/** One ygl-trees project per team, named after its canvas (design Y1c): members record into it, the router reads it. */
export const teamYglProject = (canvas: string): string => `team-${canvas}`

const madeProjects = new Set<string>()

/**
 * Create the team's project once in the team workspace (after the workspace itself). `project new` is idempotent; it runs
 * under its own YGL_SESSION, so the selection it makes touches no team session.
 * @returns what happened; a failure is logged, never thrown.
 */
export async function ensureTeamYglProject(name: string, d: { readonly logger: { warn(format: string, ...args: unknown[]): void }; readonly home?: string; readonly run?: YglRun }): Promise<YglHomeOutcome> {
  const home = d.home ?? teamYglHome()
  const key = `${home}\n${name}`
  if (madeProjects.has(key)) return 'present'
  const workspace = await ensureTeamYglHome(d)
  if (workspace === 'unavailable' || workspace === 'failed') return workspace
  // A3 (owner 2026-11-18): look before making. `project new` is idempotent, but every host start ran it again and each run
  // is an event in the team's workspace (161 runs for 10 projects on the owner's host).
  const env = { ...process.env, YGL_HOME: home, YGL_SESSION: 'superagent-host' }
  // `project show` ignores a name (it shows the selected project), so the list is the check.
  try {
    const listed = JSON.parse(String(await (d.run ?? defaultYglRun)(['project', 'list', '--json'], env) ?? '')) as unknown
    if (Array.isArray(listed) && listed.some(row => row !== null && typeof row === 'object' && (row as { name?: unknown }).name === name)) {
      madeProjects.add(key)
      return 'present'
    }
  } catch { /* the read failed: make it, as before */ }
  try {
    await (d.run ?? defaultYglRun)(['project', 'new', name, '-q', `superagent team ${name}: what the team learned, the evidence behind it and the decisions made`], env)
  } catch (error) {
    d.logger.warn('superagent: creating the team ygl-trees project %s failed: %s', name, String(error).slice(0, 300))
    return 'failed'
  }
  madeProjects.add(key)
  return 'created'
}
