#!/usr/bin/env node
/**
 * mutation-run: the reviewer's mutation runner. A review proves a test guards a line by changing the line and
 * watching a test turn red. Reviews did this with one-off scripts per pull request; this is the shared tool.
 *
 * Mutations are data (a JSON spec): file, the literal text to find, its replacement, and which occurrence. The runner
 *   - refuses a dirty working tree, checks every anchor before changing anything (exactly one hit unless an occurrence
 *     is named), and needs the narrow tests green first;
 *   - applies one mutation at a time, runs the narrow tests, runs the wide tests only for a survivor, and, when the
 *     spec names the tests as they were before the pull request, runs those too to tell "only the new tests catch it";
 *   - restores the file after each mutation (original bytes, then git checkout) and checks the tree is clean again;
 *   - can run probes: a copy of a test file with a case appended, run once on the unmutated tree, then deleted;
 *   - ends by asserting it ran as many mutations as the spec defines and the tree is clean.
 * A mutation the narrow tests miss and the wide tests catch is "killed-by-wide"; the old tests are not run for it. Each
 * test run has its own process group, so a stop (SIGINT, SIGTERM, SIGHUP, or spec.timeoutMs) reaches its children too.
 * It reads no environment switches, writes only the files the spec names (plus its logs in --out), never touches the
 * git index, and never commits or pushes. Exit: 0 every result as expected; 1 a mutation survived (or a probe or
 * mutation did not do what its "expect" says); 2 usage or preflight error, nothing changed; 3 restore or accounting
 * failure, look at the tree; 130 interrupted by SIGINT/SIGTERM, restored first.
 *
 * Usage: node scripts/mutation-run.mjs <spec.json> [--root DIR] [--out DIR] [--json]
 */
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const EXIT = Object.freeze({ ok: 0, survived: 1, usage: 2, integrity: 3, interrupted: 130 })
/** Something about the request is wrong; raised before anything was changed. */
export class UsageError extends Error {}
/** The runner could not keep its promises (restore, accounting); a person should look at the tree. */
export class IntegrityError extends Error {}

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.error || r.status !== 0) throw new UsageError(`git ${args.join(' ')} failed: ${String(r.stderr || r.error).trim()}`)
  return r.stdout
}
const gitOk = (root, args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).status === 0
/** Every changed, staged or untracked path, as git status --porcelain prints it. Ignored files do not count. */
export const dirtyLines = root => git(root, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean)

const str = v => typeof v === 'string' && v.length > 0
const strs = v => Array.isArray(v) && v.length > 0 && v.every(str)

