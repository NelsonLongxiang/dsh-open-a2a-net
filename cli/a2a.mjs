#!/usr/bin/env node
/**
 * a2a CLI (gh#45 v1 — 本机户口形态, owner rulings 2026-10-24):
 *   handle <agent-name>/<uuid·8B=16hex> (name custom, suffix forced)
 *   one key, multiple registrations — v1 deposits at the LOCAL home host
 *   online window ≤4h; expiry auto-deregisters, re-publish returns
 *
 * Commands:
 *   a2a init <agent-name> [--uuid <16hex>]   key + handle → ~/.a2a/cli.json
 *   a2a publish [--home URL] [--key <apiKey>]
 *   a2a route <team> <message…>              signed envelope → /a2a/direct
 *   a2a inbox [--home] [--key]               poll the home-host mailbox
 *   a2a skills [name] [--root DIR] [--json]  load the skills catalog, output it
 *   a2a status | a2a revoke
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
/** Positionals after the command word, excluding flag values. */
const positionals = () => {
  const out = []
  for (let i = 1; i < args.length; i += 1) {
    if (args[i].startsWith('--')) { i += 1; continue }
    if (i > 1 && args[i - 1].startsWith('--')) continue
    out.push(args[i])
  }
  return out
}

function identity() {
  if (!existsSync(IDENTITY)) { console.error('no identity — run: a2a init <agent-name>'); process.exit(1) }
  return JSON.parse(readFileSync(IDENTITY, 'utf8'))
}

/** The CLI's envelope signer: caller = the bare agent-name zone, the card
 *  lives at the home host's deposit face. */
function originClaimFor(home) {
  const id = identity()
  const privateKey = createPrivateKey(id.privateKeyPem)
  const callerUrl = `${home.replace(/\/$/, '')}/a2a/cli/${encodeURIComponent(id.handle)}`
  return () => {
    const ts = Date.now()
    const signature = edSign(undefined, Buffer.from(JSON.stringify([id.name, callerUrl, ts])), privateKey).toString('base64')
    return { 'X-A2A-Caller': id.name, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Ts': String(ts), 'X-A2A-Sig': signature }
  }
}

async function control(home, key, body) {
  const res = await fetch(`${home.replace(/\/$/, '')}/__dsh_a2a/cli-deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key !== undefined ? { 'X-API-Key': key } : {}) },
    body: JSON.stringify(body),
  })
  return await res.json()
}

// ── skills: load the catalog, output it ─────────────────────────────────
/** Parse one SKILL.md's frontmatter (name/description) — no YAML dep. */
function parseSkillFrontmatter(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  if (fm === null) return {}
  const pick = (key) => {
    const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(fm[1])
    return m !== null ? m[1].trim().replace(/^["']|["']$/g, '') : undefined
  }
  const description = pick('description')
  return { name: pick('name'), description, disable_model_invocation: pick('disable-model-invocation') === 'true' }
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
      } catch {
        // unreadable skill file: skip, never fail the catalog
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

function cmdSkills() {
  const pos = positionals()
  const roots = flag('--root') !== undefined ? [flag('--root')] : DEFAULT_SKILL_ROOTS
  const skills = loadSkills(roots)
  if (skills.length === 0) { console.error(`[skills] none found under ${roots.join(', ')}`); process.exit(1) }
  const target = pos[0]
  if (target !== undefined) {
    const hit = skills.find(s => s.name === target) ?? skills.find(s => s.path.includes(target))
    if (hit === undefined) { console.error(`[skills] "${target}" not found (use bare 'a2a skills' to list)`); process.exit(1) }
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
    if (name === undefined || !/^[a-z0-9-]{1,32}$/.test(name)) { console.error('usage: a2a init <agent-name>  (name: [a-z0-9-]{1,32})'); process.exit(1) }
    let uuid = flag('--uuid')
    if (uuid === undefined) uuid = randomUUID().replace(/-/g, '').slice(0, 16)
    if (!/^[0-9a-f]{16}$/.test(uuid)) { console.error('--uuid must be 16 hex chars (8 bytes)'); process.exit(1) }
    const { privateKey } = generateKeyPairSync('ed25519')
    mkdirSync(join(homedir(), '.a2a'), { recursive: true })
    writeFileSync(IDENTITY, JSON.stringify({ name, uuid, handle: `${name}/${uuid}`, privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) }, null, 2))
    console.log(`[init] ${name}/${uuid} — key at ${IDENTITY}`)
    return
  }
  if (cmd === 'publish') {
    const home = flag('--home') ?? DEFAULT_HOME
    const key = flag('--key')
    const id = identity()
    const privateKey = createPrivateKey(id.privateKeyPem)
    const card = signCard({ name: id.name, session: `cli-${id.name}`, team: id.handle, capabilities: { route: true, async: true }, expiresAt: Date.now() + 2 * 24 * 60 * 60 * 1000 }, privateKey)
    const out = await control(home, key, { action: 'publish', card: JSON.stringify(card) })
    if (out.ok !== true) { console.error(`[publish] refused: ${String(out.error)}`); process.exit(1) }
    const hours = ((out.expiresAt - Date.now()) / 3_600_000).toFixed(2)
    console.log(`[publish] ${String(out.handle)} online — expires in ${hours}h (auto-deregister then; re-publish to return)`)
    console.log(`[publish] card url: ${String(out.cardUrl)}`)
    return
  }
  if (cmd === 'route') {
    const home = flag('--home') ?? DEFAULT_HOME
    const pos = positionals()
    const team = pos[0]
    const message = args.slice(args.indexOf(team) + 1).filter(a => !a.startsWith('--')).join(' ')
    if (team === undefined || message === '') { console.error('usage: a2a route <team> <message…>'); process.exit(1) }
    const res = await fetch(`${home.replace(/\/$/, '')}/a2a/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...originClaimFor(home)() },
      body: JSON.stringify({ team, message, caller_session: identity().handle, async: false }),
    })
    console.log(JSON.stringify(await res.json(), null, 2))
    return
  }
  if (cmd === 'inbox') {
    const home = flag('--home') ?? DEFAULT_HOME
    const out = await control(home, flag('--key'), { action: 'inbox', handle: identity().handle })
    if (out.ok !== true) { console.error(String(out.error)); process.exit(1) }
    if (out.mail.length === 0) { console.log('[inbox] empty'); return }
    for (const m of out.mail) console.log(`[${new Date(m.at).toLocaleTimeString()}] ${String(m.from)}: ${String(m.text).slice(0, 200)}`)
    return
  }
  if (cmd === 'skills') { cmdSkills(); return }
  if (cmd === 'status') {
    const out = await control(flag('--home') ?? DEFAULT_HOME, flag('--key'), { action: 'list' })
    const mine = (out.deposits ?? []).find(d => d.handle === identity().handle)
    if (mine === undefined) { console.log('[status] OFFLINE — not deposited (expired or never published)'); return }
    console.log(`[status] ONLINE as ${String(mine.handle)} — ${((mine.expiresAt - Date.now()) / 3_600_000).toFixed(2)}h left`)
    return
  }
  if (cmd === 'revoke') {
    const out = await control(flag('--home') ?? DEFAULT_HOME, flag('--key'), { action: 'revoke', handle: identity().handle })
    console.log(`[revoke] ${out.ok === true ? 'deregistered' : 'nothing to revoke'}`)
    return
  }
  console.error('usage: a2a init <name> | publish | route <team> <msg> | inbox | skills [name] | status | revoke')
  process.exit(cmd === '' ? 1 : 0)
}

void main().catch(error => { console.error(String(error)); process.exit(1) })
