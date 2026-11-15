/**
 * superagent: the team's ygl-trees workspace, created by the host (docs/design/superagent-ygl-memory.md, Y1b).
 *
 * The presets mount `ygl-trees mcp` as MCP server `ygl` against one shared workspace. `db init` is an administration command
 * the MCP server does not offer and a team session cannot run (the router has no shell; a member's shell reaches only its own
 * directory), so until someone ran it every ygl tool answered that there is no database. The host runs it once at start when
 * the workspace has no database. Without the `ygl-trees` command on the host's PATH it does nothing: the tools are absent too.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/ygl-home
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The command ygl-trees installs. `ygl` is only the name the presets give its MCP server (tools `mcp__ygl__*`). */
export const YGL_CLI = 'ygl-trees'
/** The database file `ygl-trees db init` creates in a workspace. */
export const YGL_DB_FILE = 'ygl-trees.db'

/** The team's workspace: the same expression as the presets' mount (cordis.patch.yml). */
export const teamYglHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.SUPERAGENT_YGL_HOME ?? join(env.HOME ?? env.USERPROFILE ?? homedir(), '.ygl-trees-superagent')

/** Runs the ygl-trees CLI; rejects with the error when it cannot be started or exits non-zero. */
export type YglRun = (args: readonly string[], env: NodeJS.ProcessEnv) => Promise<void>

export const defaultYglRun: YglRun = (args, env) => new Promise((resolve, reject) => {
  // On Windows the npm install is a `.cmd` shim, which only a shell starts; the arguments are fixed words.
  execFile(YGL_CLI, [...args], { env, timeout: 60_000, shell: process.platform === 'win32', windowsHide: true }, error => { if (error) reject(error); else resolve() })
})

export type YglHomeOutcome = 'present' | 'created' | 'unavailable' | 'failed'

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
  try {
    await (d.run ?? defaultYglRun)(['project', 'new', name, '-q', `superagent team ${name}: what the team learned, the evidence behind it and the decisions made`], { ...process.env, YGL_HOME: home, YGL_SESSION: 'superagent-host' })
  } catch (error) {
    d.logger.warn('superagent: creating the team ygl-trees project %s failed: %s', name, String(error).slice(0, 300))
    return 'failed'
  }
  madeProjects.add(key)
  return 'created'
}
