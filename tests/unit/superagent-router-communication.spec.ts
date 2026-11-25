/** Router communication is in the model-facing preset; it cannot depend on a tool the role cannot call. */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { PRESET_PROMPT_PARTS, presetPrompt, renderPresetPatch } from '../../scripts/build-agent-presets.mjs'
import { roleToolRefusal } from '../../src/superagent/host/role-tools.ts'

const requireLoader = createRequire(import.meta.resolve('@deepseek-ai/cordis-plugin-loader'))
const { load } = requireLoader('js-yaml')
const { entryListSchema, applyEntryPatches } = requireLoader('@deepseek-ai/cordis-plugin-include')
interface Row { id: string; name: string; config?: Record<string, any> }
const root = new URL('../../', import.meta.url)
const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8')
const template = readFileSync(new URL('src/superagent/presets.patch.yml', root), 'utf8')
const rows = (text: string): Row[] => applyEntryPatches([], load(text, { schema: entryListSchema }), (warning: string) => { throw Error(warning) })
const presets = rows(patch).filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
const router = presets.find(row => row.config?.id === 'superagent-router')!
const persona = (row: Row) => row.config!.plugins.find((plugin: Row) => plugin.id === 'persona').config
const prompt: string = persona(router).prefix
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

it('ships generated inline router text without changing preset ids or composition', () => {
  expect(patch).toBe(renderPresetPatch())
  expect(PRESET_PROMPT_PARTS).toEqual({ router: ['router', 'team-transport'], member: ['member', 'team-transport'], observer: ['observer', 'team-transport'] })
  expect(presets.map(row => row.config!.id)).toEqual(['superagent-router', 'superagent-member', 'superagent-observer', 'superagent-builder'])
  expect(prompt).toBe(presetPrompt('router'))
  const expectedComposition = {
    // #900: the Windows ygl MCP row runs this node on the resolved entry script (router, member, observer).
    'superagent-router': 'f12ec5d5dc39720854535dce63a9ea7906bfddf93500c4af4f3bc525e637fcb0',
    // Owner 2026-11-19: members and observers gain the PTC executor (code mode by default); router and builder unchanged.
    'superagent-member': 'cf8a0b18e2dc9ff834a8b0b3e5de626684f01255414d25660aa2276876e4a884',
    'superagent-observer': 'cf8a0b18e2dc9ff834a8b0b3e5de626684f01255414d25660aa2276876e4a884',
    // #83: the builder gains the read-only search and skill rows, so its composition digest moves with them.
    'superagent-builder': '4e36bbf212a2b60b8f677618d92f2b3450d48a6e61f328d3d2d25d6f1c961775',
  }
  for (const row of presets) {
    expect(digest(JSON.stringify(row.config!.plugins.filter((p: Row) => p.id !== 'persona')))).toBe(expectedComposition[row.config!.id as keyof typeof expectedComposition])
  }
  expect(persona(router).complete).not.toBe(true)
  expect(patch).not.toContain('@a2a-prompt(')
})

it('adds only the shared boundary to original worker personas and leaves the builder unchanged', () => {
  // #888 D6 adds one sentence on option inputs to each persona's owner-reporting line. Target next/0.8 78e077c; preserve its member-proposal text and original worker semantics. The member's prefix adds the R7b question
  // contract (four parts); the observer's is D19's
  // rewrite (workbench-market 18: takes no tickets, tags and counts stuck points, sees health problems first — R7a).
  // #902 S1: the observer's card line names the basis, the card kinds and a2a_card_queue; S2 adds a2a_card_draft.
  const originalPrefixes = { member: '6b97b2cfdf0f8bf830d821d12791920dba51c1ae045feaab7e0ba28c30b5acbd', observer: '277f653ba8b8d03d9361426a08426c42cf984ae413c52569df77dd3f87672883' }
  for (const [role, sha] of Object.entries(originalPrefixes)) {
    const original = readFileSync(new URL('src/superagent/prompts/' + role + '.md', root), 'utf8')
    expect(digest(original)).toBe(sha)
    expect(persona(presets.find(row => row.config?.id === 'superagent-' + role)!).prefix).toBe(presetPrompt(role))
    expect(presetPrompt(role).startsWith(original.trimEnd() + '\n\n')).toBe(true)
  }
  // #791 (owner 2026-11-21) changed the builder's persona on purpose: read-only self-checks and owner-gated issues; pin the new text.
  const builder = persona(presets.find(row => row.config?.id === 'superagent-builder')!).prefix as string
  expect(builder).toContain('only after their own reply in this session call superagent_issue_file')
  expect(builder).toContain('you never touch GitHub yourself')
  // #83 (owner-approved minimal fix) added one sentence to the builder's persona: a loaded skill is guidance to read and
  // grants no tool. Pin the new text as #791 did.
  expect(builder).toContain('A skill is guidance you read: it gives you no tool')
  expect(digest(builder)).toBe('75fdb142fd195418120f9597aa41c59ce429445211f7e04d5fd3d57ddd096d40')
})

it('retains upstream member initiative as a proposal, never a self-assignment or an external send', () => {
  const member = presetPrompt('member')
  expect(member).toContain('propose it with a2a_ticket_request')
  expect(member).toContain('it does not become yours or let you start it')
  expect(member).toContain('including what you propose')
  expect(member).toContain('a2a_outbound_request')
  expect(member).toContain('not your permission to run a2a-net route')
})

