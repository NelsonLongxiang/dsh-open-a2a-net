/** Skill content and package-copy contracts; not a live model-behaviour verdict. */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, cpSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const skillRoot = join(root, 'src', 'skill')
const read = (path: string) => readFileSync(join(skillRoot, path), 'utf8')
const entry = read('SKILL.md')
const guide = read('references/superagent-communication.md')
const detail = read('references/superagent.md')
const cli = read('references/cli.md')

it('offers usage and relationship selection before the generic route command', () => {
  expect(entry).toContain('Use ordinary A2A for bounded session-to-session collaboration')
  expect(entry).toContain('durable tickets')
  expect(entry).toContain('not every canvas or peer connection')
  expect(entry.indexOf('Choose the communication path first')).toBeLessThan(entry.indexOf('## Routing (a2a_route)'))
  for (const clause of ['ordinary A2A discovery', 'superagent team for work', 'a2a_outbound_request', 'registered child']) expect(entry).toContain(clause)
  expect(entry).toContain('This is for ordinary authorized callers, not a superagent router/member')
})

const scenarios = [
  ['host team CLI is transport, not an escape hatch', ['宿主会为团队维护专属', 'superagent-team/<16 hex>', '不是成员自行运行 CLI 绕行', 'CLI 签名证明 agent 身份，不证明主人同意']],
  ['linked peer is not automatically a worker', ['网络可达/一条回执', '不证明其余组织关系', 'peer、同 zone', 'serve']],
  ['remote member uses the host member chain', ['/a2a/superagent-member', '/a2a/superagent-team', '不创建普通 a2a_route 任务']],
  ['external request needs exact scoped approval', ['已有开放工单', 'P0 卡由属主', '申请人不能自批', '接收方准入和接单规则']],
  ['registered child is standing dispatch', ['已登记子团队', '不逐条再申请出站 P0 卡', '登记以外的目标仍走出站申请']],
  ['acknowledgement does not settle or justify resending', ['acknowledged', '不能跨层宣告完成', '收到 ack 就结清结果债务', '不要回执套回执', '先对账原记录']],
] as const

describe('skill scenario clauses (documentation contract only)', () => {
  it.each(scenarios)('%s', (_name, clauses) => { for (const clause of clauses) expect(guide).toContain(clause) })
})

it('removes obsolete tool and future-only A2A guidance', () => {
  expect(detail).not.toContain('Later the A2A Source')
  expect(detail).not.toContain('These four are the only tools')
  expect(detail).not.toContain("an agent's first reply is the result")
  expect(detail).not.toContain('directory or worktree named after the ticket')
  expect(detail).not.toContain('The host refuses every other call with')
  expect(detail).toContain('not a fixed four-tool list')
  expect(detail).toContain('does not authorize a clone, worktree')
  expect(detail).toContain('## Root teams')
  expect(detail).not.toContain('## Root teams (in progress)')
  expect(cli).toContain('Superagent transport is not a session escape hatch')
  expect(cli).toContain('router/member calling a second communication tool')
  expect(cli).toContain('signature proves an agent key, not human consent')
})

it('runs the real package-copy entry and resolves modified skill local navigation', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'network-skill-package-'))
  mkdirSync(join(fixture, 'scripts'), { recursive: true })
  mkdirSync(join(fixture, 'src'), { recursive: true })
  cpSync(join(root, 'scripts/copy-skill.mjs'), join(fixture, 'scripts/copy-skill.mjs'))
  cpSync(skillRoot, join(fixture, 'src/skill'), { recursive: true })
  const child = spawnSync(process.execPath, ['scripts/copy-skill.mjs'], { cwd: fixture, encoding: 'utf8', timeout: 10000 })
  expect(child.error).toBeUndefined()
  expect(child.status, child.stderr).toBe(0)
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
  const emitted = join(fixture, 'lib/skill')
  const files = walk(skillRoot)
  expect(walk(emitted).map(p => relative(emitted, p)).sort()).toEqual(files.map(p => relative(skillRoot, p)).sort())
  for (const original of files) expect(readFileSync(join(emitted, relative(skillRoot, original))).equals(readFileSync(original))).toBe(true)
  let localLinks = 0
  for (const name of ['SKILL.md', 'references/superagent-communication.md', 'references/superagent.md', 'references/cli.md']) {
    const output = join(emitted, name)
    const content = readFileSync(output, 'utf8')
    for (const suffix of content.split('](').slice(1)) {
      const close = suffix.indexOf(')')
      expect(close).toBeGreaterThanOrEqual(0)
      const raw = suffix.slice(0, close)
      const target = (raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw).split('#')[0]!
      if (!target || target.includes('://')) continue
      const resolved = resolve(dirname(output), target)
      const rel = relative(emitted, resolved)
      expect(isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)).toBe(false)
      expect(() => readFileSync(resolved)).not.toThrow()
      localLinks += 1
    }
  }
  expect(localLinks).toBeGreaterThan(12)
})

it('documents user answer with options and notes (#929)', () => {
  for (const name of ['user answer --team ID <ticket id> [<text…>] [--option TEXT|o2|2]', '[属主留言]', 'no-question', 'needing words']) expect(cli).toContain(name)
})
