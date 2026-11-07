// @vitest-environment node
/**
 * superagent G2 runtime contract: the helpers the a2a Source keeps in this repo (src/superagent/source-types.ts)
 * behave exactly like the upstream code excerpted in the snapshot, and the snapshot stays a pinned, offline, licensed
 * excerpt. The type-level half of the contract is src/superagent/contract.ts (the typecheck).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as ours from '../../src/superagent/source-types.ts'
import * as up from '../../src/superagent/upstream/snapshot-8c32a9d.ts'

const dir = join(process.cwd(), 'src', 'superagent', 'upstream')

describe('superagent G2: this repo against the pinned upstream snapshot', () => {
  it('key and threadKey give the upstream values', () => {
    for (const values of [['a2a', 'dsh/1234abcd', 'direct-1'], ['a2a', ''], [], ['webhook', 'm42'], ['a2a', 'x:y', 'ctx-"q"']]) {
      expect(ours.key(...values)).toBe(up.key(...values))
    }
    expect(ours.key('a2a', 'dsh/1', 't-1')).toMatch(/^[0-9a-f]{32}$/)
    expect(ours.key('a2a', 'dsh/1', 't-1')).not.toBe(ours.key('a2a', 'dsh/2', 't-1'))
    expect(ours.threadKey({ source: 'a2a', id: 'ctx-1' })).toBe(up.threadKey({ source: 'a2a', id: 'ctx-1' }))
  })

  it('health entries carry the upstream text, code and values for every code the Source reports', () => {
    for (const code of ['setupPending', 'sourceOff', 'pollFailures'] as const) {
      for (const values of [{}, { count: '3', error: 'host unreachable' }, { count: '1' }]) {
        expect(ours.health('error', code, values)).toEqual(up.health('error', code, values))
      }
    }
  })

  it('the snapshot is pinned, licensed and offline', () => {
    expect(up.UPSTREAM_COMMIT).toMatch(/^[0-9a-f]{40}$/)
    expect(up.UPSTREAM_REPOSITORY).toBe('deepseek-ai/dsh-superagent-prototype')
    const source = readFileSync(join(dir, 'snapshot-8c32a9d.ts'), 'utf8')
    expect(source).toContain(`Commit:   ${up.UPSTREAM_COMMIT}`)
    // Its only import is node:crypto (for the excerpted key()); nothing reaches upstream at build or test time.
    expect([...source.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])).toEqual(['node:crypto'])
    expect(source).not.toMatch(/\bfetch\(|https?:\/\/(?!github\.com)/)
    const license = readFileSync(join(dir, 'LICENSE.dsh-superagent'), 'utf8')
    expect(license).toMatch(/^MIT License\n\nCopyright \(c\) 2026 DeepSeek Harness Team\n/)
    expect(license).toContain('The above copyright notice and this permission notice shall be included in all')
    // The excerpts ship in lib/ without the LICENSE file beside them, so the notice rides in the snapshot itself.
    expect(source).toContain(' * Copyright (c) 2026 DeepSeek Harness Team')
    expect(source).toContain(' * The above copyright notice and this permission notice shall be included in all')
  })
})
