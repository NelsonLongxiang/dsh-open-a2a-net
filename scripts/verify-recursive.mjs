#!/usr/bin/env node
/**
 * verify-recursive.mjs — 递归验证器（开发席指令 2026-10-21：结果导向）。
 *
 * 一层入口，三层递归：
 *   L·引擎  ygl-trees `verify self-check`——判官验证自己（canonical 向量 →
 *           语料摘要 → 形状 → 全语料实跑 → 归档链，六环；缺语料诚实 SKIP）
 *   L·证据  `verify archive verify`——重算本候选最新 run 归档的完整 hash 链
 *           （spec/材料/报告逐字节可复现，防「报告被改过」）
 *   L·判定  `verify run`——冻结 spec 在当前快照上的 14 单元判定（本层不重跑
 *           门禁，读探针刚冻结的快照；探针是命令证据的采集面）
 *
 * 用法：node scripts/verify-recursive.mjs [--fresh]（--fresh 先跑 verify-probe 再判定）
 * 退出码：0 = 三层全绿；1 = 任一层失败（含 skip 不算失败，但单独点名）。
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const REPO = resolve(import.meta.dirname, "..");
const YGL_BIN = process.env.YGL_BIN ?? "D:/workspace/ygl-trees/dist/apps/cli/src/bin.js";
const YGL_HOME = process.env.YGL_HOME ?? resolve(REPO, "tmp/ygl-verify");
const SPEC_ID = process.env.A2A_SPEC_ID ?? "spec_c8b6350c5034";
const CORPUS = process.env.YGL_VERIFY_CORPUS ?? "D:/workspace/ygl-trees/packages/verify/core/corpus";
const ARCHIVES = resolve(YGL_HOME, "verify/archives");

const argv = process.argv.slice(2);
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
  const res = spawnSync(process.execPath, [resolve(REPO, "scripts/verify-probe.mjs")], {
    cwd: REPO, encoding: "utf8", timeout: 900_000, maxBuffer: 64 << 20, stdio: "inherit",
  });
  if (res.status !== 0) {
    console.log(JSON.stringify({ ok: false, layers: [...layers, { layer: "probe", ok: false, detail: `probe exit ${res.status}` }] }, null, 2));
    process.exit(1);
  }
}

/* ── L·判定：冻结 spec 跑当前快照 ──────────────────────── */
{
  const snapshot = resolve(REPO, "verify/snapshot.sqlite");
  const submission = resolve(tmpdir(), "dsh-a2a-submission");
  if (!existsSync(snapshot)) {
    layers.push({ layer: "spec-run", ok: false, detail: "verify/snapshot.sqlite missing — run scripts/verify-probe.mjs first" });
  } else {
    const res = runJson(["verify", "run", SPEC_ID, "--db", snapshot, "--submission", submission, "--json"]);
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
const summaryPath = resolve(REPO, "verify/recursive-summary.json");
try {
  const fs = await import("node:fs");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
} catch { /* 摘要写不进不阻断回报 */ }
console.log(JSON.stringify(summary, null, 2));
process.exit(ok ? 0 : 1);
