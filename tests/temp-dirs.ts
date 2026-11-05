/** Own only paths returned by this file's allocator; never sweep by system-temp prefix. */
import { mkdtempSync as allocate, rmSync, lstatSync, existsSync } from 'node:fs'
import { mkdtemp as allocateAsync } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { afterAll } from 'vitest'
const owned = new Set<string>()
const resources: Array<() => Promise<unknown> | unknown> = []
/** Register before resource startup so a failed boot still closes before deleting its home. */
export function cleanupBeforeTempDirs(close: () => Promise<unknown> | unknown): void { resources.push(close) }
function remember(dir: string): string {
  const absolute = resolve(dir)
  if (!isAbsolute(dir)) throw Error('temporary allocator must return an absolute path')
  owned.add(absolute)
  return dir
}
function absolutePrefix(prefix: string): string {
  if (!isAbsolute(prefix)) throw Error('temporary prefix must be absolute')
  return prefix
}
export function mkdtempSync(prefix: string): string { return remember(allocate(absolutePrefix(prefix))) }
export async function mkdtemp(prefix: string): Promise<string> { return remember(await allocateAsync(absolutePrefix(prefix))) }
afterAll(async () => {
  // Teardown is file-scoped: several specs deliberately share a home across test cases.
  // Product fibers/children close in their own finally/afterEach hooks before this runs.
  const failures: string[] = []
  for (const close of resources.splice(0).reverse()) {
    try { await close() } catch (error) { failures.push('resource teardown: ' + String(error)) }
  }
  await new Promise<void>(r => setImmediate(r))
  for (const dir of [...owned].reverse()) {
    try {
      // rm does not follow symlink/junction entries; never traverse a substituted root.
      if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw Error('owned temp root replaced by link')
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
      owned.delete(dir)
    } catch (error) { failures.push(dir + ': ' + String(error)) }
  }
  if (failures.length) throw Error('temporary directory cleanup failed:\n' + failures.join('\n'))
}, 30_000)
