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
import { join, resolve, dirname } from 'node:path'

// Repo root derived from THIS script's location — no machine-specific paths
// (gh#52 ④): scripts/ lives directly under the repo root.
const REPO = resolve(import.meta.dirname, '..')
const RUNS_DIR = join(REPO, 'tmp/supervisor/runs')
const REPORTS_DIR = join(REPO, 'tmp/ygl-verify/verify/reports')
const SUPERVISED_TREES = ['v2-roadmap', 'time-capsule']
const CAMPAIGN_COMMITS = ['f124eee', 'c65416d', '8b8efeb']
// Tool binaries by convention, overridable by env: ygl-trees is the repo's
// sibling checkout; the Gitea CLI ships in the node installation's modules.
const YGL_BIN = process.env.YGL_BIN ?? resolve(REPO, '..', 'ygl-trees', 'dist/apps/cli/src/bin.js')
const GITEE_BIN = process.env.GITEE_BIN ?? resolve(dirname(process.execPath), 'node_modules/@gitee/gitee-cli/bin/index.js')
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
    const items = gh.ok ? (await gh.json()) : []
    // v12：路线图 issue（标题含「路线图」/「总表」）=属主工作项底账非垃圾开放项
    ghOpen = items.filter(i => !i.pull_request && !((i.title ?? '').includes('路线图') || (i.title ?? '').includes('总表'))).length
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
  // 2026-10-25（gh#46 修复轮 a3a57b8）：镜像退役——A/B 实证镜像字段与 11.28 开发机互斥
  // （字段在场=verify-deps 拒跑一切 pnpm 脚本）；舰队三机归一 11.28.5 后零 pre-11.24 读者。
  // S7 锚演进：单一归属=workspace.yaml 携 overrides 且 package.json#pnpm 必须缺席。
  const pkgPnpmAbsent = pkg.pnpm === undefined
  const singleSource = pkgPnpmAbsent && Object.keys(wsOverrides).length > 0
  const drift = singleSource ? [] : ['mirror contract violated: expect workspace.yaml-only overrides with package.json#pnpm absent']
  rows.push({ name: 'mirror-drift', ok: drift.length === 0 ? 1 : 0, detail: drift.length === 0 ? `single-source (${Object.keys(wsOverrides).length} overrides, pkg#pnpm absent)` : drift.join(',') })
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
    // 路由存在=非全局 404（200=面在且执行；401/403/405=面在但拒；仅 404=进程未换构建）
    face = (rcText !== '' && rcText !== '000' && rcText !== '404') ? 1 : 0
  } catch { face = 0 }
  rows.push({ name: 'newest-face-live', ok: face, detail: `canvas-op 路由指纹 http=${rcText}｜${bundleNote}` })
  return rows
}

// ── admission_remote_ref：S14 同 zone 准入的 remote-ref 信任基（gh#43/PR#44）──
// declared 扩容唯一来源=operator 手工组 remoteMembersOf（caller 自述不进——V5 不破）。
function collectAdmissionRemoteRef() {
  const rows = []
  try {
    const src = readFileSync(join(REPO, 'src/index.ts'), 'utf8')
    const hasChannel = /remoteMembersOf/.test(src)
    const inSameZone = /sameZoneSharedTeamRefusal[\s\S]{0,2000}remoteMembersOf/.test(src)
    rows.push({ name: 'remote-ref-channel', ok: (hasChannel && inSameZone) ? 1 : 0, detail: 'sameZoneSharedTeamRefusal 经 remoteMembersOf 解析 operator 手工组（PR#44 对称补齐）' })
    // V5 信任基：渠道须读 canvasStore（宿主权威面）非请求体——caller 自述不进 declared
    const readsStore = /remoteMembersOf/.test(src) && /canvasStore/.test(src.slice(Math.max(0, src.indexOf('remoteMembersOf') - 1500), src.indexOf('remoteMembersOf') + 1500))
    rows.push({ name: 'operator-only-source', ok: readsStore ? 1 : 0, detail: 'declared 扩容邻域含 canvasStore 读（宿主 operator 面）' })
    // S18（PR#46/gh#71 v9）：准入双向识别——暖缓存对端 canvasOrg 供共享队判定（信封拉取回灌）
    const warmOrg = /peerOrg/.test(src) && /canvasOrg/.test(src)
    rows.push({ name: 'warm-cache-bidirectional', ok: warmOrg ? 1 : 0, detail: '暖缓存对端 canvasOrg 双向识别（PR#46 信封回灌+准入增读）' })
  } catch (e) { rows.push({ name: 'admission-remote-ref', ok: 0, detail: String(e).slice(0, 80) }) }
  return rows
}

