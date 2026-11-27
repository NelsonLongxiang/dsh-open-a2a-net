#!/usr/bin/env node
/** Isolated preset smoke against existing DSH modules: <dsh-cli-package.json> [--ptc]; no sessions or network. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const [target, ...extra] = process.argv.slice(2)
const ptc = extra.includes('--ptc')
const memberSwitch = extra.includes('--member-switch')
if (!target || new Set(extra).size !== extra.length || extra.some(flag => flag !== '--ptc' && flag !== '--member-switch')) {
  throw Error('usage: node scripts/verify-agent-presets-runtime.mjs <dsh-cli-package.json> [--ptc] [--member-switch]')
}
const resolver = resolve(target)
const requireDsh = createRequire(resolver)
const moduleOf = name => import(pathToFileURL(requireDsh.resolve(name)).href)
const { Context } = await moduleOf('@deepseek-ai/cordis')
const { default: Loader } = await moduleOf('@deepseek-ai/cordis-plugin-loader')
const { default: SystemPrompt, renderPrompt } = await moduleOf('@deepseek-ai/dsh-system-prompt')
const requirePrompt = createRequire(requireDsh.resolve('@deepseek-ai/dsh-system-prompt'))
const { createScope } = await import(pathToFileURL(requirePrompt.resolve('@deepseek-ai/dsh-scope')).href)
const requireLoader = createRequire(requireDsh.resolve('@deepseek-ai/cordis-plugin-loader'))
const { load } = requireLoader('js-yaml')
const { entryListSchema, applyEntryPatches } = requireLoader('@deepseek-ai/cordis-plugin-include')
const rows = applyEntryPatches([], load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema }), message => { throw Error(message) })
const presets = rows.filter(row => row.name === '@deepseek-ai/dsh-agent-preset')
assert.deepEqual(presets.map(row => row.config.id), ['superagent-router', 'superagent-member', 'superagent-member-work', 'superagent-observer', 'superagent-builder'])

const presetPlugins = id => presets.find(row => row.config.id === id).config.plugins
const toolsOf = id => presetPlugins(id).filter(plugin => plugin.id !== 'persona')
assert.deepEqual(toolsOf('superagent-member-work'), toolsOf('superagent-member'))

// Mount only the changed persona rows; do not start MCP servers, sessions or the network plugin.
for (const row of presets) {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt, { personaPrefix: 'DEPLOYMENT_SENTINEL' })
    ctx.systemPrompt.variable('model', () => 'runtime-smoke-model')
    ctx.systemPrompt.context({ name: 'smoke-runtime', order: 1, text: 'runtime retained' })
    const key = {}, otherKey = {}
    const scope = createScope(ctx, key)
    const mounting = scope.ctx.extend({ baseUrl: pathToFileURL(dirname(resolver) + '/').href })
    await mounting.plugin(Loader)
    const loader = mounting.get('loader')
    const persona = row.config.plugins.find(plugin => plugin.id === 'persona')
    assert.ok(persona)
    await loader.root.update([{ ...persona, name: pathToFileURL(requireDsh.resolve(persona.name)).href }])
    await loader.await()
    const assembly = await ctx.systemPrompt.assemble({ scope: key })
    const rendered = renderPrompt(assembly)
    assert.ok(rendered.includes(persona.config.prefix.replace('{{model}}', 'runtime-smoke-model').trim()), row.config.id)
    assert.ok(!rendered.includes('DEPLOYMENT_SENTINEL'), row.config.id)
    assert.ok(assembly.contexts.some(context => context.name === 'smoke-runtime'), row.config.id)
    assert.ok(renderPrompt(await ctx.systemPrompt.assemble({ scope: otherKey })).includes('DEPLOYMENT_SENTINEL'))
    await loader.root.update([])
    await loader.await()
    assert.ok(renderPrompt(await ctx.systemPrompt.assemble({ scope: key })).includes('DEPLOYMENT_SENTINEL'))
    console.log(row.config.id + ': Loader/persona assembly, scope isolation, runtime context and disposal passed')
  } finally { await ctx.fiber.dispose() }
}

if (memberSwitch) {
  const { default: Registry } = await moduleOf('@deepseek-ai/dsh-agent-preset-registry')
  const ctx = new Context()
  const selected = new Map()
  const disposers = []
  const memberId = 'superagent-member', officeId = 'superagent-member-work'
  try {
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.variable('model', () => 'runtime-smoke-model')
    ctx.provide('agents', { roots: () => [], get: () => undefined,
      turnBoundaryOf: session => ({ lastTurn: session.lastTurn, openTurnStartSeq: null }) })
    ctx.provide('sessionProjections', { register: async () => ({ stateOf: session => selected.get(session) ?? null }) })
    const loader = new Loader(ctx)
    loader.internal = { import: moduleOf }
    const registry = new Registry(ctx, { default: memberId, selectedDefault: { get: () => undefined } })
    for (const id of [memberId, officeId]) {
      const persona = presetPlugins(id).find(plugin => plugin.id === 'persona')
      disposers.push(await registry.register({ id, plugins: [persona] }))
      assert.equal((await registry.resolve(id)).broken, undefined)
    }
    const agent = id => {
      const key = {}, scope = createScope(ctx, key)
      const session = { lastTurn: 0, append: (_type, value) => { selected.set(session, value.agentPreset) } }
      return { id, key, ctx: scope.ctx, session }
    }
    const hasOfficeRules = async agent => renderPrompt(await ctx.systemPrompt.assemble({ scope: agent.key })).includes('Office work: finish the investigation')
    const started = agent('started-member')
    assert.equal(await registry.select(started, memberId), memberId)
    assert.equal(await hasOfficeRules(started), false)
    started.session.lastTurn = 1
    await assert.rejects(registry.select(started, officeId), /This session has already started/)
    assert.equal(selected.get(started.session), memberId)
    assert.equal(await hasOfficeRules(started), false)
    const fresh = agent('fresh-member')
    assert.equal(await registry.select(fresh, officeId), officeId)
    assert.equal(await hasOfficeRules(fresh), true)
    assert.equal(await registry.select(fresh, memberId), memberId)
    assert.equal(await hasOfficeRules(fresh), false)
    console.log('member preset selection: started session stays on its original persona; fresh selection and rollback passed')
  } finally {
    for (const dispose of disposers.reverse()) await dispose()
    await ctx.fiber.dispose()
  }
}

if (ptc) {
  const { default: Tools, defineTool } = await moduleOf('@deepseek-ai/dsh-tools')
  const Native = await moduleOf('@deepseek-ai/dsh-tool-executor-native')
  const { default: Registry } = await moduleOf('@deepseek-ai/dsh-agent-preset-registry')
  const { RoleTools } = await import(new URL('../lib/superagent/host/role-tools.js', import.meta.url))
  const entry = '@nelsonlongxiang/dsh-open-a2a-net/superagent-ptc'
  const executor = '@deepseek-ai/dsh-tool-executor-ptc'
  const requireCandidate = createRequire(new URL('../package.json', import.meta.url))
  const plugin = await import(pathToFileURL(requireCandidate.resolve(entry)).href)
  const turn = () => new Promise(done => setImmediate(done))
  const runtime = () => ({
    language: 'typescript', programFormat: 'function-body', retainsState: false,
    release: async () => {}, resolve: request => ({ ...request, cwd: process.cwd(), timeoutMs: 1000 }),
    run: async spec => {
      const tools = spec.bindings.find(binding => binding.global === 'tools').functions
      return { logs: [], value: { visible: Object.keys(tools), read: await tools.read({}) } }
    },
  })
  const executorRow = role => presets.find(row => row.config.id === `superagent-${role}`).config.plugins.find(row => row.id === 'tool-executor-ptc')
  for (const role of ['member', 'observer']) {
    assert.equal(executorRow(role).name, entry)
    assert.equal(executorRow(role).disabled, undefined)
  }
  assert.deepEqual(executorRow('member'), executorRow('observer'))
  for (const role of ['router', 'builder']) assert.equal(executorRow(role), undefined)

  for (const timing of ['ready', 'absent', 'late']) {
    const ctx = new Context()
    let unregister
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(Tools)
      await ctx.plugin(Native)
      ctx.provide('agents', { roots: () => [], get: () => undefined })
      ctx.provide('sessionProjections', { register: async () => ({ stateOf: () => null }) })
      const loader = new Loader(ctx)
      ctx.tools.register(defineTool({ name: 'read', description: 'read', parameters: {},
        output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: async () => ({ read: true }) }))
      const imports = []
      // Use the supplied installed DSH for dependencies and this built candidate only for its own package entry.
      loader.internal = { import: async name => { imports.push(name); return name === entry ? plugin : moduleOf(name) } }
      const provide = () => ctx.plugin(child => { child.provide('ptcRuntime', runtime()) })
      if (timing === 'ready') await provide()
      const registry = new Registry(ctx, { default: 'ptc-check', selectedDefault: { get: () => undefined } })
      unregister = await registry.register({ id: 'ptc-check', plugins: [executorRow('member')] })
      assert.equal((await registry.resolve('ptc-check')).broken, undefined)
      const before = await registry.acquireScope('ptc-check')
      try {
        const names = ctx.tools.selectExecutor(before.key).describe(ctx.tools.definitions(before.key)).schemas.map(schema => schema.name)
        assert.deepEqual(names, timing === 'ready' ? ['run_code'] : ['read'])
      } finally { await before[Symbol.asyncDispose]() }
      if (timing === 'late') { await provide(); await turn(); await turn() }
      assert.equal((await registry.resolve('ptc-check')).broken, undefined)
      const lease = await registry.acquireScope('ptc-check')
      try {
        const names = ctx.tools.selectExecutor(lease.key).describe(ctx.tools.definitions(lease.key)).schemas.map(schema => schema.name)
        assert.deepEqual(names, timing !== 'absent' ? ['run_code'] : ['read'])
      } finally { await lease[Symbol.asyncDispose]() }
      assert.equal(imports.filter(name => name === executor).length, 1)
      console.log(`PTC real registry ${timing}: valid preset and expected executor`)
    } finally { await unregister?.(); await ctx.fiber.dispose() }
  }

  for (const denied of [false, true]) {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(Tools)
      await ctx.plugin(Native)
      ctx.baseUrl = pathToFileURL(resolver).href
      // Empty synthetic profile location under the lifecycle root; no actual profile or grant file is read.
      assert.ok(process.env.TMPDIR, 'run profile checks through the test lifecycle entry')
      ctx.provide('profileContext', { dir: resolve(process.env.TMPDIR, 'ptc-synthetic-profile') })
      const manifest = denied
        ? createRequire(import.meta.url).resolve('@deepseek-ai/dsh-tools/package.json')
        : requireDsh.resolve('@deepseek-ai/dsh-tool-executor-ptc/package.json')
      ctx.provide('pluginPackages', { packageOf: () => ({ manifestPath: manifest }) })
      const loader = new Loader(ctx), imports = []
      loader.internal = { import: async name => { imports.push(name); return moduleOf(name) } }
      await ctx.plugin(child => { child.provide('ptcRuntime', runtime()) })
      const presetKey = {}, scope = createScope(ctx, presetKey)
      try {
        await scope.ctx.plugin(plugin)
        const selected = ctx.tools.selectExecutor(presetKey).describe(ctx.tools.definitions(presetKey))
        assert.equal(selected.schemas.some(schema => schema.name === 'run_code'), !denied)
        assert.equal(imports.includes(executor), !denied)
      } finally { await scope.dispose() }
      console.log(`PTC real profile preflight ${denied ? 'denied' : 'admitted'}: original host compatibility policy retained`)
    } finally { await ctx.fiber.dispose() }
  }

  {
    const ctx = new Context()
    let unregister
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(Tools)
      await ctx.plugin(Native)
      ctx.provide('agents', { roots: () => [], get: () => undefined })
      ctx.provide('sessionProjections', { register: async () => ({ stateOf: () => null }) })
      const loader = new Loader(ctx)
      loader.internal = { import: async name => name === entry ? plugin : moduleOf(name) }
      const provide = () => ctx.plugin(child => { child.provide('ptcRuntime', runtime()) })
      const first = await provide()
      const registry = new Registry(ctx, { default: 'ptc-replace', selectedDefault: { get: () => undefined } })
      unregister = await registry.register({ id: 'ptc-replace', plugins: [executorRow('member')] })
      const lease = await registry.acquireScope('ptc-replace')
      try {
        const describe = () => ctx.tools.selectExecutor(lease.key).describe(ctx.tools.definitions(lease.key))
        assert.deepEqual(describe().knownNames, ['run_code'])
        await first.dispose(); await turn()
        // The host deliberately keeps an unavailable scoped selection after removal; do not silently restore native authority.
        assert.throws(describe, /executor.*unavailable|executor.*unloaded/i)
        await provide(); await turn(); await turn()
        assert.equal((await registry.resolve('ptc-replace')).broken, undefined)
        assert.deepEqual(describe().knownNames, ['run_code'])
      } finally { await lease[Symbol.asyncDispose]() }
      console.log('PTC real registry replacement: removed provider fails closed; compatible replacement restores the same scope')
    } finally { await unregister?.(); await ctx.fiber.dispose() }
  }

  for (const role of ['member', 'observer']) {
    const ctx = new Context()
    let scope, preset, disposeGuard, roles
    const seen = []
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(Tools)
      await ctx.plugin(Native)
      ctx.provide('workingDirectory', { ensure: async () => process.cwd() })
      const loader = new Loader(ctx)
      loader.internal = { import: moduleOf }
      await ctx.plugin(child => { child.provide('ptcRuntime', runtime()) })
      for (const name of ['read', 'a2a_route']) ctx.tools.register(defineTool({
        name, description: name, parameters: {}, output: { schema: { type: 'object', additionalProperties: true }, render: () => [] },
        execute: async () => { seen.push(name); return { tool: name } },
      }))
      const presetKey = {}, agent = { id: role, session: { id: role, header: {}, append: async () => {} }, inject() {} }
      preset = createScope(ctx, presetKey)
      await preset.ctx.plugin(plugin)
      scope = createScope(ctx, agent, { parent: presetKey })
      agent.ctx = Object.create(scope.ctx, { tools: { value: scope.ctx.get('tools') } })
      roles = new RoleTools({ roleOf: () => role, agentOf: () => undefined, logger: { warn() {} } })
      disposeGuard = ctx.tools.guard(exec => roles.guard(exec.name, exec.agent, exec.arguments))
      roles.sync(agent)
      const selected = ctx.tools.selectExecutor(agent).describe(ctx.tools.definitions(agent))
      assert.deepEqual(selected.knownNames, ['run_code'])
      const execute = (name, args) => ctx.tools.execute({ agent, signal: new AbortController().signal,
        calls: [{ type: 'tool-call', id: 'ptc-check', name, arguments: JSON.stringify(args) }] })
      assert.equal((await execute('read', {})).results[0].result.isError, true)
      const outcome = (await execute('run_code', { code: 'scripted test binding only', description: 'Check role-scoped nested tool calls' })).results[0].result
      assert.equal(outcome.isError, false)
      assert.deepEqual(outcome.value.result.read, { tool: 'read' })
      assert.equal(outcome.value.result.visible.includes('a2a_route'), false)
      assert.deepEqual(seen, ['read'])
      console.log(`PTC real ${role}: only run_code, nested read, forbidden route hidden, native call refused`)
    } finally { disposeGuard?.(); roles?.forget(role); await scope?.dispose(); await preset?.dispose(); await ctx.fiber.dispose() }
  }
  console.log('PTC checks use real installed Loader/registry/executor consumers and scripted runtime bindings; not a live model or subprocess sandbox acceptance')
}
