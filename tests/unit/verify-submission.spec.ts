import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submissionFromProbe } from '../../scripts/verify-submission.mjs'

describe('RC recursive verifier submission binding', () => {
  it('never falls back to an old fixed TEMP directory; only this snapshot and HEAD selects its unique export', () => {
    const root = mkdtempSync(join(tmpdir(), 'a2a-verify-submission-test-'))
    try {
      const stale = join(root, 'dsh-a2a-submission')
      const fresh = join(root, 'dsh-a2a-submission-actual')
      const snapshot = join(root, 'snapshot.sqlite')
      const summary = join(root, 'probe-summary.json')
      const head = 'a'.repeat(40)
      mkdirSync(stale); mkdirSync(fresh)
      writeFileSync(join(stale, 'old.js'), 'old tree')
      expect(submissionFromProbe(summary, snapshot, head, root).ok).toBe(false)
      writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), submission: stale }))
      expect(submissionFromProbe(summary, snapshot, head, root).ok).toBe(false)
      writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), submission: fresh }))
      expect(submissionFromProbe(summary, snapshot, head, root)).toEqual({ ok: true, path: fresh })
      expect(submissionFromProbe(summary, snapshot + '.other', head, root).ok).toBe(false)
      expect(submissionFromProbe(summary, snapshot, 'b'.repeat(40), root).ok).toBe(false)
      writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), submission: join(root, '..', 'dsh-a2a-submission-foreign') }))
      expect(submissionFromProbe(summary, snapshot, head, root).ok).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses a summary without a submission, a vanished export, and a link standing in for one — the old fixed directory is never the answer', () => {
    const root = mkdtempSync(join(tmpdir(), 'a2a-verify-submission-test-'))
    try {
      const snapshot = join(root, 'snapshot.sqlite')
      const summary = join(root, 'probe-summary.json')
      const head = 'c'.repeat(40)
      const stale = join(root, 'dsh-a2a-submission')
      mkdirSync(stale)
      const row = (extra: Record<string, unknown>) => writeFileSync(summary, JSON.stringify({ snapshot, git_head: head.slice(0, 8), ...extra }))
      row({})
      expect(submissionFromProbe(summary, snapshot, head, root)).toEqual({ ok: false, error: expect.stringContaining('lacks an absolute submission path') as unknown })
      row({ submission: join(root, 'dsh-a2a-submission-gone') })
      expect(submissionFromProbe(summary, snapshot, head, root)).toEqual({ ok: false, error: expect.stringContaining('missing') as unknown })
      const link = join(root, 'dsh-a2a-submission-link')
      symlinkSync(stale, link)
      row({ submission: link })
      expect(submissionFromProbe(summary, snapshot, head, root).ok).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('direct CLI instructions preserve the bound submission and complete three-part evidence chain', () => {
    const doc = readFileSync(join(process.cwd(), 'docs', 'validator.md'), 'utf8')
    const router = readFileSync(join(process.cwd(), 'src', 'skill', 'references', 'router.md'), 'utf8')
    expect(doc).toContain('verify run spec_bdf9df9d3851 --db verify/snapshot.sqlite --submission')
    expect(doc).toContain('submissionFromProbe')
    expect(doc).toContain('snapshot/HEAD')
    expect(doc).toContain('三份 CLI 产物缺一不可')
    expect(doc).toContain('该 run 返回的精确 zip')
    expect(doc).toContain('不回落固定 TEMP 目录')
    expect(router).toContain('经 `submissionFromProbe` 核对与本轮 snapshot/HEAD 相符')
    expect(doc).not.toMatch(/^node scripts\/verify-recursive\.mjs/m)
  })
})
