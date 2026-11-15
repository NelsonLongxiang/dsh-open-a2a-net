#!/usr/bin/env node
/**
 * verify-probe.mjs — 发布候选验证器的证据采集面（ygl-trees M13 snapshot 模式）。
 *
 * 职责边界（docs/validator.md）：
 *   本脚本在验证器之外运行真命令、真探针，把结果冻结成 verify/snapshot.sqlite；
 *   验证器（ygl-trees verify run）只在快照上做确定性 SQL 判定 —— 可重放、无时间函数。
 *
 * 采集面：
 *   repo_facts     仓库事实（版本、HEAD、工作树是否干净、dist 是否在库）
 *   quality_gates  质量门禁（typecheck / verify:docs / test:unit / test:wire / verify:nexus）
 *   runtime_probes 3081 运行时探针（nexus 页 / state 面）
 *   release_gate   发布闸门推导（候选就位、公网npmjs精确版本未发布）
 *
 * 用法：node scripts/verify-temp-clean.mjs -- node scripts/verify-probe.mjs
 *   [--candidate-root EXACT_EXPORT --candidate-sha FULL_SHA --source-repo EXISTING_REPO]
 *   [--base http://127.0.0.1:3081 | --runtime-unavailable]
 *   [--run-dir tmp/verify-probe/NEW_RUN]；输出摘要给出本轮 snapshot/submission 的精确路径。
 * 退出码：0 = 采集完成（不代表判定结果；判定由 verify run 出报告）。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, realpathSync, lstatSync, openSync, closeSync } from "node:fs";
import { inspectCandidateSource } from "./verify-submission.mjs";
import { dirname, resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const COLLECTOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let REPO = COLLECTOR_ROOT;
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) throw Error("--" + name + " requires a value");
  return value;
};
const BASE = flag("base", "http://127.0.0.1:3081");
const OUT = resolve(REPO, flag("out", "verify/snapshot.sqlite"));

// Additive post-publication audit mode. Never overwrite the historical RC snapshot or summary.
if (argv.includes('--release-audit')) {
  const directory = flag('release-audit', '')
  const requestedOut = flag('out', '')
  if (!directory || directory.startsWith('--') || !requestedOut || requestedOut.startsWith('--')) throw new Error('--release-audit DIR requires an explicit --out snapshot path')
  const { collectReleaseArtifactFacts } = await import('./verify-release-artifact.mjs')
  const rows = collectReleaseArtifactFacts(resolve(REPO, directory), REPO)
  const { DatabaseSync } = await import('node:sqlite')
  mkdirSync(dirname(OUT), { recursive: true })
  // New snapshot only: do not silently overwrite evidence or another run's database.
  if (existsSync(OUT)) throw new Error('release audit snapshot already exists; choose a new --out')
  const db = new DatabaseSync(OUT)
  try {
    db.exec('CREATE TABLE release_artifact_facts (name TEXT PRIMARY KEY, ok INTEGER NOT NULL, detail TEXT NOT NULL)')
    const insert = db.prepare('INSERT INTO release_artifact_facts VALUES (?,?,?)')
    for (const row of rows) insert.run(row.name, row.ok, row.detail)
  } finally { db.close() }
  console.log(JSON.stringify({ mode: 'retained-release-evidence-audit', snapshot: OUT, rows }, null, 2))
  process.exit(0) // Collection success is not a validator PASS; only verify run judges this snapshot.
}

// superagent p2 shadow acceptance: flatten one a2a Source's records into a new snapshot. Exit 0 collected, 1 run error,
// 2 usage error; one JSON object on stdout either way. Collection is not a PASS; only verify run judges the snapshot.
if (argv.includes('--a2a-shadow')) {
  const { collectA2aShadow, parseWindow, UsageError } = await import('./a2a-shadow-snapshot.mjs')
  const value = name => { const i = argv.indexOf(`--${name}`); const v = i >= 0 ? argv[i + 1] : undefined; return v === undefined || v.startsWith('--') ? '' : v }
  try {
    const [source, cliHome, out] = ['a2a-shadow', 'cli-home', 'out'].map(value)
    if (!source || !cliHome || !out) throw new UsageError('--a2a-shadow <superagent-db> requires --cli-home <dir>, --window <from>..<to> and --out <new snapshot>')
    const window = parseWindow(value('window'))
    const summary = await collectA2aShadow({ sourcePath: resolve(source), cliHome: resolve(cliHome), window, out: resolve(out) })
    // The collector's identity stands in for a tooling registration: an acceptance names this commit and these hashes,
    // and they must equal the ones at the collector PR's merge.
    const { createHash } = await import('node:crypto')
    const files = ['scripts/verify-probe.mjs', 'scripts/a2a-shadow-snapshot.mjs']
    const git = args => { const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null }
    const changed = git(['status', '--porcelain', '--', ...files])
    const collector = { commit: git(['rev-parse', 'HEAD']), clean: changed === null ? null : changed === '',
      sha256: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(resolve(REPO, f))).digest('hex')])) }
    console.log(JSON.stringify({ mode: 'a2a-shadow-snapshot', collector, snapshot: resolve(out), ...summary }))
    process.exit(0)
  } catch (error) {
    console.log(JSON.stringify({ error: String(error?.message ?? error) }))
    process.exit(error instanceof UsageError ? 2 : 1)
  }
}

// Early release-audit/shadow modes retain their original collector-root scope.
const requestedRoot = resolve(COLLECTOR_ROOT, flag("candidate-root", "."));
if (lstatSync(requestedRoot).isSymbolicLink()) throw Error("candidate root is a link");
REPO = realpathSync(requestedRoot);
const pkg = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8"));

/* ── 小工具 ─────────────────────────────────────────────── */
// Windows：pnpm/npm 是 .cmd 垫片，spawnSync 直呼 ENOENT —— 统一走 shell（参数均无空格/元字符）。
const SHELL = process.platform === "win32";
const run = (label, command, args, timeoutMs) => {
  const t0 = Date.now();
  const res = spawnSync(command, args, { cwd: REPO, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 << 20, shell: SHELL });
  const duration = Date.now() - t0;
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
  writeNew(join(RUN_DIR, label.replaceAll(":", "-") + ".log"), out);
  // gh#4: vitest prints one summary line per project plus a grand total —
  // summing every match double-counts. The LAST "N passed" line is the
  // grand total (single-project runs have exactly one).
  const last = (re) => Number([...out.matchAll(re)].at(-1)?.[1] ?? 0);
  const passed = last(/(\d+) passed/g);
  const failed = last(/(\d+) failed/g);
  const skipped = last(/(\d+) skipped/g);
  const killed = res.error?.code === "ETIMEDOUT";
  console.error(`[probe] ${label}: exit=${res.status ?? -1} ${duration}ms passed=${passed} failed=${failed}${killed ? " (TIMEOUT)" : ""}`);
  return { gate: label, exit_code: res.status ?? -1, signal: res.signal, error: res.error?.code ?? null, timed_out: killed, output_truncated: res.error?.code === "ENOBUFS", passed, failed, skipped, duration_ms: duration, stdout_tail: out.slice(-500) };
};

