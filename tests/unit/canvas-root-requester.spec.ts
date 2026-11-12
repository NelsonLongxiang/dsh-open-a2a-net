// @vitest-environment node
/**
 * docs/design/superagent-root-team.md S5 (cross-host registration): admitting a root team on another host links its
 * identity to the child team's canvas as a requester pinned to its home host. The link survives a restart, is no member,
 * goes with the canvas, and is what the wire admission counts as an operator-established link for a remote CLI.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CanvasStore } from '../../src/canvas-store.ts'
import { linkRootRequester } from '../../src/canvas-root.ts'
import { callerAdmission, recheckCallerAdmission, recheckRemoteCliAuthorization, type AdmissionRecords } from '../../src/task-auth.ts'

const ROOT = 'superagent-team/48296a44ab6849c9', HOME = 'http://127.0.0.1:3084', OTHER = 'http://127.0.0.1:3090'

function store(): { s: CanvasStore; path: string } {
  const path = join(mkdtempSync(join(tmpdir(), 'canvas-req-')), 'canvas.json')
  const s = new CanvasStore(path)
  s.create('docs')
  return { s, path }
}

describe('a requester link on a canvas', () => {
  it('pins the identity to its home, survives a restart, and is no member', () => {
    const { s, path } = store()
    expect(s.addRequester('docs', ROOT, HOME)).toBe(true)
    expect(s.addRequester('docs', ROOT, HOME)).toBe(true)
    const again = new CanvasStore(path)
    expect(again.requestersOf('docs')).toEqual([ROOT])
    expect(again.cliHomeOf(ROOT)).toBe(HOME)
    expect(again.membersOf('docs')).toEqual([])
    expect(again.remoteMembersOf('docs')).toEqual([])
  })

  it('refuses another home, a missing canvas, and a malformed handle', () => {
    const { s } = store()
    expect(s.addRequester('docs', ROOT, HOME)).toBe(true)
    expect(s.addRequester('docs', ROOT, OTHER)).toBe(false)
    expect(s.addRequester('nope', ROOT, HOME)).toBe(false)
    expect(s.addRequester('docs', 'not a handle', HOME)).toBe(false)
  })

  it('goes with its canvas, and its pinned home with the last link', () => {
    const { s, path } = store()
    s.create('ops')
    s.addRequester('docs', ROOT, HOME)
    s.addRequester('ops', ROOT, HOME)
    expect(s.removeRequester('docs', ROOT)).toBe(true)
    expect(s.cliHomeOf(ROOT)).toBe(HOME)
    expect(s.remove('ops')).toBe(true)
    expect(s.cliHomeOf(ROOT)).toBeUndefined()
    expect(new CanvasStore(path).requestersOf('ops')).toEqual([])
  })
})

describe('admitting a root on another host', () => {
  const pinOnly = (home?: string) => async (_handle: string, requested?: unknown) => requested === undefined ? { ok: true as const, ...(home !== undefined ? { home } : {}) } : requested === HOME ? { ok: true as const, home: HOME } : { ok: false as const, error: 'home must be a linked host that currently lists this CLI handle' }

  it('links the identity at the one linked host that lists it', async () => {
    const { s } = store()
    expect(await linkRootRequester({ store: s, deposited: () => false, pinHome: pinOnly(HOME) }, 'docs', ROOT, undefined)).toEqual({ ok: true, home: HOME })
    expect(s.requestersOf('docs')).toEqual([ROOT])
  })

  it('asks for the home when no single linked host lists it, and refuses a home no linked host lists', async () => {
    const { s } = store()
    expect(await linkRootRequester({ store: s, deposited: () => false, pinHome: pinOnly() }, 'docs', ROOT, undefined)).toMatchObject({ ok: false, error: expect.stringContaining('pass home') })
    expect(await linkRootRequester({ store: s, deposited: () => false, pinHome: pinOnly() }, 'docs', ROOT, OTHER)).toMatchObject({ ok: false })
    expect(s.requestersOf('docs')).toEqual([])
  })

  it('needs no link for an identity deposited on this host', async () => {
    const { s } = store()
    expect(await linkRootRequester({ store: s, deposited: () => true, pinHome: pinOnly(HOME) }, 'docs', ROOT, undefined)).toEqual({ ok: true })
    expect(s.requestersOf('docs')).toEqual([])
  })
})

describe('the wire admits a linked root from its home host only', () => {
  const records = (s: CanvasStore): AdmissionRecords => ({
    zone: 'dsh', teamScopeRouting: true, id8: id => id.slice(0, 8), canvasTeamOf: name => `dsh/canvas/${name}`,
    memberships: () => [], joined: () => [], canvasNames: () => ['docs'], canvasTeamsOf: () => [], canvasMembersOf: () => [],
    canvasRemoteMembersOf: name => s.remoteMembersOf(name), canvasRequestersOf: name => s.requestersOf(name), peerOrgs: () => [], liveNodeIds: () => [],
    cliDeposited: () => false, cliHomeOf: handle => s.cliHomeOf(handle),
  })

  it('without the link it is refused; with it, from its home and online, it is admitted', () => {
    const { s } = store()
    const proof = { origin: HOME, viaUrl: HOME, bound: true, online: true }
    expect(callerAdmission(records(s), ROOT, 'dsh/canvas/docs', proof)).toMatchObject({ ok: false })
    s.addRequester('docs', ROOT, HOME)
    expect(callerAdmission(records(s), ROOT, 'dsh/canvas/docs', proof)).toMatchObject({ ok: true, rule: 'remote-ref-cli' })
    expect(callerAdmission(records(s), ROOT, 'dsh/canvas/docs', { ...proof, origin: OTHER, viaUrl: OTHER })).toMatchObject({ ok: false })
  })

  it('the identity\'s admission query and the settlement recheck see the link too, and lose it with the link', () => {
    const { s } = store()
    expect(recheckCallerAdmission(records(s), ROOT, 'superagent-team/9d13b6d5330742b9', false)).toMatchObject({ ok: false })
    s.addRequester('docs', ROOT, HOME)
    expect(recheckCallerAdmission(records(s), ROOT, 'superagent-team/9d13b6d5330742b9', false)).toMatchObject({ ok: true, rule: 'remote-ref-cli' })
    expect(recheckRemoteCliAuthorization(records(s), { caller: ROOT, carrier_url: HOME } as never)).toMatchObject({ ok: true })
    s.removeRequester('docs', ROOT)
    expect(recheckRemoteCliAuthorization(records(s), { caller: ROOT, carrier_url: HOME } as never)).toMatchObject({ ok: false })
  })
})
