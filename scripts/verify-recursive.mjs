#!/usr/bin/env node
/**
 * verify-recursive.mjs — 递归验证器（开发席指令 2026-10-21：结果导向）。
 *
 * 一层入口，三层递归：
 *   L·引擎  ygl-trees `verify self-check`——判官验证自己（canonical 向量 →
 *           语料摘要 → 形状 → 全语料实跑 → 归档链，六环；缺语料诚实 SKIP）
 *   L·证据  `verify archive verify`——重算本候选最新 run 归档的完整 hash 链
 *           （spec/材料/报告逐字节可复现，防「报告被改过」）
 *   L·判定  `verify run`——冻结 spec 在当前快照上的 15 单元判定（本层不重跑
 *           门禁，读探针刚冻结的快照；探针是命令证据的采集面）
 *
 * 用法：node scripts/verify-recursive.mjs --fresh [--candidate-root <导出> --candidate-sha <完整SHA> --source-repo <对象仓>] [--base ... | --runtime-unavailable]
 *    或 node scripts/verify-recursive.mjs --summary <本轮>/probe-summary.json --snapshot <本轮>/snapshot.sqlite [--candidate-sha <完整SHA>]
 *    非 --fresh 调用必须显式指定本轮产物；旧 verify/snapshot.sqlite 默认已移除，陈旧固定文件不会被隐式选中。
 * 退出码：0 = 三层全绿；1 = 任一层失败（含 skip 不算失败，但单独点名）；2 = 调用契约错误（未执行任何引擎/判定）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRunSelection, submissionFromProbe } from "./verify-submission.mjs";

const REPO = resolve(import.meta.dirname, "..");
const YGL_BIN = process.env.YGL_BIN ?? resolve(REPO, "..", "ygl-trees", "dist/apps/cli/src/bin.js");
const YGL_HOME = process.env.YGL_HOME ?? resolve(REPO, "tmp/ygl-verify");
const SPEC_ID = process.env.A2A_SPEC_ID ?? "spec_bdf9df9d3851";
const CORPUS = process.env.YGL_VERIFY_CORPUS ?? resolve(REPO, "..", "ygl-trees", "packages/verify/core/corpus");
const ARCHIVES = resolve(YGL_HOME, "verify/archives");

const argv = process.argv.slice(2);

/* ── 调用契约：在任何引擎工作之前确定本轮证据，隐式默认一律拒绝 ── */
let selection;
try { selection = resolveRunSelection(argv); } catch (error) { console.error(String(error.message ?? error)); process.exit(2); }
let summaryFile = null, snapshotFile = null, explicitCandidate = undefined;
if (selection.mode === "explicit") {
  summaryFile = resolve(REPO, selection.summary);
  snapshotFile = resolve(REPO, selection.snapshot);
  explicitCandidate = selection.candidateSha;
}
const value = (name, fallback) => { const i = argv.indexOf("--" + name); return i < 0 ? fallback : argv[i + 1]; };

const runJson = (args, opts = {}) => {
  const res = spawnSync(process.execPath, [YGL_BIN, ...args], {
    encoding: "utf8", timeout: 300_000, maxBuffer: 64 << 20,
    env: { ...process.env, YGL_HOME }, ...opts,
  });
  const out = (res.stdout ?? "").trim();
  const json = out.startsWith("{") || out.startsWith("[") ? JSON.parse(out) : { ok: false, error: out || `exit ${res.status}` };
  return { status: res.status ?? -1, json };
};

const layers = [];

/* ── L·引擎：判官自证 ─────────────────────────────────── */
{
  const res = runJson(["verify", "self-check", "--corpus", CORPUS, "--json"]);
  const items = res.json.items ?? [];
  const failed = items.filter(i => i.status === "fail");
  const skipped = items.filter(i => i.status === "skip");
  layers.push({
    layer: "engine-self-check",
    ok: res.status === 0 && res.json.ok === true,
    detail: `${items.filter(i => i.status === "ok").length} ok / ${skipped.length} skip / ${failed.length} fail`,
    ...(failed.length > 0 ? { problems: failed.map(f => `${f.id}: ${f.detail}`) } : {}),
    ...(skipped.length > 0 ? { skipped: skipped.map(s => s.id) } : {}),
  });
}