/** Validate a spec (object or JSON text). Throws UsageError naming the first problem. */
export function parseSpec(raw) {
  let s
  try { s = typeof raw === 'string' ? JSON.parse(raw) : raw } catch (e) { throw new UsageError(`spec is not JSON: ${e.message}`) }
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new UsageError('spec must be a JSON object')
  if (s.version !== 1) throw new UsageError('spec.version must be 1')
  if (!strs(s.command)) throw new UsageError('spec.command must be a non-empty array of strings (no shell)')
  if (!strs(s.narrow)) throw new UsageError('spec.narrow must name at least one test path')
  if (s.wide !== undefined && !strs(s.wide)) throw new UsageError('spec.wide, when given, must name at least one test path')
  if (s.oldTests !== undefined && (!s.oldTests || !str(s.oldTests.rev) || !strs(s.oldTests.files))) throw new UsageError('spec.oldTests needs rev and files')
  if (s.timeoutMs !== undefined && !(Number.isSafeInteger(s.timeoutMs) && s.timeoutMs > 0)) throw new UsageError('spec.timeoutMs, when given, must be a whole number of milliseconds above 0')
  const mutations = s.mutations ?? [], probes = s.probes ?? []
  if (!Array.isArray(mutations) || !Array.isArray(probes)) throw new UsageError('spec.mutations and spec.probes must be arrays')
  if (mutations.length + probes.length === 0) throw new UsageError('spec defines no mutations and no probes')
  const ids = new Set()
  const fresh = id => { if (ids.has(id)) throw new UsageError(`duplicate id ${id}`); ids.add(id) }
  for (const m of mutations) {
    if (!m || !str(m.id) || !str(m.file) || !str(m.find) || typeof m.replace !== 'string') throw new UsageError(`mutation ${JSON.stringify(m?.id)} needs id, file, find and replace`)
    if (m.find === m.replace) throw new UsageError(`mutation ${m.id}: replace equals find, nothing would change`)
    if (m.occurrence !== undefined && !(Number.isSafeInteger(m.occurrence) && m.occurrence >= 1)) throw new UsageError(`mutation ${m.id}: occurrence must be a whole number from 1`)
    if (m.expect !== undefined && m.expect !== 'killed' && m.expect !== 'survived') throw new UsageError(`mutation ${m.id}: expect is killed or survived`)
    fresh(m.id)
  }
  for (const p of probes) {
    if (!p || !str(p.id) || !str(p.from) || typeof p.append !== 'string') throw new UsageError(`probe ${JSON.stringify(p?.id)} needs id, from and append`)
    if (!/^[A-Za-z0-9_.-]+$/.test(p.id)) throw new UsageError(`probe ${p.id}: id may only use letters, digits, _ . -`)
    if (p.expect !== undefined && p.expect !== 'pass' && p.expect !== 'fail') throw new UsageError(`probe ${p.id}: expect is pass or fail`)
    fresh(p.id)
  }
  return { ...s, mutations, probes }
}

/** An absolute path for a repository-relative one; refuses absolute paths and paths that leave the repository. */
export function inside(root, path) {
  if (isAbsolute(path)) throw new UsageError(`path must be relative to the repository: ${path}`)
  const full = resolve(root, path), rel = relative(root, full)
  if (rel === '' || rel === '..' || rel.startsWith('..' + '/') || rel.startsWith('..\\') || isAbsolute(rel)) throw new UsageError(`path leaves the repository: ${path}`)
  return full
}

export function countOccurrences(text, find) {
  let n = 0
  for (let i = text.indexOf(find); i !== -1; i = text.indexOf(find, i + find.length)) n++
  return n
}

/** The text with only the given (1-based) occurrence of find replaced; undefined when there is no such occurrence. */
export function replaceOccurrence(text, find, replace, occurrence) {
  let at = -1
  for (let k = 0, from = 0; k < occurrence; k++) { at = text.indexOf(find, from); if (at === -1) return undefined; from = at + find.length }
  return text.slice(0, at) + replace + text.slice(at + find.length)
}

/** Anchor problems, one line each; empty when every mutation can be applied as written. */
export function checkAnchors(root, mutations) {
  const problems = []
  for (const m of mutations) {
    const full = inside(root, m.file)
    if (!existsSync(full)) { problems.push(`${m.id}: ${m.file} does not exist`); continue }
    const n = countOccurrences(readFileSync(full, 'utf8'), m.find)
    const want = m.occurrence === undefined ? 'exactly 1' : `at least ${m.occurrence}`
    if (m.occurrence === undefined ? n !== 1 : n < m.occurrence) problems.push(`${m.id}: the anchor is found ${n} time(s) in ${m.file}, needs ${want}`)
  }
  return problems
}

/** Throws unless the runner ran exactly as many as were defined. */
export function account(what, defined, ran) {
  if (ran !== defined) throw new IntegrityError(`ran ${ran} ${what} of ${defined} defined`)
}

