// @vitest-environment node
/** The control API's user scope: an owner delegate stands in for the browser owner, and only a live one does. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OWNER_DELEGATE_HEADER, OwnerDelegates, issueOwnerDelegate, revokeOwnerDelegate } from '../../src/superagent/host/owner-delegate.ts'
import { browserOwnerProof, configureOwnerDelegates, type BrowserOwnerConnection } from '../../src/superagent/host/owner-proof.ts'

let dir = ''
let store = ''
let audit = ''
const io = (now = () => new Date('2026-11-24T00:00:00Z')) => ({
  read: (p: string) => { try { return readFileSync(p, 'utf8') } catch { return undefined } },
  write: (p: string, t: string) => { writeFileSync(p, t, 'utf8') },
  random: () => ({ token: `dshod_${'x'.repeat(30)}${Math.random().toString(36).slice(2)}`, id: `id-${Math.random().toString(36).slice(2)}` }),
  now,
})
const req = (token?: string) => ({ method: 'POST', url: '/__dsh_a2a/superagent/decisions', headers: token === undefined ? {} : { [OWNER_DELEGATE_HEADER]: token } })
const refusingHost: BrowserOwnerConnection = { browserPeer: { id: 'owner' }, admit: () => ({ rejection: 401 }) }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'owner-delegate-'))
  store = join(dir, 'owner-delegates.json')
  audit = join(dir, 'owner-delegates-audit.jsonl')
  configureOwnerDelegates(new OwnerDelegates(store, audit, () => new Date('2026-11-25T00:00:00Z')))
})
afterEach(() => { configureOwnerDelegates(undefined); rmSync(dir, { recursive: true, force: true }) })

describe('owner delegate', () => {
  it('a live delegate passes where the browser login is absent, and the use is audited', () => {
    const { token, record } = issueOwnerDelegate(store, 'coordinator', 30, io())
    expect(browserOwnerProof(refusingHost, req(token))).toEqual({ ok: true })
    const line = JSON.parse(readFileSync(audit, 'utf8').trim()) as Record<string, unknown>
    expect(line).toMatchObject({ id: record.id, name: 'coordinator', method: 'POST', path: '/__dsh_a2a/superagent/decisions' })
  })

  it('the store keeps no token, only its digest', () => {
    const { token } = issueOwnerDelegate(store, 'coordinator', 30, io())
    expect(readFileSync(store, 'utf8')).not.toContain(token)
  })

  it.each([
    ['unknown', () => 'dshod_not-issued-anywhere-xxxxxxxx'],
    ['revoked', () => { const { token, record } = issueOwnerDelegate(store, 'a', 30, io()); revokeOwnerDelegate(store, record.id, io()); return token }],
    ['expired', () => issueOwnerDelegate(store, 'a', 0.5, io()).token],
  ])('a %s token refuses and does not fall back to the browser login', (reason, make) => {
    const token = make()
    const admit = vi.fn(() => ({ peer: { id: 'owner' } }))
    const out = browserOwnerProof({ browserPeer: { id: 'owner' }, admit }, req(token))
    expect(out).toMatchObject({ ok: false, status: 403, code: 'owner-delegate' })
    expect((out as { error: string }).error).toContain(reason)
    expect(admit).not.toHaveBeenCalled()
  })

  it('the control route\'s own check ignores the delegate header (it never replaces the control key)', () => {
    const { token } = issueOwnerDelegate(store, 'coordinator', 30, io())
    expect(browserOwnerProof(refusingHost, req(token), { delegate: false })).toMatchObject({ ok: false, status: 401 })
  })

  it('no delegate book configured: a presented token refuses', () => {
    configureOwnerDelegates(undefined)
    expect(browserOwnerProof(refusingHost, req('dshod_whatever-xxxxxxxxxxxxxxxxxxxx'))).toMatchObject({ ok: false, code: 'owner-delegate' })
  })

  it('an audit that cannot be written refuses the use', () => {
    const { token } = issueOwnerDelegate(store, 'coordinator', 30, io())
    configureOwnerDelegates(new OwnerDelegates(store, join(dir, 'missing-dir', 'audit.jsonl'), () => new Date('2026-11-25T00:00:00Z')))
    expect(browserOwnerProof(refusingHost, req(token))).toMatchObject({ ok: false, status: 503, code: 'owner-delegate' })
  })

  it('without the header the browser-owner proof is unchanged', () => {
    expect(browserOwnerProof(refusingHost, req())).toMatchObject({ ok: false, status: 401, code: 'owner-proof' })
  })
})
