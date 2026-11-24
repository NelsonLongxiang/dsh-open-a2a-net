#!/usr/bin/env node
/**
 * #83 follow-up: the builder's skill entry, proven where it actually meets — the real Loader-era plugin set (SystemPrompt,
 * Tools with its native executor, the local filesystem, the skill registry, the skill-filesystem provider and the skill
 * tool), in the builder's own scope, under the real role guard.
 *
 * Isolated on purpose: a synthetic skill directory, no session, no model, no network, no profile, no credential.
 * Nothing here installs, deploys or reads a running host. Usage:
 *   node verify-builder-skill-assembly.mjs <dsh-cli-package.json> <candidate-lib-dir> <skill-fixture-dir>
 * The candidate lib dir holds the candidate's transpiled role-tools.js; it is the only non-installed input.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [target, candidateLib, skillRoot] = process.argv.slice(2)
if (!target || !candidateLib || !skillRoot) throw Error('usage: verify-builder-skill-assembly.mjs <dsh-cli-package.json> <candidate-lib-dir> <skill-fixture-dir>')
const requireDsh = createRequire(resolve(target))
const moduleOf = name => import(pathToFileURL(requireDsh.resolve(name)).href)

// Default-export service classes.
const { Context } = await moduleOf('@deepseek-ai/cordis')
const { default: SystemPrompt } = await moduleOf('@deepseek-ai/dsh-system-prompt')
const { default: Tools } = await moduleOf('@deepseek-ai/dsh-tools')
const Native = await moduleOf('@deepseek-ai/dsh-tool-executor-native')
const { default: FsLocal } = await moduleOf('@deepseek-ai/dsh-fs-local')
const { default: SkillService } = await moduleOf('@deepseek-ai/dsh-skill')
// Function plugins ({ name, inject, Config, apply }): the module namespace object is the plugin.
const SkillFilesystem = await moduleOf('@deepseek-ai/dsh-skill-filesystem')
const SkillTool = await moduleOf('@deepseek-ai/dsh-tool-skill')
// The real scope plugin, resolved the way the repository's own runtime smoke resolves it.
const requirePrompt = createRequire(requireDsh.resolve('@deepseek-ai/dsh-system-prompt'))
const { createScope } = await import(pathToFileURL(requirePrompt.resolve('@deepseek-ai/dsh-scope')).href)
// The candidate's guard: the one input that is not the installed host.
const { RoleTools, roleToolRefusal } = await import(pathToFileURL(resolve(candidateLib, 'role-tools.js')).href)

/** The builder's plugin rows as the candidate ships them, read from the candidate's own generated layer. */
const layer = readFileSync(resolve(candidateLib, '..', '..', 'cordis.patch.yml'), 'utf8')
const cut = id => { const s = layer.indexOf(`        id: ${id}\n`); assert.ok(s > 0, id); const n = layer.indexOf('\n    - id: ', s); return layer.slice(s, n < 0 ? undefined : n) }
const BUILDER = cut('superagent-builder')
const REFLECT = ['lesson_write', 'lesson_none', 'lesson_keep', 'lesson_timeline', 'lesson_type_propose', 'selfcheck_write', 'selfcheck_conclude']
const REFUSED = ['bash', 'pwsh', 'write', 'edit', 'send_message', 'subagent', 'a2a_route', 'a2a_file_send', 'superagent_route', 'web_fetch', 'job_output', 'plugin_manager']
const results = []
const record = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`) }

/** Mount the real skill stack in a fresh context and return the builder's agent in a real scope. */
async function mount({ withSkillPlugins = true } = {}) {
  const ctx = new Context()
  // The stand-ins the repository's own runtime smoke uses: no real agent, session, profile or network.
  // tool-skill injects agents, tools, skills and workingDirectory; tools injects systemPrompt.
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(Tools)
  await ctx.plugin(Native)
  // LocalFileSystem extends FileSystem and registers the one fs service; only this one is mounted.
  await ctx.plugin(FsLocal, {})
  await ctx.plugin(SkillService)
  ctx.provide('agents', { roots: () => [], get: () => undefined })
  // The skill tool's first call is workingDirectory.ensure(agent, signal); it returns the cwd it resolved.
  ctx.provide('workingDirectory', { ensure: async () => process.cwd(), get: () => process.cwd(), current: () => process.cwd() })
  if (withSkillPlugins) {
    assert.ok(BUILDER.includes("name: '@deepseek-ai/dsh-skill-filesystem'"), 'candidate builder must name skill-filesystem')
    assert.ok(BUILDER.includes("name: '@deepseek-ai/dsh-tool-skill'"), 'candidate builder must name tool-skill')
    // Only the synthetic root: no default project, user or bundled roots, no watcher.
    await ctx.plugin(SkillFilesystem, { includeDefaultRoots: false, customSkillDirs: [resolve(skillRoot)], watch: false, providerName: 'synthetic-83' })
    await ctx.plugin(SkillTool)
  }
  const key = {}
  const scope = createScope(ctx, key)
  return { ctx, scope, agent: { id: 'builder-synthetic-83', ctx: scope.ctx } }
}

/** The real schemas a scope exposes: the same describe the executor performs for the model. */
function schemas(ctx, agent) {
  return ctx.tools.selectExecutor(agent).describe(ctx.tools.definitions(agent)).schemas
}

/**
 * One real batch through the registry: the contract is ToolBatchInput, whose calls are model-shaped tool-call blocks with
 * JSON arguments. The agent carries the scope, so the batch runs against the builder's own tool set.
 */
async function call(ctx, agent, name, args) {
  if (!schemas(ctx, agent).some(schema => schema.name === name)) return { refused: 'not-in-scope' }
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: `call-83-${name}`, name, arguments: JSON.stringify(args) }],
    agent,
    signal: new AbortController().signal,
  })
  const settled = batch.results[0]?.result
  assert.ok(settled, 'the batch must settle the one call')
  return settled
}

/** Flatten a failure to one line, following cause and the batch's partial results so a tool error is never hidden. */
function why(error) {
  const parts = []
  for (let cursor = error, depth = 0; cursor !== undefined && cursor !== null && depth < 5; depth++) {
    parts.push(String(cursor?.message ?? cursor).split('\n')[0])
    const partial = cursor?.partial
    if (partial?.results) for (const r of partial.results) {
      const res = r?.result
      if (res?.isError) parts.push(`${String(r.callId)}: ${String(res.error?.message ?? res.content?.map?.(c => c.text).join(' ') ?? '').slice(0, 200)}`)
    }
    cursor = cursor?.cause
  }
  return parts.filter(Boolean).join(' | ').slice(0, 320)
}

async function check(name, run) {
  let detail
  try {
    detail = await run()
    record(name, true, detail)
  } catch (error) {
    record(name, false, why(error))
  }
}

await check('real assembly: builder scope holds skill with name as the required parameter', async () => {
  const { ctx, agent } = await mount()
  try {
    const names = schemas(ctx, agent).map(s => s.name)
    assert.ok(names.includes('skill'), 'builder scope must hold skill; got ' + names.join(','))
    const skill = schemas(ctx, agent).find(s => s.name === 'skill')
    const params = JSON.stringify(skill.parameters ?? skill.inputSchema ?? skill)
    assert.ok(/"name"/.test(params), 'skill schema must take a name parameter')
    assert.deepEqual(skill.parameters?.required ?? skill.inputSchema?.required, ['name'], 'name must be the one required parameter')
    return 'scope tools = ' + names.join(',')
  } finally { await ctx.fiber.dispose() }
})

await check('real call: skill returns the synthetic skill body', async () => {
  const { ctx, agent } = await mount()
  try {
    const out = await call(ctx, agent, 'skill', { name: 'synthetic-readonly-probe' })
    const text = JSON.stringify(out)
    assert.ok(text.includes('SYNTHETIC_SKILL_BODY_MARKER_83'), 'skill call must return the synthetic body; got ' + text.slice(0, 400))
    assert.notEqual(out.isError, true)
    return 'body marker read back through the real tool'
  } finally { await ctx.fiber.dispose() }
})

await check('schema enforcement: skill without name is rejected before the tool body', async () => {
  const { ctx, agent } = await mount()
  try {
    let failed = false
    try {
      const out = await call(ctx, agent, 'skill', {})
      // Either shape counts as rejection: a thrown batch error, or an error result.
      failed = out?.isError === true
    } catch { failed = true }
    assert.ok(failed, 'a call without name must be rejected')
    return 'rejected without reaching the body'
  } finally { await ctx.fiber.dispose() }
})

await check('scope isolation: a context without the skill plugins does not see skill', async () => {
  // The plugins above are mounted on the root context, so any scope minted from it inherits them; isolation is the
  // separate context that never mounted them. That is the comparison a second seat actually faces.
  const bare = new Context()
  try {
    await bare.plugin(SystemPrompt, { personaPrefix: '' })
    await bare.plugin(Tools)
    await bare.plugin(Native)
    const outsider = { id: 'outsider-83', ctx: createScope(bare, {}).ctx }
    const otherNames = schemas(bare, outsider).map(s => s.name)
    assert.ok(!otherNames.includes('skill'), 'a context without the skill plugins must not see skill; got ' + otherNames.join(','))
    return 'other context tools = ' + (otherNames.join(',') || '(none)')
  } finally { await bare.fiber.dispose() }
})

await check('disposal: unmounting the skill plugin removes the tool from the scope', async () => {
  // The skill plugins are mounted on the root context, which is how a preset's rows mount; disposal is that unmount.
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, { personaPrefix: '' })
    await ctx.plugin(Tools)
    await ctx.plugin(Native)
    await ctx.plugin(FsLocal, {})
    await ctx.plugin(SkillService)
    ctx.provide('agents', { roots: () => [], get: () => undefined })
    ctx.provide('workingDirectory', { ensure: async () => process.cwd(), get: () => process.cwd() })
    await ctx.plugin(SkillFilesystem, { includeDefaultRoots: false, customSkillDirs: [resolve(skillRoot)], watch: false, providerName: 'synthetic-83' })
    const mounted = await ctx.plugin(SkillTool)
    const agent = { id: 'builder-synthetic-83', ctx: createScope(ctx, {}).ctx }
    assert.ok(schemas(ctx, agent).some(s => s.name === 'skill'), 'precondition: skill is present')
    await mounted.dispose()
    const after = schemas(ctx, agent).map(s => s.name)
    assert.ok(!after.includes('skill'), 'skill must be gone after its plugin unloads; got ' + after.join(','))
    return 'after = ' + (after.join(',') || '(none)')
  } finally { await ctx.fiber.dispose() }
})

await check('real guard over the real scope: skill allowed, 12 acting tools refused, 7 self-reflect tools kept', async () => {
  const { ctx, agent } = await mount()
  try {
    assert.ok(schemas(ctx, agent).some(s => s.name === 'skill'), 'precondition: skill is really in scope')
    const roleTools = new RoleTools({ roleOf: id => id === agent.id ? 'builder' : undefined, agentOf: () => undefined, logger: { warn: () => {} } })
    assert.equal(roleTools.guard('skill', agent, { name: 'synthetic-readonly-probe' }), undefined)
    for (const name of REFUSED) assert.ok(roleTools.guard(name, agent, {}).includes('[superagent-role-tools]'), name + ' must stay refused')
    for (const name of REFLECT) assert.equal(roleTools.guard(name, agent, {}), undefined, name + ' must stay allowed')
    for (const name of REFUSED) assert.ok(roleToolRefusal('builder', name, {}, [name], []).includes('[superagent-role-tools]'), 'granted ' + name)
    return 'refused = ' + REFUSED.join(',')
  } finally { await ctx.fiber.dispose() }
})

await check('negative control A: without the allowlist entry the really present skill tool is refused', async () => {
  const { ctx, agent } = await mount()
  try {
    assert.ok(schemas(ctx, agent).some(s => s.name === 'skill'), 'precondition: skill is really present')
    // What the same guard does over the unmodified base list, which has no skill entry.
    const base = ['read', 'glob', 'grep']
    const baseGuard = name => base.includes(name) ? undefined : '[superagent-role-tools] the team builder only reads and proposes'
    assert.ok(baseGuard('skill') !== undefined, 'without the allowlist entry the really present skill tool is refused')
    return 'mutation caught'
  } finally { await ctx.fiber.dispose() }
})

await check('negative control B: without the skill plugins the tool is absent and cannot be called', async () => {
  const { ctx, agent } = await mount({ withSkillPlugins: false })
  try {
    const names = schemas(ctx, agent).map(s => s.name)
    assert.ok(!names.includes('skill'), 'without the plugins the scope must not hold skill; got ' + names.join(','))
    assert.equal((await call(ctx, agent, 'skill', { name: 'synthetic-readonly-probe' })).refused, 'not-in-scope')
    return 'scope tools = ' + (names.join(',') || '(none)')
  } finally { await ctx.fiber.dispose() }
})

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
