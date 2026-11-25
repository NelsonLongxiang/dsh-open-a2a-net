// @vitest-environment node
/** #903 S1: the owner's user scope reads this host's team builders — the inventory and the builder sessions — and nothing else. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerBuilderFace } from '../../src/faces/builder.ts'
import { builderSessions, type InventoryInput } from '../../src/superagent/host/builder-tools.ts'
import { OWNER_DELEGATE_HEADER, OwnerDelegates, issueOwnerDelegate } from '../../src/superagent/host/owner-delegate.ts'
import { configureOwnerDelegates } from '../../src/superagent/host/owner-proof.ts'

let dir = ''
const at = new Date('2026-11-25T00:00:00Z')

/** A team whose settings also carry things the inventory must never show. */
const inventory = (): InventoryInput => ({
  teams: [{
    ref: 't1',
    settings: {
      canvas: 'ops', router: 'r1', members: ['m1'], observers: [],
      rules: [{ name: 'intake', text: 'take ops tickets', enabled: true }], dispatch: 'by skill',
      profiles: { m1: { role: 'runs deploys' } }, repos: { m1: 'owner/repo' }, acceptMode: 'auto',
      // Not in InventoryTeam's type: what a raw settings object also holds, and must not leak.
      apiKey: 'SECRET-KEY', allowed: { a2a: ['someone'] }, github: { allowed: ['acct'] }, mcp: { url: 'http://x' },
    } as never,
    revisions: { team: 3, dispatch: 1, 'member:m1': 2 },
    seatOf: s => (s === 'm1' ? 'seat-1' : undefined),
    children: [],
  }],
  sessions: ['r1', 'm1', 'b1', 'free'],
  nameOf: s => ({ r1: 'Router', m1: 'Deployer', b1: '组队顾问', free: 'Spare' } as Record<string, string>)[s] ?? s,
  presetOf: s => (s === 'b1' ? 'superagent-builder' : 'superagent-member'),
  staffing: [
    { id: 'bp-1', state: 'awaiting', source: 'owner-local', at: at.toISOString(), ops: [{ op: 'member.add' }], by: { session: 'b1' } },
    { id: 'bp-0', state: 'done', source: 'owner-local', at: at.toISOString(), ops: [{ op: 'team.rules.set' }], by: { session: 'b1' } },
  ] as never,
})

describe('builderSessions', () => {
  it('lists builder sessions with their awaiting and drafted blueprints, and nothing else', () => {
    const rows = builderSessions({
      sessions: [{ id: 'b1', live: true, joined: true }, { id: 'm1', live: true, joined: true }, { id: 'b2', live: false, joined: false }],
      isBuilder: s => s.startsWith('b'),
      nameOf: s => (s === 'b1' ? '组队顾问' : s),
      staffing: [{ state: 'awaiting', by: { session: 'b1' } }, { state: 'done', by: { session: 'b1' } }, { state: 'awaiting', by: { session: 'other' } }],
    })
    expect(rows).toEqual([
      { session: 'b1', name: '组队顾问', live: true, joined: true, awaiting: 1, recent: 2 },
      { session: 'b2', name: 'b2', live: false, joined: false, awaiting: 0, recent: 0 },
    ])
  })
})

describe('/__dsh_a2a/superagent/builder', () => {
  type Handler = (req: unknown, res: unknown) => void
  let handler: Handler = () => {}
  let token = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'builder-face-'))
    const store = join(dir, 'owner-delegates.json')
    configureOwnerDelegates(new OwnerDelegates(store, join(dir, 'audit.jsonl'), () => at))
    token = issueOwnerDelegate(store, 'coordinator', 30, {
      read: p => { try { return readFileSync(p, 'utf8') } catch { return undefined } },
      write: (p, t) => { writeFileSync(p, t) },
      random: () => ({ token: `dshod_${'z'.repeat(40)}`, id: 'd1' }),
      now: () => at,
    }).token
    registerBuilderFace({ register: (row: { handler: Handler }) => { handler = row.handler; return () => {} } } as never, {
      ctx: { effect: (fn: () => unknown) => fn(), get: () => ({ browserPeer: { id: 'owner' }, admit: () => ({ rejection: 401 }) }) } as never,
      controlRoute: fn => fn,
      inventory,
      sessions: () => [{ id: 'r1', live: true, joined: true }, { id: 'm1', live: true, joined: true }, { id: 'b1', live: true, joined: false }],
      isBuilder: s => s === 'b1',
    })
  })
  afterEach(() => { configureOwnerDelegates(undefined); rmSync(dir, { recursive: true, force: true }) })

  const call = (method: string, url: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: Record<string, unknown>; text: string }>((resolve) => {
    let status = 0
    handler({ method, url, headers, socket: { localPort: 3080 } }, {
      writeHead: (s: number) => { status = s },
      end: (text: string) => { resolve({ status, body: JSON.parse(text) as Record<string, unknown>, text }) },
    })
  })

  it('refuses a caller with neither the browser owner nor a delegate', async () => {
    expect((await call('GET', '/__dsh_a2a/superagent/builder?view=inventory')).status).toBe(401)
  })

  it('view=inventory is the builder\'s inventory: teams, members by seat, rule revisions — never credentials, admission, GitHub or MCP', async () => {
    const out = await call('GET', '/__dsh_a2a/superagent/builder?view=inventory', { [OWNER_DELEGATE_HEADER]: token })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ ok: true, teams: [{ team: 't1', canvas: 'ops', router: { session: 'r1', name: 'Router' }, members: [{ seatId: 'seat-1', session: 'm1', role: 'runs deploys', revision: 2 }], rules: { teamRevision: 3, dispatchRevision: 1 } }] })
    expect((out.body.staffing as Array<{ id: string }>).map(e => e.id)).toEqual(['bp-1', 'bp-0'])
    for (const leak of ['SECRET-KEY', 'someone', 'acct', 'http://x', 'apiKey', 'allowed', 'github', 'mcp']) expect(out.text).not.toContain(leak)
  })

  it('view=builders lists the builder sessions with their awaiting blueprints', async () => {
    const out = await call('GET', '/__dsh_a2a/superagent/builder?view=builders', { [OWNER_DELEGATE_HEADER]: token })
    expect(out.body).toEqual({ ok: true, builders: [{ session: 'b1', name: '组队顾问', live: true, joined: false, awaiting: 1, recent: 2 }] })
  })

  it('S1 writes nothing: any other method is 405; an unknown view is 400', async () => {
    expect((await call('POST', '/__dsh_a2a/superagent/builder', { [OWNER_DELEGATE_HEADER]: token })).status).toBe(405)
    expect((await call('GET', '/__dsh_a2a/superagent/builder?view=blueprints', { [OWNER_DELEGATE_HEADER]: token })).status).toBe(400)
  })
})
