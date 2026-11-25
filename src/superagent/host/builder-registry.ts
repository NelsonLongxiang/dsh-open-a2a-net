/**
 * #906 review B2: the team builders this host has seen. A session's preset is readable only while it is loaded, so a
 * builder that is not loaded right now would drop out of `view=builders`. The host notes each session it sees running
 * the builder preset (`<a2a home>/builder-sessions.json`, written by this host only) and lists the noted ones that are not
 * loaded as `live: false`. A noted session seen loaded under another preset, or since taken onto a team, is forgotten.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/builder-registry
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** One noted builder: when the host last saw it loaded with the builder preset. */
export interface NotedBuilder { readonly seenAt: string }

/** At most this many noted builders are kept (the oldest seen go first). */
export const BUILDERS_NOTED_MAX = 200

export class BuilderRegistry {
  constructor(private readonly path: string, private readonly logger?: { warn(format: string, ...args: unknown[]): void }) {}

  read(): Record<string, NotedBuilder> {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as { builders?: Record<string, { seenAt?: unknown }> }
      const out: Record<string, NotedBuilder> = {}
      for (const [id, row] of Object.entries(raw.builders ?? {})) if (typeof row?.seenAt === 'string') out[id] = { seenAt: row.seenAt }
      return out
    } catch { return {} }
  }

  private write(builders: Record<string, NotedBuilder>): void {
    const kept = Object.entries(builders).sort(([, a], [, b]) => b.seenAt.localeCompare(a.seenAt)).slice(0, BUILDERS_NOTED_MAX)
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp-${String(process.pid)}`
      writeFileSync(temporary, `${JSON.stringify({ builders: Object.fromEntries(kept) }, null, 2)}\n`, { mode: 0o600 })
      renameSync(temporary, this.path)
    } catch (error) { this.logger?.warn('superagent: builder registry not saved: %s', String(error)) }
  }

  /**
   * Bring the notes up to date with what is loaded now and answer the builder rows' sessions.
   * @param input.loaded - the sessions loaded now, each with the preset it runs (undefined when unreadable).
   * @param input.onTeam - whether a session holds a team role (a builder on a team is no longer a builder).
   * @param input.known - every other local session the host knows (joined, or mounted), not loaded now.
   * @returns the builder sessions: loaded ones running the builder preset, and noted ones not loaded now.
   */
  roster(input: { readonly loaded: ReadonlyArray<{ readonly id: string; readonly preset: string | undefined }>; readonly builderPreset: string; readonly onTeam: (id: string) => boolean; readonly now: string }): Array<{ id: string; live: boolean; seenAt?: string }> {
    const noted = this.read()
    let changed = false
    const live: string[] = []
    for (const { id, preset } of input.loaded) {
      if (preset === input.builderPreset && !input.onTeam(id)) { live.push(id); if (noted[id]?.seenAt !== input.now) { noted[id] = { seenAt: input.now }; changed = true } }
      else if (preset !== undefined && noted[id] !== undefined) { delete noted[id]; changed = true }
    }
    for (const id of Object.keys(noted)) if (input.onTeam(id)) { delete noted[id]; changed = true }
    if (changed) this.write(noted)
    const loaded = new Set(input.loaded.map(s => s.id))
    return [...live.map(id => ({ id, live: true })), ...Object.entries(noted).filter(([id]) => !loaded.has(id)).map(([id, row]) => ({ id, live: false, seenAt: row.seenAt }))]
  }
}
