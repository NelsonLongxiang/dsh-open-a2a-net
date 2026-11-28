// @vitest-environment node
/** #838 H: the four hot network keys are served from one snapshot that the home-layer writer swaps; tightening bites at once. */
import { mkdtempSync } from '../temp-dirs.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Config } from '../../src/config.ts'
import { createLiveNetConfig, forgetPeerEntries, sameHostUrl, sanitizeLiveNetValue } from '../../src/live-net-config.ts'
import { onHomeA2aWritten, writeHomeA2a } from '../../src/owner-settings.ts'
import { PeerStore } from '../../src/peer-store.ts'

const fs = { exists: existsSync, read: (p: string) => readFileSync(p, 'utf8'), write: (p: string, s: string) => writeFileSync(p, s, 'utf8'), mkdir: (p: string) => { mkdirSync(p, { recursive: true }) } }
const defaults = Config({} as never) as unknown as Record<string, unknown>
const boot = () => Config({ peers: ['http://a.example:1', 'http://b.example:2'], originClaimUrl: 'http://self.example:3', originClaimAudiences: ['http://alias.example:3'], originClaimByPeer: { 'http://a.example:1': 'http://self-a.example:3' } } as never)
const home = () => mkdtempSync(join(tmpdir(), 'live-net-'))

describe('createLiveNetConfig', () => {
  it('serves the boot values, and every other key unchanged', () => {
    const live = createLiveNetConfig(boot())
    expect(live.config.peers).toEqual(['http://a.example:1', 'http://b.example:2'])
    expect(live.config.originClaimUrl).toBe('http://self.example:3')
    expect(live.config.agentName).toBe(boot().agentName)
  })
  it('a reload shows the written values at once, in the same object every reader holds', () => {
    const live = createLiveNetConfig(boot())
    const held = live.config
    const diff = live.reload({ peers: ['http://c.example:3'], originClaimUrl: '', originClaimAudiences: [], originClaimByPeer: {} })
    expect(held.peers).toEqual(['http://c.example:3'])
    expect(held.originClaimUrl).toBe('')
    expect(held.originClaimAudiences).toEqual([])
    expect(held.originClaimByPeer).toEqual({})
    expect(diff.changed).toEqual(['peers', 'originClaimUrl', 'originClaimAudiences', 'originClaimByPeer'])
    expect(diff.removedPeers).toEqual(['http://a.example:1', 'http://b.example:2'])
    expect(diff.removedAudiences).toEqual(['http://alias.example:3'])
    expect(diff.removedByPeer).toEqual(['http://a.example:1'])
  })
  it('adding is not a removal, and rewriting the same value changes nothing', () => {
    const live = createLiveNetConfig(boot())
    const grown = live.reload({ peers: ['http://a.example:1', 'http://b.example:2', 'http://c.example:3'] })
    expect(grown).toMatchObject({ changed: ['peers'], removedPeers: [] })
    expect(live.reload({ peers: ['http://a.example:1', 'http://b.example:2', 'http://c.example:3'] }).changed).toEqual([])
  })
  it('a value with the wrong shape is ignored with a warning and the previous value stays', () => {
    const live = createLiveNetConfig(boot())
    const warn = vi.fn()
    const diff = live.reload({ peers: 'http://x', originClaimAudiences: [1], originClaimByPeer: ['x'], originClaimUrl: 7 }, warn)
    expect(diff.changed).toEqual([])
    expect(diff.ignored).toEqual(['peers', 'originClaimUrl', 'originClaimAudiences', 'originClaimByPeer'])
    expect(warn).toHaveBeenCalledTimes(4)
    expect(live.config.peers).toEqual(['http://a.example:1', 'http://b.example:2'])
  })
  it('only the four hot keys are taken: credentials and anything else in the overlay never reach the config', () => {
    const live = createLiveNetConfig(boot())
    live.reload({ apiKey: 'stolen', teamScope: false, announce: true, linkKeys: { x: 'y' } })
    expect(live.config.apiKey).toBe(boot().apiKey)
    expect(live.config.announce).toBe(false)
  })
  it('the snapshot swap is atomic: an array a reader already holds is not mutated', () => {
    const live = createLiveNetConfig(boot())
    const before = live.config.peers
    live.reload({ peers: ['http://z.example:9'] })
    expect(before).toEqual(['http://a.example:1', 'http://b.example:2'])
    expect(Object.isFrozen(live.config.peers)).toBe(true)
  })
  it('sanitize mirrors the schema shapes', () => {
    expect(sanitizeLiveNetValue('peers', ['http://x'])).toMatchObject({ ok: true })
    expect(sanitizeLiveNetValue('peers', null)).toEqual({ ok: false })
    expect(sanitizeLiveNetValue('originClaimByPeer', { a: 'b' })).toMatchObject({ ok: true })
    expect(sanitizeLiveNetValue('originClaimByPeer', { a: 1 })).toEqual({ ok: false })
    expect(sanitizeLiveNetValue('originClaimUrl', '')).toMatchObject({ ok: true })
  })
})

