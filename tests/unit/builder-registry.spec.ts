// @vitest-environment node
/** #906 review B2: builders that are not loaded still list, from the host's own notes; team roles and preset changes drop them. */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BuilderRegistry } from '../../src/superagent/host/builder-registry.ts'

const B = 'superagent-builder'

describe('BuilderRegistry.roster', () => {
  it('loaded builder → live; the same session unloaded later → live: false; loaded under another preset → forgotten', () => {
    const dir = mkdtempSync(join(tmpdir(), 'builder-reg-'))
    try {
      const reg = new BuilderRegistry(join(dir, 'a2a', 'builder-sessions.json'))
      const onTeam = new Set<string>()
      const roster = (loaded: Array<{ id: string; preset: string | undefined }>, now: string) => reg.roster({ loaded, builderPreset: B, onTeam: id => onTeam.has(id), now })
      expect(roster([{ id: 'b1', preset: B }, { id: 'b2', preset: B }, { id: 'm1', preset: 'superagent-member' }], 't1')).toEqual([{ id: 'b1', live: true }, { id: 'b2', live: true }])
      // A new registry over the same file (a restart): b1 and b2 not loaded, still listed.
      const again = new BuilderRegistry(join(dir, 'a2a', 'builder-sessions.json'))
      expect(again.roster({ loaded: [], builderPreset: B, onTeam: () => false, now: 't2' })).toEqual([{ id: 'b1', live: false, seenAt: 't1' }, { id: 'b2', live: false, seenAt: 't1' }])
      // b1 loaded with an unreadable preset: not live, not forgotten (unknown is not evidence).
      expect(roster([{ id: 'b1', preset: undefined }], 't3').map(r => r.id)).toEqual(['b2'])
      // b2 loaded under another preset: forgotten. b1 taken onto a team: forgotten.
      expect(roster([{ id: 'b2', preset: 'superagent-member' }], 't4')).toEqual([{ id: 'b1', live: false, seenAt: 't1' }])
      onTeam.add('b1')
      expect(roster([], 't5')).toEqual([])
      expect(JSON.parse(readFileSync(join(dir, 'a2a', 'builder-sessions.json'), 'utf8'))).toEqual({ builders: {} })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
