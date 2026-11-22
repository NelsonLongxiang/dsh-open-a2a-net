#!/usr/bin/env node
/** Isolated preset smoke against existing DSH modules: <dsh-cli-package.json> [--ptc]; no sessions or network. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const [target, ...extra] = process.argv.slice(2)
const ptc = extra.length === 1 && extra[0] === '--ptc'
if (!target || (extra.length && !ptc)) throw Error('usage: node scripts/verify-agent-presets-runtime.mjs <dsh-cli-package.json> [--ptc]')
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
assert.deepEqual(presets.map(row => row.config.id), ['superagent-router', 'superagent-member', 'superagent-observer', 'superagent-builder', 'a2a-net-ptc'])

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

// Exercise the new preset's actual PTC executor, replacing only program evaluation with a no-effect fixture.
const { default: ToolRegistry, defineTool } = await moduleOf('@deepseek-ai/dsh-tools')
const executorPath = requireDsh.resolve('@deepseek-ai/dsh-tool-executor-ptc')
const generalEntry = '@nelsonlongxiang/dsh-open-a2a-net/general-ptc'
const generalPlugin = await import(new URL('../lib/presets/ptc.js', import.meta.url))
const fixtureRuntime = () => ({ language: 'typescript', programFormat: 'function-body', retainsState: false,
  release: async () => {}, resolve: request => ({ ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: 120000 }),
  run() { throw Error('This verification must not execute a program or business tool') } })

const general = presets.find(row => row.config.id === 'a2a-net-ptc')
const checkModules = entries => {
  for (const row of entries) {
    if (row.disabled === true) continue
    if (row.group) checkModules(row.config)
    else if (row.name === generalEntry) assert.equal(typeof generalPlugin.apply, 'function')
    else requireDsh.resolve(row.name)
  }
}
checkModules(general.config.plugins)
console.log('a2a-net-ptc: every enabled composition module resolves from the target DSH installation')
const ptcContext = new Context()
try {
  await ptcContext.plugin(SystemPrompt)
  await ptcContext.plugin(ToolRegistry)
  await ptcContext.plugin(child => { child.provide('ptcRuntime', fixtureRuntime()) })
  const owner = {}
  const scope = createScope(ptcContext, owner)
  const mounting = scope.ctx.extend({ baseUrl: pathToFileURL(dirname(resolver) + '/').href })
  await mounting.plugin(Loader)
  const loader = mounting.get('loader')
  const executor = general.config.plugins.find(row => row.id === 'tool-executor-ptc')
  assert.ok(executor)
  loader.internal = { import: async name => name === generalEntry ? generalPlugin : moduleOf(name) }
  await loader.root.update([executor])
  await loader.await()
  const scopeKey = (await import(pathToFileURL(requirePrompt.resolve('@deepseek-ai/dsh-scope')).href)).scopeOf(scope.ctx)
  const tools = scope.ctx.get('tools')
  const unregister = tools.register(defineTool({ name: 'a2a_probe_fixture', description: 'Non-executing SDK probe.', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => { throw Error('not called') } }))
  const assembly = await ptcContext.systemPrompt.assemble({ scope: scopeKey })
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['run_code'])
  assert.ok(assembly.sections.some(section => section.name === 'tools:sdk' && section.text.includes('a2a_probe_fixture')))
  assert.ok(assembly.sections.some(section => section.name === 'tools:ptc-only'))
  assert.ok(!assembly.sections.find(section => section.name === 'tools:sdk').text.match(/subagent:|subagent_fork:|workflow:|ralph:/))
  const direct = await tools.execute({ calls: [{ type: 'tool-call', id: 'preset-direct-probe', name: 'a2a_probe_fixture', arguments: '{}' }], agent: owner, signal: new AbortController().signal })
  assert.equal(direct.results[0].result.isError, true)
  assert.equal(direct.results[0].result.error.info.code, 'UNKNOWN_TOOL')
  unregister()
  await loader.root.update([])
  await loader.await()
  console.log('a2a-net-ptc: real PTC executor exposes only run_code, generates SDK, rejects direct SDK-tool calls and unloads without running business code')
} finally { await ptcContext.fiber.dispose() }

// The complete required entry must mask an inherited native selection even before a runtime arrives.
const NativeExecutor = await moduleOf('@deepseek-ai/dsh-tool-executor-native')
for (const scenario of ['absent', 'late', 'incompatible', 'missing-executor', 'denied']) {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(NativeExecutor)
    ctx.tools.register(defineTool({ name: 'native_fixture', description: 'Never called', parameters: {},
      output: { schema: { type: 'string' }, render: () => [] }, execute: async () => { throw Error('not executed') } }))
    const owner = {}, scope = createScope(ctx, owner)
    try {
      const loader = new Loader(scope.ctx)
      loader.internal = { import: async id => {
        if (scenario === 'missing-executor' && id === '@deepseek-ai/dsh-tool-executor-ptc') {
          const error = new Error("Cannot find package '@deepseek-ai/dsh-tool-executor-ptc'")
          error.code = 'ERR_MODULE_NOT_FOUND'; throw error
        }
        if (scenario === 'denied' && id === '@deepseek-ai/dsh-app-boot') return { prepareProfileEntries: () => [{ disabled: true }] }
        return moduleOf(id)
      } }
      if (scenario === 'denied') scope.ctx.provide('profileContext', {})
      if (scenario === 'incompatible') await ctx.plugin(child => { child.provide('ptcRuntime', { language: 'typescript' }) })
      await scope.ctx.plugin(generalPlugin)
      const names = () => ctx.tools.selectExecutor(owner).describe(ctx.tools.definitions(owner)).schemas.map(tool => tool.name)
      assert.throws(names, /PTC.*unavailable|executor.*unavailable|executor.*unloaded/i)
      await assert.rejects(ctx.tools.execute({ agent: owner, calls: [{ type: 'tool-call', id: 'blocked-native', name: 'native_fixture', arguments: '{}' }], signal: new AbortController().signal }), /PTC.*unavailable|executor.*unavailable/i)
      if (scenario === 'late') {
        const provider = await ctx.plugin(child => { child.provide('ptcRuntime', fixtureRuntime()) })
        await new Promise(done => setImmediate(done)); await new Promise(done => setImmediate(done))
        assert.deepEqual(names(), ['run_code'])
        await provider.dispose(); await new Promise(done => setImmediate(done))
        assert.throws(names, /PTC.*unavailable|executor.*unavailable|executor.*unloaded/i)
        await ctx.plugin(child => { child.provide('ptcRuntime', fixtureRuntime()) })
        await new Promise(done => setImmediate(done)); await new Promise(done => setImmediate(done))
        assert.deepEqual(names(), ['run_code'])
      }
      console.log('general required PTC ' + scenario + ': no inherited native tools; late provider/replacement checked when applicable')
    } finally { await scope.dispose() }
  } finally { await ctx.fiber.dispose() }
}
