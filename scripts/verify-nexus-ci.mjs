#!/usr/bin/env node
// verify-nexus-ci.mjs — verify:nexus 配方的 ci 步包装器（npm 11 install-scripts 旗形污染免疫层）
//
// 背景（2026-10-22 EALLOWSCRIPTS 事故）：用户级 ~/.npmrc 的 flag 形
// `allow-scripts=...`（为 DSH 宿主安装所设，10-17 在案）被 npm 解析后，
// `npm run` 父进程把全量已解析配置以 npm_config_* env 注入脚本子进程；
// 子 `npm ci`（project-scope）见 env 形旗即 EALLOWSCRIPTS 硬错——子级
// --userconfig 覆盖无效（env 优先级最高）。此包装器在 spawn 前剥离
// npm_config_allow_scripts* 注入，使 nexus-stage/package.json 的
// allowScripts 字段（npm 11 正典形态）得以生效。
//
// 用法：verify:nexus 配方首步 `node scripts/verify-nexus-ci.mjs` 取代裸 ci。
import { spawnSync } from 'node:child_process'

const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (/^npm_config_allow_scripts/i.test(key)) delete env[key]
}
const result = spawnSync('npm', ['--prefix', 'nexus-stage', 'ci', '--no-audit', '--no-fund', '--userconfig=.npmrc'], { stdio: 'inherit', env, shell: process.platform === 'win32' })
process.exit(result.status ?? 1)
