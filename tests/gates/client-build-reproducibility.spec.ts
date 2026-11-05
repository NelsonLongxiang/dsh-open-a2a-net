/** Real bundler regression: identical inputs at unrelated filesystem roots yield identical bytes. */
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
const exec = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const bundler = join(dirname(require.resolve('tsdown/package.json')), 'dist/run.mjs')
it('emits byte-identical browser JS and map across unrelated source roots', async () => {
  // Same-drive roots at different depths also expose relative dependency-store debug labels.
  await mkdir(join(root, 'tmp'), { recursive: true })
  const scratch = await mkdtemp(join(root, 'tmp', 'a2a-repro-build-'))
  const roots = [join(scratch, 'short'), join(scratch, 'unrelated directory with spaces', 'nested-project')]
  try {
    for (const dir of roots) {
      await mkdir(join(dir, 'lib'), { recursive: true })
      await cp(join(root, 'lib/client'), join(dir, 'lib/client'), { recursive: true })
      await cp(join(root, 'src/client'), join(dir, 'src/client'), { recursive: true })
      await cp(join(root, 'tsdown.config.ts'), join(dir, 'tsdown.config.ts'))
      await cp(join(root, 'package.json'), join(dir, 'package.json'))
      await writeFile(join(dir, 'tsconfig.json'), '{}')
      await symlink(join(root, 'node_modules'), join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
      await exec(process.execPath, [bundler], { cwd: dir, timeout: 30_000, maxBuffer: 2 << 20 })
    }
    for (const file of ['client.js', 'client.js.map']) {
      const a = await readFile(join(roots[0]!, 'lib', file)), b = await readFile(join(roots[1]!, 'lib', file))
      expect(a.equals(b), file + ' differs by build root').toBe(true)
      expect(a.toString()).not.toContain(scratch)
      expect(a.toString()).not.toContain(scratch.split('\\').join('/'))
    }
    const code = await readFile(join(roots[0]!, 'lib/client.js'), 'utf8')
    expect(code).not.toContain('//#region')
    expect(code).not.toContain('dsh-css:')
    const map = JSON.parse(await readFile(join(roots[0]!, 'lib/client.js.map'), 'utf8'))
    expect(map.sources).toContain('../node_modules/clsx/dist/clsx.mjs')
    for (const source of map.sources) expect(source).not.toMatch(/^[A-Za-z]:|^\/|\\/)
  } finally {
    // Explicitly unlink dependency junctions first: never recursively clean the shared toolchain.
    for (const dir of roots) await rm(join(dir, 'node_modules'), { force: true }).catch(() => {})
    await rm(scratch, { recursive: true, force: true })
  }
}, 60_000)
