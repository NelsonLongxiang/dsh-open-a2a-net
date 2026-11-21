/**
 * Built-artifact guard: the host transport module and the browser loader
 * bundle have different output paths. The DSH client export reserves
 * `lib/client.js`, so the host package root must import `lib/a2a-client.js`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

/** Resolve one generated artifact relative to the package root. */
function artifact(path: string): URL {
  return new URL(path, root)
}

describe('built package layout', () => {
  it('keeps the host A2aClient separate from the browser client bundle', async () => {
    const manifest = JSON.parse(await readFile(artifact('package.json'), 'utf8')) as {
      exports: { './client': { default: string } }
    }
    expect(manifest.exports['./client'].default).toBe('./lib/client.js')

    const browserBundle = await readFile(artifact('lib/client.js'), 'utf8')
    expect(browserBundle).toContain('window.__ModuleLoader__.load')

    await expect(readFile(artifact('lib/a2a-client.js'), 'utf8')).resolves.toContain('export class A2aClient')

    // The delivery is compiled ESM. Import it with Node, not Vitest's source transformer and SSR cache.
    const inspect = "const host = await import('./lib/index.js'); console.log('[host-layout] ' + JSON.stringify({ A2aClient: typeof host.A2aClient }))"
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e', inspect], {
      cwd: fileURLToPath(root), env: process.env, encoding: 'utf8', timeout: 4000,
    })
    expect(imported.error).toBeUndefined()
    expect(imported.signal).toBeNull()
    expect(imported.status, imported.stderr).toBe(0)
    const lines = imported.stdout.split(/\r?\n/).filter(line => line.startsWith('[host-layout] '))
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!.slice('[host-layout] '.length)).A2aClient).toBe('function')
  })

  it('exports the optional PTC preset entry as built code and declarations', async () => {
    const manifest = JSON.parse(await readFile(artifact('package.json'), 'utf8'))
    expect(manifest.exports['./superagent-ptc']).toEqual({ types: './lib/types/superagent/ptc.d.ts', default: './lib/superagent/ptc.js' })
    const entry = await import(pathToFileURL(fileURLToPath(artifact(manifest.exports['./superagent-ptc'].default))).href)
    expect(entry.apply).toBeTypeOf('function')
    expect(entry.inject).toEqual(['tools', 'systemPrompt', 'loader'])
    await expect(readFile(artifact(manifest.exports['./superagent-ptc'].types), 'utf8')).resolves.toContain('compatiblePtcRuntime')
  })

  it('ships a compiled artifact for every host source module', async () => {
    // The pack file list is `lib` wholesale, so a module missing its build
    // output would ship as a broken import. The guard walks the host tree
    // (`src/client` bundles separately; `css-modules.d.ts` declares no
    // runtime) and demands both shapes of each artifact.
    const sources = (await readdir(artifact('src'), { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'css-modules.d.ts')
      .map(entry => entry.name.replace(/\.ts$/, ''))
    expect(sources.length).toBeGreaterThan(0)
    const compiled = new Set(await readdir(artifact('lib')))
    const declared = new Set(await readdir(artifact('lib/types')))
    for (const name of sources) {
      expect(compiled.has(`${name}.js`)).toBe(true)
      expect(declared.has(`${name}.d.ts`)).toBe(true)
    }
  })

  it('serves the nexus stage shell whose hashed bundle exists with no orphans', async () => {
    // The nexus subpackage ships as a committed dist tree (PR #18 hold, PR #25
    // transport). This guard keeps it honest: the shell's module reference
    // must resolve on disk, and every hashed bundle in assets/ must be the
    // one the current shell references - a half-rebuilt tree leaves stale
    // doubles that silently serve old code.
    const shell = await readFile(artifact('assets/nexusDist/index.html'), 'utf8')
    const referenced = [...shell.matchAll(/assets\/(index-[\w-]+\.js)/g)].map(m => m[1] as string)
    expect(referenced.length).toBeGreaterThan(0)
    const present = (await readdir(artifact('assets/nexusDist/assets')))
      .filter(name => name.endsWith('.js'))
    for (const name of referenced) expect(present, `missing ${name}`).toContain(name)
    expect(present.slice().sort()).toEqual(referenced.slice().sort())
  })
})