function preflight(root, spec, out) {
  const dirty = dirtyLines(root)
  if (dirty.length) throw new UsageError(`the working tree is not clean; restore these first (git checkout -- <file>, or remove the untracked file):\n${dirty.join('\n')}`)
  for (const p of [...spec.narrow, ...(spec.wide ?? [])]) inside(root, p)
  const problems = checkAnchors(root, spec.mutations)
  for (const m of spec.mutations) if (existsSync(inside(root, m.file)) && !gitOk(root, ['ls-files', '--error-unmatch', '--', m.file])) problems.push(`${m.id}: ${m.file} is not tracked by git, so it could not be restored`)
  for (const f of [...spec.mutations.map(m => m.file), ...(spec.oldTests?.files ?? [])]) {
    const full = inside(root, f)
    if (existsSync(full) && lstatSync(full).isSymbolicLink()) problems.push(`${f} is a symbolic link; the runner only writes regular files (a link can point outside the repository, where git would not see a change left behind)`)
  }
  if (spec.oldTests) {
    if (!gitOk(root, ['rev-parse', '--verify', '--quiet', spec.oldTests.rev + '^{commit}'])) problems.push(`oldTests: ${spec.oldTests.rev} is not a commit here`)
    else for (const f of spec.oldTests.files) { inside(root, f); if (!gitOk(root, ['cat-file', '-e', `${spec.oldTests.rev}:${f}`])) problems.push(`oldTests: ${f} does not exist at ${spec.oldTests.rev}`) }
  }
  for (const p of spec.probes) {
    if (!existsSync(inside(root, p.from))) problems.push(`probe ${p.id}: ${p.from} does not exist`)
    else if (existsSync(probePath(root, p))) problems.push(`probe ${p.id}: ${relative(root, probePath(root, p))} already exists`)
  }
  if (problems.length) throw new UsageError(`preflight failed; nothing was changed:\n${problems.join('\n')}`)
  mkdirSync(out, { recursive: true })
  const rel = relative(root, out)
  if (!rel.startsWith('..') && !isAbsolute(rel) && !gitOk(root, ['check-ignore', '-q', '--', rel])) throw new UsageError(`--out ${rel} is inside the repository but not ignored by git; its logs would dirty the tree`)
}

/** The probe's temporary test file: next to its source, zz-probe-<id> plus the source's full suffix (.spec.ts). */
export function probePath(root, probe) {
  const from = inside(root, probe.from), name = basename(from), dot = name.indexOf('.')
  return join(dirname(from), `zz-probe-${probe.id}${dot === -1 ? '' : name.slice(dot)}`)
}

/** Stop a test run and everything it started: its process group gets SIGTERM, then SIGKILL after 5 s. */
export function stopChild(child) {
  if (!child?.pid) return
  const send = signal => { try { if (process.platform !== 'win32') { process.kill(-child.pid, signal); return } } catch { /* group gone */ } try { child.kill(signal) } catch { /* gone */ } }
  send('SIGTERM')
  setTimeout(() => { if (child.exitCode === null && child.signalCode === null) send('SIGKILL') }, 5000).unref()
}

function runCommand(state, root, spec, files, logPath) {
  return new Promise(done => {
    const fd = openSync(logPath, 'w')
    let settled = false, timedOut = false, timer
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); state.child = undefined; closeSync(fd); done(timedOut ? { ...result, timedOut: true } : result) }
    const command = spec.command
    const exe = command[0].includes('/') && !isAbsolute(command[0]) ? resolve(root, command[0]) : command[0]
    // Its own process group, so a stop also reaches what the command starts (pnpm or npx wrappers, test workers).
    const child = spawn(exe, [...command.slice(1), ...files], { cwd: root, stdio: ['ignore', fd, fd], detached: process.platform !== 'win32' })
    state.child = child
    if (spec.timeoutMs) timer = setTimeout(() => { timedOut = true; stopChild(child) }, spec.timeoutMs)
    child.on('error', error => finish({ code: -1, error: String(error) }))
    child.on('close', (code, signal) => finish({ code: code ?? -1, signal: signal ?? undefined }))
  })
}

/** Put every touched file back: original bytes (or delete a file the runner created), then git checkout as a backstop. */
function restore(root, touched) {
  const tracked = []
  for (const [rel, bytes] of touched) {
    const full = join(root, rel)
    if (bytes === null) rmSync(full, { force: true })
    else { writeFileSync(full, bytes); tracked.push(rel) }
  }
  touched.clear()
  if (tracked.length) git(root, ['checkout', '--', ...tracked])
}

