/** Owner-controlled roster mutations from the planning board. */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { applyOwnerSettings } from './owner-settings.ts'
import { TEAM_NAME_MAX, type TeamMembershipStore } from './team-store.ts'

export interface RosterOpDeps {
  zone: string
  home: string
  store: TeamMembershipStore
  joined: (id: string) => boolean
  canvasExists: (name: string) => boolean
  allowlist: () => readonly string[]
  setAllowlist: (list: string[]) => void
  audit: (action: 'join' | 'leave', team: string, id: string, ok: boolean, reason: string) => void
}
export type RosterOpResult = { ok: true; team: string; members: string[] } | { ok: false; error: string }

/** Writes complete snapshots; on a failed second write, rolls the first back. */
export function rosterOp(d: RosterOpDeps, raw: unknown): RosterOpResult {
  const b = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const op = b.op
  const name = b.name
  const team = typeof name === 'string' ? d.zone + '/' + name : ''
  const action = op === 'remove-member' || op === 'dissolve' ? 'leave' : 'join'
  const actor = 'human:owner'
  const audit = (id: string, ok: boolean, why: string): void => d.audit(action, team, id, ok, why)
  const reject = (error: string): RosterOpResult => { audit(typeof b.id === 'string' ? b.id : actor, false, error); return { ok: false, error } }
  if (typeof name !== 'string' || name !== name.trim() || name.length < 1 || name.length > 40 || name.includes('/') || name.startsWith('roster:') || /^\d+$/.test(name) || /[\r\n]/.test(name) || team.length > TEAM_NAME_MAX) return reject('name must be one exact local roster name (no slash or canvas path)')
  if (d.canvasExists(name)) return reject('a canvas team already uses this name')
  if (op !== 'create' && op !== 'add-member' && op !== 'remove-member' && op !== 'dissolve') return reject('invalid roster operation')
  const current = d.store.membersOf(team)
  const allow = [...d.allowlist()]
  const allowed = allow.includes(team)
  if (op !== 'create' && !allowed && current.length === 0) return reject('no such roster team')
  if (op === 'create' && (!Array.isArray(b.ids) || b.ids.length < 2 || b.ids.some(x => typeof x !== 'string'))) return reject('create needs at least two joined local session ids')
  if ((op === 'add-member' || op === 'remove-member') && (typeof b.id !== 'string' || b.id === '')) return reject('local session id is required')
  const add = op === 'create' ? b.ids as string[] : op === 'add-member' ? [b.id as string] : []
  if (new Set(add).size !== add.length || add.some(id => id === '' || !d.joined(id))) return reject('only distinct joined local sessions can join a roster')
  const members = op === 'create' || op === 'add-member' ? [...new Set([...current, ...add])] : op === 'remove-member' ? current.filter(id => id !== b.id) : []
  const nextAllow = op === 'create' && !allowed ? [...allow, team] : op === 'dissolve' ? allow.filter(x => x !== team) : allow
  const patch = join(d.home, 'cordis.patch.yml')
  let before: string | undefined
  if ((op === 'create' && !allowed) || (op === 'dissolve' && allowed)) {
    try { before = existsSync(patch) ? readFileSync(patch, 'utf8') : undefined }
    catch (error) { return reject('owner patch unavailable: ' + String(error)) }
  }
  const savePatch = (content: string): void => {
    mkdirSync(dirname(patch), { recursive: true })
    const tmp = patch + '.' + String(process.pid) + '.tmp'
    try { writeFileSync(tmp, content, { mode: 0o600 }); renameSync(tmp, patch) }
    catch (error) { try { unlinkSync(tmp) } catch { /* original remains */ }; throw error }
  }
  let patchWritten = false
  try {
    if (op === 'create' && !allowed) { savePatch(applyOwnerSettings(before ?? '', { teamJoinAllowlist: nextAllow }).yaml); patchWritten = true }
    const done = d.store.replaceTeam(team, members)
    if (!done.ok) throw new Error(done.error)
    if (op === 'dissolve' && allowed) savePatch(applyOwnerSettings(before ?? '', { teamJoinAllowlist: nextAllow }).yaml)
    d.setAllowlist(nextAllow)
  } catch (error) {
    try {
      if (patchWritten) {
        if (before === undefined) { if (existsSync(patch)) unlinkSync(patch) } else savePatch(before)
      }
      if (op === 'dissolve') {
        const undone = d.store.replaceTeam(team, current)
        if (!undone.ok) throw new Error(undone.error)
      }
    } catch (rollback) { return reject(String(error) + '; rollback failed: ' + String(rollback)) }
    return reject(String(error))
  }
  const delta = op === 'dissolve' ? current : op === 'remove-member' ? current.filter(id => !members.includes(id)) : members.filter(id => !current.includes(id))
  if ((op === 'create' && !allowed) || (op === 'dissolve' && allowed)) audit(actor, true, op === 'create' ? 'created roster name' : 'dissolved roster name')
  for (const id of delta) audit(id, true, 'by human:owner')
  return { ok: true, team, members }
}
