/**
 * gh#45 CLI 户口 store pins: the three owner rulings as executable
 * contracts — handle shape <name>/<16hex>, verified-card-only deposit,
 * 4h auto-deregister, mailbox round-trip.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
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

describe('gh#137 a re-publish keeps the key the handle was published with', () => {
  const H = 'ops-cli/a1b2c3d4e5f60718'
  const other = generateKeyPairSync('ed25519').privateKey
  const otherCard = (team: string): string => JSON.stringify(signCard({ name: 'cli-node', session: 'cli-node-session', team, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, other))
  const keyOf = (json: string | undefined): unknown => (json === undefined ? undefined : (JSON.parse(json) as { publicKey?: unknown }).publicKey)

  it('a live deposit refuses another key (and stays as it was); the same key refreshes', () => {
    const { s } = store()
    expect(s.deposit(cliCard(H)).ok).toBe(true)
    const before = s.get(H)?.cardJson
    const swapped = s.deposit(otherCard(H))
    expect(swapped).toEqual({ ok: false, error: expect.stringContaining('held by another key (live deposit)') as unknown })
    expect(s.get(H)?.cardJson).toBe(before)
    expect(s.deposit(cliCard(H)).ok).toBe(true)
  })

  it('a tombstone pins the key too; an explicit revoke frees the handle for a new key', () => {
    const { s, tick } = store()
    expect(s.deposit(cliCard(H)).ok).toBe(true)
    tick(4 * 60 * 60 * 1000 + 1)
    expect(s.get(H)).toBeUndefined() // expired: offline row only
    expect(s.deposit(otherCard(H))).toEqual({ ok: false, error: expect.stringContaining('held by another key (offline deposit)') as unknown })
    expect(s.revoke(H)).toBe(true)
    expect(s.deposit(otherCard(H)).ok).toBe(true)
    expect(keyOf(s.get(H)?.cardJson)).toBe((JSON.parse(otherCard(H)) as { publicKey: string }).publicKey)
  })

  it('the pin survives a restart (the stored card carries the key)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli137-'))
    expect(store(dir).s.deposit(cliCard(H)).ok).toBe(true)
    const { s } = store(dir)
    expect(s.deposit(otherCard(H)).ok).toBe(false)
    expect(s.deposit(cliCard(H)).ok).toBe(true)
  })
})

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

  it('re-review P3: an unreadable nextSeq value, or a mailbox handle without one, voids the epoch', () => {
    for (const snap of [
      { deposits: [], epoch: 'e1', nextSeq: { [H]: 'x' }, mailbox: {} },
      { deposits: [], epoch: 'e1', nextSeq: {}, mailbox: { [H]: [] } },
    ]) {
      const dir = mkdtempSync(join(tmpdir(), 'cli113-nextseq-'))
      writeFileSync(join(dir, 'deposits.json'), JSON.stringify(snap))
      expect(store(dir).s.readMailbox(H).epoch).not.toBe('e1')
    }
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

describe('superagent p1-context-read: mailbox rows carry their task and conversation', () => {
  const H = 'ops-cli/a1b2c3d4e5f60718'
  it('task_id and context_id are kept as given, empty ones dropped, and both survive a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-thread-store-'))
    const { s } = store(dir)
    s.mail(H, 'ops/1', 'tagged', undefined, { taskId: 't-1', contextId: 'ctx-1' })
    s.mail(H, 'ops/1', 'empty tags', undefined, { taskId: '', contextId: '' })
    s.mail(H, 'ops/1', 'context only', 'sync-answered', { contextId: 'ctx-2' })
    s.mail(H, 'ops/1', 'untagged')
    const rows = (st: CliDepositStore) => st.readMailbox(H).mail.map(({ at: _at, ...m }) => m)
    const expected = [
      { from: 'ops/1', text: 'untagged', seq: 4 },
      { from: 'ops/1', text: 'context only', seq: 3, dup: 'sync-answered', context_id: 'ctx-2' },
      { from: 'ops/1', text: 'empty tags', seq: 2 },
      { from: 'ops/1', text: 'tagged', seq: 1, task_id: 't-1', context_id: 'ctx-1' },
    ]
    expect(rows(s)).toEqual(expected)
    expect(rows(store(dir).s)).toEqual(expected)
  })
})

describe('superagent p1-mail-proof: rows carry the host proof and the task a receipt answers', () => {
  const H = 'ops-cli/a1b2c3d4e5f60718'
  it('keeps proof and receipt_for as given, drops an empty receipt_for, and both survive a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-proof-store-'))
    const { s } = store(dir)
    s.mail(H, 'ops/1', 'verified', undefined, { proof: 'origin-claim' })
    s.mail(H, 'ops/1', 'a receipt', undefined, { proof: 'cli-identity', receiptFor: 'job-1' })
    s.mail(H, 'ops/1', 'empty answer', undefined, { proof: 'in-process', receiptFor: '' })
    const rows = (st: CliDepositStore) => st.readMailbox(H).mail.map(({ at: _at, ...m }) => m)
    const expected = [
      { from: 'ops/1', text: 'empty answer', seq: 3, proof: 'in-process' },
      { from: 'ops/1', text: 'a receipt', seq: 2, proof: 'cli-identity', receipt_for: 'job-1' },
      { from: 'ops/1', text: 'verified', seq: 1, proof: 'origin-claim' },
    ]
    expect(rows(s)).toEqual(expected)
    expect(rows(store(dir).s)).toEqual(expected)
  })

  it('a damaged snapshot never promotes a row: unknown proof values and non-string receipt_for are dropped on restore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cli-proof-bad-'))
    const { s } = store(dir)
    s.mail(H, 'ops/1', 'one', undefined, { proof: 'unbound', receiptFor: 'job-9' })
    s.mail(H, 'ops/1', 'two', undefined, { proof: 'none' })
    const path = join(dir, 'deposits.json')
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { mailbox: Record<string, Array<Record<string, unknown>>> }
    doc.mailbox[H]![0]!.proof = 'trusted-by-me'
    doc.mailbox[H]![1]!.receipt_for = 42
    writeFileSync(path, JSON.stringify(doc))
    const back = store(dir).s.readMailbox(H).mail
    expect(back.map(m => [m.text, m.proof, m.receipt_for])).toEqual([['two', undefined, undefined], ['one', 'unbound', undefined]])
  })
})
