/**
 * Built-artifact guard: the host transport module and the browser loader
 * bundle have different output paths. The DSH client export reserves
 * `lib/client.js`, so the host package root must import `lib/a2a-client.js`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)

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

    const host = await import(pathToFileURL(fileURLToPath(artifact('lib/index.js'))).href)
    expect(host.A2aClient).toBeTypeOf('function')
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
