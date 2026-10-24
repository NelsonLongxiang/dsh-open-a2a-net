/**
 * gh#45 CLI 户口 store pins: the three owner rulings as executable
 * contracts — handle shape <name>/<16hex>, verified-card-only deposit,
 * 4h auto-deregister, mailbox round-trip.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { CliDepositStore, CLI_HANDLE_RE } from '../../src/cli-deposit.ts'
import { signCard } from '../../src/card.ts'

const { privateKey } = generateKeyPairSync('ed25519')

function cliCard(team: string, name = 'cli-node'): string {
  return JSON.stringify(signCard({ name, session: `${name}-session`, team, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, privateKey))
}

function store(dir = mkdtempSync(join(tmpdir(), 'cli45-')), base = 1_000_000): { s: CliDepositStore; tick: (ms: number) => void } {
  let t = base
  const s = new CliDepositStore(join(dir, 'deposits.json'), { now: () => t })
  return { s, tick: ms => { t += ms } }
}

describe('gh#45 CLI deposit store', () => {
  it('① accepts <agent-name>/<uuid16hex>, rejects every other shape', () => {
    const { s } = store()
    const uuid16 = 'a1b2c3d4e5f60718'
    expect(CLI_HANDLE_RE.test(`ops-cli/${uuid16}`)).toBe(true)
    expect(s.deposit(cliCard(`ops-cli/${uuid16}`)).ok).toBe(true)
    expect(s.deposit(cliCard('ops-cli/a1b2c3d4')).ok).toBe(false) // 8 hex ≠ 16
    expect(s.deposit(cliCard('ops-cli/a1b2c3d4e5f6071z')).ok).toBe(false) // non-hex
    expect(s.deposit(cliCard('ops_cli/a1b2c3d4e5f60718')).ok).toBe(false) // bad name char
    expect(s.deposit(cliCard('ops-cli')).ok).toBe(false) // no suffix
    // an unsigned/garbage card never lands
    expect(s.deposit('{"team":"x/y"}').ok).toBe(false)
  })

  it('③ 4h auto-deregister: expiry evicts from list/get; re-publish returns', () => {
    const { s, tick } = store()
    const dep = s.deposit(cliCard('ops-cli/a1b2c3d4e5f60718')) as { ok: true; handle: string }
    expect(s.list()).toHaveLength(1)
    tick(4 * 60 * 60 * 1000 + 1)
    expect(s.list()).toHaveLength(0) // auto-deregistered
    expect(s.get(dep.handle)).toBeUndefined()
    expect(s.deposit(cliCard('ops-cli/a1b2c3d4e5f60718')).ok).toBe(true) // re-publish re-registers
    expect(s.list()).toHaveLength(1)
  })

  it('card rows carry handle+name for the card face; mailbox round-trips', () => {
    const { s } = store()
    s.deposit(cliCard('ops-cli/a1b2c3d4e5f60718', 'ops-cli'))
    const rows = s.cardRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.team).toBe('ops-cli/a1b2c3d4e5f60718')
    expect(rows[0]!.name).toBe('ops-cli')
    expect(rows[0]!.description).toContain('cli')
    s.mail('ops-cli/a1b2c3d4e5f60718', 'dsh/2772468a', '[A2A receipt] task direct-1 done')
    expect(s.readMail('ops-cli/a1b2c3d4e5f60718')[0]!.text).toContain('receipt')
  })

  it('one key deposits multiple names (ruling ②: 一钥多户口)', () => {
    const { s } = store()
    expect(s.deposit(cliCard('ops-cli/a1b2c3d4e5f60718')).ok).toBe(true)
    expect(s.deposit(cliCard('nightly-job/f00dcafe12345678')).ok).toBe(true)
    expect(s.list()).toHaveLength(2)
  })
})
