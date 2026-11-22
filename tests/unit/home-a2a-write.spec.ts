// @vitest-environment node
/** #812 review / #808 P2: the one home-layer a2a write, against a real file (the route and the blueprint both call it). */
import { mkdtempSync } from '../temp-dirs.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeHomeA2a } from '../../src/owner-settings.ts'
import { Config } from '../../src/config.ts'

const fs = { exists: existsSync, read: (p: string) => readFileSync(p, 'utf8'), write: (p: string, s: string) => writeFileSync(p, s, 'utf8'), mkdir: (p: string) => { mkdirSync(p, { recursive: true }) } }
const defaults = Config({} as never) as unknown as Record<string, unknown>
const PROFILE = { peers: ['http://peer.example:13080'], originClaimUrl: 'http://self.example:3081', originClaimAudiences: ['http://self.example:3081'] }
const effective = (extra: Record<string, unknown> = {}) => Config({ ...PROFILE, ...extra } as never) as unknown as Record<string, unknown>
const home = () => mkdtempSync(join(tmpdir(), 'home-a2a-'))

describe('writeHomeA2a', () => {
  it('a first teamScope switch writes a home block that keeps the profile layer\'s peers and originClaim*', () => {
    const h = home()
    expect(writeHomeA2a(h, { teamScope: false }, effective(), defaults, fs)).toMatchObject({ ok: true })
    const yaml = readFileSync(join(h, 'cordis.patch.yml'), 'utf8')
    expect(yaml).toContain('    peers: ["http://peer.example:13080"]')
    expect(yaml).toContain('    originClaimUrl: "http://self.example:3081"')
    expect(yaml).toContain('    teamScope: false')
  })
  it('refuses, and writes nothing, when the lower layers set a credential', () => {
    const h = home()
    expect(writeHomeA2a(h, { teamScope: false }, effective({ apiKey: 'k' }), defaults, fs)).toMatchObject({ ok: false, code: 'credentials' })
    expect(existsSync(join(h, 'cordis.patch.yml'))).toBe(false)
  })
  it('replaces a block-style peers list whole and keeps foreign keys', () => {
    const h = home()
    writeFileSync(join(h, 'cordis.patch.yml'), '- id: a2a\n  config:\n    wakeJoinedOnBoot: true\n    peers:\n      - http://a.example:1\n      - http://b.example:2\n    announce: true\n')
    expect(writeHomeA2a(h, { network: { peers: ['http://c.example:3'] } }, effective(), defaults, fs)).toMatchObject({ ok: true, restartNeeded: true })
    const yaml = readFileSync(join(h, 'cordis.patch.yml'), 'utf8')
    expect(yaml).toBe('- id: a2a\n  config:\n    wakeJoinedOnBoot: true\n    peers: ["http://c.example:3"]\n    announce: true\n')
  })
})
