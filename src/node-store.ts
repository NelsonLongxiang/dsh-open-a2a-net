/**
 * Node identity store (docs/design/node-identity.md, slice N1): long-lived,
 * human-named nodes that a session can carry, with layered prompt versions.
 *
 * - `nodes.json` under the a2a home holds the node records and the retired
 *   names (a name is never reused, and never renamed — §8-1).
 * - Prompt layers live in two namespaces, append-only:
 *   `nodes/<name>/core-v<n>.json` (the immutable layer, humans only) and
 *   `nodes/<name>/mutable-v<n>.json` (the four-section mutable layer).
 *   Every version is a FULL snapshot; the next number is max+1 over the
 *   files on disk, so a write after a rollback never collides; a write must
 *   name the sha it expects to replace (CAS — parallel sessions of one node).
 * - Identity writes (create / update / archive / core / rollback) are
 *   gated by the caller (the nodes face requires apiKey even on loopback,
 *   §8-2); this module only validates shapes and keeps the chain closed.
 * - Never-reuse survives a lost roster: a name whose version directory
 *   exists counts as used. A roster that does not parse is moved aside
 *   (`nodes.json.corrupt-<ts>`) and the store turns READ-ONLY — it never
 *   silently overwrites what it could not read. Writes go to disk first
 *   (tmp + rename) and only then into memory.
 * @module @nelsonlongxiang/dsh-open-a2a-net/node-store
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** §8-1: node names. */
export const NODE_NAME = /^[a-z][a-z0-9-]{1,31}$/
/** Upper bound on live nodes per host (a roster, not a database). */
export const NODE_CAP = 64
/** The four mutable sections, in prompt order (§5). */
export const MUTABLE_SECTIONS = ['当前状态', '执行要点', '已知陷阱', '当前重点'] as const
export type MutableSection = typeof MUTABLE_SECTIONS[number]
/** §8-9 quotas, in characters (code points, not UTF-16 units). */
export const QUOTA = { core: 2000, mutable: 3000, mutableSection: 1000 } as const
const chars = (text: string): number => [...text].length
const ROLES = new Set(['dev', 'review', 'supervise', 'ops', 'intake', 'test', 'design', 'chief'])
const LABEL_MAX = 64
const TEAM_MAX = 16

export type Layer = 'core' | 'mutable'

export interface NodeCarrier {
  /** Checkout the node's sessions run in (session controller create). */
  readonly cwd: string
  /** Agent preset id; '' = the host default. */
  readonly agentPreset: string
  /** Model selection; '' = the preset's default. */
  readonly model: string
}

export interface NodeRecord {
  readonly name: string
  readonly label: string
  readonly role: readonly string[]
  readonly teams: readonly string[]
  readonly carrier: NodeCarrier
  readonly prompt: { readonly core_version: number; readonly core_sha256: string; readonly mutable_version: number; readonly mutable_sha256: string }
  readonly created_by: string
  readonly created_at: string
}

/** One frozen prompt version (either namespace). */
export interface PromptVersion {
  readonly layer: Layer
  readonly version: number
  /** sha256 over the canonical JSON of {version, sections}. */
  readonly sha256: string
  readonly parent_version: number
  /** core: {'core': text}; mutable: the four sections. Always the full layer. */
  readonly sections: Readonly<Record<string, string>>
  readonly changed: readonly string[]
  readonly reason: string
  readonly by: string
  readonly via: string
  readonly at: string
  readonly rollback_of?: number
}

export type NodeErrorCode = 'bad-request' | 'not-found' | 'conflict' | 'quota' | 'cap' | 'unavailable'
export type NodeResult<T> = { ok: true; value: T } | { ok: false; error: string; code: NodeErrorCode }

interface Snapshot { nodes: NodeRecord[]; retired: string[] }

const fail = <T>(code: NodeErrorCode, error: string): NodeResult<T> => ({ ok: false, code, error })