/* ── 1. 仓库事实 ────────────────────────────────────────── */
const candidateSha = flag("candidate-sha", undefined);
const sourceRepo = resolve(REPO, flag("source-repo", "."));
const source = inspectCandidateSource(REPO, candidateSha, sourceRepo);
const collector = REPO === realpathSync(COLLECTOR_ROOT) ? source : inspectCandidateSource(COLLECTOR_ROOT, flag("collector-sha", undefined), sourceRepo);
const collectorFiles = ["scripts/verify-probe.mjs", "scripts/verify-submission.mjs"].map(path => ({ path, sha256: createHash("sha256").update(readFileSync(resolve(COLLECTOR_ROOT, path))).digest("hex") }));
const gitHead = source.sha;
const gitDirty = source.clean ? "" : source.cleanDetail;
const distTracked = source.entries.filter(entry => entry.path.startsWith("assets/nexusDist/assets/")).length;
// Each collection owns a new run directory. Never overwrite a prior snapshot, summary or source export.
const projectTmp = resolve(REPO, "tmp"), runParent = resolve(projectTmp, "verify-probe");
for (const parent of [projectTmp, runParent]) {
  if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw Error("probe temporary parent is a link");
  mkdirSync(parent, { recursive: true });
}
const requestedRun = flag("run-dir", undefined);
const runPath = requestedRun === undefined ? mkdtempSync(join(runParent, "run-")) : resolve(REPO, requestedRun);
if (requestedRun !== undefined) {
  const rel = relative(runParent, runPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || dirname(runPath) !== runParent || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(rel)) throw Error("--run-dir must be a new direct child of project tmp/verify-probe");
  mkdirSync(runPath); // existing output is a refusal, not permission to clear it
}
const RUN_DIR = realpathSync(runPath);
const RC_OUT = argv.includes("--out") ? resolve(REPO, flag("out", "")) : join(RUN_DIR, "snapshot.sqlite");
if (dirname(RC_OUT) !== RUN_DIR || existsSync(RC_OUT)) throw Error("snapshot must be a new file inside this probe run directory");
const SUMMARY = join(RUN_DIR, "probe-summary.json");
const writeNew = (file, bytes) => writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
const repoFacts = [
  ["package_version", pkg.version],
  ["git_head", gitHead],
  ["git_clean", gitDirty ? "0" : "1"],
  ["dist_files_tracked", String(distTracked)],
  ["source_kind", source.kind],
  ["candidate_tree", source.tree],
  ["object_repository", realpathSync(sourceRepo)],
  ["candidate_root", REPO],
  ["collector_root", COLLECTOR_ROOT],
  ["collector_sha", collector.sha],
  ["source_manifest_sha256", createHash("sha256").update(JSON.stringify(source.entries)).digest("hex")],
  ["executable_modes_verified", source.executableModesVerified ? "1" : "0"],
];

