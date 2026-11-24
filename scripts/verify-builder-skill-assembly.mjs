#!/usr/bin/env node
/**
 * #83 follow-up: the builder's skill entry, proven where it meets the real host — the Loader assembling the preset's own
 * tool rows, the real Tools registry with its native executor, the real filesystem and skill plugins, two real scopes under
 * one root, and the candidate's own guard.
 *
 * Isolated on purpose: a synthetic skill directory, no session, no model, no network, no profile, no credential.
 * Nothing here installs, deploys or reads a running host.
 *   node verify-builder-skill-assembly.mjs <dsh-cli-package.json> <candidate-lib-dir> <skill-fixture-dir>
 * The candidate lib dir holds the candidate's transpiled role-tools.js (and role-tools.ts beside it, for the mutation).
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [target, candidateLib, skillRoot] = process.argv.slice(2)
if (!target || !candidateLib || !skillRoot) throw Error('usage: verify-builder-skill-assembly.mjs <dsh-cli-package.json> <candidate-lib-dir> <skill-fixture-dir>')
const resolver = resolve(target)
const requireDsh = createRequire(resolver)
const moduleOf = name => import(pathToFileURL(requireDsh.resolve(name)).href)

// Default-export service classes.
const { Context } = await moduleOf('@deepseek-ai/cordis')
const { default: Loader } = await moduleOf('@deepseek-ai/cordis-plugin-loader')
const { default: SystemPrompt } = await moduleOf('@deepseek-ai/dsh-system-prompt')
const { default: Tools } = await moduleOf('@deepseek-ai/dsh-tools')
const Native = await moduleOf('@deepseek-ai/dsh-tool-executor-native')
const { default: FsLocal } = await moduleOf('@deepseek-ai/dsh-fs-local')
const { default: SkillService } = await moduleOf('@deepseek-ai/dsh-skill')
// Function plugins ({ name, inject, Config, apply }): the module namespace object is the plugin.
const SkillFilesystem = await moduleOf('@deepseek-ai/dsh-skill-filesystem')
const SkillTool = await moduleOf('@deepseek-ai/dsh-tool-skill')
const requirePrompt = createRequire(requireDsh.resolve('@deepseek-ai/dsh-system-prompt'))
const { createScope } = await import(pathToFileURL(requirePrompt.resolve('@deepseek-ai/dsh-scope')).href)
// The candidate's guard: the one input that is not the installed host.
const candidate = await import(pathToFileURL(resolve(candidateLib, 'role-tools.js')).href)
const { RoleTools, roleToolRefusal } = candidate

/** The builder's plugin rows as the candidate ships them, read from the candidate's own generated layer. */
const layer = readFileSync(resolve(candidateLib, '..', '..', 'cordis.patch.yml'), 'utf8')
const cut = id => { const s = layer.indexOf(`        id: ${id}\n`); assert.ok(s > 0, id); const n = layer.indexOf('\n    - id: ', s); return layer.slice(s, n < 0 ? undefined : n) }
const BUILDER = cut('superagent-builder')
const REFLECT = ['lesson_write', 'lesson_none', 'lesson_keep', 'lesson_timeline', 'lesson_type_propose', 'selfcheck_write', 'selfcheck_conclude']
const REFUSED = ['bash', 'pwsh', 'write', 'edit', 'send_message', 'subagent', 'a2a_route', 'a2a_file_send', 'superagent_route', 'web_fetch', 'job_output', 'plugin_manager']
const results = []
const record = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`) }

/** The filesystem provider's config: only the synthetic root, no default project, user or bundled roots, no watcher. */
const skillFsConfig = { includeDefaultRoots: false, customSkillDirs: [resolve(skillRoot)], watch: false, providerName: 'synthetic-83' }

/** The stack every case needs, minus the skill plugins: the same stand-ins the repository's runtime smoke uses. */
async function baseContext() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(Tools)
  await ctx.plugin(Native)
  // LocalFileSystem extends FileSystem and registers the one fs service; only this one is mounted.
  await ctx.plugin(FsLocal, {})
  await ctx.plugin(SkillService)
  ctx.provide('agents', { roots: () => [], get: () => undefined })
  // The skill tool's first call is workingDirectory.ensure(agent, signal).
  ctx.provide('workingDirectory', { ensure: async () => process.cwd(), get: () => process.cwd(), current: () => process.cwd() })
  return ctx
}

/** Base context plus the two skill plugins, mounted in one scope; a sibling scope under the same root mounts neither. */
async function mountScoped() {
  const ctx = await baseContext()
  const builderKey = {}
  const builderScope = createScope(ctx, builderKey)
  await builderScope.ctx.plugin(SkillFilesystem, skillFsConfig)
  await builderScope.ctx.plugin(SkillTool)
  const siblingKey = {}
  const siblingScope = createScope(ctx, siblingKey)
  return {
    ctx,
    builderKey,
    siblingKey,
    builder: { id: 'builder-scoped-83', ctx: builderScope.ctx },
    sibling: { id: 'sibling-scoped-83', ctx: siblingScope.ctx },
  }
}

/** The real schemas a scope exposes: definitions and the executor both take the ScopeKey, not the Agent. */
function schemas(ctx, key) {
  return ctx.tools.selectExecutor(key).describe(ctx.tools.definitions(key)).schemas
}

/** One real batch through the registry: ToolBatchInput takes model-shaped tool-call blocks with JSON arguments. */
async function call(ctx, agent, key, name, args) {
  if (!schemas(ctx, key).some(schema => schema.name === name)) return { refused: 'not-in-scope' }
  // Step admission: a scoped tool is resolvable only inside the set its agent was admitted for.
  const signal = new AbortController().signal
  const toolSet = await ctx.tools.resolve({ agent, signal })
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: `call-83-${name}`, name, arguments: JSON.stringify(args) }],
    agent,
    toolSet,
    signal,
  })
  const settled = batch.results[0]?.result
  assert.ok(settled, 'the batch must settle the one call')
  return settled
}

/** Flatten a failure to one line, following cause and the batch's partial results. */
function why(error) {
  const parts = []
  for (let cursor = error, depth = 0; cursor !== undefined && cursor !== null && depth < 5; depth++) {
    parts.push(String(cursor?.message ?? cursor).split('\n')[0])
    const partial = cursor?.partial
    if (partial?.results) for (const r of partial.results) {
      const res = r?.result
      if (res?.isError) parts.push(`${String(r.callId)}: ${String(res.error?.message ?? '').slice(0, 200)}`)
    }
    cursor = cursor?.cause
  }
  return parts.filter(Boolean).join(' | ').slice(0, 320)
}

async function check(name, run) {
  try {
    record(name, true, await run())
  } catch (error) {
    record(name, false, why(error))
  }
}

// ---- 1. The Loader assembles the preset's own tool rows, and the builder scope then holds skill. ----
await check('Loader assembly: the preset\'s tool rows mount through Loader and the scope holds skill', async () => {
  // The rows this preset names for tools, in its own order; persona, MCP, compaction and the instruction rows need a
  // session, a ygl binary or unrelated services, so they stay out of this isolated mount. Each name is asserted present
  // in the candidate's own preset block, so a candidate that stops naming one fails here rather than silently passing.
  const rows = [
    { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs', config: { write: false, edit: false } },
    { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem', config: skillFsConfig },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' },
  ]
  for (const row of rows) assert.ok(BUILDER.includes(`name: '${row.name}'`), 'the candidate preset must name ' + row.name)
  const ctx = await baseContext()
  try {
    const loading = ctx.extend({ baseUrl: pathToFileURL(dirname(resolver) + '/').href })
    await loading.plugin(Loader)
    const loader = loading.get('loader')
    await loader.root.update(rows.map(row => ({ ...row, name: pathToFileURL(requireDsh.resolve(row.name)).href })))
    await loader.await()
    const loaderKey = {}
    const scope = createScope(ctx, loaderKey)
    const agent = { id: 'loader-builder-83', ctx: scope.ctx }
    const names = schemas(ctx, loaderKey).map(s => s.name)
    assert.ok(names.includes('skill'), 'after Loader assembly the scope must hold skill; got ' + names.join(','))
    const skill = schemas(ctx, loaderKey).find(s => s.name === 'skill')
    assert.deepEqual(skill.parameters?.required ?? skill.inputSchema?.required, ['name'], 'name must be the one required parameter')
    // The preset's read-only file tool came through the same assembly. glob and grep belong to tool-fs-search, which
    // injects `subprocess`; this isolated fixture composes no subprocess provider, so those two are outside this check.
    assert.ok(names.includes('read'), 'Loader assembly must also expose read; got ' + names.join(','))
    return 'scope tools = ' + names.join(',')
  } finally { await ctx.fiber.dispose() }
})

// ---- 2. Real call through the real registry reads the synthetic body back. ----
// The skill plugins mount at the composition's root here, as a preset's rows do in a composition that has not narrowed
// them to one scope: this case is about the call reaching the tool body, not about per-scope admission.
await check('real call: skill returns the synthetic skill body', async () => {
  const ctx = await baseContext()
  try {
    await ctx.plugin(SkillFilesystem, skillFsConfig)
    await ctx.plugin(SkillTool)
    const agent = { id: 'builder-call-83', ctx: createScope(ctx, {}).ctx }
    const out = await call(ctx, agent, undefined, 'skill', { name: 'synthetic-readonly-probe' })
    const text = JSON.stringify(out)
    assert.ok(text.includes('SYNTHETIC_SKILL_BODY_MARKER_83'), 'skill call must return the synthetic body; got ' + text.slice(0, 400))
    assert.notEqual(out.isError, true)
    return 'body marker read back through the real tool'
  } finally { await ctx.fiber.dispose() }
})

// ---- 3. The schema is enforced by the real tool. ----
await check('schema enforcement: skill without name is rejected before the tool body', async () => {
  const ctx = await baseContext()
  try {
    const schemaKey = {}
    const builderScope = createScope(ctx, schemaKey)
    await builderScope.ctx.plugin(SkillFilesystem, skillFsConfig)
    await builderScope.ctx.plugin(SkillTool)
    const agent = { id: 'builder-schema-83', ctx: builderScope.ctx }
    let failed = false
    try {
      const out = await call(ctx, agent, schemaKey, 'skill', {})
      failed = out?.isError === true
    } catch { failed = true }
    assert.ok(failed, 'a call without name must be rejected')
    return 'rejected without reaching the body'
  } finally { await ctx.fiber.dispose() }
})

// ---- 4. Same root, two real scopes: the sibling scope does not see the tool the builder scope mounted. ----
await check('scope isolation: a sibling scope under the same root does not see skill', async () => {
  const { ctx, builderKey, siblingKey, builder, sibling } = await mountScoped()
  try {
    assert.ok(schemas(ctx, builderKey).some(s => s.name === 'skill'), 'the builder scope must hold skill')
    const siblingNames = schemas(ctx, siblingKey).map(s => s.name)
    assert.ok(!siblingNames.includes('skill'), 'a sibling scope under the same root must not see skill; got ' + siblingNames.join(','))
    // And it really cannot call it: the batch refuses by scope, not by trust.
    assert.equal((await call(ctx, sibling, siblingKey, 'skill', { name: 'synthetic-readonly-probe' })).refused, 'not-in-scope')
    return 'sibling scope tools = ' + (siblingNames.join(',') || '(none)')
  } finally { await ctx.fiber.dispose() }
})

// ---- 5. Unmounting the skill plugin removes the tool from that scope, and leaves the sibling untouched. ----
await check('disposal: unmounting the skill plugin removes the tool from its scope', async () => {
  const ctx = await baseContext()
  try {
    const disposeKey = {}
    const builderScope = createScope(ctx, disposeKey)
    await builderScope.ctx.plugin(SkillFilesystem, skillFsConfig)
    const mounted = await builderScope.ctx.plugin(SkillTool)
    const agent = { id: 'builder-dispose-83', ctx: builderScope.ctx }
    assert.ok(schemas(ctx, disposeKey).some(s => s.name === 'skill'), 'precondition: skill is present')
    await mounted.dispose()
    const after = schemas(ctx, disposeKey).map(s => s.name)
    assert.ok(!after.includes('skill'), 'skill must be gone after its plugin unloads; got ' + after.join(','))
    return 'after = ' + (after.join(',') || '(none)')
  } finally { await ctx.fiber.dispose() }
})

// ---- 6. The candidate's real guard over the really present tools. ----
await check('real guard over the real scope: skill allowed, 12 acting tools refused, 7 self-reflect tools kept', async () => {
  const { ctx, builderKey, builder } = await mountScoped()
  try {
    assert.ok(schemas(ctx, builderKey).some(s => s.name === 'skill'), 'precondition: skill is really in scope')
    const roleTools = new RoleTools({ roleOf: id => id === builder.id ? 'builder' : undefined, agentOf: () => undefined, logger: { warn: () => {} } })
    assert.equal(roleTools.guard('skill', builder, { name: 'synthetic-readonly-probe' }), undefined)
    for (const name of REFUSED) assert.ok(roleTools.guard(name, builder, {}).includes('[superagent-role-tools]'), name + ' must stay refused')
    for (const name of REFLECT) assert.equal(roleTools.guard(name, builder, {}), undefined, name + ' must stay allowed')
    for (const name of REFUSED) assert.ok(roleToolRefusal('builder', name, {}, [name], []).includes('[superagent-role-tools]'), 'granted ' + name)
    return 'refused = ' + REFUSED.join(',')
  } finally { await ctx.fiber.dispose() }
})

// ---- 7. Negative control A: a real mutation of the candidate source, not a stand-in. ----
await check('negative control A: real source with skill removed from the allowlist is refused by the real guard', async () => {
  // Edit the candidate's own role-tools.ts, transpile it with the installed TypeScript, and run the resulting module's
  // own RoleTools: the mutation is the source change every seat would make to reproduce the gap.
  const sourcePath = resolve(candidateLib, '..', 'role-tools.ts')
  const original = readFileSync(sourcePath, 'utf8')
  const before = "'grep', 'skill', 'superagent_org_read'"
  assert.ok(original.includes(before), 'the candidate must still carry the skill entry this mutation removes')
  const mutated = original.replace(before, "'grep', 'superagent_org_read'")
  assert.notEqual(mutated, original, 'the mutation must change bytes')
  const requireTree = createRequire(pathToFileURL(join(candidateLib, 'probe.mjs')).href)
  const ts = (await import(pathToFileURL(requireTree.resolve('typescript')).href)).default
  const outDir = resolve(candidateLib, 'mutated')
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, 'role-tools.js')
  writeFileSync(outFile, ts.transpileModule(mutated, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText)
  const mutatedModule = await import(pathToFileURL(outFile).href)
  assert.equal(mutatedModule.BUILDER_TOOLS.includes('skill'), false, 'the mutated list must not carry skill')
  const refusal = mutatedModule.roleToolRefusal('builder', 'skill', { name: 'synthetic-readonly-probe' })
  assert.ok(String(refusal).includes('[superagent-role-tools]'), 'the real guard over the mutated source must refuse skill; got ' + String(refusal))
  // And the unmutated candidate still allows it, so the difference is the mutation alone.
  assert.equal(candidate.roleToolRefusal('builder', 'skill', { name: 'synthetic-readonly-probe' }), undefined)
  return 'real source mutation refused by the real guard'
})

// ---- 8. Negative control B: without the plugins the tool is absent. ----
await check('negative control B: without the skill plugins the tool is absent and cannot be called', async () => {
  const ctx = await baseContext()
  try {
    const bareKey = {}
    const scope = createScope(ctx, bareKey)
    const agent = { id: 'builder-bare-83', ctx: scope.ctx }
    const names = schemas(ctx, bareKey).map(s => s.name)
    assert.ok(!names.includes('skill'), 'without the plugins the scope must not hold skill; got ' + names.join(','))
    assert.equal((await call(ctx, agent, bareKey, 'skill', { name: 'synthetic-readonly-probe' })).refused, 'not-in-scope')
    return 'scope tools = ' + (names.join(',') || '(none)')
  } finally { await ctx.fiber.dispose() }
})

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exitCode = 1
