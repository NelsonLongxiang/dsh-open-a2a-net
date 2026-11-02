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
 * @module @nelsonlongxiang/dsh-open-a2a-net/node-store
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** §8-1: node names. */
export const NODE_NAME = /^[a-z][a-z0-9-]{1,31}$/
/** Upper bound on live nodes per host (a roster, not a database). */
export const NODE_CAP = 64
/** The four mutable sections, in prompt order (§5). */
export const MUTABLE_SECTIONS = ['当前状态', '执行要点', '已知陷阱', '当前重点'] as const
export type MutableSection = typeof MUTABLE_SECTIONS[number]
/** §8-9 quotas, in characters. */
export const QUOTA = { core: 2000, mutable: 3000, mutableSection: 1000 } as const
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

export type NodeResult<T> = { ok: true; value: T } | { ok: false; error: string; code: 'bad-request' | 'not-found' | 'conflict' | 'quota' | 'cap' }

interface Snapshot { nodes: NodeRecord[]; retired: string[] }

const fail = <T>(code: 'bad-request' | 'not-found' | 'conflict' | 'quota' | 'cap', error: string): NodeResult<T> => ({ ok: false, code, error })

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

/** A team ref a node may list: a canvas team (`<zone>/canvas/<name>`). */
function teamRef(value: string): boolean {
  return /^[a-z0-9-]+\/canvas\/[^/]{1,40}$/i.test(value) && value.trim() === value
}

/**
 * Node store. One writer (the nodes face); read fresh by the state face.
 */
