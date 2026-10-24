#!/usr/bin/env node
/**
 * a2a-net CLI (gh#45) — aligned with the plugin's TEN model tools.
 *
 * ── CLI ↔ 插件工具对齐表（tools 命令打印同表）──────────────────────────
 *   a2a whoami    ↔ a2a_whoami     身份自省：CLI 句柄/钥/户口状态/卡地址
 *   a2a teams     ↔ a2a_teams      目录：本机会话队 + 远端队（可带关键词过滤）
 *   a2a route     ↔ a2a_route      派发：签名信封直投 /a2a/direct
 *   a2a status    ↔ a2a_status     网络健康：peers/在途/活动环 + 户口状态
 *   a2a tasks     ↔ a2a_tasks      账本三层：pending/dead/archived
 *   a2a probe     ↔ a2a_probe      可达性：peer 评分/链接/验证状态
 *   a2a report    ↔ a2a_report     离网单向报告（CLI 形态：投给进程队信箱）
 *   a2a exposure  ↔ a2a_exposure   会话暴露档 —— CLI 无会话面，见 N/A 说明
 *   a2a team join/leave ↔ a2a_team_join/leave 会话手势 —— CLI 以「拉卡入队」
 *                                  等价：属主把 CLI 成员卡拖进 canvas 队
 *   a2a skills    （插件面无此工具）加载本机技能目录并输出
 *   a2a init / publish / inbox / revoke / tools —— CLI 户口制自有命令
 *
 * ── 户口制（owner rulings 2026-10-24）──────────────────────────────────
 *   句柄 <agent-name>/<uuid·8B=16hex>（名字自定义，后段强制）
 *   一钥多户口；v1 挂本机宿主；在线窗口 ≤4h，到期自动注销，重新 publish 回线
 *
 * Runs on the SDK subpaths only — no @deepseek-ai/* imports.
 */
import { generateKeyPairSync, randomUUID, sign as edSign, createPrivateKey } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { signCard } from '../lib/card.js'

const IDENTITY = join(homedir(), '.a2a', 'cli.json')
const DEFAULT_HOME = 'http://127.0.0.1:3080'
const DEFAULT_SKILL_ROOTS = [join(homedir(), '.agents', 'skills')]

const args = process.argv.slice(2)
const cmd = args[0] ?? ''
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
const positionals = () => {
  const out = []
  for (let i = 1; i < args.length; i += 1) {
    if (String(args[i]).startsWith('--')) { i += 1; continue }
    if (i > 1 && String(args[i - 1]).startsWith('--')) continue
    out.push(args[i])
  }
  return out
}
const home = () => (flag('--home') ?? DEFAULT_HOME).replace(/\/$/, '')
const die = (msg) => { console.error(String(msg)); process.exit(1) }

function identity() {
  if (!existsSync(IDENTITY)) die('no identity — run: a2a init <agent-name>')
  return JSON.parse(readFileSync(IDENTITY, 'utf8'))
}

