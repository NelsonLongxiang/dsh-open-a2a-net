// @vitest-environment node
/**
 * docs/design/superagent-root-team.md R7: a root canvas team and its child teams — the store keeps them apart from the
 * member list, a child is proved to be a superagent team its host owns, a root is never a child, and the owner's canvas
 * route runs the four operations.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CanvasStore } from '../../src/canvas-store.ts'
import { canvasOwnerFingerprint } from '../../src/canvas-id.ts'
import { splitTeamRef } from '../../src/canvas-member.ts'
import { childProof, rootAction, type CanvasRootDeps, type ChildCard } from '../../src/canvas-root.ts'
import { signCard, verifyCard } from '../../src/card.ts'

const newKey = (): string => generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const own = newKey(), peer = newKey()
const refOf = (zone: string, name: string, key: string): string => `${zone}/canvas/${name}@${canvasOwnerFingerprint(key)}`

function store(path = join(mkdtempSync(join(tmpdir(), 'canvas-root-')), 'canvas.json')): { s: CanvasStore; path: string } {
  const s = new CanvasStore(path)
  for (const name of ['root', 'docs', 'ops']) s.create(name)
  return { s, path }
}

function deps(s: CanvasStore, options: { bound?: readonly string[]; cards?: ReadonlyArray<{ url: string; card: ChildCard; linked: boolean }> } = {}): CanvasRootDeps {
  return { store: s, zone: 'dsh', ownKey: own, localSuperagentCanvas: name => (options.bound ?? ['docs', 'ops', 'root']).includes(name), peerCards: async () => options.cards ?? [] }
}

describe('the team ref', () => {
  it('is a canvas address with its host fingerprint', () => {
    expect(splitTeamRef(refOf('dsh', 'docs', own))).toEqual({ zone: 'dsh', name: 'docs', team: 'dsh/canvas/docs', fingerprint: canvasOwnerFingerprint(own) })
    expect(splitTeamRef('dsh/canvas/docs')).toBeUndefined()
    expect(splitTeamRef('dsh/1234abcd@0123abcd')).toBeUndefined()
  })
})

describe('the canvas store', () => {
  it('keeps roots and children apart from members, persists them, and restores them', () => {
    const { s, path } = store()
    expect(s.setRoot('root', true)).toEqual({ ok: true })
    const docs = refOf('dsh', 'docs', own)
    expect(s.addChild('root', docs, own)).toEqual({ ok: true })
    expect(s.addChild('root', docs, own)).toEqual({ ok: true })
    expect(s.childrenOf('root')).toEqual([{ ref: docs, key: own, slots: 3 }])
    expect(s.membersOf('root')).toEqual([])
    expect(s.setChildSlots('root', docs, 5)).toEqual({ ok: true })
    expect(s.setChildSlots('root', docs, 17)).toMatchObject({ ok: false })
    const disk = JSON.parse(readFileSync(path, 'utf8')) as { roots: string[]; children: Record<string, unknown[]> }
    expect(disk.roots).toEqual(['root'])
    const again = new CanvasStore(path)
    expect(again.isRoot('root')).toBe(true)
    expect(again.childrenOf('root')).toEqual([{ ref: docs, key: own, slots: 5 }])
  })

  it('refuses a child on a plain team, under the wrong key, or past a pinned key; a root with children stays a root', () => {
    const { s } = store()
    const docs = refOf('dsh', 'docs', own)
    expect(s.addChild('root', docs, own)).toMatchObject({ ok: false, error: expect.stringContaining('not a root') })
    s.setRoot('root', true)
    expect(s.addChild('root', docs, peer)).toMatchObject({ ok: false })
    expect(s.addChild('root', docs, own)).toEqual({ ok: true })
    expect(s.setRoot('root', false)).toMatchObject({ ok: false, error: expect.stringContaining('child teams') })
    expect(s.removeChild('root', docs)).toBe(true)
    expect(s.setRoot('root', false)).toEqual({ ok: true })
  })

  it('removing the root team drops its flag and children', () => {
    const { s, path } = store()
    s.setRoot('root', true)
    s.addChild('root', refOf('dsh', 'docs', own), own)
    expect(s.remove('root')).toBe(true)
    expect(s.rootNames()).toEqual([])
    expect(new CanvasStore(path).childrenOf('root')).toEqual([])
  })
})

describe('the child proof', () => {
  it('a local child must be a bound superagent team, not the root itself and not a root', async () => {
    const { s } = store()
    s.setRoot('root', true)
    expect(await childProof('root', refOf('dsh', 'docs', own), deps(s))).toEqual({ ok: true, key: own })
    expect(await childProof('root', refOf('dsh', 'docs', own), deps(s, { bound: [] }))).toMatchObject({ ok: false, error: expect.stringContaining('not a superagent team') })
    expect(await childProof('root', refOf('dsh', 'root', own), deps(s))).toMatchObject({ ok: false, error: expect.stringContaining('own child') })
    s.setRoot('ops', true)
    expect(await childProof('root', refOf('dsh', 'ops', own), deps(s))).toMatchObject({ ok: false, error: expect.stringContaining('root itself') })
    expect(await childProof('root', refOf('dsh', 'nosuch', own), deps(s))).toMatchObject({ ok: false })
    expect(await childProof('root', 'dsh/canvas/docs', deps(s))).toMatchObject({ ok: false })
  })

  it('a remote child must be listed as a superagent team on a linked peer\'s card under that key, and not as a root', async () => {
    const { s } = store()
    const ref = refOf('ext', 'sales', peer)
    const card = (entry: Record<string, unknown>): ChildCard => ({ publicKey: peer, canvasOrg: [{ name: 'sales', team: 'ext/canvas/sales', ...entry }] })
    expect(await childProof('root', ref, deps(s))).toMatchObject({ ok: false, error: expect.stringContaining('no linked peer') })
    expect(await childProof('root', ref, deps(s, { cards: [{ url: 'http://p', card: card({ superagentTeam: true }), linked: false }] }))).toMatchObject({ ok: false, error: expect.stringContaining('not a linked peer') })
    expect(await childProof('root', ref, deps(s, { cards: [{ url: 'http://p', card: { publicKey: peer, canvasOrg: [] }, linked: true }] }))).toMatchObject({ ok: false, error: expect.stringContaining('does not list') })
    expect(await childProof('root', ref, deps(s, { cards: [{ url: 'http://p', card: card({}), linked: true }] }))).toMatchObject({ ok: false, error: expect.stringContaining('not a superagent team') })
    expect(await childProof('root', ref, deps(s, { cards: [{ url: 'http://p', card: card({ superagentTeam: true, root: true }), linked: true }] }))).toMatchObject({ ok: false, error: expect.stringContaining('root itself') })
    expect(await childProof('root', ref, deps(s, { cards: [{ url: 'http://p', card: card({ superagentTeam: true }), linked: true }] }))).toEqual({ ok: true, key: peer })
  })
})

describe('the canvas route\'s root actions', () => {
  it('set-root, add-team, set-team-slots and remove-team, each answering the root\'s view', async () => {
    const { s } = store()
    const d = deps(s, { cards: [{ url: 'http://p', card: { publicKey: peer, canvasOrg: [{ name: 'sales', team: 'ext/canvas/sales', superagentTeam: true }] }, linked: true }] })
    const docs = refOf('dsh', 'docs', own), sales = refOf('ext', 'sales', peer)
    expect(await rootAction('add-team', { name: 'root', team: docs }, d)).toMatchObject({ ok: false, error: expect.stringContaining('set-root') })
    expect(await rootAction('set-root', { name: 'root', root: true }, d)).toMatchObject({ ok: true, roots: ['root'] })
    expect(await rootAction('add-team', { name: 'root', team: docs }, d)).toMatchObject({ ok: true })
    expect(await rootAction('add-team', { name: 'root', team: sales, slots: 2 }, d)).toMatchObject({ ok: true, children: [{ ref: docs, slots: 3 }, { ref: sales, slots: 2 }] })
    expect(await rootAction('set-team-slots', { name: 'root', team: docs, slots: 6 }, d)).toMatchObject({ ok: true, children: [{ ref: docs, slots: 6 }, { ref: sales }] })
    expect(await rootAction('remove-team', { name: 'root', team: sales }, d)).toMatchObject({ ok: true, children: [{ ref: docs }] })
    expect(await rootAction('set-root', { name: 'root', root: 'yes' }, d)).toMatchObject({ ok: false })
    expect(await rootAction('add-team', { name: '', team: docs }, d)).toMatchObject({ ok: false })
  })
})

describe('the card', () => {
  it('keeps the root flag in the canvas listing, so another host can refuse a root as a child', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const card = signCard({ name: 'R', session: 'r', team: 'dsh', capabilities: {}, expiresAt: Date.now() + 60_000 } as never, privateKey)
    const verified = verifyCard({ ...card, canvasOrg: [{ name: 'root', team: 'dsh/canvas/root', members: [], superagentTeam: true, root: true }, { name: 'docs', team: 'dsh/canvas/docs', members: [], root: 'yes' }] }, Date.now())
    expect(verified.ok).toBe(true)
    const org = (verified as { card: { canvasOrg?: Array<{ name: string; root?: true }> } }).card.canvasOrg ?? []
    expect(org.find(row => row.name === 'root')?.root).toBe(true)
    expect(org.find(row => row.name === 'docs')?.root).toBeUndefined()
    const admitting = verifyCard({ ...card, canvasOrg: [{ name: 'docs', team: 'dsh/canvas/docs', members: [], superagentTeam: true, admits: ['superagent-team/0123456789abcdef', 7] }] }, Date.now())
    expect((admitting as { card: { canvasOrg?: Array<{ admits?: string[] }> } }).card.canvasOrg?.[0]?.admits).toEqual(['superagent-team/0123456789abcdef'])
  })
})
