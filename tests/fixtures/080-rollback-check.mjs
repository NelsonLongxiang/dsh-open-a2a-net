// 0.8.0 rollback check: data written by the candidate, read (then written once) by the real 0.7.0 package.
//
//   node tests/fixtures/080-rollback-check.mjs <CANDIDATE_PACKAGE_ROOT> <OLD_0.7.0_PACKAGE_ROOT> <NEW_EMPTY_OUTPUT_DIR>
//
// Covers what 0.8.0 adds to persisted state: the task ledger's acknowledged rows (superagent v4, #421) and receipt
// dispositions (`acknowledged`, `attention`), and the CLI mailbox row fields task_id / context_id / disposition / proof /
// receipt_for / admission. It touches nothing but the output directory. The superagent state directory
// (<a2a home>/superagent/) has no reader in 0.7.0 and is not exercised here.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const [newRoot, oldRoot, out] = process.argv.slice(2).map(x => resolve(x))
if (existsSync(out) && readdirSync(out).length) throw Error('rollback fixture requires a new empty output directory')
mkdirSync(out, { recursive: true })
const load = (root, file) => import(pathToFileURL(join(root, 'lib', file)))
const version = root => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const sha = buf => createHash('sha256').update(buf).digest('hex')
const now = Date.now()
const team = 'superagent-team/0123456789abcdef'
const receipt = (task, line, envelope) => `[A2A receipt] task ${task} ${line}\n${JSON.stringify({ idempotencyKey: task, ...envelope })}`

// --- Task ledger ---------------------------------------------------------------------------------------------------
const ledgerFile = join(out, 'tasks.json')
const { TaskLedger: New } = await load(newRoot, 'task-ledger.js')
const { TaskLedger: Old } = await load(oldRoot, 'task-ledger.js')
const n = new New(ledgerFile, { now: () => now })
n.track('outbound', 'beta/aaaaaaaa', 'https://example.invalid', undefined, 'outbound debt', { kind: 'session', id: 'alpha/bbbbbbbb' }, { consumed: false })
// An acknowledged request: still owed, marked, out of the queue count, expiring 7 days after the acknowledgement.
n.track('acked', team, 'local')
assert.equal(n.resolveFromMessage(receipt('acked', '已接下', { disposition: 'acknowledged' }))?.acknowledged, true)
// An acknowledged request its result settled: archived with acknowledgedAt.
n.track('acked-settled', team, 'local')
n.resolveFromMessage(receipt('acked-settled', '已接下', { disposition: 'acknowledged' }))
n.resolveFromMessage(receipt('acked-settled', '完成', { outcome: 'completed', disposition: 'result' }))
// An attention receipt: settled, no outcome.
n.track('attention', team, 'local')
n.resolveFromMessage(receipt('attention', '需要你回答', { disposition: 'attention' }))
assert.deepEqual(n.list().map(r => r.taskId).sort(), ['acked', 'outbound'])
assert.equal(n.find('acked')?.acknowledgedAt, now)

const ledgerBefore = readFileSync(ledgerFile)
copyFileSync(ledgerFile, join(out, 'tasks-before-070.json'))
const old = new Old(ledgerFile, { now: () => now })
const oldRows = old.list()
const oldArchive = old.archive()
assert.deepEqual(oldRows.map(r => r.taskId).sort(), ['acked', 'outbound'], 'the old reader keeps every owed row')
assert.deepEqual(readFileSync(ledgerFile), ledgerBefore, 'an old read-only pass does not change the file')
writeFileSync(join(out, 'tasks-old-projection.json'), JSON.stringify({ tasks: oldRows, archived: oldArchive, conservation: old.conservation() }, null, 2))
old.track('old-write', 'beta/aaaaaaaa', 'local')
const ledgerAfter = JSON.parse(readFileSync(ledgerFile, 'utf8'))
writeFileSync(join(out, 'tasks-after-070-write.json'), JSON.stringify(ledgerAfter, null, 2))
for (const id of ['acked', 'outbound']) assert(ledgerAfter.tasks.some(r => r.taskId === id), `owed row ${id} survives an old write`)
const before = JSON.parse(ledgerBefore.toString('utf8'))
const fieldLoss = (list, id) => {
  const a = before[list].find(r => r.taskId === id), b = ledgerAfter[list].find(r => r.taskId === id)
  return b === undefined ? ['(row gone)'] : Object.keys(a).filter(k => !(k in b))
}
// The old ledger has no acknowledged TTL: the row it reads expires 24 hours after it was tracked.
const reopened = new Old(ledgerFile, { now: () => now + 24 * 3_600_000 + 60_000 })
const ackedAfterDay = reopened.list().find(r => r.taskId === 'acked')?.status ?? '(gone)'

