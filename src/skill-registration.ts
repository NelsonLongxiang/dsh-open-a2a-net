/**
 * Plugin-owned agent skill registration (obelisk pattern): the packaged
 * `src/skill/SKILL.md` (+ references/) rides the standard DSH skill catalog.
 * Install = apply registers the skill into ctx.skills; uninstall = the
 * registration disposer unwinds with the fiber (no files copied, no residue).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Context } from '@deepseek-ai/cordis'

const PACKAGED_SKILL_ROOT = new URL('./skill/', import.meta.url)

interface ParsedSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

/** Locate and validate the packaged SKILL.md; throw loudly when missing. */
function readSkill(): ParsedSkill {
  const path = fileURLToPath(new URL('SKILL.md', PACKAGED_SKILL_ROOT))
  if (!existsSync(path)) {
    throw new Error(`a2a skill bundle is missing; expected SKILL.md at ${path}`)
  }
  const raw = readFileSync(path, 'utf8')
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0 || raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') {
    throw new Error('a2a skill bundle is missing YAML frontmatter')
  }
  const closingStart = raw.indexOf('\n---', firstLineEnd)
  if (closingStart < 0) {
    throw new Error('a2a skill bundle has unterminated YAML frontmatter')
  }
  const frontmatter = raw.slice(firstLineEnd + 1, closingStart)
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
  const skillName = nameMatch?.[1]?.trim() ?? ''
  const description = descMatch?.[1]?.trim() ?? ''
  if (skillName !== 'a2a-network' || description === '') {
    throw new Error('a2a skill frontmatter must define the a2a-network name and a non-empty description')
  }
  const bodyStart = raw.indexOf('\n', closingStart + 1)
  return { name: skillName, description, content: raw.slice(bodyStart + 1).trim() }
}

/** The part of the DSH skill registry this plugin uses. */
interface SkillScope {
  readonly skills: { register(skill: Record<string, unknown>): () => void }
  effect(run: () => () => void, label?: string): void
}

/**
 * Register the a2a-network skill (runtime contribution) once the host's skill registry is up.
 *
 * The plugin does not declare `skills` among the services it needs, so `ctx.skills` read at apply time was undefined and the
 * skill silently never registered. Waiting for the service through `ctx.inject` registers it when the registry exists, and
 * the registration goes when either side does. The registry supplies the runtime provider and the default invocation policy
 * only when they are left out; a made-up provider name would own no loader for the skill's body.
 * @param ctx - the plugin's context.
 */
export function registerA2aNetworkSkill(ctx: Context): void {
  const skill = readSkill()
  const registration = {
    name: skill.name,
    description: skill.description,
    invocation: { modelInvocable: true, userInvocable: true },
    resourceBase: { kind: 'directory', path: fileURLToPath(PACKAGED_SKILL_ROOT) },
    content: skill.content,
  }
  const late = ctx as unknown as { inject?(services: string[], run: (scope: SkillScope) => void): void }
  if (typeof late.inject !== 'function') return
  late.inject(['skills'], (scope) => { scope.effect(() => scope.skills.register(registration), 'a2a: a2a-network skill') })
}
