import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

/** Never run file checks against an old fixed TEMP directory or an unrelated probe snapshot. */
export function submissionFromProbe(summaryFile, snapshotFile, head, tempRoot = tmpdir()) {
  try {
    const row = JSON.parse(readFileSync(summaryFile, 'utf8'))
    if (typeof head !== 'string' || head.length < 40 || row.snapshot !== snapshotFile || row.git_head !== head.slice(0, 8)) return { ok: false, error: 'probe summary does not match this snapshot or HEAD — run probe again' }
    const candidate = row.submission
    if (typeof candidate !== 'string' || !isAbsolute(candidate)) return { ok: false, error: 'probe summary lacks an absolute submission path' }
    const path = resolve(candidate)
    const rel = relative(resolve(tempRoot), path)
    if (rel.startsWith('..') || isAbsolute(rel) || !basename(path).startsWith('dsh-a2a-submission-')) return { ok: false, error: 'submission path is outside this run’s temporary area' }
    if (!existsSync(path) || !lstatSync(path).isDirectory()) return { ok: false, error: 'this run’s submission directory is missing' }
    return { ok: true, path }
  } catch (error) { return { ok: false, error: 'probe summary unavailable: ' + String(error) } }
}
