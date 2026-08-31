/**
 * Stage CSS ↔ constants contract (the 202af37 class of bug): the geometry
 * constants the edges/layout math relies on must stay in lockstep with the
 * stylesheet. jsdom has no layout engine, so this source-contract test is
 * the cheapest real pin — either side drifting fails the build. The gold
 * standard remains an occasional Playwright offsetWidth smoke.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NODE_H, NODE_W } from '../nexus-stage/src/world.ts'
import { FRAME_HEAD_H, FRAME_HEAD_TOP } from '../nexus-stage/src/edges.ts'

const css = readFileSync(new URL('../nexus-stage/src/planning.css', import.meta.url), 'utf8')

describe('stage CSS ↔ constants contract', () => {
  it('declares border-box for the whole planning subtree', () => {
    expect(css).toMatch(/#dsh-plan \*,#dsh-plan \*::before,#dsh-plan \*::after\{box-sizing:border-box\}/)
  })

  it('card is exactly NODE_W×NODE_H border-box', () => {
    expect(css).toMatch(new RegExp(`\\.p-node\\{[^}]*width:${NODE_W}px; height:${NODE_H}px`))
  })

  it('frame head geometry matches the star-anchor constants', () => {
    expect(css).toMatch(new RegExp(`\\.p-frame-head\\{[^}]*top:${FRAME_HEAD_TOP}px; left:50%[^}]*height:${FRAME_HEAD_H}px`))
  })

  it('frame body is event-transparent; only the head is interactive', () => {
    expect(css).toMatch(/\.p-frame\{[^}]*pointer-events:none\}/)
    expect(css).toMatch(/\.p-frame-head\{pointer-events:auto\}/)
  })
})
