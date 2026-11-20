/** Project review exports: source identity and owned paths, never installation or checkout. */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, symlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { createHash } from 'node:crypto'
import { candidateFiles, gitBlobSha, gitTreeSha, normalizePlan, prepareCandidates, verifyCandidates } from '../../scripts/review-candidates.mjs'

const HEAD = 'a'.repeat(40), PREVIOUS = 'b'.repeat(40)
const payload = Buffer.from('export const candidate = 1\n')
const blob = { path: 'src/main.ts', mode: '100644', type: 'blob', sha: gitBlobSha(payload) }
// Independent one-file Git object encoding, not the production tree reconstruction helper.
const treeHash = (bytes: Buffer) => createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex')
const SUBTREE = treeHash(Buffer.concat([Buffer.from('100644 main.ts\0'), Buffer.from(blob.sha, 'hex')]))
const TREE = treeHash(Buffer.concat([Buffer.from('40000 src\0'), Buffer.from(SUBTREE, 'hex')]))
function fixture() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'review-candidates-'))
  mkdirSync(join(projectRoot, 'tmp'))
  const raw = { root: 'tmp/review-one', plans: [{ n: 23, head: HEAD, previous: PREVIOUS }] }
  const pr = { number: 23, head: { sha: HEAD }, base: { sha: PREVIOUS }, state: 'open' }
  const calls: string[] = []
  const api = vi.fn(async (route: string) => {
    calls.push(route)
    if (route === 'pulls/23') return structuredClone(pr)
    if (route === `commits/${HEAD}`) return { sha: HEAD, parents: [], commit: { tree: { sha: TREE } } }
    if (route === `compare/${PREVIOUS}...${HEAD}`) return { files: [{ status: 'added', filename: blob.path, patch: '+export const candidate = 1' }] }
    if (route === `git/trees/${HEAD}?recursive=1`) return { sha: TREE, tree: [blob], truncated: false }
    if (route === `git/trees/${PREVIOUS}?recursive=1`) return { sha: 'd'.repeat(40), tree: [blob], truncated: false }
    if (route === 'pulls/23/files?per_page=100') return [{ status: 'added', filename: blob.path }]
    if (route === `git/blobs/${blob.sha}`) return { sha: blob.sha, encoding: 'base64', size: payload.length, content: payload.toString('base64') }
    throw Error('unexpected route ' + route)
  })
  return { projectRoot, raw, pr, calls, api, home: join(projectRoot, 'tmp/review-one/pr23') }
}

describe('review candidate plan and tree boundaries', () => {
  it('accepts explicit independent plans with only an owned project task root', () => {
    const f = fixture(), plan = normalizePlan(f.raw, f.projectRoot)
    expect(plan.root).toBe(join(f.projectRoot, 'tmp/review-one'))
    expect(plan.plans).toEqual(f.raw.plans)
    expect(plan.reuse).toEqual([])
  })
  it.each(['../outside', '/tmp/outside', 'scripts/review', 'tmp', 'tmp/job/nested', 'tmp/../job', 'tmp\\job', 'tmp/CON', 'tmp/name.'])('rejects unsafe output root %s', root => {
    const f = fixture()
    expect(() => normalizePlan({ ...f.raw, root }, f.projectRoot)).toThrow()
  })
  it('rejects duplicate PRs, abbreviated SHAs, foreign repositories and non-task reuse', () => {
    const f = fixture()
    for (const raw of [
      { ...f.raw, plans: [...f.raw.plans, ...f.raw.plans] },
      { ...f.raw, plans: [{ ...f.raw.plans[0], head: 'aabbcc' }] },
      { ...f.raw, repository: 'other/project' },
      { ...f.raw, reuse: ['node_modules'] },
    ]) expect(() => normalizePlan(raw, f.projectRoot)).toThrow()
  })
  it('rejects escaping tree paths, links, submodules, aliases, empty and truncated inventories', () => {
    for (const entries of [
      [{ ...blob, path: '../escape.ts' }], [{ ...blob, path: 'src/../../escape.ts' }],
      [{ ...blob, path: 'C:/escape.ts' }], [{ ...blob, path: '.git/config' }],
      [{ ...blob, mode: '120000' }], [{ ...blob, type: 'commit', mode: '160000' }],
      [blob, { ...blob, path: 'SRC/Main.ts' }], [blob, { ...blob, path: 'SRC/other.ts' }], [blob, { ...blob, path: 'src/main.ts/child' }], [],
    ]) expect(() => candidateFiles({ tree: entries, truncated: false })).toThrow()
    expect(() => candidateFiles({ tree: [blob], truncated: true })).toThrow('truncated')
  })
  it('refuses a substituted task parent instead of following a directory junction', () => {
    const f = fixture(), outside = join(f.projectRoot, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(f.projectRoot, 'tmp/redirect'), 'junction')
    expect(() => normalizePlan({ ...f.raw, root: 'tmp/redirect' }, f.projectRoot)).toThrow('link')
    expect(readdirSync(outside)).toEqual([])
  })
})