function originClaimFor(base) {
  const id = identity()
  const privateKey = createPrivateKey(id.privateKeyPem)
  const callerUrl = `${base}/a2a/cli/${encodeURIComponent(id.handle)}`
  return () => {
    const ts = Date.now()
    const signature = edSign(undefined, Buffer.from(JSON.stringify([id.name, callerUrl, ts])), privateKey).toString('base64')
    return { 'X-A2A-Caller': id.name, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Ts': String(ts), 'X-A2A-Sig': signature }
  }
}

const keyHeaders = () => {
  const key = flag('--key')
  return key !== undefined ? { 'X-API-Key': key } : {}
}

async function control(body) {
  const res = await fetch(`${home()}/__dsh_a2a/cli-deposit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...keyHeaders() }, body: JSON.stringify(body),
  })
  return await res.json()
}

async function state() {
  const res = await fetch(`${home()}/__dsh_a2a/state`, { headers: keyHeaders() })
  if (res.status !== 200) die(`state face ${String(res.status)} — ${flag('--key') === undefined ? 'pass --key <apiKey>' : 'wrong key?'}`)
  return await res.json()
}

// ── the plugin's ten tools, one line each (mirrors src registration) ─────
const TOOL_CATALOG = [
  ['a2a_whoami', '身份自省：节点 id、joined 状态、可路由句柄、roster/canvas 队、allowlist 效应'],
  ['a2a_team_join', '声明会话节点为某可路由队成员（allowlist 精确名门控；人建队而非模型自组）'],
  ['a2a_team_leave', '撤销一次队成员声明（只能缩不能扩）'],
  ['a2a_report', '离网单向报告入监督读的报表环（无在场权——不带来发现/路由权）'],
  ['a2a_teams', '列/搜可达队：本机行+远端 peer 行（teamScopeInfo 开时跟随协作圈）'],
  ['a2a_route', '向远端队发消息并等回复（长任务用 async；context_id 续谈）'],
  ['a2a_status', '网络健康：peers 质量分、在途路由、近期活动环、幂等窗占用'],
  ['a2a_tasks', '账本三层对账：pending（欠回执）/dead（超期）/archived（已结算）'],
  ['a2a_probe', '探活整个 tracked fleet 或单 peer：可达性+往返延迟+失败原因'],
  ['a2a_exposure', '设本会话的网络可见档：linked（下限）/fleet（自愿上调）'],
]

function printAlignment() {
  console.log('插件工具面（十枚）与 CLI 对齐：\n')
  for (const [tool, desc] of TOOL_CATALOG) console.log(`  ${tool.padEnd(16)} ${desc}`)
  console.log('\nCLI 对齐映射：')
  const map = [
    ['a2a whoami', 'a2a_whoami', '身份自省（CLI 句柄+户口+卡地址）'],
    ['a2a teams', 'a2a_teams', '目录（读宿主 state 面：本机+远端队）'],
    ['a2a route', 'a2a_route', '派发（CLI 自签信封直投 /a2a/direct）'],
    ['a2a status', 'a2a_status', '网络健康（peers/在途/活动环）+ 户口状态'],
    ['a2a tasks', 'a2a_tasks', '账本三层（pending/dead/archived）'],
    ['a2a probe', 'a2a_probe', 'peer 可达性（评分/链接/验证，读暖态）'],
    ['a2a report', 'a2a_report', '离网报告（CLI 形态：投给宿主进程队信箱）'],
    ['（N/A）', 'a2a_exposure', '暴露档是会话面概念——CLI 无会话；户口即其可见性'],
    ['（拖卡入队）', 'a2a_team_join/leave', '入队是会话手势——等价物：属主把 CLI 成员卡拖进 canvas 队（画布手势=运营者链接）'],
    ['a2a skills', '（插件无）', '加载本机技能目录输出（CLI 专有）'],
    ['a2a init/publish/inbox/revoke/tools', '（插件无）', '户口制自有：建钥/落户/收信箱/撤户/本表'],
  ]
  for (const [cli, tool, note] of map) console.log(`  ${String(cli).padEnd(28)} ↔ ${String(tool).padEnd(22)} ${note}`)
}

// ── skills: load the catalog, output it ─────────────────────────────────
function parseSkillFrontmatter(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  if (fm === null) return {}
  const pick = (key) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm[1])
    return m !== null ? m[1].trim().replace(/^["']|["']$/g, '') : undefined
  }
  return { name: pick('name'), description: pick('description') }
}

function loadSkills(roots) {
  const out = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const md = join(root, entry.name, 'SKILL.md')
      if (!existsSync(md)) continue
      try {
        const text = readFileSync(md, 'utf8')
        const meta = parseSkillFrontmatter(text)
        out.push({ name: meta.name ?? entry.name, description: (meta.description ?? '').split('\n')[0] ?? '', path: md, text })
      } catch { /* unreadable: skip */ }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function cmdSkills() {
  const pos = positionals()
  const roots = flag('--root') !== undefined ? [flag('--root')] : DEFAULT_SKILL_ROOTS
  const skills = loadSkills(roots)
  if (skills.length === 0) die(`[skills] none found under ${roots.join(', ')}`)
  const target = pos[0]
  if (target !== undefined) {
    const hit = skills.find(s => s.name === target) ?? skills.find(s => s.path.includes(target))
    if (hit === undefined) die(`[skills] "${target}" not found (bare 'a2a skills' lists)`)
    process.stdout.write(hit.text)
    return
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify(skills.map(({ name, description, path }) => ({ name, description, path })), null, 2))
    return
  }
  for (const s of skills) console.log(`${s.name} — ${s.description.slice(0, 90)}`)
  console.log(`\n(${String(skills.length)} skills · 'a2a skills <name>' prints one)`)
}

// ── commands ────────────────────────────────────────────────────────────
async function main() {
  if (cmd === 'init') {
    const name = positionals()[0]
    if (name === undefined || !/^[a-z0-9-]{1,32}$/.test(name)) die('usage: a2a init <agent-name>  (name: [a-z0-9-]{1,32})')
    let uuid = flag('--uuid')
    if (uuid === undefined) uuid = randomUUID().replace(/-/g, '').slice(0, 16)
    if (!/^[0-9a-f]{16}$/.test(uuid)) die('--uuid must be 16 hex chars (8 bytes)')
    const { privateKey } = generateKeyPairSync('ed25519')
    mkdirSync(join(homedir(), '.a2a'), { recursive: true })
    writeFileSync(IDENTITY, JSON.stringify({ name, uuid, handle: `${name}/${uuid}`, privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) }, null, 2))
    console.log(`[init] ${name}/${uuid} — key at ${IDENTITY}`)
    return
  }
  if (cmd === 'publish') {
    const id = identity()
    const privateKey = createPrivateKey(id.privateKeyPem)
    const card = signCard({ name: id.name, session: `cli-${id.name}`, team: id.handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000 }, privateKey)
    const out = await control({ action: 'publish', card: JSON.stringify(card) })
    if (out.ok !== true) die(`[publish] refused: ${String(out.error)}`)
    console.log(`[publish] ${String(out.handle)} online — ${((out.expiresAt - Date.now()) / 3_600_000).toFixed(2)}h left (auto-deregister then; re-publish returns)`)
    console.log(`[publish] card url: ${String(out.cardUrl)}`)
    return
  }
  if (cmd === 'route') {
    const pos = positionals()
    const team = pos[0]
    const message = args.slice(args.indexOf(team) + 1).filter(a => !String(a).startsWith('--')).join(' ')
    if (team === undefined || message === '') die('usage: a2a route <team> <message…>')
    const res = await fetch(`${home()}/a2a/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...originClaimFor(home())(), ...keyHeaders() },
      body: JSON.stringify({ team, message, caller_session: identity().handle, wait: false }),
    })
    console.log(JSON.stringify(await res.json(), null, 2))
    return
  }
  if (cmd === 'inbox') {
    const out = await control({ action: 'inbox', handle: identity().handle })
    if (out.ok !== true) die(String(out.error))
    if (out.mail.length === 0) { console.log('[inbox] empty'); return }
    for (const m of out.mail) console.log(`[${new Date(m.at).toLocaleTimeString()}] ${String(m.from)}: ${String(m.text).slice(0, 200)}`)
    return
  }
  if (cmd === 'skills') { cmdSkills(); return }
  if (cmd === 'tools') { printAlignment(); return }
  if (cmd === 'whoami') {
    const id = identity()
    const list = await control({ action: 'list' })
    const mine = (list.deposits ?? []).find(d => d.handle === id.handle)
    console.log(`handle      ${id.handle}`)
    console.log(`identity    ~/.a2a/cli.json (own Ed25519 key — the card's team = "${id.name}" is its own zone)`)
    console.log(`deposit     ${mine === undefined ? 'OFFLINE (expired or never published — run: a2a publish)' : `ONLINE, ${((mine.expiresAt - Date.now()) / 3_600_000).toFixed(2)}h left`}`)
    console.log(`card url    ${home()}/a2a/cli/${encodeURIComponent(id.handle)}`)
    console.log(`capability  route via signed envelope; receive via mailbox (poll: a2a inbox)`)
    return
  }
  if (cmd === 'teams') {
    const s = await state()
    const q = (positionals()[0] ?? '').toLowerCase()
    const rows = [
      ...['dsh'].map(t => ({ team: String(t), name: String(s.session ?? 'host'), where: 'host' })),
      ...(s.sessions ?? []).map(x => ({ team: String(x.team ?? ''), name: String(x.label ?? ''), where: 'local' })),
      ...(s.remote ?? []).map(x => ({ team: String(x.team ?? ''), name: String(x.name ?? ''), where: `remote · ${String(x.via ?? '')}` })),
    ]
    for (const r of rows.filter(r => q === '' || r.team.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))) {
      console.log(`${r.team.padEnd(28)} ${r.name.slice(0, 24).padEnd(26)} [${r.where}]`)
    }
    return
  }
  if (cmd === 'probe') {
    const s = await state()
    for (const p of s.peers ?? []) console.log(`${String(p.url).padEnd(36)} score=${String(p.score).padEnd(9)} link=${String(p.link ?? 'stranger').padEnd(8)} verified=${p.verified === true ? '✓' : '✗'}`)
    return
  }
  if (cmd === 'tasks') {
    const s = await state()
    const pending = s.tasks ?? []
    const dead = s.tasksDead ?? []
    const archived = s.archived ?? []
    console.log(`pending (${String(pending.length)}):`)
    for (const t of pending.slice(0, 20)) console.log(`  ${String(t.taskId)} → ${String(t.team)} ${String(t.direction ?? '')}`)
    console.log(`dead (${String(dead.length)}):`)
    for (const t of dead.slice(0, 20)) console.log(`  ${String(t.taskId)} → ${String(t.team)} (${String(t.reason ?? '?')})`)
    console.log(`archived (${String(archived.length)}):`)
    for (const t of archived.slice(0, 20)) console.log(`  ${String(t.taskId)} ${String(t.outcome ?? '?')}`)
    return
  }
  if (cmd === 'status') {
    const s = await state()
    const list = await control({ action: 'list' })
    const mine = (list.deposits ?? []).find(d => d.handle === identity().handle)
    console.log(`host        ${home()}  version=${String(s.version ?? '?')}  peers=${String((s.peers ?? []).length)}`)
    for (const p of s.peers ?? []) console.log(`  peer ${String(p.url).padEnd(34)} link=${String(p.link ?? 'stranger')}`)
    const inflight = s.inFlight ?? []
    if (inflight.length > 0) {
      console.log('in-flight:')
      for (const r of inflight) console.log(`  ${String(r.team)} → ${String(r.peer)}`)
    }
    console.log(`deposit     ${mine === undefined ? 'OFFLINE' : `ONLINE, ${((mine.expiresAt - Date.now()) / 3_600_000).toFixed(2)}h left`}`)
    return
  }
  if (cmd === 'report') {
    const text = args.slice(1).filter(a => !String(a).startsWith('--')).join(' ')
    if (text === '') die('usage: a2a report <message…> — one-way report into the host process-team mailbox')
    const res = await fetch(`${home()}/a2a/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...originClaimFor(home())(), ...keyHeaders() },
      body: JSON.stringify({ team: 'dsh', message: `[a2a-net cli report] ${text}`, caller_session: identity().handle, wait: false }),
    })
    const out = await res.json()
    console.log(JSON.stringify(out, null, 2))
    return
  }
  if (cmd === 'revoke') {
    const out = await control({ action: 'revoke', handle: identity().handle })
    console.log(`[revoke] ${out.ok === true ? 'deregistered' : 'nothing to revoke'}`)
    return
  }
  console.error(`a2a-net CLI — aligned with the plugin's ten model tools ('a2a tools' prints the full map)

usage: a2a <command> [args] [--home URL] [--key <apiKey>]

户口制:   init <name> [--uuid 16hex] · publish · inbox · revoke
对齐面:   whoami · teams [query] · route <team> <msg> · status · tasks · probe · report <msg>
CLI 专有: skills [name] [--json] [--root DIR] · tools (this alignment table)`)
  process.exit(cmd === '' ? 1 : 0)
}

void main().catch(error => { console.error(String(error)); process.exit(1) })
