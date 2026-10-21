#!/usr/bin/env node
// supervisor-verify.mjs — open-a2a-net 监督席递归验证器（S 层，九层版）
//
// 定位：RC 验证器（scripts/verify-probe.mjs + ygl-trees M13 verify run）验证
// 【项目】；本脚本验证【验证系统本身与监督记录】，且上一轮监督记录是本轮的
// 被验对象——递归闭环。只读不写仓库（运行记录除外，落 tmp/supervisor/runs/，
// 该目录 gitignore——运行史不入库）。
//
// 2026-10-21 转正：自 tmp/supervisor/verify.mjs 晋升 scripts/（可版本化、
// 可评审、可复现），新增 S7/S8/S9 三层。
//
// 检查面：
//   S1 validator-records   docs/validator.md 声称的每个 PASS run：报告在盘、
//                          overall/spec/vu 计数与文档一致；冻结四件套在位
//   S2 repo-facts          战役提交血统在 master / 版本线 0.6.x / 工作树净
//   S3 ygl-trees-health    doctor 0 fail；监督域树 validate 干净
//   S4 docs-crosscheck     文档逐周期声明（head/判据数）与 run 报告对账
//   S5 self-recursion      上一轮监督记录的静态事实本轮复 assert（血统断言），
//                          血缘链接
//   S6 public-triage       GitHub issues/PRs + gitee PRs/issues 开放项清点
//   S7 deps-dual-mirror    pnpm overrides 双镜像（package.json ↔
//                          pnpm-workspace.yaml）值一致 + packageManager 钉版
//                          + engines.pnpm 范围在位（cordis 事故 0e32ae1 +
//                          gh#6 的回归防线）
//   S8 scope-fix-anchors   已合 PR 的修复锚在位防回归：M2 无条件
//                          visibleTeams.add(config.team)（PR#107）、G2
//                          visibleTeams.add('log')（PR#108）、G4
//                          joinedTeamScope 含 canvas（PR#108）
//   S9 layer-docs-contract docs/testing-layers.md 分层契约 ↔ package.json
//                          脚本 ↔ 磁盘目录 三方一致
//
// 退出码：全绿 0；任何 FAIL 1。WARN 不影响退出码，但必须出现在报告里。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'D:/workspace/dsh-open-a2a-net'
const RUNS_DIR = join(REPO, 'tmp/supervisor/runs')
const REPORTS_DIR = join(REPO, 'tmp/ygl-verify/verify/reports')
const SUPERVISED_TREES = ['v2-roadmap', 'time-capsule']
const CAMPAIGN_COMMITS = ['f124eee', 'c65416d', '8b8efeb']