/** The sha a version is pinned by: canonical JSON of {version, sections} (keys sorted). */
export function promptSha(version: number, sections: Readonly<Record<string, string>>): string {
  const sorted = Object.fromEntries(Object.keys(sections).sort().map(key => [key, sections[key]]))
  return createHash('sha256').update(JSON.stringify({ version, sections: sorted }), 'utf8').digest('hex')
}

function textList(raw: unknown, max: number, item: (s: string) => boolean): string[] | undefined {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > max) return undefined
  const out: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string' || !item(value)) return undefined
    if (!out.includes(value)) out.push(value)
  }
  return out
}

function carrierOf(raw: unknown): NodeCarrier | undefined {
  if (raw === undefined) return { cwd: '', agentPreset: '', model: '' }
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const field = (key: string): string | undefined => {
    const v = r[key] ?? ''
    return typeof v === 'string' && v.length <= 512 ? v : undefined
  }
  const cwd = field('cwd'), agentPreset = field('agentPreset'), model = field('model')
  return cwd === undefined || agentPreset === undefined || model === undefined ? undefined : { cwd, agentPreset, model }
}

/** A team ref a node may list: a canvas team (`<zone>/canvas/<name>`); no control characters (these reach prompt text in N2/N3). */
function teamRef(value: string): boolean {
  return /^[a-z0-9-]+\/canvas\/[^/\p{Cc}]{1,40}$/u.test(value) && value.trim() === value
}

const isText = (v: unknown): v is string => typeof v === 'string'
/** One roster entry as read from disk, or undefined when any field is malformed. */
function recordOf(raw: unknown): NodeRecord | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const p = r.prompt as Record<string, unknown> | null | undefined
  const c = r.carrier as Record<string, unknown> | null | undefined
  const version = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  if (!isText(r.name) || !NODE_NAME.test(r.name) || !isText(r.label) || !isText(r.created_by) || !isText(r.created_at)) return undefined
  if (!Array.isArray(r.role) || !r.role.every(isText) || !Array.isArray(r.teams) || !r.teams.every(isText)) return undefined
  if (c === null || c === undefined || typeof c !== 'object' || !isText(c.cwd) || !isText(c.agentPreset) || !isText(c.model)) return undefined
  if (p === null || p === undefined || typeof p !== 'object' || !version(p.core_version) || !version(p.mutable_version) || !isText(p.core_sha256) || !isText(p.mutable_sha256)) return undefined
  return {
    name: r.name, label: r.label, role: [...r.role], teams: [...r.teams],
    carrier: { cwd: c.cwd, agentPreset: c.agentPreset, model: c.model },
    prompt: { core_version: p.core_version, core_sha256: p.core_sha256, mutable_version: p.mutable_version, mutable_sha256: p.mutable_sha256 },
    created_by: r.created_by, created_at: r.created_at,
  }
}

/** Whether a version file is a well-formed frozen version of `layer` (shape, keys, quotas, self-consistent sha). */
function wellFormed(v: PromptVersion | undefined, layer: Layer): v is PromptVersion {
  if (v === undefined || v === null || typeof v !== 'object' || v.layer !== layer || typeof v.version !== 'number') return false
  const sections = v.sections as Record<string, unknown> | null | undefined
  if (sections === null || sections === undefined || typeof sections !== 'object') return false
  const keys = Object.keys(sections)
  const expected: string[] = layer === 'core' ? ['core'] : [...MUTABLE_SECTIONS]
  if (keys.length !== expected.length || !expected.every(k => typeof sections[k] === 'string')) return false
  const texts = expected.map(k => sections[k] as string)
  const overQuota = layer === 'core'
    ? chars(texts[0] ?? '') > QUOTA.core
    : texts.some(t => chars(t) > QUOTA.mutableSection) || texts.reduce((n, t) => n + chars(t), 0) > QUOTA.mutable
  if (overQuota) return false
  return v.sha256 === promptSha(v.version, sections as Record<string, string>)
}

/**
 * Node store. One writer (the nodes face); read fresh by the state face.
 */