/* ── 2. 质量门禁（真命令，限时） ────────────────────────── */
const gates = [
  run("typecheck", "pnpm", ["run", "typecheck"], 180_000),
  run("verify:docs", "pnpm", ["run", "verify:docs"], 180_000),
  run("test:unit", "pnpm", ["run", "test:unit"], 300_000),
  run("test:wire", "pnpm", ["run", "test:wire"], 300_000),
  ...(source.kind === "git-worktree" ? [run("verify:nexus", "pnpm", ["run", "verify:nexus"], 600_000)] : (() => {
    const steps = [
      run("nexus-install", process.execPath, ["scripts/verify-nexus-ci.mjs"], 180_000),
      run("nexus-build", "npm", ["--prefix", "nexus-stage", "run", "build"], 180_000),
      run("nexus-test", "npm", ["--prefix", "nexus-stage", "run", "test"], 300_000),
    ];
    let assetMatch = false;
    try {
      const entries = source.entries.filter(entry => entry.path.startsWith("assets/nexusDist/"));
      assetMatch = entries.length > 0 && entries.every(entry => createHash("sha256").update(readFileSync(resolve(REPO, entry.path))).digest("hex") === entry.sha256);
    } catch {}
    return [{ gate: "verify:nexus", exit_code: steps.every(step => step.exit_code === 0) && assetMatch ? 0 : 1, passed: steps.at(-1).passed, failed: steps.at(-1).failed, skipped: steps.at(-1).skipped, duration_ms: steps.reduce((sum, step) => sum + step.duration_ms, 0), stdout_tail: JSON.stringify({ steps: steps.map(step => ({ gate: step.gate, exit_code: step.exit_code })), exact_candidate_dist_bytes: assetMatch }) }];
  })()),
];

