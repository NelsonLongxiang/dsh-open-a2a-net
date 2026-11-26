import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// #942: a console-less host on Windows (dsh web) gets a visible terminal window for every console
// program it spawns without `windowsHide`. One guard per host-side spawn site, so the option cannot
// be dropped silently.
const sites: Array<[file: string, callee: string]> = [
  ['src/superagent/host/a2a-source.ts', 'spawn(process.execPath, [CLI_PATH, ...args]'],
  ['src/superagent/host/pr-follow.ts', "execFile('gh', args,"],
  ['src/node-github.ts', "execFile('gh', ['api', path],"],
  ['src/superagent/host/executor.ts', "execFile('sh', ['-c', command],"],
  ['src/superagent/host/node-ops.ts', "execFileSync('tar', [flags, 'package.tgz'],"],
  ['src/superagent/host/node-ops.ts', "execFileSync('tar', ['-xzf', 'package.tgz'],"],
]

describe('host spawns hide their console window on Windows (#942)', () => {
  for (const [file, callee] of sites) {
    it(`${file}: ${callee} … passes windowsHide`, () => {
      const line = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n').find(text => text.includes(callee))
      expect(line, `${callee} not found in ${file}`).toBeTypeOf('string')
      expect(line).toMatch(/windowsHide:\s*true/)
    })
  }
})