export class NodeStore {
  private nodes: NodeRecord[] = []
  private retired: string[] = []
  private readonly root: string
  /** Set when the roster on disk could not be read: identity writes are refused until a human repairs it. */
  private readOnlyReason = ''
  /** Roster entries dropped on load (malformed), for the face to report. */
  readonly dropped: string[] = []

  /**
   * @param root - the `<home>/a2a` directory; '' keeps everything in memory (tests).
   * @param now - clock seam (ISO timestamps).
   */
  constructor(root: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.root = root
    this.restore()
  }

  private get file(): string { return join(this.root, 'nodes.json') }
  private versionDir(name: string): string { return join(this.root, 'nodes', name) }

  private restore(): void {
    if (this.root === '' || !existsSync(this.file)) return
    let snap: Partial<Snapshot> | null
    try {
      snap = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Snapshot> | null
    } catch {
      // Never overwrite what could not be read: move it aside and refuse writes (design §3 still
      // holds — a broken roster vetoes nothing, the node faces just stay read-only).
      const aside = `${this.file}.corrupt-${this.now().replace(/[:.]/g, '-')}`
      try { renameSync(this.file, aside) } catch { /* keep it in place; still read-only */ }
      this.readOnlyReason = `nodes.json did not parse and was moved to ${aside}; repair or restore it, then restart`
      return
    }
    for (const raw of Array.isArray(snap?.nodes) ? snap.nodes : []) {
      const record = recordOf(raw)
      if (record === undefined || this.nodes.some(n => n.name === record.name)) this.dropped.push(String((raw as { name?: unknown } | null)?.name ?? '?'))
      else this.nodes.push(record)
    }
    // Dropped names stay reserved: their version directories make them "used" (see nameUsed).
    if (Array.isArray(snap?.retired)) this.retired = snap.retired.filter(isText)
  }

  /** Disk first (tmp + rename), memory after — a failed write leaves both as they were. */
  private commit(next: { nodes?: NodeRecord[]; retired?: string[] }): NodeResult<true> {
    const nodes = next.nodes ?? this.nodes
    const retired = next.retired ?? this.retired
    if (this.root !== '') {
      try {
        mkdirSync(this.root, { recursive: true })
        const tmp = `${this.file}.${String(process.pid)}.tmp`
        writeFileSync(tmp, JSON.stringify({ nodes, retired } satisfies Snapshot), { mode: 0o600 })
        renameSync(tmp, this.file)
      } catch (error) {
        return fail('unavailable', `could not persist nodes.json: ${String(error)}`)
      }
    }
    this.nodes = nodes
    this.retired = retired
    return { ok: true, value: true }
  }

  /** Identity writes are refused while the roster is read-only. */
  private writable(): NodeResult<true> {
    return this.readOnlyReason === '' ? { ok: true, value: true } : fail('unavailable', `node roster is read-only: ${this.readOnlyReason}`)
  }

  /** Why the store refuses writes ('' when it does not). */
  get readOnly(): string { return this.readOnlyReason }

  /** A name is used when it is live, retired, or has version files on disk (survives a lost roster). */
  private nameUsed(name: string): boolean {
    if (this.get(name) !== undefined || this.retired.includes(name)) return true
    if (this.root === '') return [...this.memVersions.keys()].some(k => k.startsWith(`${name}/`))
    return existsSync(this.versionDir(name))
  }

  // In-memory version files for root '' (tests); keyed `<name>/<layer>-v<n>`.
  private readonly memVersions = new Map<string, PromptVersion>()

  private versionNumbers(name: string, layer: Layer): number[] {
    const pattern = new RegExp(`^${layer}-v(\\d+)\\.json$`)
    if (this.root === '') {
      return [...this.memVersions.keys()].map(k => k.startsWith(`${name}/`) ? pattern.exec(k.slice(name.length + 1)) : null).filter((m): m is RegExpExecArray => m !== null).map(m => Number(m[1]))
    }
    const dir = this.versionDir(name)
    if (!existsSync(dir)) return []
    return readdirSync(dir).map(f => pattern.exec(f)).filter((m): m is RegExpExecArray => m !== null).map(m => Number(m[1]))
  }