/* ── 3. 运行时探针（3081） ──────────────────────────────── */
const probeRuntime = async () => {
  const rows = [];
  const t = new Date().toISOString();
  if (argv.includes("--runtime-unavailable")) {
    for (const endpoint of ["nexus_page", "state"]) rows.push({ endpoint, http_status: 0, version: null, peers: null, isolated: null, sessions_live: null, sessions_cold: null, remote_rows: null, ledger_pending: null, ledger_dead: null, ledger_archived: null, checked_at: t });
    console.error("[probe] runtime unavailable: no authorized candidate runtime window; no HTTP calls made");
    return rows;
  }
  try {
    const page = await fetch(`${BASE}/__dsh_a2a_nexus/`, { signal: AbortSignal.timeout(8_000) });
    await page.text();
    rows.push({ endpoint: "nexus_page", http_status: page.status, version: null, peers: null, isolated: null, sessions_live: null, sessions_cold: null, remote_rows: null, ledger_pending: null, ledger_dead: null, ledger_archived: null, checked_at: t });
  } catch (e) {
    rows.push({ endpoint: "nexus_page", http_status: 0, version: null, peers: null, isolated: null, sessions_live: null, sessions_cold: null, remote_rows: null, ledger_pending: null, ledger_dead: null, ledger_archived: null, checked_at: t });
    console.error(`[probe] nexus_page: unreachable (${e.message})`);
  }
  try {
    const r = await fetch(`${BASE}/__dsh_a2a/state`, { signal: AbortSignal.timeout(8_000) });
    const j = await r.json();
    const sessions = Array.isArray(j.sessions) ? j.sessions : [];
    const live = sessions.filter((s) => s.live).length;
    const cold = sessions.length - live;
    const cnt = (x) => (Array.isArray(x) ? x.length : typeof x === "number" ? x : null);
    rows.push({
      endpoint: "state",
      http_status: r.status,
      version: typeof j.version === "string" ? j.version : null,
      peers: cnt(j.peers),
      isolated: j.isolated === true ? 1 : 0,
      sessions_live: live,
      sessions_cold: cold,
      remote_rows: cnt(j.remote),
      // /state 台账面：tasks=pending 数组、tasksDead=死信数组、archivedCount=数字
      ledger_pending: cnt(j.tasks),
      ledger_dead: cnt(j.tasksDead),
      ledger_archived: cnt(j.archivedCount),
      checked_at: t,
    });
  } catch (e) {
    rows.push({ endpoint: "state", http_status: 0, version: null, peers: null, isolated: null, sessions_live: null, sessions_cold: null, remote_rows: null, ledger_pending: null, ledger_dead: null, ledger_archived: null, checked_at: t });
    console.error(`[probe] state: unreachable (${e.message})`);
  }
  return rows;
};
const runtimeRows = await probeRuntime();
const stateRow = runtimeRows.find((r) => r.endpoint === "state");

/* ── 4. 发布闸门推导 ────────────────────────────────────── */
const regUrl = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
let regState = "unverified";
const regCheckedAt = new Date().toISOString();
try {
  const reg = await fetch(regUrl, { signal: AbortSignal.timeout(8_000) });
  if (reg.status === 404) regState = "absent";
  else if (reg.ok) { const body = await reg.json(); if (body.version === pkg.version) regState = "published"; }
  else console.error(`[probe] public npmjs exact version HTTP ${reg.status}`);
} catch (e) { console.error(`[probe] public npmjs exact version: ${e.message}`); }
const gateRows = [
  {
    rule: "candidate_on_3081",
    holds: stateRow && stateRow.version === pkg.version ? 1 : 0,
    detail: `pkg=${pkg.version} 3081=${stateRow?.version ?? "unreachable"} npmjs=${regState}`,
  },
  {
    rule: "unpublished_in_registry",
    holds: regState === "absent" ? 1 : 0,
    detail: `npmjs ${pkg.version} exact version: ${regState}`,
  },
  { rule: "worktree_clean", holds: gitDirty ? 0 : 1, detail: gitDirty ? gitDirty.split("\n").slice(0, 3).join("; ") : "clean" },
];

/* ── 5. 导出提交树（验证器 file 检查的 submission 面） ──── */
// Recheck every committed source byte after real gates; no ignored read error or stale ancestor HEAD.
const after = inspectCandidateSource(REPO, source.sha, sourceRepo);
if (JSON.stringify(after.entries) !== JSON.stringify(source.entries) || after.clean !== source.clean) throw Error("candidate source changed during collection");
const collectorAfter = inspectCandidateSource(COLLECTOR_ROOT, collector.sha, sourceRepo);
if (JSON.stringify(collectorAfter.entries) !== JSON.stringify(collector.entries)) throw Error("collector source changed during collection");
const SUBMISSION = mkdtempSync(join(RUN_DIR, "dsh-a2a-submission-"));
const tracked = source.entries.map(entry => entry.path);
for (const rel of tracked) {
  const dest = resolve(SUBMISSION, rel);
  mkdirSync(dirname(dest), { recursive: true });
  const bytes = readFileSync(resolve(REPO, rel));
  if (createHash("sha256").update(bytes).digest("hex") !== source.entries.find(entry => entry.path === rel).sha256) throw Error("source changed during submission export: " + rel);
  writeNew(dest, bytes);
}
writeNew(join(RUN_DIR, "source-manifest.json"), JSON.stringify({ sha: source.sha, tree: source.tree, kind: source.kind, files: source.entries }, null, 2) + "\n");
console.error(`[probe] submission exported: ${tracked.length} tracked files -> ${SUBMISSION}`);