describe('Git tree witness reconstruction', () => {
  it('binds actual paths/modes/blob ids even when the API top sha echoes a commit id', () => {
    expect(gitTreeSha({ sha: HEAD, tree: [blob], truncated: false })).toBe(TREE)
    expect(gitTreeSha({ sha: HEAD, tree: [blob, { path: 'src', mode: '040000', type: 'tree', sha: SUBTREE }], truncated: false })).toBe(TREE)
    expect(() => gitTreeSha({ tree: [blob, { path: 'src', mode: '040000', type: 'tree', sha: 'e'.repeat(40) }] })).toThrow('directory tree digest')
    expect(gitTreeSha({ tree: [{ ...blob, mode: '100755' }] })).not.toBe(TREE)
  })
})

describe('pinned preparation and read-only verification', () => {
  it('exports exact bytes then verifies online/offline without changing source or evidence', async () => {
    const f = fixture()
    const prepared = await prepareCandidates(f.raw, f)
    expect(prepared.results).toMatchObject([{ pr: 23, head: HEAD, verified: 1, fetched: 1, reused: 0 }])
    const source = join(f.home, 'candidate/src/main.ts')
    expect(readFileSync(source)).toEqual(payload)
    expect(existsSync(join(f.home, 'candidate/node_modules'))).toBe(false)
    const log = join(f.home, 'tests.log')
    writeFileSync(log, '1 failed: preserved negative result\n')
    const before = { bytes: readFileSync(source), mtime: statSync(source).mtimeMs, log: readFileSync(log), names: readdirSync(f.home) }
    const offlineApi = vi.fn(() => { throw Error('offline must not call remote') })
    const offline = await verifyCandidates(f.raw, { ...f, api: offlineApi, offline: true })
    expect(offline.results[0]).toMatchObject({ verified: 1, currentHead: 'not-checked', logs: [{ name: 'tests.log', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }] })
    expect(offlineApi).not.toHaveBeenCalled()
    const online = await verifyCandidates(f.raw, f)
    expect(online.results[0]).toMatchObject({ currentHead: 'matched', head: HEAD })
    expect({ bytes: readFileSync(source), mtime: statSync(source).mtimeMs, log: readFileSync(log), names: readdirSync(f.home) }).toEqual(before)
  })
  it('never overwrites an existing destination or an already delivered candidate', async () => {
    const f = fixture()
    await prepareCandidates(f.raw, f)
    const original = readFileSync(join(f.home, 'pr.json'))
    f.api.mockClear()
    await expect(prepareCandidates(f.raw, f)).rejects.toThrow('already exists')
    expect(f.api).not.toHaveBeenCalled()
    expect(readFileSync(join(f.home, 'pr.json'))).toEqual(original)
  })
  it('rejects a stale remote head before creating a per-PR directory', async () => {
    const f = fixture()
    f.pr.head.sha = 'e'.repeat(40)
    await expect(prepareCandidates(f.raw, f)).rejects.toThrow('mismatch')
    expect(existsSync(f.home)).toBe(false)
  })
  it('rejects a tree not bound to the requested commit before writing', async () => {
    const f = fixture(), api = async (route: string, ...args: unknown[]) => {
      const value = await f.api(route, ...args)
      return route === `git/trees/${HEAD}?recursive=1` ? { ...value, tree: [{ ...blob, sha: 'e'.repeat(40) }] } : value
    }
    await expect(prepareCandidates(f.raw, { ...f, api })).rejects.toThrow('commit/tree')
    expect(existsSync(f.home)).toBe(false)
  })
  it('refuses potentially capped comparison summaries rather than presenting a partial delta as complete', async () => {
    const f = fixture(), api = async (route: string) => route.startsWith('compare/') ? { files: Array.from({ length: 300 }, () => ({})) } : f.api(route)
    await expect(prepareCandidates(f.raw, { ...f, api })).rejects.toThrow('300-file limit')
    expect(existsSync(f.home)).toBe(false)
  })
  it('checks the immutable remote commit witness as well as the current PR head', async () => {
    const f = fixture()
    await prepareCandidates(f.raw, f)
    const api = async (route: string) => {
      const value = await f.api(route)
      return route === `commits/${HEAD}` ? { ...value, commit: { tree: { sha: 'e'.repeat(40) } } } : value
    }
    await expect(verifyCandidates(f.raw, { ...f, api })).rejects.toThrow('remote commit/tree witness')
  })
  it('rejects wrong blob bytes and preserves partial evidence without calling it complete', async () => {
    const f = fixture(), api = async (route: string, ...args: unknown[]) => {
      const value = await f.api(route, ...args)
      return route.startsWith('git/blobs/') ? { ...value, content: Buffer.from('wrong').toString('base64'), size: 5 } : value
    }
    await expect(prepareCandidates(f.raw, { ...f, api })).rejects.toThrow('blob mismatch')
    expect(existsSync(join(f.home, 'tree.json'))).toBe(true)
    expect(existsSync(join(f.home, 'candidate/src/main.ts'))).toBe(false)
  })
  it('uses only explicit, hash-matching owned reuse; it never searches other sessions or tmp directories', async () => {
    const f = fixture(), source = join(f.projectRoot, 'tmp/prior/candidate/src')
    mkdirSync(source, { recursive: true }); writeFileSync(join(source, 'main.ts'), payload)
    const result = await prepareCandidates({ ...f.raw, reuse: ['tmp/prior/candidate'] }, f)
    expect(result.results[0]).toMatchObject({ fetched: 0, reused: 1 })
    expect(f.calls.some(route => route.startsWith('git/blobs/'))).toBe(false)
  })
  it('detects source drift and a later advanced remote head, without repairing either', async () => {
    const f = fixture()
    await prepareCandidates(f.raw, f)
    f.pr.head.sha = 'e'.repeat(40)
    await expect(verifyCandidates(f.raw, f)).rejects.toThrow('mismatch')
    expect((await verifyCandidates(f.raw, { ...f, offline: true })).results[0].currentHead).toBe('not-checked')
    const source = join(f.home, 'candidate/src/main.ts')
    writeFileSync(source, 'drift\n')
    await expect(verifyCandidates(f.raw, { ...f, offline: true })).rejects.toThrow('candidate drift')
    expect(readFileSync(source, 'utf8')).toBe('drift\n')
  })
  it('refuses substituted candidate and log links during verification', async () => {
    const f = fixture()
    await prepareCandidates(f.raw, f)
    const sibling = join(f.projectRoot, 'tmp/sibling.log'); writeFileSync(sibling, 'do not read')
    symlinkSync(sibling, join(f.home, 'linked.log'), 'file')
    await expect(verifyCandidates(f.raw, { ...f, offline: true })).rejects.toThrow('link')
  })
})