describe('the home-layer writer drives the reload', () => {
  it('a successful write notifies the owner of that home with the overlay, an unsubscribed listener hears nothing', () => {
    const h = home()
    const heard = vi.fn()
    const stop = onHomeA2aWritten(h, heard)
    expect(writeHomeA2a(h, { network: { peers: ['http://c.example:3'] } }, boot() as never, defaults, fs)).toMatchObject({ ok: true })
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ peers: ['http://c.example:3'] }))
    stop()
    writeHomeA2a(h, { network: { peers: ['http://d.example:4'] } }, boot() as never, defaults, fs)
    expect(heard).toHaveBeenCalledTimes(1)
  })
  it('a refused write (credentials in the lower layer) notifies no one, and a throwing listener never fails a write', () => {
    const refused = home(); const heard = vi.fn(); onHomeA2aWritten(refused, heard)
    const withKey = Config({ apiKey: 'k', peers: ['http://a.example:1'] } as never)
    expect(writeHomeA2a(refused, { teamScope: false }, withKey as never, defaults, fs)).toMatchObject({ ok: false })
    expect(heard).not.toHaveBeenCalled()
    const h = home(); onHomeA2aWritten(h, () => { throw new Error('listener bug') })
    expect(writeHomeA2a(h, { network: { peers: ['http://c.example:3'] } }, boot() as never, defaults, fs)).toMatchObject({ ok: true })
  })
  it('end to end: write, reload, and the next read sees the new peers; the file and the running value agree', () => {
    const h = home(); const live = createLiveNetConfig(boot())
    onHomeA2aWritten(h, overlay => { live.reload(overlay) })
    writeHomeA2a(h, { network: { peers: ['http://c.example:3'], originClaimAudiences: ['http://new.example:3'] } }, live.config as never, defaults, fs)
    expect(live.config.peers).toEqual(['http://c.example:3'])
    expect(live.config.originClaimAudiences).toEqual(['http://new.example:3'])
    expect(readFileSync(join(h, 'cordis.patch.yml'), 'utf8')).toContain('peers: ["http://c.example:3"]')
  })
})

describe('forgetPeerEntries', () => {
  it('drops the warm card and the signed-discovery entry of a removed peer, by origin and path, and keeps every other peer', () => {
    const cards = new Map<string, unknown>([['http://a.example:1', 1], ['http://a.example:1/', 2], ['http://b.example:2', 3], ['http://a.example:1/mount', 4]])
    const discovery = new Map<string, unknown>([['http://a.example:1', 1], ['http://c.example:3', 2]])
    expect(forgetPeerEntries(['http://a.example:1'], cards, discovery)).toBe(3)
    expect([...cards.keys()]).toEqual(['http://b.example:2', 'http://a.example:1/mount'])
    expect([...discovery.keys()]).toEqual(['http://c.example:3'])
  })
  it('removing nothing drops nothing', () => {
    const cards = new Map<string, unknown>([['http://a.example:1', 1]])
    expect(forgetPeerEntries([], cards)).toBe(0)
    expect(cards.size).toBe(1)
  })
  it('sameHostUrl ignores trailing slashes only', () => {
    expect(sameHostUrl('http://a.example:1', 'http://a.example:1/')).toBe(true)
    expect(sameHostUrl('http://a.example:1', 'http://a.example:2')).toBe(false)
    expect(sameHostUrl('http://a.example:1/x', 'http://a.example:1/y')).toBe(false)
  })
})

describe('PeerStore.setSeeds', () => {
  it('a new seed is tracked and immune; a removed seed loses its immunity and a drop forgets it', () => {
    const store = new PeerStore(['http://a', 'http://b'], '')
    store.setSeeds(['http://a', 'http://c'])
    expect(store.list()).toEqual(['http://a', 'http://c', 'http://b'])
    expect(store.listSeeded()).toEqual(['http://a', 'http://c'])
    store.drop('http://b')
    expect(store.list()).toEqual(['http://a', 'http://c'])
  })
  it('a seed that stays keeps its learned contact stamps', () => {
    const store = new PeerStore(['http://a'], '')
    store.noteSuccess('http://a')
    const at = store.lastContact('http://a')
    store.setSeeds(['http://a', 'http://b'])
    expect(store.lastContact('http://a')).toBe(at)
  })
})

describe('no direct read of the boot config', () => {
  it('index.ts reads the four hot keys only through the live view: bootConfig appears at its one wrapper, and config is never spread', () => {
    const src = readFileSync(join(__dirname, '../../src/index.ts'), 'utf8')
    expect(src.match(/bootConfig\b/g)?.length).toBe(3)
    expect(src).not.toMatch(/bootConfig\./)
    expect(src).not.toMatch(/\{\s*\.\.\.config\s*[,}]/)
    expect(src).not.toMatch(/\bconfig\s*=\s*\{/)
  })
})
