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
 *   quality_gates  质量门禁（typecheck / test:unit / test:wire / verify:nexus）
 *   runtime_probes 3081 运行时探针（nexus 页 / state 面）
 *   release_gate   发布闸门推导（候选就位、私仓未发版）
 *
 * 用法：node scripts/verify-probe.mjs [--base http://127.0.0.1:3081] [--out verify/snapshot.sqlite]
 * 退出码：0 = 采集完成（不代表判定结果；判定由 verify run 出报告）。
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const BASE = flag("base", "http://127.0.0.1:3081");
const OUT = resolve(REPO, flag("out", "verify/snapshot.sqlite"));

const pkg = JSON.parse(readFileSync(resolve(REPO, "package.json"), "utf8"));

/* ── 小工具 ─────────────────────────────────────────────── */
// Windows：pnpm/npm 是 .cmd 垫片，spawnSync 直呼 ENOENT —— 统一走 shell（参数均无空格/元字符）。
const SHELL = process.platform === "win32";
const run = (label, command, args, timeoutMs) => {
  const t0 = Date.now();
  const res = spawnSync(command, args, { cwd: REPO, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 << 20, shell: SHELL });
  const duration = Date.now() - t0;
  const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  // vitest 汇总行：`Tests  123 passed | 4 skipped`（多段跑取全部求和）
  const passed = [...out.matchAll(/(\d+) passed/g)].reduce((a, m) => a + Number(m[1]), 0);
  const failed = [...out.matchAll(/(\d+) failed/g)].reduce((a, m) => a + Number(m[1]), 0);
  const skipped = [...out.matchAll(/(\d+) skipped/g)].reduce((a, m) => a + Number(m[1]), 0);
  const killed = res.error?.code === "ETIMEDOUT";
  console.error(`[probe] ${label}: exit=${res.status ?? -1} ${duration}ms passed=${passed} failed=${failed}${killed ? " (TIMEOUT)" : ""}`);
  return { gate: label, exit_code: res.status ?? -1, passed, failed, skipped, duration_ms: duration, stdout_tail: out.slice(-500) };
};

/* ── 1. 仓库事实 ────────────────────────────────────────── */
const git = (args) => spawnSync("git", args, { cwd: REPO, encoding: "utf8" }).stdout?.trim() ?? "";
const gitHead = git(["rev-parse", "HEAD"]);
const gitDirty = git(["status", "--porcelain"]);
const distTracked = git(["ls-files", "assets/nexusDist/assets"]).split("\n").filter(Boolean).length;
const repoFacts = [
  ["package_version", pkg.version],
  ["git_head", gitHead],
  ["git_clean", gitDirty ? "0" : "1"],
  ["dist_files_tracked", String(distTracked)],
];

/* ── 2. 质量门禁（真命令，限时） ────────────────────────── */
const gates = [
  run("typecheck", "pnpm", ["run", "typecheck"], 180_000),
  run("test:unit", "pnpm", ["run", "test:unit"], 300_000),
  run("test:wire", "pnpm", ["run", "test:wire"], 300_000),
  run("verify:nexus", "pnpm", ["run", "verify:nexus"], 600_000),
];

/* ── 3. 运行时探针（3081） ──────────────────────────────── */
const probeRuntime = async () => {
  const rows = [];
  const t = new Date().toISOString();
  try {
    const page = await fetch(`${BASE}/__dsh_a2a_nexus/`);
    await page.text();
    rows.push({ endpoint: "nexus_page", http_status: page.status, version: null, peers: null, sessions_live: null, sessions_cold: null, remote_rows: null, ledger_pending: null, ledger_dead: null, ledger_archived: null, checked_at: t });
  } catch (e) {
    rows.push({ endpoint: "nexus_page", http_status: 0, version: null, peers: null, sessions_live: null, sessions_cold: null, remote_rows: null, ledger_pending: null, ledger_dead: null, ledger_archived: null, checked_at: t });
    console.error(`[probe] nexus_page: unreachable (${e.message})`);
  }
  try {
    const r = await fetch(`${BASE}/__dsh_a2a/state`);
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
    rows.push({ endpoint: "state", http_status: 0, version: null, peers: null, sessions_live: null, sessions_cold: null, remote_rows: null, ledger_pending: null, ledger_dead: null, ledger_archived: null, checked_at: t });
    console.error(`[probe] state: unreachable (${e.message})`);
  }
  return rows;
};
const runtimeRows = await probeRuntime();
const stateRow = runtimeRows.find((r) => r.endpoint === "state");

/* ── 4. 发布闸门推导 ────────────────────────────────────── */
const regView = spawnSync("npm", ["view", `${pkg.name}`, "version"], { cwd: REPO, encoding: "utf8", timeout: 60_000, shell: SHELL });
const regLatest = (regView.stdout ?? "").trim() || null;
const gateRows = [
  {
    rule: "candidate_on_3081",
    holds: stateRow && stateRow.version === pkg.version ? 1 : 0,
    detail: `pkg=${pkg.version} 3081=${stateRow?.version ?? "unreachable"} registry=${regLatest ?? "?"}`,
  },
  {
    rule: "unpublished_in_registry",
    holds: regLatest && regLatest !== pkg.version ? 1 : 0,
    detail: regLatest === pkg.version ? `registry latest ${regLatest} == candidate ${pkg.version}（已发版 —— 候选期违例）` : `registry latest ${regLatest ?? "none"} != candidate ${pkg.version}`,
  },
  { rule: "worktree_clean", holds: gitDirty ? 0 : 1, detail: gitDirty ? gitDirty.split("\n").slice(0, 3).join("; ") : "clean" },
];

/* ── 5. 导出提交树（验证器 file 检查的 submission 面） ──── */
// 不用工作树本身：.claude/worktrees 里有 pnpm junction 环（walk ELOOP），且 node_modules 是非提交物。
// 提交面 = git ls-files 的导出 —— 与「提交物」语义严格一致。
// 位置必须在仓库外（os tmpdir）：放进 repo 的 tmp/ 会被 vitest 当测试树收进 test:wire（实测踩坑 0.6.14）。
const SUBMISSION = resolve(tmpdir(), "dsh-a2a-submission");
rmSync(SUBMISSION, { recursive: true, force: true });
mkdirSync(SUBMISSION, { recursive: true });
const tracked = git(["ls-files"]).split("\n").filter(Boolean);
for (const rel of tracked) {
  const dest = resolve(SUBMISSION, rel);
  mkdirSync(dirname(dest), { recursive: true });
  try { writeFileSync(dest, readFileSync(resolve(REPO, rel))); } catch { /* 跳过读不了的边角 */ }
}
console.error(`[probe] submission exported: ${tracked.length} tracked files -> ${SUBMISSION}`);

/* ── 6. 冻结成 sqlite ───────────────────────────────────── */
const { DatabaseSync } = await import("node:sqlite");
mkdirSync(dirname(OUT), { recursive: true });
if (existsSync(OUT)) rmSync(OUT);
const db = new DatabaseSync(OUT);
db.exec(`
CREATE TABLE repo_facts (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE quality_gates (gate TEXT PRIMARY KEY, exit_code INTEGER NOT NULL, passed INTEGER, failed INTEGER, skipped INTEGER, duration_ms INTEGER NOT NULL, stdout_tail TEXT);
CREATE TABLE runtime_probes (endpoint TEXT PRIMARY KEY, http_status INTEGER, version TEXT, peers INTEGER, sessions_live INTEGER, sessions_cold INTEGER, remote_rows INTEGER, ledger_pending INTEGER, ledger_dead INTEGER, ledger_archived INTEGER, checked_at TEXT NOT NULL);
CREATE TABLE release_gate (rule TEXT PRIMARY KEY, holds INTEGER NOT NULL, detail TEXT);
`);
const ins = (sql, rows) => { const s = db.prepare(sql); for (const r of rows) s.run(...r); };
ins("INSERT INTO repo_facts VALUES (?,?)", repoFacts);
ins("INSERT INTO quality_gates VALUES (?,?,?,?,?,?,?)", gates.map((g) => [g.gate, g.exit_code, g.passed, g.failed, g.skipped, g.duration_ms, g.stdout_tail]));
ins("INSERT INTO runtime_probes VALUES (?,?,?,?,?,?,?,?,?,?,?)", runtimeRows.map((r) => [r.endpoint, r.http_status, r.version, r.peers, r.sessions_live, r.sessions_cold, r.remote_rows, r.ledger_pending, r.ledger_dead, r.ledger_archived, r.checked_at]));
ins("INSERT INTO release_gate VALUES (?,?,?)", gateRows.map((g) => [g.rule, g.holds, g.detail]));
db.close();

const summary = {
  package_version: pkg.version,
  git_head: gitHead.slice(0, 8),
  git_clean: !gitDirty,
  gates: Object.fromEntries(gates.map((g) => [g.gate, { exit: g.exit_code, passed: g.passed, failed: g.failed }])),
  runtime: Object.fromEntries(runtimeRows.map((r) => [r.endpoint, r.http_status === 200 ? { ok: true, version: r.version, peers: r.peers, dead: r.ledger_dead } : { ok: false, status: r.http_status }])),
  release_gate: Object.fromEntries(gateRows.map((g) => [g.rule, !!g.holds])),
  snapshot: OUT,
};
writeFileSync(resolve(REPO, "verify/probe-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
