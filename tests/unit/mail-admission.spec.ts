// @vitest-environment node
/** superagent p1-mail-admission: the rule set a mailbox row may carry, its sanitising, and the signed re-check query. */
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { CliDepositStore, MAIL_ADMISSIONS, admissionQueryPayload, verifyAdmissionQuery, ADMISSION_QUERY_WINDOW_MS } from '../../src/cli-deposit.ts'
import { VIA_OF, recheckCallerAdmission, type AdmissionRecords } from '../../src/task-auth.ts'
import { signCard } from '../../src/card.ts'

const HANDLE = 'shadow-src/a1b2c3d4e5f60718'
const cardOf = (key = generateKeyPairSync('ed25519').privateKey) => ({ key, json: JSON.stringify(signCard({ name: 'shadow-src', session: 'cli-shadow-src', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 3_600_000 }, key)) })
const signed = (key: ReturnType<typeof generateKeyPairSync>['privateKey'], handle: string, caller: string, ingress: 'local' | 'wire', ts: number) =>
  sign(null, Buffer.from(admissionQueryPayload(handle, caller, ingress, ts)), key).toString('base64')

describe('p1-mail-admission', () => {
  it('a row may carry exactly the admission rules task-auth knows', () => {
    expect([...MAIL_ADMISSIONS].sort()).toEqual(Object.keys(VIA_OF).sort())
  })

  it('a restored snapshot keeps a known rule and drops anything else', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mail-admission-')), 'deposits.json')
    const store = new CliDepositStore(file)
    const { json } = cardOf()
    expect(store.deposit(json).ok).toBe(true)
    store.mail(HANDLE, 'dsh/aaaaaaaa', 'one', undefined, { taskId: 't1', admission: 'canvas-shared' })
    store.mail(HANDLE, 'dsh/bbbbbbbb', 'two', undefined, { taskId: 't2', admission: 'cli-deposit' })
    const snap = JSON.parse(readFileSync(file, 'utf8')) as { mailbox: Record<string, Array<Record<string, unknown>>> }
    snap.mailbox[HANDLE]!.find(r => r.task_id === 't2')!.admission = 'operator-says-so'
    writeFileSync(file, JSON.stringify(snap))
    const back = new CliDepositStore(file).readMail(HANDLE)
    expect(back.find(r => r.task_id === 't1')?.admission).toBe('canvas-shared')
    expect(back.find(r => r.task_id === 't2')).not.toHaveProperty('admission')
  })

  it('a query is answered only when signed by the deposit\'s own key, fresh, over exactly its fields', () => {
    const { key, json } = cardOf()
    const now = Date.now()
    const q = { handle: HANDLE, caller: 'dsh/aaaaaaaa', ingress: 'wire' as const, ts: now }
    expect(verifyAdmissionQuery(json, { ...q, sig: signed(key, HANDLE, q.caller, 'wire', now) }, now)).toBe(true)
    // Another identity's key, a changed caller or ingress, a stale or future stamp, no live deposit, no signature: refused.
    expect(verifyAdmissionQuery(json, { ...q, sig: signed(generateKeyPairSync('ed25519').privateKey, HANDLE, q.caller, 'wire', now) }, now)).toBe(false)
    expect(verifyAdmissionQuery(json, { ...q, caller: 'dsh/bbbbbbbb', sig: signed(key, HANDLE, q.caller, 'wire', now) }, now)).toBe(false)
    expect(verifyAdmissionQuery(json, { ...q, ingress: 'local', sig: signed(key, HANDLE, q.caller, 'wire', now) }, now)).toBe(false)
    expect(verifyAdmissionQuery(json, { ...q, sig: signed(key, HANDLE, q.caller, 'wire', now) }, now + ADMISSION_QUERY_WINDOW_MS + 1)).toBe(false)
    expect(verifyAdmissionQuery(json, { ...q, sig: signed(key, HANDLE, q.caller, 'wire', now) }, now - ADMISSION_QUERY_WINDOW_MS - 1)).toBe(false)
    expect(verifyAdmissionQuery(undefined, { ...q, sig: signed(key, HANDLE, q.caller, 'wire', now) }, now)).toBe(false)
    expect(verifyAdmissionQuery(json, { ...q, sig: '' }, now)).toBe(false)
    expect(verifyAdmissionQuery(json, { ...q, sig: 'not-base64-signature' }, now)).toBe(false)
  })

  it('the recheck judges a remote CLI on its operator link and pinned home only (no online/signer proof needed)', () => {
    const REMOTE = 'ops-cli/a1b2c3d4e5f60799'
    const records = (over: Partial<AdmissionRecords> = {}): AdmissionRecords => ({
      zone: 'dsh', teamScopeRouting: true, id8: (id: string) => id.slice(-8), canvasTeamOf: (n: string) => `dsh/canvas/${n}`,
      memberships: () => [], joined: () => [], canvasNames: () => ['ops'], canvasTeamsOf: () => [], canvasMembersOf: () => [],
      canvasRemoteMembersOf: () => [REMOTE], peerOrgs: () => [], liveNodeIds: () => [], cliDeposited: () => false, cliHomeOf: () => 'http://home.test',
      ...over,
    })
    expect(recheckCallerAdmission(records(), REMOTE, HANDLE, false)).toMatchObject({ ok: true, rule: 'remote-ref-cli' })
    expect(recheckCallerAdmission(records({ canvasRemoteMembersOf: () => [] }), REMOTE, HANDLE, false)).toMatchObject({ ok: false })
    expect(recheckCallerAdmission(records({ cliHomeOf: () => undefined }), REMOTE, HANDLE, false)).toMatchObject({ ok: false })
    // A locally deposited CLI is the host's own fact (cli-deposit), not a remote ref; scope off admits everything as scope-off.
    expect(recheckCallerAdmission(records({ cliDeposited: () => true }), REMOTE, HANDLE, false)).toMatchObject({ ok: true, rule: 'cli-deposit' })
    expect(recheckCallerAdmission(records({ teamScopeRouting: false }), REMOTE, HANDLE, false)).toMatchObject({ ok: true, rule: 'scope-off' })
  })

  it('the CLI signs the same bytes the host verifies', () => {
    const cli = readFileSync(join(process.cwd(), 'cli/a2a.mjs'), 'utf8')
    expect(cli).toContain("['a2a-admission', id.handle, caller, ingress, ts]")
    expect(admissionQueryPayload('h', 'c', 'local', 1)).toBe(JSON.stringify(['a2a-admission', 'h', 'c', 'local', 1]))
    // #697 review R1: a query about one task signs it too, in a domain-separated form.
    expect(cli).toContain("['a2a-admission/2', id.handle, caller, ingress, ts, task]")
    expect(admissionQueryPayload('h', 'c', 'wire', 1, 't-1')).toBe(JSON.stringify(['a2a-admission/2', 'h', 'c', 'wire', 1, 't-1']))
  })
})
