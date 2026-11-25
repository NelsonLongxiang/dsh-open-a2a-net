// @vitest-environment node
/** #900: on Windows the team presets run ygl-trees with this node directly, so no console window opens per team session. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { YGL_BIN_ENV, exportYglBin, resolveYglBin } from '../../src/superagent/host/ygl-home.ts'

const requireLoader = createRequire(import.meta.resolve('@deepseek-ai/cordis-plugin-loader'))
const { load } = requireLoader('js-yaml')
const { entryListSchema, applyEntryPatches } = requireLoader('@deepseek-ai/cordis-plugin-include')
interface Row { id: string; name: string; config?: Record<string, any> }

/** A file system of exactly these files. */
const files = (map: Record<string, string>) => ({ exists: (p: string) => resolve(p) in map, read: (p: string) => { const t = map[resolve(p)]; if (t === undefined) throw Error('ENOENT'); return t } })

describe('resolveYglBin', () => {
  const pkg = JSON.stringify({ name: 'ygl-trees', bin: { 'ygl-trees': 'dist/bundle/bin.cjs' } })

  it('finds the entry script beside the ygl-trees shim on PATH (npm global prefix)', () => {
    const fs = files({ [resolve('/npm/ygl-trees.cmd')]: '', [resolve('/npm/node_modules/ygl-trees/package.json')]: pkg, [resolve('/npm/node_modules/ygl-trees/dist/bundle/bin.cjs')]: '' })
    expect(resolveYglBin({ PATH: ['/elsewhere', '/npm'].join(delimiter) }, '/node/node', fs)).toBe(resolve('/npm/node_modules/ygl-trees/dist/bundle/bin.cjs'))
  })

  it('falls back to the prefix beside this node and to npm\'s default Windows prefix; a string bin works too', () => {
    const beside = files({ [resolve('/node/node_modules/ygl-trees/package.json')]: pkg, [resolve('/node/node_modules/ygl-trees/dist/bundle/bin.cjs')]: '' })
    expect(resolveYglBin({ PATH: '' }, '/node/node.exe', beside)).toBe(resolve('/node/node_modules/ygl-trees/dist/bundle/bin.cjs'))
    const appdata = files({ [resolve('/appdata/npm/node_modules/ygl-trees/package.json')]: JSON.stringify({ bin: 'cli.js' }), [resolve('/appdata/npm/node_modules/ygl-trees/cli.js')]: '' })
    expect(resolveYglBin({ PATH: '', APPDATA: '/appdata' }, '/node/node.exe', appdata)).toBe(resolve('/appdata/npm/node_modules/ygl-trees/cli.js'))
  })

  it('the POSIX layout (<prefix>/bin beside <prefix>/lib/node_modules) resolves too', () => {
    const fs = files({ [resolve('/usr/local/bin/ygl-trees')]: '', [resolve('/usr/local/lib/node_modules/ygl-trees/package.json')]: pkg, [resolve('/usr/local/lib/node_modules/ygl-trees/dist/bundle/bin.cjs')]: '' })
    expect(resolveYglBin({ PATH: '/usr/local/bin' }, '/opt/node/bin/node', fs)).toBe(resolve('/usr/local/lib/node_modules/ygl-trees/dist/bundle/bin.cjs'))
  })

  it('a ygl-trees on PATH that links straight to the script is taken as is', () => {
    const fs = { ...files({ [resolve('/opt/ygl/bin.cjs')]: '' }), real: (p: string) => { if (resolve(p) === resolve('/home/o/.local/bin/ygl-trees')) return resolve('/opt/ygl/bin.cjs'); throw Error('ENOENT') } }
    expect(resolveYglBin({ PATH: ['/usr/bin', '/home/o/.local/bin'].join(delimiter) }, '/node/node', fs)).toBe(resolve('/opt/ygl/bin.cjs'))
  })

  it('answers undefined when nothing is installed, or the bin it names is missing', () => {
    expect(resolveYglBin({ PATH: '/a' }, '/node/node', files({}))).toBeUndefined()
    expect(resolveYglBin({ PATH: '' }, '/node/node', files({ [resolve('/node/node_modules/ygl-trees/package.json')]: pkg }))).toBeUndefined()
  })
})