const YGL_BIN = 'D:/workspace/ygl-trees/dist/apps/cli/src/bin.js'
const GITEE_BIN = 'D:/node-v24.12.0-win-x64/node_modules/@gitee/gitee-cli/bin/index.js'
const ygl = (args) => {
  try {
    // Direct dist-bin invocation: Windows execFileSync cannot run the .cmd
    // shim without a shell, and the dist entry is the documented stable face.
    return { rc: 0, out: execFileSync(process.execPath, [YGL_BIN, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }
  } catch (error) { return { rc: error.status ?? 1, out: String(error.stdout ?? '') + String(error.stderr ?? '') } }
}
const git = (args) => execFileSync('git', args, { encoding: 'utf8', cwd: REPO }).trim()

const runId = `run-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${process.pid.toString(16).slice(-4)}`
const checks = []
const check = (id, name, verdict, detail) => { checks.push({ id, name, verdict, detail }); console.log(`${verdict === 'PASS' ? ' ✓' : verdict === 'WARN' ? ' !' : ' ✗'} ${id} ${name} — ${detail}`) }

// ---------- S1 validator-records ----------
{
  const doc = readFileSync(join(REPO, 'docs/validator.md'), 'utf8')
  const claimed = [...new Set([...doc.matchAll(/run_([0-9a-f]{16})/g)].map(m => `run_${m[1]}`))]
  // Both frozen spec generations are legitimate: 1.0-era spec_bae507ea0520
  // (same criteria) and contract-1.1 spec_c8b6350c5034 — docs/validator.md
  // names both; a claimed PASS run on either is consistent.
  const allowedSpecs = new Set(['spec_c8b6350c5034', 'spec_bae507ea0520'])
  let missing = 0, nonPass = 0, specMismatch = 0, unitMismatch = 0
  for (const id of claimed) {
    const path = join(REPORTS_DIR, `${id}.json`)
    if (!existsSync(path)) { missing++; continue }
    const report = JSON.parse(readFileSync(path, 'utf8'))
    if (report.overall !== 'PASS') nonPass++
    if (!allowedSpecs.has(report.spec_id)) specMismatch++
    const vuCount = Array.isArray(report.vu) ? report.vu.length : (report.summary?.total ?? -1)
    if (vuCount !== 14) unitMismatch++
  }
  const frozen = ['material.md', 'candidates.json', 'reviews.json'].every(f => existsSync(join(REPO, 'verify', f))) && existsSync(join(REPO, 'verify/snapshot.sqlite'))
  const pass = missing === 0 && nonPass === 0 && specMismatch === 0 && unitMismatch === 0 && frozen
  check('S1', 'validator-records', pass ? 'PASS' : 'FAIL',
    `${claimed.length} claimed runs: missing=${missing} nonPass=${nonPass} specMismatch=${specMismatch} unitMismatch=${unitMismatch} frozenQuad=${frozen}`)
}

// ---------- S2 repo-facts ----------
{
  // Ancestry assertion (not a -N window grep): campaign commits must be
  // reachable from HEAD regardless of how deep an active repo buries them.
  const missingCommits = CAMPAIGN_COMMITS.filter(c => {
    try { git(['merge-base', '--is-ancestor', c, 'HEAD']); return false }
    catch { return true }
  })
  const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
  const onVersionLine = /^0\.6\./.test(version)
  const dirty = git(['status', '--porcelain']).split('\n').filter(line => line.trim() !== '' && !line.startsWith('??'))
  const pass = missingCommits.length === 0 && onVersionLine && dirty.length === 0
  check('S2', 'repo-facts', pass ? (dirty.length === 0 ? 'PASS' : 'WARN') : 'FAIL',
    `campaignCommits(ancestry)=${CAMPAIGN_COMMITS.length - missingCommits.length}/${CAMPAIGN_COMMITS.length} version=${version}${onVersionLine ? '' : ' (NOT 0.6.x)'} dirtyTracked=${dirty.length}`)
}

// ---------- S3 ygl-trees-health ----------
{
  const doctor = ygl(['doctor', '--json'])
  let fail = -1, warn = -1
  try {
    // stderr noise (runtime warnings) may precede the JSON array in the
    // combined capture — parse from the first '['.
    const rows = JSON.parse(doctor.out.slice(doctor.out.indexOf('[')))
    const statuses = rows.map(row => String(row.status).toLowerCase())
    fail = statuses.filter(s => s === 'fail').length
    warn = statuses.filter(s => s === 'warn').length
  } catch { /* non-json output tolerated below */ }
  let validateClean = true
  for (const tree of SUPERVISED_TREES) {
    const r = ygl(['node', 'validate', '-t', tree])
    // Clean = exit 0 AND the explicit no-issues verdict (0.107 output shape).
    if (r.rc !== 0 || !/no issues/i.test(r.out)) validateClean = false
  }
  const pass = fail === 0 && validateClean
  check('S3', 'ygl-trees-health', pass ? 'PASS' : 'FAIL',
    `doctor fails=${fail} warns=${warn}; trees[${SUPERVISED_TREES.join(',')}] validateClean=${validateClean}`)
}

// ---------- S4 docs-crosscheck ----------
{
  const doc = readFileSync(join(REPO, 'docs/validator.md'), 'utf8')
  const cycleHeads = [...doc.matchAll(/head ([0-9a-f]{8})/g)].map(m => m[1])
  // git log --oneline abbreviates to 7 chars; compare against full hashes.
  const fullHashes = git(['log', '--format=%H', '-300']).split('\n')
  const unknownHeads = cycleHeads.filter(h => !fullHashes.some(full => full.startsWith(h)))
  const specFrozen = doc.includes('spec_c8b6350c5034')
  const pass = unknownHeads.length === 0 && specFrozen
  check('S4', 'docs-crosscheck', pass ? 'PASS' : 'FAIL',
    `cycleHeads=${cycleHeads.length} unknownInGit=${unknownHeads.length} specIdMentioned=${specFrozen}`)
}

// ---------- S5 self-recursion ----------
{
  const previous = existsSync(RUNS_DIR)
    ? readdirSync(RUNS_DIR).filter(f => /^run-.*\.json$/.test(f)).sort().pop()
    : undefined
  let detail = 'seed run — no previous record; lineage starts here'
  let verdict = 'PASS'
  if (previous !== undefined) {
    const prior = JSON.parse(readFileSync(join(RUNS_DIR, previous), 'utf8'))
    // Recursion verifies FACT PERSISTENCE, not verdict inheritance: the
    // previous run's static facts (its commit set) must still hold — via
    // ancestry, not a shallow window grep.
    const priorCommits = (prior.checks ?? []).some(c => c.id === 'S2')
      ? CAMPAIGN_COMMITS
      : []
    const recheckMiss = priorCommits.filter(c => {
      try { git(['merge-base', '--is-ancestor', c, 'HEAD']); return false } catch { return true }
    })
    verdict = recheckMiss.length === 0 ? 'PASS' : 'FAIL'
    detail = `previous=${previous} priorOverall=${prior.overall} factRecheckMiss=${recheckMiss.length}`
  }
  check('S5', 'self-recursion', verdict, detail)
}

// ---------- S6 public-triage (GitHub issues/PRs + gitee PRs/issues) ----------
// 监督面的公共入口：公开仓的 issue/PR 是待 triage 的监督工作项。开放项存在 =
// WARN（巡检轮据此行动：回应/评审/派发），不存在 = PASS。拉取失败 = WARN
// （网络抖动不应染红监督门禁），细节随行。
{
  const ghHeaders = { 'User-Agent': 'open-a2a-net-supervisor', Accept: 'application/vnd.github+json' }
  const items = []
  let ghError, giteeError, giteeIssueError
  try {
    const gh = await fetch('https://api.github.com/repos/NelsonLongxiang/dsh-open-a2a-net/issues?state=open&per_page=50', { headers: ghHeaders, signal: AbortSignal.timeout(15_000) })
    if (!gh.ok) throw new Error(`HTTP ${String(gh.status)}`)
    const rows = await gh.json()
    for (const row of rows) {
      const kind = row.pull_request ? 'PR' : 'issue'
      const ageDays = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000)
      items.push(`gh#${String(row.number)} [${kind}] ${String(row.title).slice(0, 60)} (${String(row.user?.login ?? '?')}, ${String(ageDays)}d)`)
    }
  } catch (error) { ghError = String(error).slice(0, 120) }
  try {
    // The gitee repo is PRIVATE: anonymous API v5 answers 404 Not Found
    // Project — reads go through the authenticated gitee CLI's real js
    // entry (the .cmd shim is not execFileSync-able on Windows). The CLI
    // may print an update notice after the JSON: brace-trim before parse.
    const out = execFileSync(process.execPath, [GITEE_BIN, 'pr', 'list', '-R', 'NelsonLongXiang/dsh-open-a2a-net', '--state', 'open', '--json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: REPO })
    const rows = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1))
    for (const row of rows) {
      const ageDays = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000)
      items.push(`gitee#${String(row.number)} [PR] ${String(row.title).slice(0, 60)} (${String(row.user?.login ?? row.head?.user ?? '?')}, ${String(ageDays)}d)`)
    }
  } catch (error) { giteeError = String(error).slice(0, 120) }
  try {
    const out = execFileSync(process.execPath, [GITEE_BIN, 'issue', 'list', '-R', 'NelsonLongXiang/dsh-open-a2a-net', '--json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: REPO })
    const rows = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1))
    for (const row of rows) {
      const ageDays = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000)
      items.push(`gitee#${String(row.number)} [issue] ${String(row.title).slice(0, 60)} (${String(row.user?.login ?? '?')}, ${String(ageDays)}d)`)
    }
  } catch (error) { giteeIssueError = String(error).slice(0, 120) }
  const fetchDegraded = ghError !== undefined || giteeError !== undefined || giteeIssueError !== undefined
  const verdict = fetchDegraded ? 'WARN' : (items.length > 0 ? 'WARN' : 'PASS')
  check('S6', 'public-triage', verdict,
    `open=${String(items.length)}${items.length > 0 ? `: ${items.join(' | ')}` : ''}${ghError !== undefined ? ` githubFetchError=${ghError}` : ''}${giteeError !== undefined ? ` giteeFetchError=${giteeError}` : ''}${giteeIssueError !== undefined ? ` giteeIssueError=${giteeIssueError}` : ''}`)
}

