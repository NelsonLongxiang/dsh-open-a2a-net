/** gh#131: CanvasStore.localizeMembers rewrites this host's own handles to session ids. */
import { describe, expect, it } from 'vitest'
import { CanvasStore } from '../../src/canvas-store.ts'

const resolve = (ref: string): string | undefined => (ref === 'dsh/aaaaaaaa' ? 'session-aaaaaaaa11112222' : undefined)

describe('gh#131 canvas handle localization', () => {
  it('rewrites a local handle in its priority slot and leaves remote refs and session ids alone', () => {
    const store = new CanvasStore('')
    store.create('ops')
    for (const id of ['dsh/bbbbbbbb', 'dsh/aaaaaaaa', 'session-cccccccc']) store.addMember('ops', id)
    expect(store.localizeMembers(resolve)).toBe(1)
    expect(store.membersOf('ops')).toEqual(['dsh/bbbbbbbb', 'session-aaaaaaaa11112222', 'session-cccccccc'])
    expect(store.localizeMembers(resolve)).toBe(0)
  })

  it('a team holding both shapes keeps one slot, the earlier one', () => {
    const store = new CanvasStore('')
    store.create('a'); store.create('b')
    for (const id of ['dsh/aaaaaaaa', 'session-x', 'session-aaaaaaaa11112222']) store.addMember('a', id)
    for (const id of ['session-aaaaaaaa11112222', 'session-x', 'dsh/aaaaaaaa']) store.addMember('b', id)
    expect(store.localizeMembers(resolve)).toBe(2)
    expect(store.membersOf('a')).toEqual(['session-aaaaaaaa11112222', 'session-x'])
    expect(store.membersOf('b')).toEqual(['session-aaaaaaaa11112222', 'session-x'])
  })

  it('persists the rewrite and tells the listeners only when something changed', () => {
    const store = new CanvasStore('')
    store.create('ops')
    store.addMember('ops', 'dsh/zzzzzzzz')
    let calls = 0
    store.onChange(() => { calls += 1 })
    expect(store.localizeMembers(resolve)).toBe(0)
    expect(calls).toBe(0)
    store.addMember('ops', 'dsh/aaaaaaaa')
    calls = 0
    expect(store.localizeMembers(resolve)).toBe(1)
    expect(calls).toBe(1)
  })
})
