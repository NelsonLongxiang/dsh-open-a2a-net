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

/** Register the a2a-network skill (runtime contribution). */
export function registerA2aNetworkSkill(ctx: Context): void {
  const skills = (ctx as unknown as { skills?: { register: (reg: Record<string, unknown>) => () => void } }).skills
  if (skills === undefined) return
  const skill = readSkill()
  const registration = {
    name: skill.name,
    description: skill.description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'a2a',
    source: 'runtime',
    resourceBase: { kind: 'directory', path: fileURLToPath(PACKAGED_SKILL_ROOT) },
    content: skill.content,
  }
  skills.register(registration)
}
