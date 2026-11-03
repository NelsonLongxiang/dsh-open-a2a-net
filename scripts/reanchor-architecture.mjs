#!/usr/bin/env node
/** Re-anchor the architecture diagram after source edits — an explicit operator step, never part
 * of the audit (verify-architecture.mjs still refuses any drift). For each manifest source whose
 * digest changed, the manifest must describe that file as it is at the base ref (default
 * origin/master). Each anchor's line is shifted through the base→working-tree diff and kept ONLY
 * when the shifted line still equals its witness exactly (trimmed, as the audit compares). An
 * anchor whose witness no longer matches (it sits in an edited hunk) is never moved
 * automatically: it is reported, with the lines that do match as candidates, for a human.
 *
 *   node scripts/reanchor-architecture.mjs [--base <ref>] [--check]
 *
 * Writes docs/arch/a2a-architecture.{anchors.json,drawio}; --check writes nothing and exits 1
 * when anything would change or needs a human. Exit 2 on a usage or git error.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const sha = text => createHash('sha256').update(text).digest('hex')
const norm = text => text.replace(/\r\n/g, '\n')
const escape = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** `@@ -a,b +c,d @@` headers of a -U0 diff as { oldStart, oldLen, newLen }. */
export function parseHunks(diff) {
  return [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)]
    .map(m => ({ oldStart: +m[1], oldLen: m[2] === undefined ? 1 : +m[2], newLen: m[4] === undefined ? 1 : +m[4] }))
}

/** Where old line `n` sits after the hunks: every hunk that ends before it shifts it by its size change. */
export function mapLine(hunks, n) {
  return n + hunks.filter(h => n >= h.oldStart + Math.max(h.oldLen, 1)).reduce((s, h) => s + h.newLen - h.oldLen, 0)
}

/**
 * Pure re-anchor of one manifest + diagram. `changed` maps each changed source file to
 * { hunks, text } (the working-tree text). Returns the new manifest and diagram, the moves made,
 * and the anchors that need a human (with candidate lines whose trimmed text equals the witness).
 */
export function reanchor(manifest, xml, changed) {
  const next = JSON.parse(JSON.stringify(manifest))
  const moved = []; const misses = []
  const renames = new Map()
  for (const [file, { hunks, text }] of changed) {
    const lines = norm(text).split('\n')
    const own = new RegExp(`^${escape(file)}:(\\d+)(?:-(\\d+))?$`)
    for (const a of next.anchors) {
      const r = own.exec(a.ref)
      if (r === null) continue
      const start = mapLine(hunks, +r[1])
      const end = r[2] === undefined ? undefined : mapLine(hunks, +r[2])
      const startOk = (lines[start - 1] ?? '').trim() === a.expect
      const endOk = end === undefined || (a.endExpect !== undefined && (lines[end - 1] ?? '').trim() === a.endExpect)
      if (!startOk || !endOk) {
        const candidates = lines.flatMap((l, i) => (l.trim() === a.expect ? [i + 1] : []))
        misses.push({ page: a.page, cell: a.cell, ref: a.ref, expect: a.expect, shiftedTo: start, candidates })
        continue
      }
      const ref = `${file}:${String(start)}${end === undefined ? '' : '-' + String(end)}`
      if (ref !== a.ref) { moved.push({ page: a.page, cell: a.cell, from: a.ref, to: ref }); renames.set(a.ref, ref) }
      a.ref = ref
    }
    next.sources[file] = sha(lines.join('\n'))
  }
  // One pass over the diagram: every full-path reference that moved is rewritten exactly once.
  const fileAlt = [...changed.keys()].map(escape).join('|')
  const nextXml = fileAlt === '' ? xml : xml.replace(new RegExp(`(?<![\\w./-])(?:${fileAlt}):\\d+(?:-\\d+)?(?![\\d-])`, 'g'), ref => renames.get(ref) ?? ref)
  return { manifest: next, xml: nextXml, moved, misses }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(import.meta.dirname, '..')
  const args = process.argv.slice(2)
  const at = args.indexOf('--base')
  const base = at >= 0 ? args[at + 1] : 'origin/master'
  const check = args.includes('--check')
  const mp = resolve(root, 'docs/arch/a2a-architecture.anchors.json')
  const dp = resolve(root, 'docs/arch/a2a-architecture.drawio')
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  try {
    if (base === undefined || base.startsWith('--')) throw Object.assign(new Error('--base needs a ref'), { usage: true })
    const manifest = JSON.parse(readFileSync(mp, 'utf8'))
    const xml = readFileSync(dp, 'utf8')
    const changed = new Map()
    const problems = []
    for (const [file, digest] of Object.entries(manifest.sources)) {
      const text = readFileSync(resolve(root, file), 'utf8')
      if (sha(norm(text)) === digest) continue
      let baseText
      try { baseText = git('show', `${base}:${file}`) } catch { problems.push(`${file}: not present at ${base}`); continue }
      if (sha(norm(baseText)) !== digest) { problems.push(`${file}: the manifest does not describe ${base}'s copy — take ${base}'s docs/arch first (git checkout ${base} -- docs/arch) or pass the right --base`); continue }
      changed.set(file, { hunks: parseHunks(git('diff', '-U0', base, '--', file)), text })
    }
    const out = reanchor(manifest, xml, changed)
    const report = { base, files: [...changed.keys()], moved: out.moved.length, misses: out.misses, problems }
    const dirty = out.moved.length > 0 || changed.size > 0
    if (!check && problems.length === 0) {
      writeFileSync(mp, JSON.stringify(out.manifest, null, 2) + '\n')
      writeFileSync(dp, out.xml)
    }
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = problems.length > 0 || out.misses.length > 0 || (check && dirty) ? 1 : 0
  } catch (e) {
    console.error(e.message)
    process.exitCode = 2
  }
}
