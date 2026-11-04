import { describe, expect, it } from 'vitest'
import { canvasOwners, canvasMemberships, canvasFailure } from '../../src/canvas-discovery.ts'
import type { A2aPeerCard } from '../../src/types.ts'
const card = (key: string): A2aPeerCard => ({ publicKey: key, session: 'host-'+key, team: 'dsh', expiresAt: Date.now()+60000, canvasOrg: [{ team: 'dsh/canvas/shared', name: 'shared', members: ['dsh/aaaaaaaa','dsh/bbbbbbbb'] }] } as A2aPeerCard)
describe('#271 read-only canvas ownership', () => {
  it('keeps distinct same-name owners, collapses same-key/session aliases and shows only actual identity memberships', () => {
    const rows = canvasOwners([{ team:'dsh/canvas/local',name:'local',members:['local-id'] }], 'http://home', [{url:'http://b',card:card('b')},{url:'http://b-alias',card:card('b')},{url:'http://c',card:card('c')}])
    expect(rows).toHaveLength(3)
    const memberships = canvasMemberships(rows, 'dsh/aaaaaaaa','local-id', ref => ref==='dsh/aaaaaaaa'?'local-id':undefined)
    expect(memberships).toHaveLength(3)
    expect(memberships.every(row=>!('members' in row))).toBe(true)
    expect(canvasMemberships(rows,'dsh/aaaaaaaa','local-id',()=>undefined).map(row=>row.owner)).toEqual(['http://home'])
    const message = canvasFailure('dsh/canvas/shared',rows,'refused')
    expect(message).toContain('canvas-multiple-owners');expect(message).toContain('http://b');expect(message).toContain('http://c')
    expect(canvasFailure('dsh/canvas/missing',rows,'refused')).toContain('canvas-not-found')
    expect(canvasFailure('dsh/canvas/local',rows,'refused')).toContain('canvas-owner: http://home')
    expect(canvasFailure('dsh/aaaaaaaa',rows,'refused')).toBe('refused')
  })
  it('does not mistake publisher sessions, expired cards or foreign canvas namespaces for this identity', () => {
    const own=card('b');own.sessionTeams=[{team:'dsh/aaaaaaaa',name:'peer own session',description:''}]
    const expired={...card('expired'),expiresAt:1}
    const foreign={...card('foreign'),team:'other'}
    const rows=canvasOwners([], 'http://home',[{url:'http://b',card:own},{url:'http://expired',card:expired},{url:'http://foreign',card:foreign}])
    expect(rows).toHaveLength(1);expect(rows[0]!.memberCount).toBe(2)
    expect(canvasMemberships(rows,'dsh/aaaaaaaa','local-id',()=> 'local-id')).toEqual([])
  })
})