  private writeVersion(name: string, v: PromptVersion): void {
    // Throws EEXIST (append-only collision) or an I/O error; freeze() tells them apart.
    const file = `${v.layer}-v${String(v.version)}.json`
    if (this.root === '') {
      if (this.memVersions.has(`${name}/${file}`)) throw new Error(`version exists: ${file}`)
      this.memVersions.set(`${name}/${file}`, v)
      return
    }
    mkdirSync(this.versionDir(name), { recursive: true })
    // 'wx': append-only — an existing version file is never overwritten.
    writeFileSync(join(this.versionDir(name), file), JSON.stringify(v), { mode: 0o600, flag: 'wx' })
  }

  /** One frozen version, or undefined. */
  version(name: string, layer: Layer, version: number): PromptVersion | undefined {
    const file = `${layer}-v${String(version)}.json`
    if (this.root === '') return this.memVersions.get(`${name}/${file}`)
    try {
      return JSON.parse(readFileSync(join(this.versionDir(name), file), 'utf8')) as PromptVersion
    } catch {
      return undefined
    }
  }

  /** Version numbers present for one layer, ascending. */
  versions(name: string, layer: Layer): number[] {
    return this.versionNumbers(name, layer).sort((a, b) => a - b)
  }

  list(): readonly NodeRecord[] { return this.nodes.map(n => ({ ...n })) }
  get(name: string): NodeRecord | undefined { return this.nodes.find(n => n.name === name) }

  /** Create a node (identity write). The name is final and never reused. */
  create(input: { name?: unknown; label?: unknown; role?: unknown; teams?: unknown; carrier?: unknown }, by: string): NodeResult<NodeRecord> {
    const name = typeof input.name === 'string' ? input.name : ''
    const w = this.writable()
    if (!w.ok) return w
    if (!NODE_NAME.test(name)) return fail('bad-request', 'name must match ^[a-z][a-z0-9-]{1,31}$')
    if (this.get(name) !== undefined) return fail('conflict', `node ${name} exists`)
    if (this.nameUsed(name)) return fail('conflict', `node name ${name} was used before and is never reused`)
    if (this.nodes.length >= NODE_CAP) return fail('cap', `node cap ${String(NODE_CAP)} reached`)
    const fields = this.fields(input)
    if (!fields.ok) return fields
    const record: NodeRecord = {
      name, ...fields.value,
      label: fields.value.label === '' ? name : fields.value.label,
      prompt: { core_version: 0, core_sha256: '', mutable_version: 0, mutable_sha256: '' },
      created_by: by, created_at: this.now(),
    }
    const saved = this.commit({ nodes: [...this.nodes, record] })
    return saved.ok ? { ok: true, value: record } : saved
  }

  /** Update label / role / teams / carrier (identity write). There is no rename. */
  update(name: string, input: { name?: unknown; label?: unknown; role?: unknown; teams?: unknown; carrier?: unknown }): NodeResult<NodeRecord> {
    const w = this.writable()
    if (!w.ok) return w
    const current = this.get(name)
    if (current === undefined) return fail('not-found', `no node ${name}`)
    if (input.name !== undefined && input.name !== name) return fail('bad-request', 'nodes are never renamed (§8-1): create a new node and archive this one')
    const fields = this.fields({ label: input.label ?? current.label, role: input.role ?? current.role, teams: input.teams ?? current.teams, carrier: input.carrier ?? current.carrier })
    if (!fields.ok) return fields
    const next: NodeRecord = { ...current, ...fields.value, label: fields.value.label === '' ? name : fields.value.label }
    const saved = this.commit({ nodes: this.nodes.map(n => (n.name === name ? next : n)) })
    return saved.ok ? { ok: true, value: next } : saved
  }