// --- CLI mailbox ---------------------------------------------------------------------------------------------------
const mailFile = join(out, 'cli-deposits.json')
const { CliDepositStore: NewStore } = await load(newRoot, 'cli-deposit.js')
const { CliDepositStore: OldStore } = await load(oldRoot, 'cli-deposit.js')
const handle = 'reporter/0123456789abcdef'
const ns = new NewStore(mailFile, { now: () => now })
ns.mail(handle, 'superagent-team/0123456789abcdef', receipt('t1', '已接下', { disposition: 'acknowledged' }), undefined,
  { taskId: 'ack-t1', contextId: 'ctx-1', disposition: 'acknowledged', proof: 'cli-identity', receiptFor: 't1', admission: 'cli-deposit' })
ns.mail(handle, 'alpha/bbbbbbbb', 'a plain message', undefined, { taskId: 'direct-1', contextId: 'ctx-1', proof: 'origin-claim', admission: 'canvas-shared' })
const mailBefore = readFileSync(mailFile)
copyFileSync(mailFile, join(out, 'cli-deposits-before-070.json'))
const os = new OldStore(mailFile, { now: () => now })
const oldMail = os.readMail(handle)
assert.equal(oldMail.length, 2, 'the old store keeps both mailbox rows')
const mailReadChangedDisk = !mailBefore.equals(readFileSync(mailFile))
os.mail(handle, 'alpha/bbbbbbbb', 'written by 0.7.0')
const mailAfter = JSON.parse(readFileSync(mailFile, 'utf8'))
writeFileSync(join(out, 'cli-deposits-after-070-write.json'), JSON.stringify(mailAfter, null, 2))
const mailRowsAfter = mailAfter.mailbox[handle]
const mailBeforeRows = JSON.parse(mailBefore.toString('utf8')).mailbox[handle]
const mailFieldLoss = mailBeforeRows.map(row => {
  const kept = mailRowsAfter.find(r => r.seq === row.seq && r.text === row.text)
  return { seq: row.seq, lost: kept === undefined ? ['(row gone)'] : Object.keys(row).filter(k => !(k in kept)) }
})
// The candidate reads the mailbox the old version wrote.
const reread = new NewStore(mailFile, { now: () => now }).readMail(handle)

const result = {
  newVersion: version(newRoot),
  oldVersion: version(oldRoot),
  ledger: {
    oldLoads: true,
    oldReadOnlyChangesDisk: false,
    owedIds: ['acked', 'outbound'],
    oldReadOwedIds: oldRows.map(r => r.taskId),
    oldReadArchivedIds: oldArchive.map(r => r.taskId),
    afterOldWriteOwedIds: ledgerAfter.tasks.map(r => r.taskId),
    ackedFieldLoss: fieldLoss('tasks', 'acked'),
    ackedSettledFieldLoss: fieldLoss('archived', 'acked-settled'),
    attentionFieldLoss: fieldLoss('archived', 'attention'),
    oldAckedStatusAfter24h: ackedAfterDay,
    topLevelLost: Object.keys(before).filter(k => !(k in ledgerAfter)),
    beforeSha256: sha(ledgerBefore),
  },
  mailbox: {
    oldLoads: true,
    oldReadRows: oldMail.length,
    oldReadChangesDisk: mailReadChangedDisk,
    afterOldWriteRows: mailRowsAfter.length,
    fieldLoss: mailFieldLoss,
    candidateRereadRows: reread.length,
    beforeSha256: sha(mailBefore),
  },
}
writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