/* ── 可选：fresh 重采证据（--fresh 时先跑探针） ──────────── */
if (argv.includes("--fresh")) {
  const args = [resolve(REPO, "scripts/verify-temp-clean.mjs"), "--", process.execPath, resolve(REPO, "scripts/verify-probe.mjs")];
  for (const name of ["candidate-root", "candidate-sha", "collector-sha", "source-repo", "base", "run-dir"]) {
    const argument = value(name, undefined);
    if (argument !== undefined) args.push("--" + name, argument);
  }
  if (argv.includes("--runtime-unavailable")) args.push("--runtime-unavailable");
  const res = spawnSync(process.execPath, args, { cwd: REPO, encoding: "utf8", timeout: 900_000, maxBuffer: 64 << 20 });
  const output = (res.stdout ?? "").trim();
  const marker = output.indexOf("\n[temp-clean]");
  let collected;
  try { collected = JSON.parse(marker < 0 ? output : output.slice(0, marker)); } catch {}
  if (res.error || res.status !== 0 || !collected || !/^[a-f0-9]{40}$/.test(collected.candidate_sha ?? "") || typeof collected.snapshot !== "string" || typeof collected.submission_root !== "string") {
    console.log(JSON.stringify({ ok: false, layers: [...layers, { layer: "probe", ok: false, detail: "probe did not return one bound collection summary", exit: res.status, error: String(res.error ?? res.stderr ?? "") }] }, null, 2));
    process.exit(1);
  }
  snapshotFile = collected.snapshot;
  summaryFile = resolve(collected.submission_root, "probe-summary.json");
  explicitCandidate = collected.candidate_sha;
}

/* ── L·判定：冻结 spec 跑当前快照 ──────────────────────── */
{
  const snapshot = snapshotFile;
  const head = explicitCandidate ?? spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).stdout?.trim() ?? "";
  const submission = submissionFromProbe(summaryFile, snapshot, head);
  if (!existsSync(snapshot)) {
    layers.push({ layer: "spec-run", ok: false, detail: snapshot + " missing — run scripts/verify-probe.mjs and pass that run's --summary/--snapshot explicitly" });
  } else if (!submission.ok) {
    layers.push({ layer: "spec-run", ok: false, detail: submission.error });
  } else {
    const res = runJson(["verify", "run", SPEC_ID, "--db", snapshot, "--submission", submission.path, "--json"]);
    layers.push({
      layer: "spec-run",
      ok: res.status === 0 && res.json.overall === "PASS",
      detail: `${res.json.overall ?? "?"} ${JSON.stringify(res.json.summary ?? {})}`,
      ...(res.json.run_id !== undefined ? { run_id: res.json.run_id } : {}),
    });
  }
}

/* ── L·证据：最新归档 hash 链重算 ──────────────────────── */
{
  if (!existsSync(ARCHIVES)) {
    layers.push({ layer: "archive-chain", ok: false, detail: `no archives dir: ${ARCHIVES}` });
  } else {
    const zips = readdirSync(ARCHIVES).filter(f => f.endsWith(".zip")).sort();
    if (zips.length === 0) {
      layers.push({ layer: "archive-chain", ok: false, detail: "no archived runs yet" });
    } else {
      const latest = zips[zips.length - 1];
      const res = runJson(["verify", "archive", "verify", resolve(ARCHIVES, latest), "--json"]);
      layers.push({
        layer: "archive-chain",
        ok: res.json.ok === true,
        detail: `${latest} — ${res.json.items ?? "?"} items${(res.json.problems ?? []).length > 0 ? `, problems: ${res.json.problems.join("; ")}` : ""}`,
      });
    }
  }
}

const ok = layers.every(l => l.ok);
const summary = { ok, spec_id: SPEC_ID, layers };
const summaryPath = resolve(snapshotFile, "..", "recursive-summary-" + String(Date.now()) + "-" + String(process.pid) + ".json");
try {
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", { flag: "wx", mode: 0o600 });
} catch { /* 摘要写不进不阻断回报 */ }
console.log(JSON.stringify(summary, null, 2));
process.exit(ok ? 0 : 1);