  /** Archive a node (identity write): it leaves the roster, its name is retired, its versions stay on disk. */
  archive(name: string): NodeResult<string> {
    const w = this.writable()
    if (!w.ok) return w
    if (this.get(name) === undefined) return fail('not-found', `no node ${name}`)
    const saved = this.commit({ nodes: this.nodes.filter(n => n.name !== name), retired: [...this.retired, name] })
    return saved.ok ? { ok: true, value: name } : saved
  }

  private fields(input: { label?: unknown; role?: unknown; teams?: unknown; carrier?: unknown }): NodeResult<{ label: string; role: string[]; teams: string[]; carrier: NodeCarrier }> {
    const label = input.label === undefined ? '' : input.label
    if (typeof label !== 'string' || label.length > LABEL_MAX) return fail('bad-request', `label must be a string of at most ${String(LABEL_MAX)} characters`)
    const role = textList(input.role, ROLES.size, r => ROLES.has(r))
    if (role === undefined) return fail('bad-request', `role must be a list drawn from ${[...ROLES].join('|')}`)
    const teams = textList(input.teams, TEAM_MAX, teamRef)
    if (teams === undefined) return fail('bad-request', 'teams must be canvas team refs <zone>/canvas/<name>')
    const carrier = carrierOf(input.carrier)
    if (carrier === undefined) return fail('bad-request', 'carrier must be {cwd, agentPreset, model} strings')
    return { ok: true, value: { label: label.trim(), role, teams, carrier } }
  }

  /**
   * Freeze a new version of one layer. `sections` is the FULL layer for
   * core (`{core: text}`) and a PATCH for mutable (the named sections
   * replace their text; the rest carry over). `expectedSha` must equal the
   * layer's current sha ('' while the layer has no version yet).
   */
  writeLayer(name: string, layer: Layer, sections: unknown, meta: { expectedSha?: unknown; reason?: unknown; by: string; via: string }): NodeResult<PromptVersion> {
    const w = this.writable()
    if (!w.ok) return w
    const node = this.get(name)
    if (node === undefined) return fail('not-found', `no node ${name}`)
    if (sections === null || typeof sections !== 'object' || Array.isArray(sections)) return fail('bad-request', 'sections must be an object')
    const patch = sections as Record<string, unknown>
    if (Object.keys(patch).length === 0) return fail('bad-request', 'sections is empty: nothing to freeze')
    const reason = typeof meta.reason === 'string' ? meta.reason.trim() : ''
    if (reason === '' || reason.length > 500) return fail('bad-request', 'reason is required (at most 500 characters)')
    const currentVersion = layer === 'core' ? node.prompt.core_version : node.prompt.mutable_version
    const currentSha = layer === 'core' ? node.prompt.core_sha256 : node.prompt.mutable_sha256
    if (meta.expectedSha !== currentSha) return fail('conflict', `expected_sha256 does not match the current ${layer} sha (${currentSha === '' ? 'none yet' : currentSha.slice(0, 12)}) — re-read and retry`)
    let full: Record<string, string>
    if (layer === 'core') {
      const keys = Object.keys(patch)
      if (keys.length !== 1 || keys[0] !== 'core' || typeof patch.core !== 'string') return fail('bad-request', 'core layer is {core: text}')
      if (chars(patch.core) > QUOTA.core) return fail('quota', `core layer exceeds ${String(QUOTA.core)} characters`)
      full = { core: patch.core }
    } else {
      // A patch carries the other sections over from the CURRENT version — which must be readable
      // and match the roster's sha, or the patch would silently blank them.
      let base: Record<string, string> = Object.fromEntries(MUTABLE_SECTIONS.map(s => [s, '']))
      if (currentVersion > 0) {
        const current = this.version(name, 'mutable', currentVersion)
        if (!wellFormed(current, 'mutable') || current.sha256 !== currentSha) return fail('conflict', `current mutable v${String(currentVersion)} is missing or does not match the roster sha — repair it or roll back first`)
        base = { ...current.sections }
      }
      for (const [key, value] of Object.entries(patch)) {
        if (!(MUTABLE_SECTIONS as readonly string[]).includes(key)) return fail('bad-request', `unknown mutable section ${key} (allowed: ${MUTABLE_SECTIONS.join(' / ')})`)
        if (typeof value !== 'string') return fail('bad-request', `section ${key} must be text`)
        if (chars(value) > QUOTA.mutableSection) return fail('quota', `section ${key} exceeds ${String(QUOTA.mutableSection)} characters`)
        base[key] = value
      }
      full = Object.fromEntries(MUTABLE_SECTIONS.map(s => [s, String(base[s] ?? '')]))
      const total = Object.values(full).reduce((n, t) => n + chars(t), 0)
      if (total > QUOTA.mutable) return fail('quota', `mutable layer exceeds ${String(QUOTA.mutable)} characters in total`)
    }
    return this.freeze(node, layer, full, { parent: currentVersion, changed: Object.keys(patch), reason, by: meta.by, via: meta.via })
  }

