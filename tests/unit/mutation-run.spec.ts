import { describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { mkdtempSync as tempDir } from '../temp-dirs.ts'
import { account, IntegrityError, parseSpec, replaceOccurrence, UsageError } from '../../scripts/mutation-run.mjs'

const mkdtempSync = (prefix: string) => tempDir(join(tmpdir(), prefix))
const RUNNER = fileURLToPath(new URL('../../scripts/mutation-run.mjs', import.meta.url))
// A fake test command: each test file holds directive lines, so no test framework runs inside these tests.
//   contains <file> <text>          fail unless <file> contains <text>
//   endswith <file> <text>          fail unless <file> ends with <text>
//   sleepif <file> <text> <ms>      sleep when <file> contains <text>
//   touchif <file> <text> <target>  overwrite <target> when <file> contains <text>
//   pidfileif <file> <text> <path>  write this process's pid to <path> (outside the repository) when <file> contains <text>
//   ignoretermif <file> <text>      ignore SIGTERM when <file> contains <text> (a test process that does not stop politely)
const CHECK = `import { readFileSync, writeFileSync } from 'node:fs'
let bad = 0
for (const f of process.argv.slice(2)) for (const l of readFileSync(f, 'utf8').split('\\n')) {
  const c = l.match(/^contains (\\S+) (.*)$/); if (c && !readFileSync(c[1], 'utf8').includes(c[2])) bad++
  const e = l.match(/^endswith (\\S+) (.*)$/); if (e && !readFileSync(e[1], 'utf8').trimEnd().endsWith(e[2])) bad++
  const s = l.match(/^sleepif (\\S+) (\\S+) (\\d+)$/); if (s && readFileSync(s[1], 'utf8').includes(s[2])) await new Promise(r => setTimeout(r, Number(s[3])))
  const t = l.match(/^touchif (\\S+) (\\S+) (\\S+)$/); if (t && readFileSync(t[1], 'utf8').includes(t[2])) writeFileSync(t[3], 'touched\\n')
  const p = l.match(/^pidfileif (\\S+) (\\S+) (\\S+)$/); if (p && readFileSync(p[1], 'utf8').includes(p[2])) writeFileSync(p[3], String(process.pid))
  const q = l.match(/^ignoretermif (\\S+) (\\S+)$/); if (q && readFileSync(q[1], 'utf8').includes(q[2])) process.on('SIGTERM', () => {})
}
process.exit(bad ? 1 : 0)
`
// A wrapper like pnpm or npx: the real test process is its child, the runner's grandchild.
const WRAP = "import { spawnSync } from 'node:child_process'\nconst r = spawnSync(process.execPath, ['check.mjs', ...process.argv.slice(2)], { stdio: 'inherit' })\nprocess.exit(r.status ?? 1)\n"
const LIB = 'export const LIMIT = 3\nexport const NAME = \'alpha\'\nexport const TWIN = 1\nexport const TWIN = 1\n'

const g = (repo: string, ...args: string[]) => {
  const r = spawnSync('git', ['-C', repo, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw Error(r.stderr)
  return r.stdout
}
function fixture(files: Record<string, string> = {}) {
  const repo = mkdtempSync('mutation-run-repo-')
  const all: Record<string, string> = { 'check.mjs': CHECK, 'wrap.mjs': WRAP, 'src/lib.js': LIB, '.gitignore': 'logs/\n', 'tests/strong.t': 'contains src/lib.js LIMIT = 3\ncontains src/lib.js NAME = \'alpha\'\n', 'tests/weak.t': 'contains src/lib.js NAME\n', ...files }
  g(repo, 'init', '-q')
  for (const [p, text] of Object.entries(all)) { mkdirSync(join(repo, p, '..'), { recursive: true }); writeFileSync(join(repo, p), text) }
  g(repo, 'add', '-A'); g(repo, 'commit', '-q', '-m', 'fixture')
  return repo
}
const base = { version: 1, command: [process.execPath, 'check.mjs'] }
function cli(repo: string, s: unknown, extra: string[] = []) {
  const specPath = join(mkdtempSync('mutation-run-spec-'), 'spec.json'), out = mkdtempSync('mutation-run-out-')
  writeFileSync(specPath, JSON.stringify(s))
  const r = spawnSync(process.execPath, [RUNNER, specPath, '--root', repo, '--out', out, '--json', ...extra], { encoding: 'utf8' })
  const last = r.stdout.trim().split('\n').pop() ?? ''
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, out, json: last.startsWith('{') ? JSON.parse(last) : undefined }
}
const clean = (repo: string) => g(repo, 'status', '--porcelain', '--untracked-files=all')
const lib = (repo: string) => readFileSync(join(repo, 'src/lib.js'), 'utf8')
const T = 30_000
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const gone = async (pid: number) => { const until = Date.now() + 5000; while (alive(pid) && Date.now() < until) await new Promise(r => setTimeout(r, 50)); return !alive(pid) }

describe('mutation-run: results', () => {
  it('reports a killed mutation and an expected survivor, runs every one, and leaves the tree clean', () => {
    const repo = fixture()
    const r = cli(repo, { ...base, narrow: ['tests/strong.t'], mutations: [
      { id: 'K', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' },
      { id: 'S', file: 'src/lib.js', find: 'TWIN = 1', replace: 'TWIN = 2', occurrence: 1, expect: 'survived' },
    ] })
    expect(r.code, r.stderr).toBe(0)
    expect(r.json.results.map((x: { id: string; verdict: string }) => [x.id, x.verdict])).toEqual([['K', 'killed'], ['S', 'survived']])
    expect([r.json.ran, r.json.defined]).toEqual([2, 2])
    expect(clean(repo)).toBe('')
    expect(lib(repo)).toBe(LIB)
  }, T)

  it('exits 1 when a mutation survives that should have been killed', () => {
    const repo = fixture()
    const r = cli(repo, { ...base, narrow: ['tests/weak.t'], mutations: [{ id: 'M', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' }] })
    expect(r.code).toBe(1)
    expect(r.json.results[0]).toMatchObject({ verdict: 'survived', asExpected: false })
    expect(clean(repo)).toBe('')
  }, T)

  it('runs the wide tests only for a narrow survivor', () => {
    const repo = fixture()
    const r = cli(repo, { ...base, narrow: ['tests/weak.t'], wide: ['tests/strong.t'], mutations: [
      { id: 'byWide', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' },
      { id: 'byNarrow', file: 'src/lib.js', find: 'NAME', replace: 'NOM' },
    ] })
    expect(r.code, r.stderr).toBe(0)
    expect(r.json.results.map((x: { narrow: string; wide: string | null }) => [x.narrow, x.wide])).toEqual([['GREEN', 'RED'], ['RED', null]])
  }, T)

  it('calls a mutation only the wide tests catch killed-by-wide, and does not ask the old tests about it', () => {
    const repo = fixture()
    const old = g(repo, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(repo, 'tests/weak.t'), 'contains src/lib.js NAME\n# new comment\n')
    g(repo, 'commit', '-q', '-am', 'new tests')
    const r = cli(repo, { ...base, narrow: ['tests/weak.t'], wide: ['tests/strong.t'], oldTests: { rev: old, files: ['tests/weak.t'] }, mutations: [{ id: 'W1', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' }] })
    expect(r.code, r.stderr).toBe(0)
    expect(r.json.results[0]).toMatchObject({ narrow: 'GREEN', wide: 'RED', old: null, verdict: 'killed-by-wide', asExpected: true })
    expect(r.stdout).toContain('killed, only by the wide tests')
    expect(existsSync(join(r.out, 'W1.old.log'))).toBe(false)
  }, T)

  it('tells a mutation only the new tests catch from one the old tests catch too, and restores the test files', () => {
    const repo = fixture()
    const old = g(repo, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(repo, 'tests/weak.t'), 'contains src/lib.js NAME\ncontains src/lib.js LIMIT = 3\n')
    g(repo, 'commit', '-q', '-am', 'new tests')
    const r = cli(repo, { ...base, narrow: ['tests/weak.t'], oldTests: { rev: old, files: ['tests/weak.t'] }, mutations: [
      { id: 'new', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' },
      { id: 'both', file: 'src/lib.js', find: 'NAME', replace: 'NOM' },
    ] })
    expect(r.code, r.stderr).toBe(0)
    expect(r.json.results.map((x: { verdict: string }) => x.verdict)).toEqual(['only-new-kills', 'old-also-kills'])
    expect(r.stdout).toContain('killed, only by the new tests')
    expect(clean(repo)).toBe('')
  }, T)
})

describe('mutation-run: refusals change nothing', () => {
  it.each([
    ['an anchor that is not found', { id: 'A', file: 'src/lib.js', find: 'LIMIT = 9', replace: 'x' }, '0 time'],
    ['an anchor found twice', { id: 'A', file: 'src/lib.js', find: 'TWIN = 1', replace: 'x' }, '2 time'],
    ['an occurrence beyond the hits', { id: 'A', file: 'src/lib.js', find: 'TWIN = 1', replace: 'x', occurrence: 3 }, 'at least 3'],
    ['a path outside the repository', { id: 'A', file: '../lib.js', find: 'x', replace: 'y' }, 'leaves the repository'],
  ])('refuses %s with exit 2', (_name, mutation, message) => {
    const repo = fixture()
    const r = cli(repo, { ...base, narrow: ['tests/strong.t'], mutations: [{ id: 'ok', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' }, mutation] })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain(message)
    expect(lib(repo)).toBe(LIB)
    expect(clean(repo)).toBe('')
  }, T)

  it('refuses a dirty working tree and names the file', () => {
    const repo = fixture()
    writeFileSync(join(repo, 'stray.txt'), 'x\n')
    const r = cli(repo, { ...base, narrow: ['tests/strong.t'], mutations: [{ id: 'K', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' }] })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('stray.txt')
    expect(lib(repo)).toBe(LIB)
  }, T)

  it('refuses when the narrow tests are red before any change', () => {
    const repo = fixture({ 'tests/red.t': 'contains src/lib.js NOPE\n' })
    const r = cli(repo, { ...base, narrow: ['tests/red.t'], mutations: [{ id: 'K', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' }] })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('baseline')
    expect(clean(repo)).toBe('')
  }, T)

  it('refuses a spec it cannot read as written', () => {
    expect(() => parseSpec('{')).toThrow(UsageError)
    expect(() => parseSpec({ ...base, narrow: ['t'], mutations: [{ id: 'a', file: 'f', find: 'x', replace: 'x' }] })).toThrow(/nothing would change/)
    expect(() => parseSpec({ ...base, narrow: ['t'], mutations: [{ id: 'a', file: 'f', find: 'x', replace: 'y' }, { id: 'a', file: 'f', find: 'z', replace: 'y' }] })).toThrow(/duplicate/)
    expect(() => parseSpec({ ...base, command: 'node check.mjs', narrow: ['t'], mutations: [{ id: 'a', file: 'f', find: 'x', replace: 'y' }] })).toThrow(/no shell/)
  })
})

describe('mutation-run: occurrence', () => {
  it('replaces only the named occurrence', () => {
    expect(replaceOccurrence('a b a b a', 'a', 'X', 2)).toBe('a b X b a')
    expect(replaceOccurrence('a b a', 'a', 'X', 3)).toBeUndefined()
    // The last line is the second TWIN: changing occurrence 2 breaks this test, changing occurrence 1 does not.
    const repo = fixture({ 'tests/last.t': 'endswith src/lib.js TWIN = 1\n' })
    const r = cli(repo, { ...base, narrow: ['tests/last.t'], mutations: [
      { id: 'second', file: 'src/lib.js', find: 'TWIN = 1', replace: 'TWIN = 2', occurrence: 2 },
      { id: 'first', file: 'src/lib.js', find: 'TWIN = 1', replace: 'TWIN = 2', occurrence: 1, expect: 'survived' },
    ] })
    expect(r.code, r.stderr).toBe(0)
    expect(r.json.results.map((x: { verdict: string }) => x.verdict)).toEqual(['killed', 'survived'])
    expect(lib(repo)).toBe(LIB)
  }, T)
})

describe('mutation-run: restore and accounting', () => {
  it('exits 3 when a test run dirties a tracked file, and still restores what it changed', () => {
    const repo = fixture({ 'tests/toucher.t': 'touchif src/lib.js LIMIT_X tests/weak.t\ncontains src/lib.js NAME\n' })
    const r = cli(repo, { ...base, narrow: ['tests/toucher.t'], mutations: [{ id: 'T', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT_X = 3' }, { id: 'next', file: 'src/lib.js', find: 'NAME', replace: 'NOM' }] })
    expect(r.code).toBe(3)
    expect(r.stderr).toContain('after T the tree is not clean')
    expect(r.stderr).toContain('tests/weak.t')
    // The next mutation never ran on the dirty tree.
    expect(existsSync(join(r.out, 'next.narrow.log'))).toBe(false)
    expect(lib(repo)).toBe(LIB)
  }, T)

  it.each(['SIGTERM', 'SIGHUP'] as const)('on %s mid-run stops the test and what it started, restores the file and exits 130', async (signal) => {
    const pidDir = mkdtempSync('mutation-run-pid-'), pidFile = join(pidDir, 'pid')
    // The test process ignores SIGTERM, so only the runner's SIGKILL of the group, sent as it finishes, can stop it.
    const repo = fixture({ 'tests/slow.t': `ignoretermif src/lib.js SLOW\npidfileif src/lib.js SLOW ${pidFile}\nsleepif src/lib.js SLOW 20000\ncontains src/lib.js NAME\n` })
    const dir = mkdtempSync('mutation-run-spec-'), out = mkdtempSync('mutation-run-out-')
    writeFileSync(join(dir, 'spec.json'), JSON.stringify({ ...base, command: [process.execPath, 'wrap.mjs'], narrow: ['tests/slow.t'], mutations: [{ id: 'slow', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'SLOW = 3' }, { id: 'never', file: 'src/lib.js', find: 'NAME', replace: 'NOM' }] }))
    const child = spawn(process.execPath, [RUNNER, join(dir, 'spec.json'), '--root', repo, '--out', out, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (b: Buffer) => { stdout += String(b) })
    const exited = new Promise<number | null>(done => child.on('close', code => done(code)))
    const until = Date.now() + 15_000
    // Wait until the mutated run's test process (the runner's grandchild, under wrap.mjs) has written its pid.
    while (!(existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '') && Date.now() < until) await new Promise(r => setTimeout(r, 50))
    expect(lib(repo)).toContain('SLOW')
    const grandchild = Number(readFileSync(pidFile, 'utf8'))
    expect(alive(grandchild)).toBe(true)
    const sent = Date.now()
    child.kill(signal)
    expect(await exited).toBe(130)
    // Stopped promptly, not after the 20 s sleep, and the wrapped test process is gone too.
    expect(Date.now() - sent).toBeLessThan(5000)
    expect(await gone(grandchild)).toBe(true)
    expect(lib(repo)).toBe(LIB)
    expect(clean(repo)).toBe('')
    expect(JSON.parse(stdout.trim().split('\n').pop()!).ran).toBe(0)
  }, T)

  it('with timeoutMs, a test run that hangs is stopped and the mutation counts as killed, marked timeout', () => {
    const repo = fixture({ 'tests/slow.t': 'sleepif src/lib.js SLOW 20000\ncontains src/lib.js NAME\n' })
    const started = Date.now()
    const r = cli(repo, { ...base, timeoutMs: 1500, narrow: ['tests/slow.t'], mutations: [{ id: 'hang', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'SLOW = 3' }] })
    expect(r.code, r.stderr).toBe(0)
    expect(r.json.results[0]).toMatchObject({ narrow: 'RED', verdict: 'killed', timedOut: true })
    expect(r.stdout).toContain('(timeout)')
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(lib(repo)).toBe(LIB)
    expect(() => parseSpec({ ...base, timeoutMs: 0, narrow: ['t'], mutations: [{ id: 'a', file: 'f', find: 'x', replace: 'y' }] })).toThrow(/timeoutMs/)
  }, T)

  it('refuses a tracked symbolic link as a mutation target, so a change can never be left outside the repository', () => {
    const outside = join(mkdtempSync('mutation-run-outside-'), 'lib.js')
    writeFileSync(outside, LIB)
    const repo = fixture()
    symlinkSync(outside, join(repo, 'src/link.js'))
    g(repo, 'add', 'src/link.js'); g(repo, 'commit', '-q', '-m', 'link')
    const r = cli(repo, { ...base, narrow: ['tests/strong.t'], mutations: [{ id: 'L', file: 'src/link.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' }] })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('symbolic link')
    expect(readFileSync(outside, 'utf8')).toBe(LIB)
  }, T)

  it('after a timeout, the group gets SIGKILL after the grace period even though the direct child already exited', async () => {
    // wrap.mjs dies on SIGTERM; the test process under it ignores SIGTERM. The runner's next mutation keeps it busy past the
    // grace period, so the test process must be killed by the grace timer, while the runner is still running.
    const pidDir = mkdtempSync('mutation-run-pid-'), pidFile = join(pidDir, 'pid')
    const repo = fixture({ 'tests/slow.t': `ignoretermif src/lib.js SLOW\npidfileif src/lib.js SLOW ${pidFile}\nsleepif src/lib.js SLOW 60000\nsleepif src/lib.js BUSY 9000\ncontains src/lib.js NAME\n` })
    const dir = mkdtempSync('mutation-run-spec-'), out = mkdtempSync('mutation-run-out-')
    writeFileSync(join(dir, 'spec.json'), JSON.stringify({ ...base, command: [process.execPath, 'wrap.mjs'], timeoutMs: 3000, narrow: ['tests/slow.t'], mutations: [
      { id: 'hang', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'SLOW = 3' },
      // Each busy run is stopped by the 3 s timeout too, so three of them keep the runner going well past the 5 s grace.
      { id: 'busy1', file: 'src/lib.js', find: 'TWIN = 1', replace: 'BUSY = 1', occurrence: 1 },
      { id: 'busy2', file: 'src/lib.js', find: 'TWIN = 1', replace: 'BUSY = 1', occurrence: 2 },
      { id: 'busy3', file: 'src/lib.js', find: "NAME = 'alpha'", replace: "NAME = 'BUSY'" },
    ] }))
    const child = spawn(process.execPath, [RUNNER, join(dir, 'spec.json'), '--root', repo, '--out', out, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const exited = new Promise<number | null>(done => child.on('close', code => done(code)))
    let grandchild = 0
    try {
      let until = Date.now() + 15_000
      while (!(existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '') && Date.now() < until) await new Promise(r => setTimeout(r, 50))
      grandchild = Number(readFileSync(pidFile, 'utf8'))
      until = Date.now() + 15_000
      while (alive(grandchild) && Date.now() < until) await new Promise(r => setTimeout(r, 50))
      expect(alive(grandchild)).toBe(false)
      expect(child.exitCode, 'killed by the grace timer, not only when the runner finished').toBeNull()
      expect(await exited).toBe(0)
      expect(lib(repo)).toBe(LIB)
    } finally {
      if (grandchild && alive(grandchild)) process.kill(grandchild, 'SIGKILL')
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }, 45_000)

  it('a fast test run with a long timeoutMs finishes without waiting for the timeout', () => {
    const repo = fixture()
    const started = Date.now()
    const r = cli(repo, { ...base, timeoutMs: 25_000, narrow: ['tests/strong.t'], mutations: [{ id: 'K', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' }] })
    expect(r.code, r.stderr).toBe(0)
    expect(r.json.results[0]).toMatchObject({ verdict: 'killed', timedOut: false })
    expect(Date.now() - started).toBeLessThan(15_000)
  }, 45_000)

  it('refuses a tracked symbolic link among the oldTests files too', () => {
    const outside = join(mkdtempSync('mutation-run-outside-'), 'old.t')
    writeFileSync(outside, 'contains src/lib.js NAME\n')
    const repo = fixture()
    symlinkSync(outside, join(repo, 'tests/link.t'))
    g(repo, 'add', 'tests/link.t'); g(repo, 'commit', '-q', '-m', 'link')
    const head = g(repo, 'rev-parse', 'HEAD').trim()
    const r = cli(repo, { ...base, narrow: ['tests/strong.t'], oldTests: { rev: head, files: ['tests/link.t'] }, mutations: [{ id: 'K', file: 'src/lib.js', find: 'LIMIT = 3', replace: 'LIMIT = 4' }] })
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('tests/link.t is a symbolic link')
    expect(lib(repo)).toBe(LIB)
  }, T)

  it('account() throws unless the counts match', () => {
    expect(() => account('mutations', 3, 2)).toThrow(IntegrityError)
    expect(() => account('mutations', 3, 3)).not.toThrow()
  })
})

describe('mutation-run: probes', () => {
  it('runs a probe copy of a test file once, reports pass or fail, and deletes it', () => {
    const repo = fixture()
    const r = cli(repo, { ...base, narrow: ['tests/strong.t'], probes: [
      { id: 'holds', from: 'tests/weak.t', append: 'contains src/lib.js LIMIT = 3', expect: 'pass' },
      { id: 'breaks', from: 'tests/weak.t', append: 'contains src/lib.js LIMIT = 4', expect: 'fail' },
    ] })
    expect(r.code, r.stderr).toBe(0)
    expect(r.json.probes.map((p: { id: string; result: string }) => [p.id, p.result])).toEqual([['holds', 'pass'], ['breaks', 'fail']])
    expect(existsSync(join(repo, 'tests/zz-probe-holds.t'))).toBe(false)
    expect(clean(repo)).toBe('')
  }, T)

  it('exits 1 when a probe does not do what its expect says', () => {
    const repo = fixture()
    const r = cli(repo, { ...base, narrow: ['tests/strong.t'], probes: [{ id: 'wrong', from: 'tests/weak.t', append: 'contains src/lib.js LIMIT = 4', expect: 'pass' }] })
    expect(r.code).toBe(1)
    expect(r.json.probes[0]).toMatchObject({ result: 'fail', asExpected: false })
    expect(r.stdout).toContain('(expected pass)')
    expect(clean(repo)).toBe('')
  }, T)
})
