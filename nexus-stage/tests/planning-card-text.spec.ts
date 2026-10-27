/**
 * Board card text (review 2026-10-27): the second line says what a session
 * is for instead of repeating its name; a peer card leads with the name it
 * publishes, not a clipped address.
 */
import { describe, expect, it } from 'vitest'
import { cardText, plainLine } from '../src/planning-card-text.ts'
import type { WorldNode } from '../src/world.ts'

const node = (over: Partial<WorldNode>): WorldNode => ({ x: 0, y: 0, id: 's1', label: 'dsh-host-x-11111111', team: 'dsh/11111111', name: 'scout-01', live: true, memberships: [], ...over })

describe('cardText', () => {
  it('a session card’s second line is its description; the handle moves to the tooltip', () => {
    const t = cardText(node({ description: '选品复核' }), [], undefined)
    expect(t).toEqual({ title: 'scout-01', sub: '选品复核', tip: 'dsh/11111111 · scout-01\n选品复核' })
  })

  it('without a description the second line is the handle alone — never the title again', () => {
    expect(cardText(node({}), [], undefined).sub).toBe('dsh/11111111')
    // Title fell back to the team label: nothing to repeat.
    expect(cardText(node({ name: undefined }), [], undefined)).toEqual({ title: 'dsh/11111111', sub: '', tip: 'dsh/11111111' })
  })

  it('cross-team and roster suffixes still ride the second line', () => {
    const t = cardText(node({ description: '选品复核', memberships: [{ team: 'a', index: 0 }, { team: 'b', index: 1 }], teams: ['x'] }), [], undefined)
    expect(t.sub).toBe('选品复核 · 跨队×2 · 网络队×1')
  })

  it('a peer publishing one named team is titled by that name; the address moves to the second line', () => {
    const peer = node({ id: 'peer-192.168.3.157:13080', remote: true, name: undefined })
    const t = cardText(peer, [{ team: 'dsh-host-ca0c0a8d', name: 'remote-157', via: 'http://192.168.3.157:13080' }], 0.9)
    expect(t.title).toBe('remote-157')
    expect(t.sub).toBe('192.168.3.157:13080 · score 0.9 · 1 远端团队：remote-157')
    expect(t.tip).toContain('192.168.3.157:13080')
  })

  it('a peer with several (or unnamed) teams keeps the address as its title', () => {
    const peer = node({ id: 'peer-10.0.0.5:8787', remote: true, name: undefined })
    const rows = [{ team: '远端甲', name: 'alpha-team' }, { team: '远端乙' }]
    expect(cardText(peer, rows, undefined)).toEqual({ title: '10.0.0.5:8787', sub: '2 远端团队：alpha-team、远端乙', tip: '10.0.0.5:8787\n2 远端团队：alpha-team、远端乙' })
    expect(cardText(peer, [{ team: '远端丙' }], undefined).title).toBe('10.0.0.5:8787')
  })
})

describe('plainLine — real-host descriptions (review 2026-10-27, .156 host 0.6.28)', () => {
  it('drops heading, emphasis and code markup and stops at a folded table or code fence', () => {
    expect(plainLine('# ✅ 已纠正——GitHub 仓现为**当前本仓**开源镜像 ## 终态 ``` github.com/x')).toBe('✅ 已纠正——GitHub 仓现为当前本仓开源镜像 终态')
    expect(plainLine('`/ygl-trees-verify` 已按技能门禁跑完，**全绿**。 ## 1. 递归自校验（六环，rc=0） | 环 | 结果 | |---|---|')).toBe('/ygl-trees-verify 已按技能门禁跑完，全绿。 1. 递归自校验（六环，rc=0）')
    expect(plainLine('# 评审完成 — 切片 3a 复验为真（完整表在 [REVIEW.md](tmp/review/REVIEW.md)）')).toBe('评审完成 — 切片 3a 复验为真（完整表在 REVIEW.md）')
  })

  it('leaves plain prose and issue numbers alone', () => {
    expect(plainLine('对齐回执 direct-4068c113 静默收讫。02:05 见。')).toBe('对齐回执 direct-4068c113 静默收讫。02:05 见。')
    expect(plainLine('修复 #77 两段棘轮')).toBe('修复 #77 两段棘轮')
  })

  it('the card shows the plain line', () => {
    const t = cardText(node({ description: '✅ **PR#76 补章入账确认回执已送达**（`direct-690f7cf9`）。' }), [], undefined)
    expect(t.sub).toBe('✅ PR#76 补章入账确认回执已送达（direct-690f7cf9）。')
  })
})
