/** Optional PTC activation uses Cordis lifetimes, not a one-shot preset disabled expression. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtempSync } from '../temp-dirs.ts'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, compatiblePtcRuntime, inject, name } from '../../src/superagent/ptc.ts'

const runtime = () => ({ language: 'typescript', programFormat: 'function-body', retainsState: false, release() {}, resolve() {}, run() {} })
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

function host(options: { oldTools?: boolean; imported?: () => Promise<unknown> } = {}) {
  const ctx = new Context()
  const mounted = vi.fn(), removed = vi.fn(), warn = vi.fn()
  const setExecutor = options.oldTools ? undefined : vi.fn()
  ctx.provide('tools', { setExecutor } as never)
  ctx.provide('systemPrompt', {} as never)
  const executor = { apply(child: Context) { mounted(); child.effect(() => () => { removed() }) } }
  const importer = vi.fn(options.imported ?? (async () => executor))
  ctx.baseUrl = import.meta.url
  ctx.provide('loader', { import: importer, ctx } as never)
  ctx.logger.warn = warn
  const load = () => ctx.plugin({ name, inject, apply })
  const provide = async (value = runtime()) => {
    const fiber = ctx.plugin((child: Context) => { child.provide('ptcRuntime', value as never) })
    await fiber
    return fiber
  }
  return { ctx, mounted, removed, warn, importer, load, provide }
}

describe('optional team PTC entry', () => {
  it('requires the new runtime contract, not the legacy shared service name', () => {
    expect(compatiblePtcRuntime(runtime())).toBe(true)
    expect(compatiblePtcRuntime({ language: 'typescript', resolve() {}, run() {} })).toBe(false)
    for (const key of ['release', 'retainsState', 'programFormat', 'resolve', 'run']) {
      const partial: Record<string, unknown> = { ...runtime() }; delete partial[key]
      expect(compatiblePtcRuntime(partial), key).toBe(false)
    }
    expect(compatiblePtcRuntime({ ...runtime(), language: 'unsupported' })).toBe(false)
    expect(compatiblePtcRuntime(null)).toBe(false)
  })

  it('imports nothing on old tools even when the old named runtime exists', async () => {
    const h = host({ oldTools: true })
    try {
      await h.provide({ language: 'typescript', resolve() {}, run() {} } as never)
      await h.load()
      expect(h.importer).not.toHaveBeenCalled()
      expect(h.mounted).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('the actual legacy tools and runtime service never import the unavailable new executor', async () => {
    const ctx = new Context(), imports: string[] = []
    // The real PTC runtime loads a native addon; its loader caches binaries under os.tmpdir() and never removes them,
    // which the verify gate reports as temp residue. Cache in a directory this test owns (removed after the file).
    const previousCache = process.env.NARB_NATIVE_CACHE_DIR
    process.env.NARB_NATIVE_CACHE_DIR = mkdtempSync(join(tmpdir(), 'ptc-native-cache-'))
    onTestFinished(() => { if (previousCache === undefined) delete process.env.NARB_NATIVE_CACHE_DIR; else process.env.NARB_NATIVE_CACHE_DIR = previousCache })
    const requireTools = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'))
    const { PtcRuntime } = await import(pathToFileURL(requireTools.resolve('@deepseek-ai/dsh-ptc-runtime')).href)
    class LegacyRuntime extends PtcRuntime {
      language = 'typescript'; isolation = 'test'
      resolve(request: unknown) { return request }
      async run() { return { logs: [], value: null } }
    }
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LegacyRuntime)
      const loader = new Loader(ctx)
      loader.internal = { import: async (id: string) => { imports.push(id); throw Error('new executor must not be resolved by this legacy host') } } as never
      expect(typeof (ctx.get('tools') as unknown as { setExecutor?: unknown }).setExecutor).toBe('undefined')
      expect(compatiblePtcRuntime(ctx.get('ptcRuntime'))).toBe(false)
      await ctx.plugin({ name, inject, apply })
      expect(imports).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('leaves native execution alone while the runtime remains absent', async () => {
    const h = host()
    try {
      await h.load()
      await flush()
      expect(h.importer).toHaveBeenCalledExactlyOnceWith('@deepseek-ai/dsh-tool-executor-ptc')
      expect(h.mounted).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it.each(['ready', 'late'])('mounts once for a compatible %s provider', async timing => {
    const h = host()
    try {
      if (timing === 'ready') await h.provide()
      await h.load()
      if (timing === 'late') await h.provide()
      await vi.waitFor(() => expect(h.mounted).toHaveBeenCalledTimes(1))
      expect(h.importer).toHaveBeenCalledTimes(1)
    } finally { await h.ctx.fiber.dispose() }
    expect(h.removed).toHaveBeenCalledTimes(1)
  })

  it('releases the selected executor before replacement and unmounts with its scope', async () => {
    const h = host()
    try {
      const owner = await h.provide()
      const entry = await h.load()
      expect(h.mounted).toHaveBeenCalledTimes(1)
      await owner.dispose()
      expect(h.removed).toHaveBeenCalledTimes(1)
      await h.provide()
      await vi.waitFor(() => expect(h.mounted).toHaveBeenCalledTimes(2))
      await entry.dispose()
      expect(h.removed).toHaveBeenCalledTimes(2)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('does not mount the split executor against an incompatible runtime on newer tools', async () => {
    const h = host()
    try {
      await h.provide({ language: 'typescript', resolve() {}, run() {} } as never)
      await h.load()
      expect(h.mounted).not.toHaveBeenCalled()
      expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('incompatible PTC runtime'))
    } finally { await h.ctx.fiber.dispose() }
  })

  it('an absent optional package is native fallback, not an install request', async () => {
    const h = host({ imported: async () => { throw Object.assign(new Error("Cannot find package '@deepseek-ai/dsh-tool-executor-ptc' imported from fixture"), { code: 'ERR_MODULE_NOT_FOUND' }) } })
    try {
      await h.provide()
      await h.load()
      expect(h.mounted).not.toHaveBeenCalled()
      expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('no split PTC executor'))
    } finally { await h.ctx.fiber.dispose() }
  })

  it('does not swallow a missing transitive dependency or a broken executor import', async () => {
    for (const error of [Object.assign(new Error("Cannot find package 'a-transitive-dependency' imported from executor"), { code: 'ERR_MODULE_NOT_FOUND' }), new Error('executor syntax failure')]) {
      const h = host({ imported: async () => { throw error } })
      try {
        await expect(h.load()).rejects.toThrow(error.message)
        expect(h.warn).not.toHaveBeenCalled()
      } finally { await h.ctx.fiber.dispose() }
    }
  })

  it('a profile compatibility denial prevents importing or mounting the executor', async () => {
    const preflight = vi.fn(() => [{ disabled: true }])
    const h = host({ imported: async () => ({ prepareProfileEntries: preflight }) })
    try {
      h.ctx.provide('profileContext', { dir: 'test-only-profile' } as never)
      await h.provide()
      await h.load()
      expect(preflight).toHaveBeenCalledTimes(1)
      expect(h.importer.mock.calls.map(call => call[0])).toEqual(['@deepseek-ai/dsh-app-boot'])
      expect(h.mounted).not.toHaveBeenCalled()
      expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('compatibility policy denied'))
    } finally { await h.ctx.fiber.dispose() }
  })

  it('an admitted profile resolves and mounts the executor after the host preflight', async () => {
    const preflight = vi.fn((_ctx, rows) => rows), selected = vi.fn()
    const importer = vi.fn(async (id: string) => id === '@deepseek-ai/dsh-app-boot'
      ? { prepareProfileEntries: preflight }
      : { apply() { selected() } })
    const h = host({ imported: importer as never })
    try {
      h.ctx.provide('profileContext', { dir: 'test-only-profile' } as never)
      await h.provide()
      await h.load()
      expect(preflight).toHaveBeenCalledTimes(1)
      expect(importer.mock.calls.map(call => call[0])).toEqual(['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-tool-executor-ptc'])
      expect(selected).toHaveBeenCalledTimes(1)
    } finally { await h.ctx.fiber.dispose() }
  })

  it('a malformed executor module is a visible activation failure, not native compatibility fallback', async () => {
    const h = host({ imported: async () => ({}) })
    try {
      await h.provide()
      await expect(h.load()).rejects.toThrow('incompatible split PTC executor module')
      expect(h.warn).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })

  it('a disposed entry cannot mount after its import settles', async () => {
    let resolve!: (value: unknown) => void
    const delayed = new Promise<unknown>(done => { resolve = done })
    const h = host({ imported: () => delayed })
    try {
      await h.provide()
      const loading = h.load()
      await vi.waitFor(() => expect(h.importer).toHaveBeenCalledTimes(1))
      const disposed = loading.dispose()
      resolve({ apply() { h.mounted() } })
      await disposed
      await loading
      expect(h.mounted).not.toHaveBeenCalled()
    } finally { await h.ctx.fiber.dispose() }
  })
})