/* ── 6. 冻结成 sqlite ───────────────────────────────────── */
const { DatabaseSync } = await import("node:sqlite");
// Reserve a new owned path before SQLite opens it; never rm an earlier evidence database.
const reserved = openSync(RC_OUT, "wx", 0o600); closeSync(reserved);
const db = new DatabaseSync(RC_OUT);
db.exec(`
CREATE TABLE repo_facts (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE quality_gates (gate TEXT PRIMARY KEY, exit_code INTEGER NOT NULL, passed INTEGER, failed INTEGER, skipped INTEGER, duration_ms INTEGER NOT NULL, stdout_tail TEXT);
CREATE TABLE runtime_probes (endpoint TEXT PRIMARY KEY, http_status INTEGER, version TEXT, peers INTEGER, isolated INTEGER, sessions_live INTEGER, sessions_cold INTEGER, remote_rows INTEGER, ledger_pending INTEGER, ledger_dead INTEGER, ledger_archived INTEGER, checked_at TEXT NOT NULL);
CREATE TABLE release_gate (rule TEXT PRIMARY KEY, holds INTEGER NOT NULL, detail TEXT);
`);
const ins = (sql, rows) => { const s = db.prepare(sql); for (const r of rows) s.run(...r); };
ins("INSERT INTO repo_facts VALUES (?,?)", repoFacts);
ins("INSERT INTO quality_gates VALUES (?,?,?,?,?,?,?)", gates.map((g) => [g.gate, g.exit_code, g.passed, g.failed, g.skipped, g.duration_ms, g.stdout_tail]));
ins("INSERT INTO runtime_probes VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", runtimeRows.map((r) => [r.endpoint, r.http_status, r.version, r.peers, r.isolated, r.sessions_live, r.sessions_cold, r.remote_rows, r.ledger_pending, r.ledger_dead, r.ledger_archived, r.checked_at]));
ins("INSERT INTO release_gate VALUES (?,?,?)", gateRows.map((g) => [g.rule, g.holds, g.detail]));
db.close();

const summary = {
  package_version: pkg.version,
  git_head: gitHead,
  candidate_sha: gitHead,
  source_kind: source.kind,
  collector_root: COLLECTOR_ROOT,
  collector_sha: collector.sha,
  collector_files: collectorFiles,
  candidate_root: REPO,
  object_repository: realpathSync(sourceRepo),
  executable_modes_verified: source.executableModesVerified,
  executable_mode_scope: source.executableModeScope,
  candidate_tree: source.tree,
  source_manifest: join(RUN_DIR, "source-manifest.json"),
  submission_root: RUN_DIR,
  git_clean: !gitDirty,
  gates: Object.fromEntries(gates.map((g) => [g.gate, { exit: g.exit_code, passed: g.passed, failed: g.failed }])),
  gate_observations: gates,
  runtime: Object.fromEntries(runtimeRows.map((r) => [r.endpoint, r.http_status === 200
    ? { ok: true, source: `${BASE}/${r.endpoint === "state" ? "__dsh_a2a/state" : "__dsh_a2a_nexus/"}`, checked_at: r.checked_at, version: r.version, peers: r.peers, isolated: r.isolated === null ? null : r.isolated === 1, dead: r.ledger_dead }
    : { ok: false, source: `${BASE}/${r.endpoint === "state" ? "__dsh_a2a/state" : "__dsh_a2a_nexus/"}`, checked_at: r.checked_at, status: r.http_status }])),
  release_gate: Object.fromEntries(gateRows.map((g) => [g.rule, !!g.holds])),
  release_evidence: { source: regUrl, checked_at: regCheckedAt, exact_version: pkg.version, registry_state: regState },
  snapshot: RC_OUT,
  submission: SUBMISSION,
};
writeNew(SUMMARY, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