describe('exportYglBin', () => {
  const platform = process.platform
  afterEach(() => { Object.defineProperty(process, 'platform', { value: platform }) })

  it('leaves every platform but Windows alone', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const env: NodeJS.ProcessEnv = { PATH: '' }
    expect(exportYglBin(env)).toBeUndefined()
    expect(env[YGL_BIN_ENV]).toBeUndefined()
  })

  it('on Windows keeps an owner-set value', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const env: NodeJS.ProcessEnv = { PATH: '', [YGL_BIN_ENV]: 'C:/own/bin.cjs' }
    expect(exportYglBin(env)).toBe('C:/own/bin.cjs')
  })
})

describe('the Windows ygl MCP row of every team preset', () => {
  const rows: Row[] = applyEntryPatches([], load(readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema }), (w: string) => { throw Error(w) })
  const presets = rows.filter(row => row.name === '@deepseek-ai/dsh-agent-preset' && row.config?.id !== 'superagent-builder')
  // The loader's own evaluator: `with (ctx) { return eval(expr) }` (cordis-plugin-loader config/utils).
  // eslint-disable-next-line no-new-func
  const evaluate = new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }') as (ctx: object, expr: string) => unknown
  const value = (node: unknown, ctx: object): unknown => node !== null && typeof node === 'object' && '__jsExpr' in node ? evaluate(ctx, (node as { __jsExpr: string }).__jsExpr) : node
  const winRow = (preset: Row) => (preset.config!.plugins as Row[]).find(p => p.id === 'mcp-ygl-win')!

  it('is in the router, member and observer presets', () => {
    expect(presets.map(p => p.config!.id)).toEqual(['superagent-router', 'superagent-member', 'superagent-observer'])
    for (const preset of presets) expect(winRow(preset)).toBeDefined()
  })

  it('with a resolved entry script: this node runs it directly, as node, under its own session name', () => {
    const ctx = { process: { execPath: 'C:\\nodejs\\node.exe', env: { SUPERAGENT_YGL_BIN: 'C:\\npm\\node_modules\\ygl-trees\\dist\\bundle\\bin.cjs', USERPROFILE: 'C:\\Users\\o' } } }
    for (const preset of presets) {
      const config = winRow(preset).config!
      expect(value(config.command, ctx)).toBe('C:\\nodejs\\node.exe')
      expect(value(config.args, ctx)).toEqual(['C:\\npm\\node_modules\\ygl-trees\\dist\\bundle\\bin.cjs', 'mcp'])
      expect(config.env.ELECTRON_RUN_AS_NODE).toBe('1')
      const a = value(config.env.YGL_SESSION, ctx), b = value(config.env.YGL_SESSION, ctx)
      expect(a).toMatch(/^superagent-[a-z0-9]+-[a-z0-9]+$/)
      expect(a).not.toBe(b)
      expect(value(config.env.YGL_HOME, ctx)).toBe('C:\\Users\\o/.ygl-trees-superagent')
    }
  })

  it('without one: the shell route exactly as before', () => {
    const ctx = { process: { execPath: 'C:\\nodejs\\node.exe', env: {} } }
    for (const preset of presets) {
      const config = winRow(preset).config!
      expect(value(config.command, ctx)).toBe('cmd')
      expect(value(config.args, ctx)).toEqual(['/d', '/s', '/c', 'set "YGL_SESSION=superagent-%RANDOM%%RANDOM%" && ygl-trees mcp'])
    }
  })

  it('the POSIX row is unchanged', () => {
    for (const preset of presets) {
      const posix = (preset.config!.plugins as Row[]).find(p => p.id === 'mcp-ygl')!.config!
      expect(posix.command).toBe('sh')
      expect(posix.args).toEqual(['-c', 'YGL_SESSION="superagent-$$" exec ygl-trees mcp'])
    }
  })
})

