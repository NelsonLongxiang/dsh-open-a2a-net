// Copy the packaged skill assets (SKILL.md + references/) into lib/skill/
// so the published tarball carries them next to lib/index.js — readSkill()
// resolves SKILL.md relative to the compiled module (import.meta.url).
import { cpSync, existsSync, mkdirSync } from 'node:fs'

const src = new URL('../src/skill/', import.meta.url)
const dest = new URL('../lib/skill/', import.meta.url)

if (!existsSync(src)) {
  console.error(`copy-skill: source missing (${src})`)
  process.exit(1)
}
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log('copy-skill: lib/skill/ refreshed')