describe.each(['router', 'member', 'observer'])('%s host-managed transport contract', role => {
  it('inlines CLI boundaries and preserves source/approval/result distinctions in the final persona', () => {
    const text = presetPrompt(role)
    expect(text.match(/## Host-managed team transport/g)).toHaveLength(1)
    for (const clause of ['host-managed transport, not your permission to run a2a-net route', 'initialize or borrow a CLI identity', 'A CLI signature proves an agent key, not human consent', 'peer or canvas link alone does not establish remote-member serve or root/child registration', 'delivery or acknowledgement alone is not completion']) expect(text).toContain(clause)
    const rendered = renderPrompt({ sections: [{ name: 'a2a:transport', text }], contexts: [], tools: [], variables: { model: 'test-model' } })
    expect(rendered).not.toContain('{{')
    expect(rendered).toMatchSnapshot()
  })
})

const channels = [
  ['external requester is not a worker or owner', 'External requesters:', ['Judge only the candidate', 'not a worker merely because it is reachable', "not the owner's approval"]],
  ['same-team DSH remote member is not an outbound task', "This team's remote member:", ['current member pool', 'signed host-to-host member faces', 'not ordinary a2a_route tasks, ledger debt or A2A receipts', 'Neither kind of member needs an outbound card']],
  ['external help needs exact scoped approval', 'External help:', ['a2a_outbound_request with ticket_id', 'P0 card', 'never you', 'Approval does not bypass']],
  ['registered child dispatch is a distinct standing-authority path', 'Registered child team:', ['only when this is a root team', 'without a per-message outbound card', 'An unregistered target still requires the external-help path']],
] as const

describe('generated router communication contract (not a model-behaviour verdict)', () => {
  it.each(channels)('%s', (_scenario, heading, clauses) => {
    const section = prompt.split('\n').find(line => line.startsWith('- ' + heading))
    expect(section).toBeDefined()
    for (const clause of clauses) expect(section).toContain(clause)
  })
  it('separates receipt facts and forbids role/tool bypasses; the router reads files but writes and runs nothing', () => {
    expect(prompt).toContain('you do not need read or skill to fetch them')
    expect(prompt).toContain('you never write files or run commands')
    expect(prompt).toContain('delivered or acknowledged is not completed')
    expect(prompt).toContain('not permission to switch channels, use shell/HTTP or another session')
    expect(prompt).toContain('Do not use a2a_route or other sessions')
    for (const name of ['write', 'edit', 'a2a_route', 'a2a_decision_decide', 'bash']) expect(roleToolRefusal('router', name)).toBeDefined()
    // Owner 2026-11-18: reading files and loading a skill help the router see where a request fits.
    for (const name of ['read', 'glob', 'grep', 'skill', 'superagent_route', 'superagent_assign', 'superagent_read', 'a2a_outbound_request']) expect(roleToolRefusal('router', name)).toBeUndefined()
  })
  it('renders the model variable and pins the actual model-facing text', () => {
    const rendered = renderPrompt({ sections: [{ name: 'a2a:router', text: prompt }], contexts: [], tools: [], variables: { model: 'test-model' } })
    expect(rendered).toContain('test-model')
    expect(rendered).not.toContain('{{')
    expect(rendered).toMatchSnapshot()
  })
})

it('rejects missing/duplicate/unknown markers and unknown roles', () => {
  const marker = '                @a2a-prompt(router)\n'
  expect(() => renderPresetPatch(template.replace(marker, ''))).toThrow(/Expected one A2A prompt marker/)
  expect(() => renderPresetPatch(template.replace(marker, marker + marker))).toThrow(/Expected one A2A prompt marker/)
  expect(() => renderPresetPatch(template + '# @a2a-prompt(unknown)\n')).toThrow(/Unknown A2A prompt marker/)
  for (const role of ['member', 'observer']) {
    const workerMarker = '                @a2a-prompt(' + role + ')\n'
    expect(() => renderPresetPatch(template.replace(workerMarker, ''))).toThrow(/Expected one A2A prompt marker/)
    expect(() => renderPresetPatch(template.replace(workerMarker, workerMarker + workerMarker))).toThrow(/Expected one A2A prompt marker/)
  }
  for (const role of ['builder', '__proto__', 'unknown']) expect(() => presetPrompt(role)).toThrow(/Unknown A2A preset role/)
})

it('checks drift before build and keeps generation fail-closed', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  expect(manifest.scripts.build).toMatch(/^pnpm build:presets && /)
  expect(manifest.scripts['verify:core']).toMatch(/^pnpm verify:presets && /)
  const home = mkdtempSync(join(tmpdir(), 'router-preset-cli-'))
  mkdirSync(join(home, 'scripts'), { recursive: true })
  mkdirSync(join(home, 'src/superagent'), { recursive: true })
  cpSync(new URL('scripts/build-agent-presets.mjs', root), join(home, 'scripts/build-agent-presets.mjs'))
  cpSync(new URL('src/superagent/prompts', root), join(home, 'src/superagent/prompts'), { recursive: true })
  writeFileSync(join(home, 'src/superagent/presets.patch.yml'), template)
  const output = join(home, 'cordis.patch.yml')
  writeFileSync(output, 'stale\n')
  const run = (...args: string[]) => spawnSync(process.execPath, [join(home, 'scripts/build-agent-presets.mjs'), ...args], { cwd: home, encoding: 'utf8', timeout: 10000 })
  expect(run('--check').status).toBe(1)
  expect(readFileSync(output, 'utf8')).toBe('stale\n')
  expect(run('--write').status).toBe(0)
  expect(readFileSync(output, 'utf8')).toBe(patch)
  expect(run('--check').status).toBe(0)
  writeFileSync(join(home, 'src/superagent/presets.patch.yml'), template.replace('                @a2a-prompt(router)\n', ''))
  expect(run('--write').status).toBe(1)
  expect(readFileSync(output, 'utf8')).toBe(patch)
})