export class NodeStore {
  private nodes: NodeRecord[] = []
  private retired: string[] = []
  private readonly root: string

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
    try {
      const snap = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Snapshot> | null
      if (Array.isArray(snap?.nodes)) this.nodes = snap.nodes.filter((n): n is NodeRecord => typeof n?.name === 'string' && NODE_NAME.test(n.name)).slice(0, NODE_CAP)
      if (Array.isArray(snap?.retired)) this.retired = snap.retired.filter((n): n is string => typeof n === 'string')
    } catch {
      // A corrupt roster is not fatal (design §3: it must never veto a session).
    }
  }

  private persist(): void {
    if (this.root === '') return
    mkdirSync(this.root, { recursive: true })
    writeFileSync(this.file, JSON.stringify({ nodes: this.nodes, retired: this.retired } satisfies Snapshot), { mode: 0o600 })
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
    if (!NODE_NAME.test(name)) return fail('bad-request', 'name must match ^[a-z][a-z0-9-]{1,31}$')
    if (this.get(name) !== undefined) return fail('conflict', `node ${name} exists`)
    if (this.retired.includes(name)) return fail('conflict', `node name ${name} was used before and is never reused`)
    if (this.nodes.length >= NODE_CAP) return fail('cap', `node cap ${String(NODE_CAP)} reached`)
    const fields = this.fields(input)
    if (!fields.ok) return fields
    const record: NodeRecord = {
      name, ...fields.value,
      label: fields.value.label === '' ? name : fields.value.label,
      prompt: { core_version: 0, core_sha256: '', mutable_version: 0, mutable_sha256: '' },
      created_by: by, created_at: this.now(),
    }
    this.nodes.push(record)
    this.persist()
    return { ok: true, value: record }
  }

  /** Update label / role / teams / carrier (identity write). There is no rename. */
  update(name: string, input: { name?: unknown; label?: unknown; role?: unknown; teams?: unknown; carrier?: unknown }): NodeResult<NodeRecord> {
    const current = this.get(name)
    if (current === undefined) return fail('not-found', `no node ${name}`)
    if (input.name !== undefined && input.name !== name) return fail('bad-request', 'nodes are never renamed (§8-1): create a new node and archive this one')
    const fields = this.fields({ label: input.label ?? current.label, role: input.role ?? current.role, teams: input.teams ?? current.teams, carrier: input.carrier ?? current.carrier })
    if (!fields.ok) return fields
    const next: NodeRecord = { ...current, ...fields.value, label: fields.value.label === '' ? name : fields.value.label }
    this.nodes = this.nodes.map(n => (n.name === name ? next : n))
    this.persist()
    return { ok: true, value: next }
  }

  /** Archive a node (identity write): it leaves the roster, its name is retired, its versions stay on disk. */
  archive(name: string): NodeResult<string> {
    if (this.get(name) === undefined) return fail('not-found', `no node ${name}`)
    this.nodes = this.nodes.filter(n => n.name !== name)
    this.retired.push(name)
    this.persist()
    return { ok: true, value: name }
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
    const node = this.get(name)
    if (node === undefined) return fail('not-found', `no node ${name}`)
    if (sections === null || typeof sections !== 'object' || Array.isArray(sections)) return fail('bad-request', 'sections must be an object')
    const patch = sections as Record<string, unknown>
    const reason = typeof meta.reason === 'string' ? meta.reason.trim() : ''
    if (reason === '' || reason.length > 500) return fail('bad-request', 'reason is required (at most 500 characters)')
    const currentVersion = layer === 'core' ? node.prompt.core_version : node.prompt.mutable_version
    const currentSha = layer === 'core' ? node.prompt.core_sha256 : node.prompt.mutable_sha256
    if (meta.expectedSha !== currentSha) return fail('conflict', `expected_sha256 does not match the current ${layer} sha (${currentSha === '' ? 'none yet' : currentSha.slice(0, 12)}) — re-read and retry`)
    let full: Record<string, string>
    if (layer === 'core') {
      const keys = Object.keys(patch)
      if (keys.length !== 1 || keys[0] !== 'core' || typeof patch.core !== 'string') return fail('bad-request', 'core layer is {core: text}')
      if (patch.core.length > QUOTA.core) return fail('quota', `core layer exceeds ${String(QUOTA.core)} characters`)
      full = { core: patch.core }
    } else {
      const base = currentVersion > 0 ? { ...this.version(name, 'mutable', currentVersion)?.sections } : Object.fromEntries(MUTABLE_SECTIONS.map(s => [s, '']))
      for (const [key, value] of Object.entries(patch)) {
        if (!(MUTABLE_SECTIONS as readonly string[]).includes(key)) return fail('bad-request', `unknown mutable section ${key} (allowed: ${MUTABLE_SECTIONS.join(' / ')})`)
        if (typeof value !== 'string') return fail('bad-request', `section ${key} must be text`)
        if (value.length > QUOTA.mutableSection) return fail('quota', `section ${key} exceeds ${String(QUOTA.mutableSection)} characters`)
        base[key] = value
      }
      full = Object.fromEntries(MUTABLE_SECTIONS.map(s => [s, String(base[s] ?? '')]))
      const total = Object.values(full).reduce((n, t) => n + t.length, 0)
      if (total > QUOTA.mutable) return fail('quota', `mutable layer exceeds ${String(QUOTA.mutable)} characters in total`)
    }
    return this.freeze(node, layer, full, { parent: currentVersion, changed: Object.keys(patch), reason, by: meta.by, via: meta.via })
  }

  /** Roll a layer back (identity write): freezes a NEW version whose content is the target's. */
  rollback(name: string, layer: Layer, to: unknown, meta: { expectedSha?: unknown; reason?: unknown; by: string }): NodeResult<PromptVersion> {
    const node = this.get(name)
    if (node === undefined) return fail('not-found', `no node ${name}`)
    if (typeof to !== 'number' || !Number.isSafeInteger(to)) return fail('bad-request', 'to must be a version number')
    const target = this.version(name, layer, to)
    if (target === undefined) return fail('not-found', `no ${layer} version ${String(to)}`)
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
      return fail('conflict', `could not freeze ${layer} v${String(version)}: ${String(error)}`)
    }
    const prompt = layer === 'core'
      ? { ...node.prompt, core_version: version, core_sha256: v.sha256 }
      : { ...node.prompt, mutable_version: version, mutable_sha256: v.sha256 }
    this.nodes = this.nodes.map(n => (n.name === node.name ? { ...n, prompt } : n))
    this.persist()
    return { ok: true, value: v }
  }
}
