#!/usr/bin/env node
/** Pinned GitHub review exports, never checkout/install/dispatch. See docs/guides/review-candidates.md. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const run = promisify(execFile)
const PROJECT = fs.realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const REPOSITORY = 'NelsonLongxiang/dsh-open-a2a-net'
const SHA = /^[0-9a-f]{40}$/
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export const gitBlobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

/** Refuse ambiguous/escaping Git paths, including Windows aliases and alternate data streams. */
function partsOf(value) {
  if (typeof value !== 'string' || value === '' || value.includes('\\')) throw Error('invalid relative path')
  const parts = value.split('/')
  if (parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error('unsafe relative path: ' + value)
  return parts
}

/** All output and reuse paths are explicit project-local task paths, never a discovered cache. */
function taskPath(projectRoot, relative) {
  const parts = partsOf(relative)
  if (parts[0] !== 'tmp' || parts.length < 2) throw Error('expected a project tmp task path: ' + relative)
  const absolute = path.resolve(projectRoot, ...parts)
  assertNoLinks(projectRoot, absolute)
  return absolute
}

/** Inspect each existing component before I/O; never follow a replaced task root or source symlink. */
function assertNoLinks(root, absolute) {
  const relative = path.relative(root, absolute)
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('path escapes project')
  let cursor = root
  for (const part of [undefined, ...relative.split(path.sep).filter(Boolean)]) {
    if (part !== undefined) cursor = path.join(cursor, part)
    let stat
    try { stat = fs.lstatSync(cursor) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    if (stat.isSymbolicLink()) throw Error('link in review path: ' + cursor)
    if (cursor !== absolute && !stat.isDirectory()) throw Error('review parent is not a directory: ' + cursor)
  }
}

function readFile(root, file) {
  assertNoLinks(root, file)
  if (!fs.lstatSync(file).isFile()) throw Error('expected a regular file: ' + file)
  return fs.readFileSync(file)
}

function writeNew(root, file, bytes) {
  assertNoLinks(root, file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  assertNoLinks(root, file)
  fs.writeFileSync(file, bytes, { flag: 'wx' })
}

export function normalizePlan(raw, projectRoot = PROJECT) {
  projectRoot = fs.realpathSync(projectRoot)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('expected a plan object')
  if (raw.repository !== undefined && raw.repository !== REPOSITORY) throw Error('this entry serves only ' + REPOSITORY)
  const root = taskPath(projectRoot, raw.root)
  if (partsOf(raw.root).length !== 2) throw Error('root must be tmp/<task-key>')
  if (!Array.isArray(raw.plans) || raw.plans.length === 0 || raw.plans.length > 20) throw Error('expected 1..20 candidate plans')
  const seen = new Set()
  const plans = raw.plans.map(p => {
    if (!p || !Number.isSafeInteger(p.n) || p.n < 1 || !SHA.test(p.head) || !SHA.test(p.previous)) throw Error('candidate needs positive n and full head/previous SHAs')
    if (seen.has(p.n)) throw Error('duplicate PR: ' + p.n)
    seen.add(p.n)
    return { n: p.n, head: p.head, previous: p.previous }
  })
  if (raw.reuse !== undefined && (!Array.isArray(raw.reuse) || raw.reuse.length > 8)) throw Error('reuse must be an explicit list of at most 8 owned candidate directories')
  const reuse = (raw.reuse ?? []).map(p => taskPath(projectRoot, p))
  return { projectRoot, root, plans, reuse }
}

export function candidateFiles(tree) {
  if (!tree || tree.truncated || !Array.isArray(tree.tree)) throw Error('missing or truncated Git tree')
  const files = [], seen = new Set(), spellings = new Map()
  for (const entry of tree.tree) {
    if (entry.type === 'tree') continue
    const parts = partsOf(entry.path)
    for (let i = 1; i <= parts.length; i++) {
      const spelling = parts.slice(0, i).join('/'), folded = spelling.toLowerCase()
      if (spellings.has(folded) && spellings.get(folded) !== spelling) throw Error('aliased Git path component: ' + spelling)
      spellings.set(folded, spelling)
    }
    if (parts.some(p => ['.git', 'node_modules'].includes(p.toLowerCase()))) throw Error('reserved candidate path: ' + entry.path)
    if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw Error('unsupported Git entry (link/submodule): ' + entry.path)
    if (!SHA.test(entry.sha)) throw Error('invalid blob SHA: ' + entry.path)
    // Portable export: reject case aliases even when the exporting host is case-sensitive.
    const key = entry.path.toLowerCase()
    if (seen.has(key)) throw Error('duplicate/aliased Git path: ' + entry.path)
    seen.add(key)
    files.push(entry)
  }
  if (files.length === 0) throw Error('empty candidate tree')
  for (const file of files) {
    const parts = file.path.toLowerCase().split('/')
    while (parts.pop(), parts.length) if (seen.has(parts.join('/'))) throw Error('Git file/directory collision: ' + file.path)
  }
  return files
}

/** Rebuild the root Git tree from paths/modes/blob ids; API top-level `sha` can echo a commit request. */
export function gitTreeSha(tree) {
  const files = candidateFiles(tree), root = new Map(), directories = new Map([['', root]])
  for (const file of files) {
    const parts = file.path.split('/'), basename = parts.pop()
    let children = root, prefix = ''
    for (const part of parts) {
      prefix = prefix ? prefix + '/' + part : part
      if (!children.has(part)) children.set(part, { children: new Map() })
      children = children.get(part).children
      directories.set(prefix, children)
    }
    children.set(basename, { mode: file.mode, sha: file.sha })
  }
  const hashes = new Map()
  const digest = children => {
    if (hashes.has(children)) return hashes.get(children)
    const rows = [...children.entries()].sort(([a, av], [b, bv]) => Buffer.compare(Buffer.from(a + (av.children ? '/' : '')), Buffer.from(b + (bv.children ? '/' : ''))))
    const bytes = Buffer.concat(rows.map(([name, value]) => Buffer.concat([
      Buffer.from(`${value.children ? '40000' : value.mode} ${name}\0`),
      Buffer.from(value.children ? digest(value.children) : value.sha, 'hex'),
    ])))
    const sha = createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex')
    hashes.set(children, sha)
    return sha
  }
  const result = digest(root), seen = new Set()
  for (const entry of tree.tree.filter(e => e.type === 'tree')) {
    partsOf(entry.path)
    if (entry.mode !== '040000' || !SHA.test(entry.sha) || seen.has(entry.path.toLowerCase())) throw Error('invalid directory tree entry: ' + entry.path)
    seen.add(entry.path.toLowerCase())
    const children = directories.get(entry.path)
    if (!children || digest(children) !== entry.sha) throw Error('directory tree digest mismatch: ' + entry.path)
  }
  return result
}

async function githubApi(route, paginate = false) {
  const args = ['api', `repos/${REPOSITORY}/${route}`, ...(paginate ? ['--paginate', '--slurp'] : [])]
  const { stdout } = await run('gh', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 24_000_000 })
  const value = JSON.parse(stdout)
  return paginate ? value.flat() : value
}

function checkHead(pr, candidate) {
  if (pr?.head?.sha !== candidate.head || (pr.number !== undefined && pr.number !== candidate.n)) throw Error('head/PR mismatch for #' + candidate.n)
}

/** Export only to a new per-PR destination. Failure keeps partial evidence; there is no overwrite/retry cleanup. */
export async function prepareCandidates(raw, { projectRoot = PROJECT, api = githubApi } = {}) {
  const plan = normalizePlan(raw, projectRoot)
  // Fail before remote work or writes if any destination already belongs to a run.
  for (const p of plan.plans) if (fs.existsSync(path.join(plan.root, `pr${p.n}`))) throw Error('candidate destination already exists: pr' + p.n)
  const results = []
  for (const p of plan.plans) {
    const [pr, commit, comparison, tree, previousTree, files] = await Promise.all([
      api(`pulls/${p.n}`), api(`commits/${p.head}`), api(`compare/${p.previous}...${p.head}`),
      api(`git/trees/${p.head}?recursive=1`), api(`git/trees/${p.previous}?recursive=1`), api(`pulls/${p.n}/files?per_page=100`, true),
    ])
    checkHead(pr, p)
    if (commit?.sha !== p.head || !Array.isArray(commit.parents) || !Array.isArray(comparison.files) || !Array.isArray(files)) throw Error('invalid candidate metadata for #' + p.n)
    if (comparison.files.length >= 300) throw Error('comparison reaches the GitHub 300-file limit; choose a narrower explicit baseline before exporting')
    if (!SHA.test(commit.commit?.tree?.sha) || gitTreeSha(tree) !== commit.commit.tree.sha) throw Error('commit/tree identity mismatch for #' + p.n)
    const incoming = candidateFiles(tree)
    candidateFiles(previousTree)
    const parentTrees = []
    for (const parent of commit.parents) {
      if (!SHA.test(parent.sha)) throw Error('invalid parent SHA')
      const parentTree = await api(`git/trees/${parent.sha}?recursive=1`)
      candidateFiles(parentTree)
      parentTrees.push(parentTree)
    }
    const home = path.join(plan.root, `pr${p.n}`), candidate = path.join(home, 'candidate')
    assertNoLinks(plan.projectRoot, home)
    fs.mkdirSync(plan.root, { recursive: true })
    fs.mkdirSync(home) // exclusive: do not adopt a concurrent creator's directory
    fs.mkdirSync(candidate)
    const metadata = { 'pr.json': pr, 'head-commit.json': commit, 'since-review.json': comparison, 'tree.json': tree, 'previous-tree.json': previousTree, 'parent-trees.json': parentTrees, 'files.json': files }
    for (const [name, value] of Object.entries(metadata)) writeNew(plan.projectRoot, path.join(home, name), JSON.stringify(value, null, 2) + '\n')
    const parentMaps = parentTrees.map(t => new Map(t.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha])))
    const unique = incoming.filter(e => parentMaps.length > 1 && parentMaps.every(m => m.get(e.path) !== e.sha)).map(e => e.path)
    writeNew(plan.projectRoot, path.join(home, 'merge-unique.txt'), unique.join('\n'))
    writeNew(plan.projectRoot, path.join(home, 'paths.txt'), files.map(f => `${f.status} ${f.filename}`).join('\n'))
    writeNew(plan.projectRoot, path.join(home, 'delta.txt'), comparison.files.map(f => `${f.status} ${f.filename}\n${f.patch ?? '[patch unavailable]'}`).join('\n\n'))
    let fetched = 0, reused = 0
    for (const entry of incoming) {
      let bytes
      for (const source of plan.reuse) {
        const file = path.join(source, ...entry.path.split('/'))
        assertNoLinks(plan.projectRoot, file)
        if (!fs.existsSync(file)) continue
        const value = readFile(plan.projectRoot, file)
        if (gitBlobSha(value) === entry.sha) { bytes = value; reused++; break }
      }
      if (bytes === undefined) {
        const blob = await api(`git/blobs/${entry.sha}`)
        if (blob?.sha !== entry.sha || blob.encoding !== 'base64' || typeof blob.content !== 'string' || !/^[A-Za-z0-9+/=\r\n]*$/.test(blob.content)) throw Error('invalid blob response: ' + entry.path)
        bytes = Buffer.from(blob.content, 'base64')
        if (blob.size !== undefined && blob.size !== bytes.length) throw Error('blob size mismatch: ' + entry.path)
        fetched++
      }
      if (gitBlobSha(bytes) !== entry.sha) throw Error('blob mismatch: ' + entry.path)
      writeNew(plan.projectRoot, path.join(candidate, ...entry.path.split('/')), bytes)
    }
    checkHead(await api(`pulls/${p.n}`), p)
    results.push({ pr: p.n, head: p.head, base: pr.base?.sha, verified: incoming.length, fetched, reused, parents: commit.parents.map(p => p.sha), mergeUnique: unique })
  }
  return { ok: true, mode: 'prepare', repository: REPOSITORY, results }
}