const RED = 'RED', GREEN = 'GREEN'
const colour = r => (r === undefined ? null : r.code === 0 ? GREEN : RED)

async function runMutation(state, root, spec, m, out) {
  const full = inside(root, m.file), original = readFileSync(full), text = original.toString('utf8')
  const next = replaceOccurrence(text, m.find, m.replace, m.occurrence ?? 1)
  if (next === undefined || next === text) throw new IntegrityError(`${m.id}: the mutation did not change ${m.file}`)
  writeFileSync(join(out, 'current.json'), JSON.stringify({ mutation: m.id, file: m.file }) + '\n')
  state.touched.set(m.file, original)
  writeFileSync(full, next)
  if (readFileSync(full, 'utf8') !== next) throw new IntegrityError(`${m.id}: ${m.file} does not read back as written`)
  const narrow = await runCommand(state, root, spec, spec.narrow, join(out, `${m.id}.narrow.log`))
  let wide, old
  if (!state.interrupted && narrow.code === 0 && spec.wide) wide = await runCommand(state, root, spec, spec.wide, join(out, `${m.id}.wide.log`))
  const killed = narrow.code !== 0 || (wide !== undefined && wide.code !== 0)
  // The old tests only answer "would the tests before this pull request catch it" for a mutation the narrow tests caught.
  if (!state.interrupted && narrow.code !== 0 && spec.oldTests) {
    for (const f of spec.oldTests.files) {
      const path = inside(root, f)
      if (!state.touched.has(f)) state.touched.set(f, readFileSync(path))
      writeFileSync(path, git(root, ['show', `${spec.oldTests.rev}:${f}`]))
    }
    old = await runCommand(state, root, spec, spec.narrow, join(out, `${m.id}.old.log`))
  }
  const verdict = !killed ? 'survived' : narrow.code !== 0 ? (old === undefined ? 'killed' : old.code === 0 ? 'only-new-kills' : 'old-also-kills') : 'killed-by-wide'
  const expected = m.expect ?? 'killed'
  return { id: m.id, narrow: colour(narrow), wide: colour(wide), old: colour(old), verdict, expected, asExpected: (verdict === 'survived') === (expected === 'survived'), timedOut: [narrow, wide, old].some(r => r?.timedOut === true) }
}

async function runProbe(state, root, spec, p, out) {
  const from = inside(root, p.from), path = probePath(root, p), rel = relative(root, path)
  state.touched.set(rel, null)
  writeFileSync(path, readFileSync(from, 'utf8') + '\n' + p.append + '\n')
  const r = await runCommand(state, root, spec, [rel], join(out, `probe-${p.id}.log`))
  const result = r.code === 0 ? 'pass' : 'fail'
  return { id: p.id, result, expected: p.expect ?? null, asExpected: p.expect === undefined || p.expect === result }
}

/**
 * Run a parsed spec against the repository at root, writing logs to out. Returns the exit code and the results;
 * throws UsageError (2) or IntegrityError (3).
 */
