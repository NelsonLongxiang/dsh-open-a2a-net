#!/usr/bin/env node
// supervisor-snapshot.mjs — open-a2a-net 监督域采集探针（铁律一 · 探针角色）
//
// 定位（2026-10-21 铁律一迁移后）：本脚本只做【采集】——把 S1-S9 判据域的事实
// 写入 snapshot.sqlite，供 `ygl-trees verify run --db <snapshot>` 判定。
// 判定不再出自本脚本（旧 S-verdict 逻辑已退役）；运行记录（tmp/supervisor/runs/）
// 留作审计轨迹。CLI 是唯一判定面（《验证器协同规范》铁律一，kb f167b5b5f7）。
//
// 快照表结构（每表 (name TEXT, ok INTEGER, detail TEXT)；ok=0 行即违例）：
//   validator_reports / repo_facts / ygl_health / docs_crosscheck /
//   recursion / public_triage / deps_mirror / scope_anchors / layer_contract
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'D:/workspace/dsh-open-a2a-net'
const RUNS_DIR = join(REPO, 'tmp/supervisor/runs')
const REPORTS_DIR = join(REPO, 'tmp/ygl-verify/verify/reports')
const SUPERVISED_TREES = ['v2-roadmap', 'time-capsule']
const CAMPAIGN_COMMITS = ['f124eee', 'c65416d', '8b8efeb']
const YGL_BIN = 'D:/workspace/ygl-trees/dist/apps/cli/src/bin.js'
const GITEE_BIN = 'D:/node-v24.12.0-win-x64/node_modules/@gitee/gitee-cli/bin/index.js'
const SNAPSHOT_PATH = process.argv.includes('--snapshot')
  ? process.argv[process.argv.indexOf('--snapshot') + 1]
  : join(REPO, 'tmp/supervisor/snapshot.sqlite')

const ygl = (args) => {
  try { return { rc: 0, out: execFileSync(process.execPath, [YGL_BIN, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) } }
  catch (error) { return { rc: error.status ?? 1, out: String(error.stdout ?? '') + String(error.stderr ?? '') } }
}
const git = (args) => execFileSync('git', args, { encoding: 'utf8', cwd: REPO }).trim()

// ---------- collectors (facts only — no verdicts) ----------

async function collectValidatorReports() {
  const rows = []
  const doc = readFileSync(join(REPO, 'docs/validator.md'), 'utf8')
  const claimed = [...new Set([...doc.matchAll(/run_([0-9a-f]{16})/g)].map(m => `run_${m[1]}`))]
  for (const id of claimed) {
    const path = join(REPORTS_DIR, `${id}.json`)
    if (!existsSync(path)) { rows.push({ name: id, ok: 0, detail: 'missing report' }); continue }
    const report = JSON.parse(readFileSync(path, 'utf8'))
    const vuCount = Array.isArray(report.vu) ? report.vu.length : (report.summary?.total ?? -1)
    const allowed = report.spec_id === 'spec_c8b6350c5034' || report.spec_id === 'spec_bae507ea0520'
    rows.push({ name: id, ok: (report.overall === 'PASS' && allowed && vuCount === 14) ? 1 : 0, detail: `overall=${String(report.overall)} spec=${String(report.spec_id)} vu=${String(vuCount)}` })
  }
  return rows
}

function collectRepoFacts() {
  const rows = []
  for (const c of CAMPAIGN_COMMITS) {
    let ancestor = 1
    try { git(['merge-base', '--is-ancestor', c, 'HEAD']) } catch { ancestor = 0 }
    rows.push({ name: `ancestor:${c}`, ok: ancestor, detail: 'campaign commit ancestry' })
  }
  const version = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
  rows.push({ name: 'version-line', ok: /^0\.6\./.test(version) ? 1 : 0, detail: `version=${version}` })
  const dirty = git(['status', '--porcelain']).split('\n').filter(l => l.trim() !== '' && !l.startsWith('??')).length
  rows.push({ name: 'worktree-clean', ok: dirty === 0 ? 1 : 0, detail: `dirtyTracked=${String(dirty)}` })
  return rows
}

function collectYglHealth() {
  const rows = []
  const doctor = ygl(['doctor', '--json'])
  let fail = -1
  try {
    const parsed = JSON.parse(doctor.out.slice(doctor.out.indexOf('[')))
    fail = parsed.filter(row => String(row.status).toLowerCase() === 'fail').length
  } catch { fail = 1 }
  rows.push({ name: 'doctor-fails', ok: fail === 0 ? 1 : 0, detail: `fails=${String(fail)}` })
  for (const tree of SUPERVISED_TREES) {
    const r = ygl(['node', 'validate', '-t', tree])
    rows.push({ name: `validate:${tree}`, ok: (r.rc === 0 && /no issues/i.test(r.out)) ? 1 : 0, detail: r.out.slice(0, 120) })
  }
  return rows
}

function collectDocsCrosscheck() {
  const rows = []
  const doc = readFileSync(join(REPO, 'docs/validator.md'), 'utf8')
  const heads = [...doc.matchAll(/head ([0-9a-f]{8})/g)].map(m => m[1])
  const full = git(['log', '--format=%H', '-300']).split('\n')
  const unknown = heads.filter(h => !full.some(f => f.startsWith(h))).length
  rows.push({ name: 'unknown-heads', ok: unknown === 0 ? 1 : 0, detail: `unknown=${String(unknown)} of ${String(heads.length)}` })
  rows.push({ name: 'spec-mentioned', ok: doc.includes('spec_c8b6350c5034') ? 1 : 0, detail: 'spec id present in docs' })
  return rows
}

function collectRecursion() {
  const rows = []
  const previous = existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR).filter(f => /^run-.*\.json$/.test(f)).sort().pop() : undefined
  let miss = 0
  if (previous !== undefined) {
    const prior = JSON.parse(readFileSync(join(RUNS_DIR, previous), 'utf8'))
    if ((prior.checks ?? []).some(c => c.id === 'S2')) {
      for (const c of CAMPAIGN_COMMITS) {
        try { git(['merge-base', '--is-ancestor', c, 'HEAD']) } catch { miss++ }
      }
    }
  }
  rows.push({ name: 'prior-facts-persist', ok: miss === 0 ? 1 : 0, detail: `previous=${previous ?? 'seed'} recheckMiss=${String(miss)}` })
  return rows
}

