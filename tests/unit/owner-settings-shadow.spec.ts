/**
 * #812: the owner-settings writer must not hide the lower layers' a2a config. DSH patches replace an entry's top-level
 * keys whole, so the home layer's a2a `config` block is the whole effective a2a config once it exists.
 */
import { describe, expect, it } from 'vitest'
import { applyOwnerSettings, createsConfigBlock, lowerLayerSeed } from '../../src/owner-settings.ts'
import { Config } from '../../src/config.ts'

const PROFILE = { peers: ['http://peer.example:13080'], originClaimUrl: 'http://self.example:3081', originClaimAudiences: ['http://self.example:3081'], teamScope: true, announce: true }
const defaults = Config({} as never) as unknown as Record<string, unknown>
const effective = Config(PROFILE as never) as unknown as Record<string, unknown>

/** The home a2a config block as DSH would mount it (only `key: <json>` lines, as this writer emits for these keys). */
function homeA2aConfig(yaml: string): Record<string, unknown> | undefined {
  const lines = yaml.split('\n'); const at = lines.findIndex(l => /^-\s*id:\s*a2a\s*$/.test(l))
  if (at < 0) return undefined
  const out: Record<string, unknown> = {}
  for (const line of lines.slice(at + 2)) { const m = /^ {4}(\w+): (.*)$/.exec(line); if (m === null) break; out[m[1]!] = JSON.parse(m[2]!) }
  return out
}

describe('#812 owner settings keep the lower layers\' a2a config', () => {
  it('toggling teamScope with no home a2a entry keeps peers, originClaimUrl and originClaimAudiences in effect', () => {
    const current = '- id: session-persistence-jsonl\n  disabled: false\n'
    expect(createsConfigBlock(current)).toBe(true)
    const lower = lowerLayerSeed(effective, defaults)
    expect(lower.ok).toBe(true)
    const { yaml } = applyOwnerSettings(current, { teamScope: false }, lower.ok ? lower.seed : {})
    const home = homeA2aConfig(yaml)!
    // DSH replaces the whole config: what the home block holds is all that takes effect.
    expect(home.peers).toEqual(PROFILE.peers)
    expect(home.originClaimUrl).toBe(PROFILE.originClaimUrl)
    expect(home.originClaimAudiences).toEqual(PROFILE.originClaimAudiences)
    expect(home.announce).toBe(true)
    expect(home.teamScope).toBe(false)
    expect(yaml.startsWith(current)).toBe(true)
  })

  it('an entry without a config block is seeded the same way', () => {
    const lower = lowerLayerSeed(effective, defaults)
    const { yaml } = applyOwnerSettings('- id: a2a\n  disabled: false\n', { announce: false }, lower.ok ? lower.seed : {})
    expect(yaml).toContain('    peers: ["http://peer.example:13080"]')
    expect(yaml).toContain('    announce: false')
    expect(yaml).not.toContain('    announce: true')
  })

  it('leaves out keys equal to the schema default, and an existing config block is edited in place without a seed', () => {
    const lower = lowerLayerSeed(effective, defaults)
    expect(lower.ok && Object.keys(lower.seed).sort()).toEqual(['announce', 'originClaimAudiences', 'originClaimUrl', 'peers', 'teamScope'])
    const existing = '- id: a2a\n  config:\n    teamScope: true\n'
    expect(createsConfigBlock(existing)).toBe(false)
  })

  it('refuses when a lower layer sets a credential: never copied between layers, never silently dropped', () => {
    for (const secret of [{ apiKey: 'k' }, { linkKeys: { 'http://peer.example:13080': 'k' } }]) {
      const lower = lowerLayerSeed(Config({ ...PROFILE, ...secret } as never) as unknown as Record<string, unknown>, defaults)
      expect(lower).toEqual({ ok: false, blocked: Object.keys(secret) })
    }
  })
})
