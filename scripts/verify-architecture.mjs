#!/usr/bin/env node
/** Architecture diagram audit: full-path anchors, exact source text, XML and
 * black ink. Uses the project's existing jsdom dev dependency, no install.
 * node scripts/verify-architecture.mjs [--diagram file] [--manifest file]
 * Exit 1 means a failed check; the JSON lists every covered anchor/error.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const require = createRequire(resolve(root, 'nexus-stage/package.json'))
const { JSDOM } = require('jsdom')
const sha = text => createHash('sha256').update(text).digest('hex')

export function auditArchitecture(xml, manifest, readSource) {
  const errors = []; const anchors = []; const seen = new Set()
  let doc
  try { doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document }
  catch (e) { return { ok: false, anchors, errors: ['XML: ' + e.message] } }
  if (xml.includes('--')) errors.push('XML contains forbidden double-hyphen')
  if (doc.querySelectorAll('diagram').length !== 2) errors.push('expected two architecture pages')
  if (!manifest.anchors?.length || !Object.keys(manifest.sources ?? {}).length) errors.push('empty architecture inventory')
  const sources = new Map()
  for (const [file, digest] of Object.entries(manifest.sources)) {
    try {
      const text = readSource(file); sources.set(file, text.split(/\r?\n/))
      if (sha(text.replace(/\r\n/g, '\n')) !== digest) errors.push('source digest differs: ' + file)
    } catch (e) { errors.push('source missing: ' + file) }
  }
  for (const diagram of doc.querySelectorAll('diagram')) {
    const id = diagram.id; const cells = new Map()
    const titleId = id === 'p1-arch' ? 'p1-title' : 'title'
    const title = [...diagram.querySelectorAll('mxCell')].find(c => c.id === titleId)?.getAttribute('value') ?? ''
    if (!title.includes('SOURCE ' + manifest.sourceCommit.slice(0,7))) errors.push('page source pin differs: ' + id)
    for (const cell of diagram.querySelectorAll('mxCell')) {
      if (cells.has(cell.id)) errors.push('duplicate cell: ' + id + '/' + cell.id)
      cells.set(cell.id, cell)
      if (cell.getAttribute('value')) {
        const colors = [...(cell.getAttribute('style') ?? '').matchAll(/fontColor=([^;]+)/g)]
        if (!colors.length || colors.some(c => c[1].toLowerCase() !== '#000000')) errors.push('nonblack/missing text color: ' + id + '/' + cell.id)
      }
      const value = cell.getAttribute('value') ?? ''
      // Includes bare :NN references — no short-form anchor can escape the
      // inventory. Full file references are the sole permitted format.
      const full = /((?:[\w.-]+\/)*[\w.-]+\.ts):(\d+)(?:-(\d+))?/g
      const refs = [...value.matchAll(full)]
      const residual = value.replace(full, '')
      if (/[:：]\s*\d+/.test(residual)) errors.push('unscoped numeric anchor: ' + id + '/' + cell.id)
      for (const ref of refs) {
        const key = id + '/' + cell.id + '/' + ref[0]
        seen.add(key)
        const item = manifest.anchors.find(a => a.page === id && a.cell === cell.id && a.ref === ref[0])
        if (!item) { errors.push('unmanifested anchor: ' + key); continue }
        const lines = sources.get(ref[1]); const start = Number(ref[2]); const end = Number(ref[3] ?? ref[2])
        if (!ref[1].includes('/') || start < 1 || end < start) errors.push('invalid full-path/range anchor: ' + key)
        if (!lines || (lines[start-1] ?? '').trim() !== item.expect) errors.push('exact target mismatch: ' + key)
        if (end !== start && (!item.endExpect || (lines?.[end-1] ?? '').trim() !== item.endExpect)) errors.push('range end mismatch: ' + key)
        anchors.push({ page: id, cell: cell.id, ref: ref[0] })
      }
    }
    for (const cell of cells.values()) {
      for (const attr of ['source','target']) {
        const target = cell.getAttribute(attr)
        if (target && !cells.has(target)) errors.push('broken edge: ' + id + '/' + cell.id + '/' + attr)
      }
      const g = cell.querySelector(':scope > mxGeometry')
      if (g && cell.getAttribute('vertex') === '1' && cell.getAttribute('parent') === '1') {
        const model = diagram.querySelector('mxGraphModel')
        if (Number(g.getAttribute('x')) + Number(g.getAttribute('width')) > Number(model.getAttribute('pageWidth')) ||
            Number(g.getAttribute('y')) + Number(g.getAttribute('height')) > Number(model.getAttribute('pageHeight'))) errors.push('out of page: ' + id + '/' + cell.id)
      }
    }
  }
  for (const item of manifest.anchors) {
    const key = item.page + '/' + item.cell + '/' + item.ref
    if (!seen.has(key)) errors.push('manifest anchor absent from diagram: ' + key)
  }
  if (new Set(manifest.anchors.map(a => a.page + '/' + a.cell + '/' + a.ref)).size !== manifest.anchors.length) errors.push('manifest duplicate anchors')
  if (!xml.includes('SOURCE ' + manifest.sourceCommit.slice(0,7))) errors.push('diagram source pin differs')
  return { ok: errors.length === 0, sourceCommit: manifest.sourceCommit, anchorCount: anchors.length, sourceFiles: sources.size, anchors, errors }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : resolve(process.argv[i+1]) }
  try {
    const xml = readFileSync(arg('--diagram', resolve(root,'docs/arch/a2a-architecture.drawio')), 'utf8')
    const manifest = JSON.parse(readFileSync(arg('--manifest', resolve(root,'docs/arch/a2a-architecture.anchors.json')), 'utf8'))
    const result = auditArchitecture(xml, manifest, f => readFileSync(resolve(root,f),'utf8'))
    if (process.argv.includes('--snapshot')) {
      const dest = arg('--snapshot', resolve(root,'tmp/architecture.sqlite'))
      mkdirSync(dirname(dest), { recursive: true })
      const db = new DatabaseSync(dest)
      db.exec('CREATE TABLE IF NOT EXISTS architecture_facts(name TEXT PRIMARY KEY, value INTEGER, detail TEXT); DELETE FROM architecture_facts;')
      const insert = db.prepare('INSERT INTO architecture_facts VALUES (?,?,?)')
      insert.run('anchors', result.anchorCount ?? 0, 'Complete numeric-reference inventory')
      insert.run('sources', result.sourceFiles ?? 0, 'SHA256-normalized source file count')
      insert.run('errors', result.errors.length, JSON.stringify(result.errors))
      insert.run('xml_sha256', 1, sha(xml))
      insert.run('manifest_sha256', 1, sha(JSON.stringify(manifest)))
      db.close()
    }
    console.log(JSON.stringify(result,null,2)); process.exitCode = result.ok ? 0 : 1
  } catch (e) { console.error(e.message); process.exitCode = 1 }
}
