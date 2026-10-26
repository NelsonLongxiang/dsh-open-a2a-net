/**
 * gh#47 CLI tombstones: expired deposits stay as OFFLINE directory rows —
 * the board keeps the member card visible (grayed by description) so a
 * canvas ref never dangles silently; re-publish un-tombstones. The LIVE
 * surfaces (get / card face / mailbox delivery / N3 admission) still see
 * only live rows.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { CliDepositStore, CLI_TOMBSTONE_CAP } from '../../src/cli-deposit.ts'
import { signCard } from '../../src/card.ts'

const { privateKey } = generateKeyPairSync('ed25519')
const card = (team: string, name: string): string =>
  JSON.stringify(signCard({ name, session: `cli-${name}`, team, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, privateKey))

function store(base = 1_000_000): { s: CliDepositStore; tick: (ms: number) => void } {
  let t = base
  return { s: new CliDepositStore(join(mkdtempSync(join(tmpdir(), 'gh47-')), 'd.json'), { now: () => t }), tick: ms => { t += ms } }
}

const H1 = 'ops-cli/a1b2c3d4e5f60718'

describe('gh#47 CLI tombstones', () => {
  it('① expiry keeps the directory row (offline) — the card face and get() stay dead', () => {
    const { s, tick } = store()
    s.deposit(card(H1, 'ops-cli'))
    tick(4 * 60 * 60 * 1000 + 1)
    const rows = s.directoryRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.offline).toBe(true)
    expect(rows[0]!.description).toContain('offline')
    // LIVE surfaces: the row is gone.
    expect(s.get(H1)).toBeUndefined()
    expect(s.list()).toHaveLength(0)
    expect(s.cardRows()).toHaveLength(0)
  })

  it('② re-publish un-tombstones — same handle back online', () => {
    const { s, tick } = store()
    s.deposit(card(H1, 'ops-cli'))
    tick(4 * 60 * 60 * 1000 + 1)
    expect(s.directoryRows()[0]!.offline).toBe(true)
    expect(s.deposit(card(H1, 'ops-cli')).ok).toBe(true)
    const rows = s.directoryRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.offline).toBe(false)
    expect(s.get(H1)).toBeDefined()
  })

  it('③ the tombstone bound: cap+1 expired rows squeeze the OLDEST out', () => {
    const { s, tick } = store()
    for (let i = 0; i <= CLI_TOMBSTONE_CAP; i += 1) {
      const h = `cli-${String(i).padStart(2, '0')}/${String(i).padStart(16, '0')}`
      s.deposit(card(h, `cli-${String(i).padStart(2, '0')}`))
      tick(5 * 60 * 60 * 1000) // each expires before the next deposits
    }
    const rows = s.directoryRows()
    expect(rows).toHaveLength(CLI_TOMBSTONE_CAP)
    // The OLDEST (cli-00) fell off; the newest survives.
    expect(rows.some(r => r.team.startsWith('cli-00/'))).toBe(false)
    expect(rows.some(r => r.team.startsWith(`cli-${String(CLI_TOMBSTONE_CAP).padStart(2, '0')}/`))).toBe(true)
  })

  it('④ tombstones round-trip through persistence (a restart keeps the offline row)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gh47-'))
    const path = join(dir, 'd.json')
    let t = 1_000_000
    const first = new CliDepositStore(path, { now: () => t })
    first.deposit(card(H1, 'ops-cli'))
    t += 4 * 60 * 60 * 1000 + 1
    expect(first.directoryRows()[0]!.offline).toBe(true)
    const reloaded = new CliDepositStore(path, { now: () => t })
    expect(reloaded.directoryRows()[0]!.offline).toBe(true)
    // And the field is on disk for the older-reader story.
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { deposits: Array<{ handle: string; expiredAt?: number }> }
    expect(onDisk.deposits[0]!.expiredAt).toBeDefined()
  })
})
