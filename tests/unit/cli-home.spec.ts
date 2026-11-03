import { describe, expect, it } from 'vitest'
import { cliHomeChoices, decideCliHome, type CliHomeCandidate } from '../../src/cli-home.ts'
import type { A2aPeerCard } from '../../src/types.ts'

const handle = 'ops-cli/a1b2c3d4e5f60718'
const row = (url: string, linked = true, listed = true): CliHomeCandidate => ({
  url, linked, card: { sessionTeams: listed ? [{ team: handle, name: 'CLI', description: '', offline: false }] : [] } as unknown as A2aPeerCard,
})

describe('CLI home pin at the operator link gesture', () => {
  it('pins only one linked origin, deduplicates aliases, and leaves zero/multiple homes unknown', () => {
    expect(decideCliHome(handle, undefined, [])).toEqual({ ok: true })
    expect(decideCliHome(handle, undefined, [row('https://one.test', false)])).toEqual({ ok: true })
    expect(decideCliHome(handle, undefined, [row('https://one.test'), row('https://one.test/alias')])).toEqual({ ok: true, home: 'https://one.test' })
    expect(decideCliHome(handle, undefined, [row('https://one.test'), row('https://two.test')])).toEqual({ ok: true })
  })
  it('a locally held online or offline household never auto-pins elsewhere, but a fresh explicit choice is validated', () => {
    const candidates = [row('https://replay.test')]
    expect(decideCliHome(handle, undefined, candidates, true)).toEqual({ ok: true })
    expect(decideCliHome(handle, 'https://replay.test', candidates, true)).toEqual({ ok: true, home: 'https://replay.test' })
    expect(decideCliHome(handle, 'https://unlisted.test', candidates, true).ok).toBe(false)
  })
  it('an unreadable linked host prevents automatic pinning, but an explicit verified choice remains available', () => {
    const candidates = [row('https://attacker.test'), { url: 'https://home.test', linked: true }]
    expect(decideCliHome(handle, undefined, candidates)).toEqual({ ok: true })
    expect(decideCliHome(handle, 'https://attacker.test/', candidates)).toEqual({ ok: true, home: 'https://attacker.test' })
    expect(decideCliHome(handle, 'https://home.test', candidates).ok).toBe(false)
  })
  it('choice projection includes only linked advertisers, counts unreadable cards, and deduplicates origins', () => {
    const candidates = [row('https://one.test'), row('https://one.test/alias'), row('https://stranger.test', false), row('https://unlisted.test', true, false), { url: 'https://dead.test', linked: true }]
    expect(cliHomeChoices(handle, candidates)).toEqual({ homes: ['https://one.test'], unreadable: 1 })
  })
  it('accepts explicit home only when its linked host lists that exact CLI handle', () => {
    const candidates = [row('https://one.test'), row('https://two.test', false), row('https://three.test', true, false)]
    expect(decideCliHome(handle, 'https://one.test', candidates)).toEqual({ ok: true, home: 'https://one.test' })
    for (const bad of ['https://two.test', 'https://three.test', 'https://one.test/path', 'http://one.test', null]) expect(decideCliHome(handle, bad, candidates).ok).toBe(false)
    expect(decideCliHome('zone/01234567', 'https://one.test', candidates).ok).toBe(false)
  })
})
