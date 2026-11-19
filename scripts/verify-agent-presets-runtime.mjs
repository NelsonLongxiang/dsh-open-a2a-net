#!/usr/bin/env node
/** Read-only preset smoke against an installed DSH: node scripts/verify-agent-presets-runtime.mjs <dsh-cli-package.json>. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const [target, ...extra] = process.argv.slice(2)
if (!target || extra.length) throw Error('usage: node scripts/verify-agent-presets-runtime.mjs <dsh-cli-package.json>')
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
assert.deepEqual(presets.map(row => row.config.id), ['superagent-router', 'superagent-member', 'superagent-observer', 'superagent-builder'])

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
