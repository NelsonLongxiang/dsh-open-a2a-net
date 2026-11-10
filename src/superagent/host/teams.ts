/**
 * superagent: several teams on one DSH instance (docs/design/superagent-multi-team.md, M1–M6).
 *
 * A {@link SuperagentHost} stays one team. This registry holds one per team: the primary team keeps `<a2a home>/superagent/`,
 * and a further team lives in `<a2a home>/superagent/teams/<id>/`, so an existing install changes nothing. A session has one
 * role across all of them, which is what lets a tool or a turn event find its team from the session.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/teams
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SuperagentHost, type SuperagentHostDeps } from './index.ts'
export { ensureTeamYglHome } from './ygl-home.ts'

const TEAM_ID = /^[0-9a-f]{8}$/

/** One team, as the picker and the team page list it. */
export interface TeamRow { readonly id: string; readonly primary: boolean; readonly canvas?: string; readonly router?: string; readonly open: boolean }

export class SuperagentTeams {
  readonly primary: SuperagentHost
  private readonly extras = new Map<string, SuperagentHost>()
  private started = false
  private readonly teamsDir: string

  constructor(private readonly deps: Omit<SuperagentHostDeps, 'stateDir' | 'canvasTaken'>) {
    this.teamsDir = join(deps.home, 'superagent', 'teams')
    this.primary = this.build(undefined)
    if (existsSync(this.teamsDir)) for (const id of readdirSync(this.teamsDir)) if (TEAM_ID.test(id)) this.extras.set(id, this.build(id))
  }

  private build(id: string | undefined): SuperagentHost {
    return new SuperagentHost({
      ...this.deps,
      ...(id !== undefined ? { stateDir: join(this.teamsDir, id) } : {}),
      canvasTaken: (canvas, self) => this.all().some(team => team !== self && team.settings.canvas === canvas),
    })
  }

  all(): SuperagentHost[] { return [this.primary, ...this.extras.values()] }

  /** A team by id; no id is the primary team, which is what callers from before several teams mean. */
  get(id?: string): SuperagentHost | undefined { return id === undefined || id === '' ? this.primary : this.extras.get(id) }

  /** The team a session has a role in. */
  ofSession(sessionId: string): SuperagentHost | undefined { return this.all().find(team => team.roleOf(sessionId) !== undefined) }

  /** The team bound to a canvas. */
  ofCanvas(canvas: string): SuperagentHost | undefined { return this.all().find(team => team.settings.canvas === canvas) }

  rows(): TeamRow[] {
    const row = (id: string, team: SuperagentHost): TeamRow => {
      const { canvas, router, sources } = team.settings
      return { id, primary: team === this.primary, ...(canvas !== undefined ? { canvas } : {}), ...(router !== undefined ? { router } : {}), open: canvas !== undefined && router !== undefined && sources.workbench }
    }
    return [row('', this.primary), ...[...this.extras].map(([id, team]) => row(id, team))]
  }

  /** Every team's health problems, each with the team it belongs to (reliability R6). */
  health(): Array<Record<string, unknown>> {
    return [['', this.primary] as const, ...this.extras].flatMap(([id, team]) => team.health().map(problem => ({ ...problem, teamId: id, team: team.settings.canvas ?? '' })))
  }

  /** Every team's waiting decisions, each with the team it belongs to. */
  decisionCards(): Array<Record<string, unknown>> {
    return [['', this.primary] as const, ...this.extras].flatMap(([id, team]) => team.decisionCards().map(card => ({ ...card, teamId: id, team: team.settings.canvas ?? '' })))
  }

  /** Why a session may not join a canvas, asked of every team. */
  canvasMemberRefusal(canvas: string, member: string, presetOf: (id: string) => string | undefined): string | undefined {
    for (const team of this.all()) { const refused = team.canvasMemberRefusal(canvas, member, presetOf); if (refused !== undefined) return refused }
    return undefined
  }

  /**
   * Add a team: bind a canvas and its router, as the team page does for the primary team. An unbound team is used first.
   * @param settings - the binding, `{ canvas, router }`.
   * @param sessionValid - whether a session may hold a role.
   * @param presetOf - a session's preset.
   * @returns the new team's id, or why it was refused.
   */
  add(settings: { canvas: unknown; router: unknown }, sessionValid: (id: string) => boolean, presetOf: (id: string) => string | undefined): { ok: true; id: string } | { ok: false; error: string } {
    if (typeof settings.canvas !== 'string' || settings.canvas === '' || typeof settings.router !== 'string' || settings.router === '') return { ok: false, error: 'a team needs a canvas and a router' }
    const unbound = [...this.extras].find(([, team]) => team.settings.canvas === undefined)
    const id = unbound?.[0] ?? randomBytes(4).toString('hex')
    const team = unbound?.[1] ?? this.build(id)
    const saved = team.saveSettings({ canvas: settings.canvas, router: settings.router }, sessionValid, presetOf)
    if (!saved.ok) return saved
    if (unbound === undefined) {
      this.extras.set(id, team)
      if (this.started) team.start()
      // saveSettings told the tool lists before the team was in the registry, so they still saw its sessions as outside any
      // team: the router was refused its work tools but never shown superagent_* (remote report 2026-11-10). Tell them again.
      try { this.deps.onRolesChanged?.() } catch (error) { this.deps.logger.warn('superagent: role change not applied: %s', String(error)) }
    }
    return { ok: true, id }
  }

  start(): void { this.started = true; for (const team of this.all()) team.start() }
  async stop(): Promise<void> { this.started = false; await Promise.all(this.all().map(team => team.stop())) }
}
