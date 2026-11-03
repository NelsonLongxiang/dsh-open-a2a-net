import { describe, expect, it } from 'vitest'
import { rosterFrames, rosterFrameName, rosterNameOf } from '../src/planning-roster.ts'
import { buildLayoutDoc, clampDoc } from '../src/layout-doc.ts'

describe('#199 roster frame namespace and state projection', () => {
  it('turns registry.teams declarations into local team frames with a distinct persisted key', () => {
    expect(rosterFrames([{ team: 'dsh/生产服务组', members: ['session-a', 'session-b'] }], 'dsh')).toEqual([
      { name: 'roster:生产服务组', team: 'dsh/生产服务组', kind: 'roster', members: [{ id: 'session-a' }, { id: 'session-b' }] },
    ])
    expect(rosterFrameName('甲')).not.toBe('甲')
    expect(rosterNameOf('甲')).toBeUndefined()
    expect(rosterNameOf('roster:甲')).toBe('甲')
    expect(rosterFrames([], 'dsh')).toEqual([])
    expect(rosterFrames([{ team: 'dsh/review', members: ['a'] }, { team: 'peerzone/review', members: ['b'] }, { team: 'dsh/a/b', members: ['c'] }], 'dsh')).toEqual([{ name: 'roster:review', team: 'dsh/review', kind: 'roster', members: [{ id: 'a' }] }])
  })
  it('round-trips a 40-character roster name as an independent 47-character layout key', () => {
    const frame = rosterFrameName('组'.repeat(40))
    const rect = { x: 1, y: 2, w: 260, h: 160 }
    const doc = buildLayoutDoc({ x: 0, y: 0, scale: 1 }, new Map(), new Map([[frame, rect], ['组'.repeat(41), rect]]))
    expect(doc.frames).toEqual({ [frame]: rect })
    expect(clampDoc(doc)?.frames).toEqual({ [frame]: rect })
  })
})