  /** Roll a layer back (identity write): freezes a NEW version whose content is the target's. */
  rollback(name: string, layer: Layer, to: unknown, meta: { expectedSha?: unknown; reason?: unknown; by: string }): NodeResult<PromptVersion> {
    const w = this.writable()
    if (!w.ok) return w
    const node = this.get(name)
    if (node === undefined) return fail('not-found', `no node ${name}`)
    if (typeof to !== 'number' || !Number.isSafeInteger(to)) return fail('bad-request', 'to must be a version number')
    const target = this.version(name, layer, to)
    if (target === undefined) return fail('not-found', `no ${layer} version ${String(to)}`)
    // A hand-placed or foreign file is never promoted into a frozen version.
    if (!wellFormed(target, layer) || target.version !== to) return fail('conflict', `${layer} v${String(to)} is not a well-formed frozen version (layer, keys, quota or sha)`)
    const currentSha = layer === 'core' ? node.prompt.core_sha256 : node.prompt.mutable_sha256
    if (meta.expectedSha !== currentSha) return fail('conflict', `expected_sha256 does not match the current ${layer} sha — re-read and retry`)
    const reason = typeof meta.reason === 'string' ? meta.reason.trim() : ''
    if (reason === '' || reason.length > 500) return fail('bad-request', 'reason is required (at most 500 characters)')
    const parent = layer === 'core' ? node.prompt.core_version : node.prompt.mutable_version
    return this.freeze(node, layer, { ...target.sections }, { parent, changed: Object.keys(target.sections), reason, by: meta.by, via: 'host-face', rollbackOf: to })
  }

  private freeze(node: NodeRecord, layer: Layer, sections: Record<string, string>, meta: { parent: number; changed: string[]; reason: string; by: string; via: string; rollbackOf?: number }): NodeResult<PromptVersion> {
    const version = Math.max(0, ...this.versionNumbers(node.name, layer)) + 1
    const v: PromptVersion = {
      layer, version, sha256: promptSha(version, sections), parent_version: meta.parent, sections,
      changed: meta.changed, reason: meta.reason, by: meta.by, via: meta.via, at: this.now(),
      ...(meta.rollbackOf !== undefined ? { rollback_of: meta.rollbackOf } : {}),
    }
    try {
      this.writeVersion(node.name, v)
    } catch (error) {
      const exists = (error as { code?: unknown }).code === 'EEXIST' || /version exists/.test(String(error))
      return fail(exists ? 'conflict' : 'unavailable', `could not freeze ${layer} v${String(version)}: ${String(error)}`)
    }
    const prompt = layer === 'core'
      ? { ...node.prompt, core_version: version, core_sha256: v.sha256 }
      : { ...node.prompt, mutable_version: version, mutable_sha256: v.sha256 }
    // The version file is frozen even if the roster write fails: the next write numbers past it (max+1).
    const saved = this.commit({ nodes: this.nodes.map(n => (n.name === node.name ? { ...n, prompt } : n)) })
    return saved.ok ? { ok: true, value: v } : saved
  }
}