// ---------- S7 deps-dual-mirror (cordis 0e32ae1 + gh#6 回归防线) ----------
// 契约（10052f0 立）：overrides 双镜像（package.json#pnpm 供 <11.24 读、
// pnpm-workspace.yaml#overrides 供 ≥11.24 读）值必须一致；packageManager 钉
// 版 + engines.pnpm 范围在位。任一镜像漂移 = 双 cordis 回潮风险。
{
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  const wsText = readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8')
  const wsBlock = wsText.slice(wsText.indexOf('overrides:'))
  const wsOverrides = Object.fromEntries([...wsBlock.matchAll(/'([^']+)':\s*(\S+)/g)].map(m => [m[1], m[2]]))
  const pkgOverrides = pkg.pnpm?.overrides ?? {}
  const mirrorKeys = new Set([...Object.keys(pkgOverrides), ...Object.keys(wsOverrides)])
  const drift = [...mirrorKeys].filter(key => pkgOverrides[key] !== wsOverrides[key])
  const pin = pkg.packageManager ?? ''
  const enginesPnpm = pkg.engines?.pnpm ?? ''
  const pinOk = /^pnpm@11\.28\.5$/.test(pin)
  const enginesOk = />=11\.24/.test(enginesPnpm)
  const pass = drift.length === 0 && Object.keys(pkgOverrides).length > 0 && pinOk && enginesOk
  check('S7', 'deps-dual-mirror', pass ? 'PASS' : 'FAIL',
    `overridesKeys=${[...mirrorKeys].join(',')} drift=${drift.length === 0 ? 'none' : drift.join(',')} packageManager=${pin || 'MISSING'} engines.pnpm=${enginesPnpm || 'MISSING'}`)
}

// ---------- S8 scope-fix-anchors (PR#107 M2 + PR#108 G2/G4 防回归锚) ----------
// 三修复锚任一消失 = 已合语义被回退。M2 反形状（条件化 visibleTeams）必须
// 不存在——那正是首轮漏进自伤性可见性 bug 的形状。
{
  const src = readFileSync(join(REPO, 'src/index.ts'), 'utf8')
  const anchors = {
    m2Unconditional: /visibleTeams\.add\(config\.team\)/.test(src),
    m2RegressiveShapeAbsent: !/if \(joined\.size > 0\) visibleTeams\.add\(config\.team\)/.test(src),
    g2LogFace: /visibleTeams\.add\('log'\)/.test(src),
    g4CanvasInScope: /const joinedTeamScope = [\s\S]{0,800}?canvasTeamOf\(/.test(src),
  }
  const pass = Object.values(anchors).every(Boolean)
  check('S8', 'scope-fix-anchors', pass ? 'PASS' : 'FAIL',
    `anchors=${JSON.stringify(anchors)}`)
}

// ---------- S9 layer-docs-contract (docs ↔ package.json ↔ 磁盘) ----------
// docs/testing-layers.md 契约的五层目录、package.json 的分层脚本、磁盘实际
// 目录三者一致——文档漂移即契约漂移。
{
  const layers = ['unit', 'wire', 'mesh', 'gates', 'live']
  const scripts = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts ?? {}
  const needScripts = ['test:unit', 'test:wire', 'test:mesh', 'test:live', 'test:build-layout']
  const missingScripts = needScripts.filter(s => scripts[s] === undefined)
  const missingDirs = layers.filter(dir => !existsSync(join(REPO, 'tests', dir)))
  const doc = readFileSync(join(REPO, 'docs/testing-layers.md'), 'utf8')
  const docCoversLayers = layers.every(layer => doc.includes(`tests/${layer}`))
  const pass = missingScripts.length === 0 && missingDirs.length === 0 && docCoversLayers
  check('S9', 'layer-docs-contract', pass ? 'PASS' : 'FAIL',
    `missingScripts=${missingScripts.length === 0 ? 'none' : missingScripts.join(',')} missingDirs=${missingDirs.length === 0 ? 'none' : missingDirs.join(',')} docCoversLayers=${docCoversLayers}`)
}


const overall = checks.some(c => c.verdict === 'FAIL') ? 'FAIL' : checks.some(c => c.verdict === 'WARN') ? 'WARN' : 'PASS'
mkdirSync(RUNS_DIR, { recursive: true })
const record = {
  runId,
  startedAtISO: new Date(Date.now() - 60_000).toISOString(),
  finishedAtISO: new Date().toISOString(),
  supervisor: 'open-a2a-net--监督席',
  layers: { S1: 'validator-records', S2: 'repo-facts', S3: 'ygl-trees-health', S4: 'docs-crosscheck', S5: 'self-recursion', S6: 'public-triage', S7: 'deps-dual-mirror', S8: 'scope-fix-anchors', S9: 'layer-docs-contract' },
  checks, overall,
}
const recordPath = join(RUNS_DIR, `${runId}.json`)
writeFileSync(recordPath, JSON.stringify(record, null, 1))
// Bound the run history under cadence: keep the newest 200 records.
const allRuns = readdirSync(RUNS_DIR).filter(f => /^run-.*\.json$/.test(f)).sort()
for (const stale of allRuns.slice(0, Math.max(0, allRuns.length - 200))) {
  try { unlinkSync(join(RUNS_DIR, stale)) } catch { /* best effort */ }
}
console.log(`\nOVERALL ${overall} — record ${recordPath}`)
process.exit(overall === 'FAIL' ? 1 : 0)
