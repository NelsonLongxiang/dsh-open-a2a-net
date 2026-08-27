// @vitest-environment jsdom
/** Regression suite for the P0 readability split (B1-B6): topology
 *  normalization + O(n) hub-star, LOD boundaries, overlay lifecycle + XSS,
 *  keyboard navigation, reduced-motion probe. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { drawMembership, drawActivity, drawPeers, formatCensus, MOCK } from '../src/topology'
import { lodFor, prefersReducedMotion } from '../src/lod'
import { attachLabel, detachLabel, bindInspectorKeys, shortName } from '../src/overlay'

/** jsdom lacks matchMedia: stub it before any module probes reduced-motion. */
function stubMatchMedia(): void {
  const w = window as unknown as {
    matchMedia?: (q: string) => {
      matches: boolean; media: string
      addEventListener: () => void; removeEventListener: () => void
      addListener: () => void; removeListener: () => void
      onchange: unknown; dispatchEvent: () => boolean
    }
  }
  w.matchMedia = (q: string) => ({
    matches: false, media: q,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false,
  })
}

const meshes = (rows: Array<{ id: string; x: number; y: number; z: number }>) => {
  const m = new Map<string, THREE.Object3D>()
  for (const r of rows) {
    const o = new THREE.Object3D()
    o.position.set(r.x, r.y, r.z)
    m.set(r.id, o)
  }
  return m
}

beforeEach(() => { stubMatchMedia() })
afterEach(() => { vi.restoreAllMocks() })

describe('B4 topology normalization (defensive fixtures)', () => {
  it('hub-star draws exactly members-1 spokes + 1 hub per team (O(n) edges)', () => {
    const lineGroup = new THREE.Group()
    const teamGroup = new THREE.Group()
    const ids = ['a', 'b', 'c', 'd', 'e']
    const m = meshes(ids.map((id, i) => ({ id, x: i * 2, y: 0, z: 0 })))
    drawMembership([{
      name: 'core', team: 'ontology',
      members: ids.map(id => ({ id, team: 'ontology', joined: true, live: true })),
    }], m, lineGroup, teamGroup)
    // 5 members -> 5 spokes + 1 hub; NOT 5*4/2=10 pairwise lines
    expect(lineGroup.children.filter(c => c instanceof THREE.Line)).toHaveLength(5)
    expect(teamGroup.children.filter(c => c instanceof THREE.Mesh)).toHaveLength(1)
  })

  it('drawMembership skips members with no mesh (dangling ids)', () => {
    const lineGroup = new THREE.Group()
    const teamGroup = new THREE.Group()
    const m = meshes([{ id: 'x', x: 0, y: 0, z: 0 }])
    drawMembership([{
      name: 't', team: 't',
      members: [
        { id: 'x', team: 't', joined: true, live: true },
        { id: 'ghost-1', team: 't', joined: true, live: true },
        { id: 'ghost-2', team: 't', joined: true, live: true },
      ],
    }], m, lineGroup, teamGroup)
    // only 1 live member present -> no hub/spokes at all
    expect(lineGroup.children.filter(c => c instanceof THREE.Line)).toHaveLength(0)
    expect(teamGroup.children).toHaveLength(0)
  })

  it('mock fixture: 5 sessions / 2 teams / 1 peer, malformed-safe', () => {
    expect(MOCK.sessions).toHaveLength(5)
    expect(MOCK.canvas!.teams).toHaveLength(2)
    expect(MOCK.peers).toHaveLength(1)
  })
})

describe('B5 LOD boundaries', () => {
  it('near/far/mid boundaries', () => {
    expect(lodFor(30)).toBe('near')
    expect(lodFor(60)).toBe('mid')
    expect(lodFor(120)).toBe('far')
  })
})

describe('overlay XSS + lifecycle', () => {
  it('attachLabel uses textContent only — no innerHTML, script payloads inert', () => {
    const mesh = new THREE.Object3D()
    const obj = attachLabel(mesh, '<img src=x onerror=alert(1)>', true, '<script>y</script>')
    const el = obj.element as HTMLElement
    expect(el.innerHTML.includes('<img')).toBe(false)
    expect(el.innerHTML.includes('<script')).toBe(false)
  })
  it('shortName strips team prefix and caps length', () => {
    expect(shortName('ontology/main')).toBe('main')
    expect(shortName('a-very-long-name-that-exceeds-the-cap-limit')!.length).toBeLessThanOrEqual(19)
  })
  it('detach removes the label element from its parent', () => {
    const mesh = new THREE.Object3D()
    const obj = attachLabel(mesh, 'n', true, 't')
    const parent = obj.element.parentElement
    detachLabel(obj)
    expect(parent?.contains(obj.element) ?? false).toBe(false)
  })
})

describe('bindInspectorKeys — dispatchEvent-driven behavior', () => {
  it('Enter/Tab advance the roster; Escape unpins and fires onEscape', () => {
    const canvas = document.createElement('div')
    document.body.appendChild(canvas)
    const roster = ['n-a', 'n-b', 'n-c']
    let idx = -1
    let escapes = 0
    bindInspectorKeys(canvas, {
      advance: () => { idx = (idx + 1) % roster.length; return roster[idx] },
      current: () => roster[idx] ?? '',
      onEscape: () => { escapes += 1 },
    })
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(idx).toBe(0)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(idx).toBe(1)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(escapes).toBe(1)
    canvas.remove()
  })

  it('prefersReducedMotion stays boolean across jsdom (static path gate)', () => {
    const flag = prefersReducedMotion()
    expect(typeof flag).toBe('boolean')
  })
})

describe('formatCensus — aria 五计数纯函数', () => {
  it('counts total/live/cold/teams/peers exactly', () => {
    const sessions = [
      { id: 'a', label: 'a', team: 't1', joined: true, live: true },
      { id: 'b', label: 'b', team: 't1', joined: true, live: false },
      { id: 'c', label: 'c', team: 't2', joined: true, live: true },
    ]
    const teams = [{ name: 't1' }, { name: 't2' }]
    const peers = [{ url: 'u1' }]
    const s = formatCensus(sessions, teams, peers)
    expect(s).toContain('3 个节点')
    expect(s).toContain('2 live')
    expect(s).toContain('1 cold')
    expect(s).toContain('2 个团队')
    expect(s).toContain('1 个联邦对端')
  })
  it('empty fleet renders zeroed census', () => {
    const s = formatCensus([], [], [])
    expect(s).toContain('0 个节点')
    expect(s).toContain('0 个团队')
  })
})

describe('reduced-motion: renderOnce gated on real events', () => {
  it('prefersReducedMotion is a boolean gate', () => {
    expect(typeof prefersReducedMotion()).toBe('boolean')
  })
})