/** Read-only identity verification; offline explicitly does not establish the current remote head. */
export async function verifyCandidates(raw, { projectRoot = PROJECT, api = githubApi, offline = false } = {}) {
  const plan = normalizePlan(raw, projectRoot), results = []
  for (const p of plan.plans) {
    const home = path.join(plan.root, `pr${p.n}`)
    const readJson = name => JSON.parse(readFile(plan.projectRoot, path.join(home, name)).toString('utf8'))
    checkHead(readJson('pr.json'), p)
    const tree = readJson('tree.json'), commit = readJson('head-commit.json')
    if (commit?.sha !== p.head || !SHA.test(commit.commit?.tree?.sha) || gitTreeSha(tree) !== commit.commit.tree.sha) throw Error('saved commit/tree identity mismatch for #' + p.n)
    const incoming = candidateFiles(tree)
    for (const entry of incoming) {
      const bytes = readFile(plan.projectRoot, path.join(home, 'candidate', ...entry.path.split('/')))
      if (gitBlobSha(bytes) !== entry.sha) throw Error('candidate drift #' + p.n + ': ' + entry.path)
    }
    const current = offline ? undefined : await api(`pulls/${p.n}`)
    if (current !== undefined) {
      checkHead(current, p)
      const remoteCommit = await api(`commits/${p.head}`)
      if (remoteCommit?.sha !== p.head || remoteCommit.commit?.tree?.sha !== commit.commit.tree.sha) throw Error('remote commit/tree witness mismatch for #' + p.n)
    }
    const logs = fs.readdirSync(home).filter(name => name.endsWith('.log')).sort().map(name => ({ name, sha256: sha256(readFile(plan.projectRoot, path.join(home, name))) }))
    results.push({ pr: p.n, head: p.head, verified: incoming.length, currentHead: offline ? 'not-checked' : 'matched', ...(current ? { base: current.base?.sha, state: current.state } : {}), logs })
  }
  return { ok: true, mode: 'verify', repository: REPOSITORY, results }
}

export async function main(argv = process.argv.slice(2)) {
  const help = 'Usage: node scripts/review-candidates.mjs --plan tmp/<task>/plan.json [--verify-only [--offline]]\nPrepare creates new per-PR exports; verify is read-only and prints JSON. No install, checkout, automatic cache search or cleanup.\nGuide: docs/guides/review-candidates.md'
  if (argv.length === 1 && argv[0] === '--help') { console.log(help); return }
  let file, verify = false, offline = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--plan' && file === undefined && argv[i + 1]) file = argv[++i]
    else if (arg === '--verify-only' && !verify) verify = true
    else if (arg === '--offline' && !offline) offline = true
    else throw Error('invalid argument: ' + arg + '\n' + help)
  }
  if (!file || (offline && !verify)) throw Error(help)
  const planFile = taskPath(PROJECT, file)
  const raw = JSON.parse(readFile(PROJECT, planFile).toString('utf8'))
  const result = await (verify ? verifyCandidates(raw, { offline }) : prepareCandidates(raw))
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await main() } catch (error) { console.error('review-candidates: ' + error.message); process.exitCode = 1 }
}