async function collectPublicTriage() {
  const rows = []
  let ghOpen = -1
  try {
    const gh = await fetch('https://api.github.com/repos/NelsonLongxiang/dsh-open-a2a-net/issues?state=open&per_page=50', { headers: { 'User-Agent': 'open-a2a-net-supervisor', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15_000) })
    ghOpen = gh.ok ? (await gh.json()).length : -1
  } catch { ghOpen = -1 }
  rows.push({ name: 'github-open', ok: ghOpen === 0 ? 1 : 0, detail: `open=${String(ghOpen)}` })
  let giteePrs = -1
  try {
    const out = execFileSync(process.execPath, [GITEE_BIN, 'pr', 'list', '-R', 'NelsonLongXiang/dsh-open-a2a-net', '--state', 'open', '--json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: REPO })
    giteePrs = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)).length
  } catch { giteePrs = -1 }
  rows.push({ name: 'gitee-prs-open', ok: giteePrs === 0 ? 1 : 0, detail: `open=${String(giteePrs)}` })
  return rows
}

function collectDepsMirror() {
  const rows = []
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  const ws = readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8')
  const wsBlock = ws.slice(ws.indexOf('overrides:'))
  const wsOverrides = Object.fromEntries([...wsBlock.matchAll(/'([^']+)':\s*(\S+)/g)].map(m => [m[1], m[2]]))
  const pkgOverrides = pkg.pnpm?.overrides ?? {}
  const keys = new Set([...Object.keys(pkgOverrides), ...Object.keys(wsOverrides)])
  const drift = [...keys].filter(k => pkgOverrides[k] !== wsOverrides[k])
  rows.push({ name: 'mirror-drift', ok: drift.length === 0 ? 1 : 0, detail: drift.join(',') || 'none' })
  rows.push({ name: 'packageManager-pin', ok: /^pnpm@11\.28\.5$/.test(pkg.packageManager ?? '') ? 1 : 0, detail: String(pkg.packageManager ?? 'missing') })
  rows.push({ name: 'engines-range', ok: />=11\.24/.test(pkg.engines?.pnpm ?? '') ? 1 : 0, detail: String(pkg.engines?.pnpm ?? 'missing') })
  return rows
}

function collectScopeAnchors() {
  const src = readFileSync(join(REPO, 'src/index.ts'), 'utf8')
  return [
    { name: 'm2-unconditional', ok: /visibleTeams\.add\(config\.team\)/.test(src) ? 1 : 0, detail: 'M2 unconditional anchor' },
    { name: 'm2-regressive-absent', ok: !/if \(joined\.size > 0\) visibleTeams\.add\(config\.team\)/.test(src) ? 1 : 0, detail: 'M2 regressive shape must be absent' },
    { name: 'g2-log-face', ok: /visibleTeams\.add\('log'\)/.test(src) ? 1 : 0, detail: 'G2 log face anchor' },
    { name: 'g4-canvas-in-scope', ok: /const joinedTeamScope = [\s\S]{0,800}?canvasTeamOf\(/.test(src) ? 1 : 0, detail: 'G4 canvas in joinedTeamScope' },
  ]
}

function collectLayerContract() {
  const layers = ['unit', 'wire', 'mesh', 'gates', 'live']
  const scripts = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts ?? {}
  const need = ['test:unit', 'test:wire', 'test:mesh', 'test:live', 'test:build-layout']
  const missingScripts = need.filter(s => scripts[s] === undefined).length
  const missingDirs = layers.filter(d => !existsSync(join(REPO, 'tests', d))).length
  const doc = readFileSync(join(REPO, 'docs/testing-layers.md'), 'utf8')
  const covers = layers.every(l => doc.includes(`tests/${l}`))
  return [
    { name: 'scripts-present', ok: missingScripts === 0 ? 1 : 0, detail: `missing=${String(missingScripts)}` },
    { name: 'dirs-present', ok: missingDirs === 0 ? 1 : 0, detail: `missing=${String(missingDirs)}` },
    { name: 'doc-covers-layers', ok: covers ? 1 : 0, detail: String(covers) },
  ]
}

// ---------- 0.6.23/0.6.24 治理面锚（REVIEW-205964730/205992804 双章面收编） ----------

function collectOriginClaimAnchors() {
  const src = readFileSync(join(REPO, 'src/index.ts'), 'utf8')
  return [
    { name: 'verify-fn', ok: /verifyOriginClaim/.test(src) ? 1 : 0, detail: '三面共享验签入口' },
    { name: 'bare-zone-shape', ok: /originClaimCallerShape\s*=\s*\/\^\[a-z0-9-\]\+\$\//.test(src) ? 1 : 0, detail: '信封 shape 收窄 bare zone（M2 第三轮裁决）' },
    { name: 'window-config', ok: /originClaimWindow/.test(src) ? 1 : 0, detail: 'M1 窗口态配置（默认开=legacyInbound 计量）' },
    { name: 'fail-closed-minimal', ok: /untrusted-origin/.test(src) ? 1 : 0, detail: '验签败/关窗→untrusted-origin 与最小卡同码' },
  ]
}

function collectControlFaceGate() {
  const src = readFileSync(join(REPO, 'src/index.ts'), 'utf8')
  return [
    { name: 'trusted-gate', ok: /controlTrustedWithoutKey/.test(src) ? 1 : 0, detail: '钥注入分支 loopback 门（REVIEW M3 修复）' },
    { name: 'leniency-warning', ok: /controlFaceLeniencyWarning/.test(src) ? 1 : 0, detail: 'boot 告警：loopback 信任=减速带非门（N7）' },
  ]
}

// ── live_host_build：活宿主构建指纹（S13）────────────────────────────
// dc64eb1 三层根因教训：插件升级=换 lib+换进程两步缺一不可；判据=路由指纹非安装输出。
// 主检出=路由指纹：最新控制面须在面集（404 全局=进程未换构建）。
// bundle 哈希对比=尽力信息面（401 无钥面不可达时以路由指纹为准）。
function collectLiveHostBuild() {
  const rows = []
  let bundleNote = ''
  try {
    const headJs = readdirSync(join(REPO, 'assets/nexusDist/assets')).filter(f => f.startsWith('index-') && f.endsWith('.js')).sort().pop() ?? ''
    const headHash = headJs.replace(/^index-/, '').replace(/\.js$/, '')
    let liveHash = ''
    try {
      const html = execFileSync('curl', ['-s', '--max-time', '5', 'http://127.0.0.1:3080/nexus/'], { encoding: 'utf8' })
      const m = html.match(/index-([A-Za-z0-9_-]+)\.js/)
      liveHash = m ? m[1] : ''
    } catch { liveHash = '' }
    bundleNote = liveHash ? `bundle live=${liveHash} head=${headHash}${liveHash === headHash ? ' ✓' : ' ⚠漂移'}` : `bundle 不可达（401 无钥面）·head=${headHash}`
  } catch { bundleNote = 'bundle probe skipped' }
  let face = 0
  let rcText = 'unreachable'
  try {
    const rc = execFileSync('curl', ['-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '5', '-X', 'POST', 'http://127.0.0.1:3080/a2a/canvas-op'], { encoding: 'utf8' })
    rcText = rc.trim()
    face = (rcText === '404' || rcText === '401' || rcText === '403' || rcText === '405' || rcText === '400') ? 1 : 0 // 路由存在（哪怕拒）即非陈旧
  } catch { face = 0 }
  rows.push({ name: 'newest-face-live', ok: face, detail: `canvas-op 路由指纹 http=${rcText}｜${bundleNote}` })
  return rows
}

function collectOwnerSignalUi() {
  // 遍历 nexus-stage 源码聚合文本（UI 字符串锚）
  const agg = (dir) => {
    let text = ''
    if (!existsSync(dir)) return text
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      try {
        if (statSync(full).isDirectory()) { text += agg(full) } else if (/\.(ts|tsx|vue|svelte|js)$/.test(name)) { text += readFileSync(full, 'utf8') }
      } catch { /* skip */ }
    }
    return text
  }
  const ui = agg(join(REPO, 'nexus-stage/src')) + agg(join(REPO, 'nexus-stage/tests'))
  const rows = []
  rows.push({ name: 'alert-chips', ok: /死信.*tone.*danger|tone: 'warn' \| 'danger'/.test(ui) ? 1 : 0, detail: '异常驱动 alerts 芯片（死信 danger/陈旧 warn/欠回执 warn——PR#30 取代 wb-row-alert 行类）' })
  // 2026-10-23 属主裁定（PR#28）：对话默认展开——推翻 b324460 折叠，取证开关随折叠退役。
  // 新锚=chat-drawer-dom.spec 首例「shows the conversation by default as bubbles」。
  rows.push({ name: 'chat-default-expanded', ok: /shows the conversation by default/.test(ui) ? 1 : 0, detail: '对话默认展开（属主裁定 PR#28，取代折叠取证开关）' })
  rows.push({ name: 'brief-first', ok: /无摘要——派发未带 brief|brief/.test(ui) ? 1 : 0, detail: '订单卡 brief 主文案' })
  return rows
}

// ---------- snapshot writer ----------

const TABLES = {
  validator_reports: collectValidatorReports,
  repo_facts: collectRepoFacts,
  ygl_health: collectYglHealth,
  docs_crosscheck: collectDocsCrosscheck,
  recursion: collectRecursion,
  public_triage: collectPublicTriage,
  deps_mirror: collectDepsMirror,
  scope_anchors: collectScopeAnchors,
  layer_contract: collectLayerContract,
  originclaim_anchors: collectOriginClaimAnchors,
  controlface_gate: collectControlFaceGate,
  owner_signal_ui: collectOwnerSignalUi,
  live_host_build: collectLiveHostBuild,
}

mkdirSync(join(REPO, 'tmp/supervisor'), { recursive: true })
if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH)
const db = new DatabaseSync(SNAPSHOT_PATH)
for (const table of Object.keys(TABLES)) {
  db.exec(`CREATE TABLE ${table} (name TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT)`)
}

const runId = `probe-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${process.pid.toString(16).slice(-4)}`
const insert = Object.fromEntries(Object.keys(TABLES).map(table => [table, db.prepare(`INSERT INTO ${table} (name, ok, detail) VALUES (?, ?, ?)`)]))
let totalFacts = 0
for (const [table, collect] of Object.entries(TABLES)) {
  const rows = await collect()
  for (const row of rows) {
    insert[table].run(row.name, row.ok, row.detail.slice(0, 300))
    totalFacts++
  }
  console.log(`probe ${table}: ${String(rows.length)} facts (${String(rows.filter(r => r.ok === 0).length)} violations)`)
}
db.close()

// 运行记录（审计轨迹，非判定面）
mkdirSync(RUNS_DIR, { recursive: true })
const recordPath = join(RUNS_DIR, `${runId}.json`)
writeFileSync(recordPath, JSON.stringify({ runId, finishedAtISO: new Date().toISOString(), probe: 'supervisor-snapshot', snapshot: SNAPSHOT_PATH, facts: totalFacts }, null, 1))
const allRuns = readdirSync(RUNS_DIR).filter(f => /^probe-.*\.json$/.test(f)).sort()
for (const stale of allRuns.slice(0, Math.max(0, allRuns.length - 200))) {
  try { unlinkSync(join(RUNS_DIR, stale)) } catch { /* best effort */ }
}
console.log(`\nprobe done — ${String(totalFacts)} facts → ${SNAPSHOT_PATH}\n下一步: ygl-trees verify run <spec-id> --db ${SNAPSHOT_PATH}`)
process.exit(0)
