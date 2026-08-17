/**
 * Built-artifact guard: the host transport module and the browser loader
 * bundle have different output paths. The DSH client export reserves
 * `lib/client.js`, so the host package root must import `lib/a2a-client.js`.
 */
import { readFile } from 'node:fs/promises'
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
})