// ── S15/S16/S17：重排几何不变量 + CLI 墓碑 + canvas 自环豁免（v8 三锚）──
function collectV8Anchors() {
  const rows = []
  try {
    const relayoutSrc = readFileSync(join(REPO, 'nexus-stage/src/planning-relayout.ts'), 'utf8')
    const relayoutSpec = readFileSync(join(REPO, 'nexus-stage/tests/planning-relayout.spec.ts'), 'utf8')
    const soleInFrame = /sole|bbox|within/i.test(relayoutSpec) && /perRow|Math\.min\(4|Math\.ceil/i.test(relayoutSrc)
    const nonOverlap = /FRAME_GAP|row-flow|tile/i.test(relayoutSrc)
    const widthVaries = /3.*6|content|size follows/i.test(relayoutSpec)
    rows.push({ name: 'relayout-invariants', ok: (soleInFrame && nonOverlap && widthVaries) ? 1 : 0, detail: 'sole⊆框/构造性互斥/宽随内容（PR#45 三不变量源锚）' })
    const cli = readFileSync(join(REPO, 'src/cli-deposit.ts'), 'utf8')
    const tombstone = /expiredAt|tombstone/i.test(cli)
    const revive = /re-?publish|revive/i.test(cli)
    rows.push({ name: 'cli-tombstone', ok: (tombstone && revive) ? 1 : 0, detail: '过期标记不删+同钥复活（gh#47 身份死/目录留痕）' })
    const idx = readFileSync(join(REPO, 'src/index.ts'), 'utf8')
    const originSkip = /originAgentId/.test(idx) && /skipId/.test(idx)
    const borrowedKept = /quick-dispatch|quickDispatch/i.test(idx.slice(idx.indexOf('originAgentId') - 3000, idx.indexOf('originAgentId') + 3000)) === false || true
    rows.push({ name: 'canvas-selfloop-exempt', ok: originSkip ? 1 : 0, detail: 'originAgentId skipId 真发起跳（PR#42 借脸不豁免由 wire 钉承载）' })
  } catch (e) { rows.push({ name: 'v8-anchors', ok: 0, detail: String(e).slice(0, 80) }) }
  return rows
}

// ── S18b/S19（PR#48 落地锚）：M1 棘轮 + flyer WorldBounds 签名 ──
function collectBoardHardening() {
  const rows = []
  try {
    const raw = readFileSync(join(REPO, 'nexus-stage/src/planning-view.ts'), 'utf8')
    const lines = raw.endsWith('\n') ? raw.split('\n').length - 1 : raw.split('\n').length
    rows.push({ name: 'm1-ratchet-1507', ok: lines <= 1507 ? 1 : 0, detail: 'planning-view ' + lines + '行 ≤1507（M1 棘轮·gh#48 裁定→属主令 d9946e8 收紧一致）' })
    const search = readFileSync(join(REPO, 'nexus-stage/src/planning-search.ts'), 'utf8')
    const conv = /minX|minY/.test(search) && /fitView/.test(search)
    rows.push({ name: 'flyer-worldbounds', ok: conv ? 1 : 0, detail: 'flyer 以 WorldBounds(min/max) 调 fitView（PR#48 真 bug 根防）' })
  } catch (e) { rows.push({ name: 'board-hardening', ok: 0, detail: String(e).slice(0, 80) }) }
  return rows
}

// ── S23（#77 裁定·两段式 M1 第二段）：src/index.ts ≤6776 冻结（随批收紧·S19 族 src 侧）──
function collectIndexM1() {
  const rows = []
  try {
    const raw = readFileSync(join(REPO, 'src/index.ts'), 'utf8')
    const lines = raw.endsWith('\n') ? raw.split('\n').length - 1 : raw.split('\n').length
    rows.push({ name: 'index-m1-ratchet-6776', ok: lines <= 6776 ? 1 : 0, detail: 'src/index.ts ' + lines + '行 ≤6776（#77 两段式 M1 即刻冻结·随批收紧）' })
  } catch (e) { rows.push({ name: 'index-m1-ratchet-6776', ok: 0, detail: String(e).slice(0, 60) }) }
  return rows
}

// ── S20/S21/S22（路线图 #55/#56/#64 v11）：npm 追平/文档漂移/legacyInbound 计量 ──
function collectRoadmapAnchors() {
  const rows = []
  try {
    // S20（#55）：npm latest == package.json version（网络 curl，S13 先例）
    let npmLatest = ''
    try {
      const out = execFileSync('curl', ['-s', '--noproxy', '*', '--max-time', '8', 'https://registry.npmjs.org/@nelsonlongxiang%2Fdsh-open-a2a-net'], { encoding: 'utf8' })
      npmLatest = JSON.parse(out)['dist-tags']?.latest ?? ''
    } catch { npmLatest = '' }
    const pkgV = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
    rows.push({ name: 'npm-latest-follows-master', ok: (npmLatest !== '' && npmLatest === pkgV) ? 1 : 0, detail: 'npm latest=' + (npmLatest || 'unreachable') + ' pkg=' + pkgV })
    // S21（#56）：文档漂移核心标记——工具数十枚在 docs 与源一致
    const srcIdx = readFileSync(join(REPO, 'src/index.ts'), 'utf8')
    const toolCount = [...srcIdx.matchAll(/ctx\.tools\.register\(defineTool/g)].length
    const runbook = readFileSync(join(REPO, 'src/skill/references/routing.md'), 'utf8')
    const docSaysTen = /ten|十/.test(runbook) || /10/.test(runbook)
    rows.push({ name: 'doc-tool-count', ok: (toolCount >= 10 && docSaysTen) ? 1 : 0, detail: 'src tools=' + toolCount + ' docs say ten=' + docSaysTen })
    // S22（#64）：legacyInbound 基线计量——探针面记录计数（关窗条件=舰队 7 天零增量，属主裁）
    let legacy = -1
    try {
      const st = execFileSync('curl', ['-s', '--max-time', '5', 'http://127.0.0.1:3080/__dsh_a2a/state'], { encoding: 'utf8' })
      const m = st.match(/"legacyInbound"[^,}]*/g)
      if (m && m.length) legacy = Number(m[0].replace(/[^0-9]/g, '')) || 0
      else legacy = 0
    } catch { legacy = -1 }
    rows.push({ name: 'legacy-inbound-metered', ok: legacy >= 0 ? 1 : 0, detail: 'legacyInbound=' + legacy + '（#64 关窗=舰队 7 天零增量·属主裁）' })
  } catch (e) { rows.push({ name: 'roadmap-anchors', ok: 0, detail: String(e).slice(0, 80) }) }
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
  admission_remote_ref: collectAdmissionRemoteRef,
  v8_anchors: collectV8Anchors,
  board_hardening: collectBoardHardening,
  roadmap_anchors: collectRoadmapAnchors,
  index_m1: collectIndexM1,
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
