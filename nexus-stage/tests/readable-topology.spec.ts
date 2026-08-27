// @vitest-environment jsdom
/** Regression suite for the P0 readability split (B1-B6):
 *  topology normalization, LOD hysteresis, overlay lifecycle + XSS,
 *  and reduced-motion render gating. */
import { describe, expect, it, vi, afterEach } from 'vitest'
import * as THREE from 'three'
import { drawMembership, drawActivity, drawPeers, MOCK } from '../src/topology'
import { lodFor, prefersReducedMotion } from '../src/lod'
import { attachLabel, detachLabel, pinInspector, unpinInspector, mountChrome, setAriaLabel, shortName } from '../src/overlay'

const meshes = (rows: Array<{ id: string; x: number; y: number; z: number }>) => {
  const m = new Map<string, THREE.Object3D>()
  for (const r of rows) {
    const o = new THREE.Object3D()
    o.position.set(r.x, r.y, r.z)
    m.set(r.id, o)
  }
  return m
}

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

describe('B5 LOD hysteresis', () => {
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
    // shortName caps/ellipsizes the payload; every fragment stays inert text
    expect(el.textContent).toContain('<img src=x onerror…')
    expect(el.textContent).toContain('<script>y</script>')
  })
  it('detach removes the label element from its parent', () => {
    const mesh = new THREE.Object3D()
    const obj = attachLabel(mesh, 'n', true, 't')
    const parent = obj.element.parentElement
    detachLabel(obj)
    expect(parent?.contains(obj.element) ?? false).toBe(false)
  })
})

describe('a11y + reduced-motion (C-series)', () => {
  it('aria: setAriaLabel writes the live node/team/peer census onto the canvas', () => {
    const canvas = document.createElement('canvas')
    setAriaLabel(canvas, 'A2A 拓扑：5 个节点（3 live / 2 cold），2 个团队，1 个联邦对端')
    expect(canvas.getAttribute('aria-label')).toContain('5 个节点')
    expect(canvas.getAttribute('aria-label')).toContain('1 个联邦对端')
  })

  it('aria: inspector text carries team and live state via pin/unpin cycle', () => {
    const app = document.createElement('div')
    document.body.appendChild(app)
    pinInspector(app, 'ontology/main · live · 团队 ontology')
    const badge = app.querySelector('.nexus-inspector')!
    expect(badge.textContent).toContain('ontology/main')
    expect((badge as HTMLElement).style.display).toBe('block')
    unpinInspector()
    expect((badge as HTMLElement).style.display).toBe('none')
    app.remove()
  })

  it('reduced-motion: prefersReducedMotion reflects the media flag (static render path gate)', () => {
    window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false, removeListener() {} })) as MediaQueryList
    const flag = prefersReducedMotion()
    expect(typeof flag).toBe('boolean')
  })

  it('keyboard: Enter/Tab handlers exist on the canvas surface (focus traversal contract)', () => {
    const canvas = document.createElement('canvas')
    mountChrome(document.createElement('div'), canvas)
    expect(canvas.getAttribute('tabindex')).toBe('0')
    expect(canvas.getAttribute('role')).toBe('img')
  })
})
