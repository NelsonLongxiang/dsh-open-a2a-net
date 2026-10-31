/**
 * gh#45 CLI 户口 store pins: the three owner rulings as executable
 * contracts — handle shape <name>/<16hex>, verified-card-only deposit,
 * 4h auto-deregister, mailbox round-trip.
 */
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { CliDepositStore, CLI_HANDLE_RE, MAILBOX_CAP, MAILBOX_TEXT_CAP } from '../../src/cli-deposit.ts'
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

describe('gh#113 CLI mailbox: seq, loss and truncation are visible', () => {
  const H = 'ops-cli/a1b2c3d4e5f60718'

  it('numbers mail 1, 2, 3 … and counts what the 64-row cap pushes out', () => {
    const { s } = store()
    for (let i = 1; i <= 70; i += 1) s.mail(H, 'dsh/2772468a', `m${String(i)}`)
    const box = s.readMailbox(H)
    expect(box.mail).toHaveLength(MAILBOX_CAP)
    expect(box.mail[0]).toMatchObject({ seq: 70, text: 'm70' })
    expect(box.mail.at(-1)).toMatchObject({ seq: 7, text: 'm7' })
    expect(box).toMatchObject({ next_seq: 71, oldest_seq: 7, dropped: 6 })
    expect(s.readMailbox(H, 68).mail.map(m => m.seq)).toEqual([70, 69])
    expect(s.mailStats()).toEqual({ dropped: 6, truncated: 0 })
  })

  it('an empty mailbox reports oldest_seq = next_seq', () => {
    const { s } = store()
    expect(s.readMailbox(H)).toMatchObject({ mail: [], next_seq: 1, oldest_seq: 1, dropped: 0 })
  })

  it('marks a cut text with its original length', () => {
    const { s } = store()
    s.mail(H, 'dsh/2772468a', 'x'.repeat(5000))
    const [row] = s.readMailbox(H).mail
    expect(row!.text).toHaveLength(MAILBOX_TEXT_CAP)
    expect(row).toMatchObject({ truncated: true, chars: 5000, seq: 1 })
    s.mail(H, 'dsh/2772468a', 'short')
    expect(s.readMailbox(H).mail[0]!.truncated).toBeUndefined()
    expect(s.mailStats().truncated).toBe(1)
  })

  it('seq, epoch and the counters survive a restart; a fresh store gets a new epoch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli113-'))
    const a = store(dir).s
    for (let i = 1; i <= 66; i += 1) a.mail(H, 'dsh/2772468a', `m${String(i)}`)
    const before = a.readMailbox(H)
    const b = store(dir).s
    const after = b.readMailbox(H)
    expect(after).toMatchObject({ epoch: before.epoch, next_seq: 67, oldest_seq: 3, dropped: 2 })
    b.mail(H, 'dsh/2772468a', 'next')
    expect(b.readMailbox(H).mail[0]!.seq).toBe(67)
    expect(store().s.readMailbox(H).epoch).not.toBe(before.epoch)
  })

  it('review P2: a failed write rotates the epoch, so a restart from the older disk state cannot reuse seq under the same name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli113-ro-'))
    const a = store(dir).s
    a.mail(H, 'x', 'on disk')
    const diskEpoch = a.readMailbox(H).epoch
    chmodSync(join(dir, 'deposits.json'), 0o444)
    try {
      a.mail(H, 'x', 'memory only')
      const memory = a.readMailbox(H)
      expect(memory.next_seq).toBe(3)
      expect(memory.epoch).not.toBe(diskEpoch)
      a.mail(H, 'x', 'still memory only')
      expect(a.readMailbox(H).epoch).toBe(memory.epoch) // one rotation per failure streak
      const restarted = store(dir).s.readMailbox(H)
      expect(restarted).toMatchObject({ epoch: diskEpoch, next_seq: 2 })
      expect(restarted.epoch).not.toBe(memory.epoch)
    } finally {
      chmodSync(join(dir, 'deposits.json'), 0o644)
    }
  })

  it('review P3: unsound seqs (fractional, duplicate, negative, mixed) are renumbered under a new epoch', () => {
    for (const rows of [
      [{ at: 3, from: 'x', text: 'c', seq: 2.5 }, { at: 1, from: 'x', text: 'a', seq: 1 }],
      [{ at: 3, from: 'x', text: 'c', seq: 5 }, { at: 1, from: 'x', text: 'a', seq: 5 }],
      [{ at: 3, from: 'x', text: 'c', seq: -7 }],
      [{ at: 3, from: 'x', text: 'c', seq: 10 }, { at: 1, from: 'x', text: 'a' }],
    ]) {
      const dir = mkdtempSync(join(tmpdir(), 'cli113-bad-'))
      writeFileSync(join(dir, 'deposits.json'), JSON.stringify({ deposits: [], mailbox: { [H]: rows }, epoch: 'e1', nextSeq: { [H]: 11 } }))
      const box = store(dir).s.readMailbox(H)
      expect(box.epoch).not.toBe('e1')
      expect(box.mail.map(m => m.seq)).toEqual(rows.map((_, i) => rows.length - i))
      expect(box).toMatchObject({ next_seq: rows.length + 1, oldest_seq: 1 })
    }
  })

  it('review P3: an epoch whose nextSeq record is missing is not kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli113-partial-'))
    writeFileSync(join(dir, 'deposits.json'), JSON.stringify({ deposits: [], epoch: 'e1' }))
    expect(store(dir).s.readMailbox(H).epoch).not.toBe('e1')
  })

  it('review P3: a restored or renumbered store pins its epoch on disk at once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli113-pin-'))
    writeFileSync(join(dir, 'deposits.json'), JSON.stringify({ deposits: [], mailbox: { [H]: [{ at: 1, from: 'x', text: 'a' }] } }))
    const first = store(dir).s.readMailbox(H).epoch
    expect((JSON.parse(readFileSync(join(dir, 'deposits.json'), 'utf8')) as { epoch: string }).epoch).toBe(first)
    expect(store(dir).s.readMailbox(H).epoch).toBe(first)
  })

  it('a pre-gh#113 snapshot (no seq) is numbered oldest first on restore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli113-legacy-'))
    writeFileSync(join(dir, 'deposits.json'), JSON.stringify({
      deposits: [], mailbox: { [H]: [{ at: 3, from: 'x', text: 'newest' }, { at: 2, from: 'x', text: 'middle' }, { at: 1, from: 'x', text: 'oldest' }] },
    }))
    const { s } = store(dir)
    expect(s.readMailbox(H).mail.map(m => [m.seq, m.text])).toEqual([[3, 'newest'], [2, 'middle'], [1, 'oldest']])
    s.mail(H, 'x', 'later')
    expect(s.readMailbox(H)).toMatchObject({ next_seq: 5, oldest_seq: 1 })
  })
})
