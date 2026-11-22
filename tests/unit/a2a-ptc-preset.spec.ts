/** The general PTC collaboration preset is a package asset, not a deployment-specific superagent role. */
import { describe, expect, it } from 'vitest'
import { readFileSync, mkdirSync, cpSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from '../temp-dirs'
import { createRequire } from 'node:module'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { A2A_PTC_ID, a2aPtcPrompt, a2aPlanModePrompt, renderPresetPatch, presetPrompt, PRESET_PROMPT_PARTS } from '../../scripts/build-agent-presets.mjs'

const loaderRequire = createRequire(import.meta.resolve('@deepseek-ai/cordis-plugin-loader'))
const { load } = loaderRequire('js-yaml')
const { entryListSchema, applyEntryPatches } = loaderRequire('@deepseek-ai/cordis-plugin-include')
const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
const roleTemplate = readFileSync(new URL('../../src/superagent/presets.patch.yml', import.meta.url), 'utf8')
const template = readFileSync(new URL('../../src/presets/a2a-ptc.patch.yml', import.meta.url), 'utf8')
interface Entry { id?: string; name: string; disabled?: boolean | { __jsExpr: string }; group?: boolean; config?: any } // Cordis owns each plugin's schema.
const parsed = (text: string): Entry[] => applyEntryPatches([], load(text, { schema: entryListSchema }), (warning: string) => { throw Error(warning) })
const declarations = parsed(patch).filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
const declaration = declarations.find(row => row.config.id === A2A_PTC_ID)!
const plugins: Entry[] = declaration.config.plugins
const persona = plugins.find(row => row.id === 'persona')!.config
const all = (entries: Entry[]): Entry[] => entries.flatMap(row => [row, ...(row.group ? all(row.config) : [])])

it('ships the fifth, general preset with its own stable id and display name', () => {
  expect(declarations.map(row => row.config.id)).toEqual(['superagent-router', 'superagent-member', 'superagent-observer', 'superagent-builder', 'a2a-net-ptc'])
  expect(declaration.id).toBe('preset-a2a-net-ptc')
  expect(declaration.config.name).toBe('A2A 协作（PTC）')
  expect(A2A_PTC_ID).toBe('a2a-net-ptc')
  expect(declarations.some(row => row.config.id === 'a2a-ptc' || row.id === 'preset-a2a-ptc')).toBe(false)
  expect(declarations.some(row => row.config.id === 'ptc-no-delegation')).toBe(false)
  expect(patch).toBe(renderPresetPatch())
  expect(persona.prefix).toBe(a2aPtcPrompt())
  expect(persona.suffix ?? '').toBe('')
  expect(persona.complete).not.toBe(true)
})

it('selects the supported PTC executor and omits the entire local delegation capability group', () => {
  const entries = all(plugins), names = entries.map(row => row.name)
  expect(names.filter(name => name === '@deepseek-ai/dsh-tool-executor-ptc')).toHaveLength(1)
  expect(names).not.toContain('@deepseek-ai/dsh-tool-executor-native')
  expect(names).not.toContain('@deepseek-ai/dsh-agent-tool-presentation')
  expect(names.join('\n')).not.toMatch(/subagent|workflow|ralph/)
  expect(entries.some(row => row.id === 'delegation')).toBe(false)
  expect(names).not.toContain('@deepseek-ai/dsh-mcp-client')
  expect(names).not.toContain('@deepseek-ai/dsh-tool-office')
  expect(names).not.toContain('@nelsonlongxiang/dsh-open-a2a-net')
  const planning = plugins.find(row => row.id === 'planning')!
  expect(planning).toMatchObject({ group: true, isolate: { planMode: true } })
  expect(planning.config[0].config.section).toBe(a2aPlanModePrompt())
  expect(a2aPlanModePrompt()).toContain('exit_plan_mode')
  expect(a2aPlanModePrompt()).toContain('send work to another agent')
  expect(a2aPlanModePrompt()).not.toContain('another engineer')
  expect(a2aPlanModePrompt()).toMatchSnapshot('general plan mode')
  expect(plugins.find(row => row.id === 'compaction')).toMatchObject({ group: true, isolate: { compaction: true, toolResultPruner: true } })
  for (const id of ['tool-bash', 'tool-pwsh']) expect(plugins.find(row => row.id === id)?.disabled).toHaveProperty('__jsExpr')
})

it('does not import a deployment identity, filesystem redline, business role or implicit authorization', () => {
  expect(persona.prefix).not.toMatch(/龙翔|jf-tech|[CD]:\\|six criteria|六判据|SOUL|role-declare|a coding agent|superagent_/)
  expect(persona.prefix).toContain('research, analysis, operations, content, business workflows or software development')
  expect(persona.prefix).toContain('Do not start local subagents')
  expect(persona.prefix).toContain('A preset does not join a session')
  expect(persona.prefix).toContain('silence or elapsed time into permission')
  expect(persona.prefix).toContain('without assuming a particular MCP service')
})

it('keeps discovery, bounded dispatch, idempotency, reconciliation and evidence in the reusable procedure', () => {
  for (const word of ['a2a-network', 'a2a_whoami', 'a2a_teams', 'a2a_probe', 'async', 'task_id', 'context_id', 'a2a_tasks', 'a2a_status', 'a2a_task_read', '[A2A receipt] task', 'file channel']) expect(persona.prefix).toContain(word)
  expect(persona.prefix).toContain('not interchangeable completion signals')
  expect(persona.prefix).toContain('do not also send a duplicate receipt')
  expect(persona.prefix).toContain('A terminal receipt needs no receipt in return')
  expect(persona.prefix).toContain('Use branches, commits or pull requests only when relevant')
})

it('refuses missing, duplicate or unknown PTC markers before generating output', () => {
  const marker = '                @a2a-prompt(a2a-net-ptc)\n'
  expect(() => renderPresetPatch(roleTemplate, template.replace(marker, ''))).toThrow(/Expected one A2A prompt marker: a2a-net-ptc/)
  expect(() => renderPresetPatch(roleTemplate, template.replace(marker, marker + marker))).toThrow(/Expected one A2A prompt marker: a2a-net-ptc/)
  expect(() => renderPresetPatch(roleTemplate, template + '# @a2a-prompt(unknown)\n')).toThrow(/Unknown A2A prompt marker/)
  expect(() => renderPresetPatch(roleTemplate, template.replace('                    @a2a-prompt(a2a-plan-mode)\n', ''))).toThrow(/Expected one A2A prompt marker: a2a-plan-mode/)
})

it('adds no changes to any existing superagent declaration', () => {
  const baseline = parsed(roleTemplate).filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
  for (const row of baseline) {
    const role = row.config.id.replace('superagent-', '')
    if (Object.hasOwn(PRESET_PROMPT_PARTS, role)) row.config.plugins.find((entry: Entry) => entry.id === 'persona').config.prefix = presetPrompt(role)
  }
  const existing = declarations.filter(row => row.config.id !== A2A_PTC_ID)
  expect(existing).toEqual(baseline)
})

it('the generation CLI rejects stale output without rewriting it and writes the complete bundle', () => {
  const home = mkdtempSync(join(tmpdir(), 'a2a-preset-cli-'))
  mkdirSync(join(home, 'scripts'), { recursive: true })
  mkdirSync(join(home, 'src/superagent'), { recursive: true })
  cpSync(new URL('../../scripts/build-agent-presets.mjs', import.meta.url), join(home, 'scripts/build-agent-presets.mjs'))
  cpSync(new URL('../../src/superagent/prompts', import.meta.url), join(home, 'src/superagent/prompts'), { recursive: true })
  cpSync(new URL('../../src/presets', import.meta.url), join(home, 'src/presets'), { recursive: true })
  writeFileSync(join(home, 'src/superagent/presets.patch.yml'), roleTemplate)
  const output = join(home, 'cordis.patch.yml')
  writeFileSync(output, 'stale patch\n')
  const run = (mode: string) => spawnSync(process.execPath, [join(home, 'scripts/build-agent-presets.mjs'), mode], { encoding: 'utf8' })
  expect(run('--check').status).toBe(1)
  expect(readFileSync(output, 'utf8')).toBe('stale patch\n')
  expect(run('--write').status).toBe(0)
  expect(readFileSync(output, 'utf8')).toBe(patch)
  expect(run('--check').status).toBe(0)
})

describe('general A2A PTC model-facing persona', () => {
  it('renders the prompt variable and pins the published collaboration procedure', () => {
    const rendered = renderPrompt({ sections: [{ name: 'a2a:ptc-persona', text: persona.prefix }], contexts: [], tools: [], variables: { model: 'test-model' } })
    expect(rendered).not.toContain('{{')
    expect(rendered).toContain('test-model')
    expect(rendered).toMatchSnapshot()
  })
})