export async function run({ root, spec, out, signals = true }) {
  preflight(root, spec, out)
  const state = { touched: new Map(), child: undefined, interrupted: false }
  const onSignal = () => { state.interrupted = true; stopChild(state.child) }
  const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']
  if (signals) for (const s of SIGNALS) process.on(s, onSignal)
  const results = [], probes = []
  let failure
  try {
    const base = await runCommand(state, root, spec, spec.narrow, join(out, 'baseline.log'))
    if (!state.interrupted && base.code !== 0) throw new UsageError(`baseline: the narrow tests are not green before any change (exit ${base.code}); see ${join(out, 'baseline.log')}`)
    for (const m of spec.mutations) {
      if (state.interrupted) break
      let r
      try { r = await runMutation(state, root, spec, m, out) } finally { restore(root, state.touched); rmSync(join(out, 'current.json'), { force: true }) }
      const dirty = dirtyLines(root)
      if (dirty.length) throw new IntegrityError(`after ${m.id} the tree is not clean:\n${dirty.join('\n')}`)
      if (state.interrupted) break
      results.push(r)
    }
    for (const p of spec.probes) {
      if (state.interrupted) break
      let r
      try { r = await runProbe(state, root, spec, p, out) } finally { restore(root, state.touched) }
      if (state.interrupted) break
      probes.push(r)
    }
    if (!state.interrupted) { account('mutations', spec.mutations.length, results.length); account('probes', spec.probes.length, probes.length) }
  } catch (error) {
    failure = error
  } finally {
    restore(root, state.touched)
    if (signals) for (const s of SIGNALS) process.off(s, onSignal)
  }
  const dirty = dirtyLines(root)
  // The first failure is the one to report; a dirty tree always makes it an integrity failure (exit 3).
  if (failure && (failure instanceof IntegrityError || dirty.length === 0)) throw failure
  if (dirty.length) throw new IntegrityError(`${failure ? failure.message + '\n' : ''}the tree is not clean at the end:\n${dirty.join('\n')}`)
  const summary = { ran: results.length, defined: spec.mutations.length, probesRan: probes.length, probesDefined: spec.probes.length, results, probes, out }
  if (state.interrupted) return { code: EXIT.interrupted, ...summary }
  return { code: results.every(r => r.asExpected) && probes.every(p => p.asExpected) ? EXIT.ok : EXIT.survived, ...summary }
}

function line(r) {
  const why = r.verdict === 'only-new-kills' ? 'killed, only by the new tests' : r.verdict === 'old-also-kills' ? 'killed, the old tests too' : r.verdict === 'killed-by-wide' ? 'killed, only by the wide tests' : r.verdict
  return `${r.id}\tnarrow=${r.narrow}\twide=${r.wide ?? '-'}\told=${r.old ?? '-'}\t${why}${r.timedOut ? '\t(timeout)' : ''}${r.asExpected ? '' : `\t(expected ${r.expected})`}`
}

export async function main(argv, io = { out: s => process.stdout.write(s), err: s => process.stderr.write(s) }) {
  const pos = [], opts = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') opts.json = true
    else if (a === '--root' || a === '--out') { if (!argv[i + 1]) { io.err(`${a} needs a value\n`); return EXIT.usage } opts[a.slice(2)] = argv[++i] }
    else if (a.startsWith('--')) { io.err(`unknown option ${a}\n`); return EXIT.usage }
    else pos.push(a)
  }
  if (pos.length !== 1) { io.err('usage: node scripts/mutation-run.mjs <spec.json> [--root DIR] [--out DIR] [--json]\n'); return EXIT.usage }
  try {
    const root = realpathSync(opts.root ? resolve(opts.root) : git(process.cwd(), ['rev-parse', '--show-toplevel']).trim())
    if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== root) throw new UsageError(`--root ${root} is not the top of a git repository`)
    let text
    try { text = readFileSync(pos[0], 'utf8') } catch (e) { throw new UsageError(`cannot read the spec: ${e.message}`) }
    const spec = parseSpec(text)
    const out = opts.out ? resolve(opts.out) : join(root, 'tmp', 'mutation-run', new Date().toISOString().replace(/[:.]/g, '-'))
    const result = await run({ root, spec, out })
    for (const r of result.results) io.out(line(r) + '\n')
    for (const p of result.probes) io.out(`probe ${p.id}\t${p.result}${p.asExpected ? '' : `\t(expected ${p.expected})`}\n`)
    io.out(`ran ${result.ran}/${result.defined} mutations, ${result.probesRan}/${result.probesDefined} probes; logs in ${out}${result.code === EXIT.interrupted ? '; interrupted, restored' : ''}\n`)
    if (opts.json) io.out(JSON.stringify(result) + '\n')
    return result.code
  } catch (error) {
    io.err(`${error.message}\n`)
    return error instanceof UsageError ? EXIT.usage : EXIT.integrity
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(code => { process.exitCode = code })
