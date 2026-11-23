/**
 * Staffing changes (S1a): the executor wired to this host's canvas and team routes' own checks. Kept out of index.ts
 * (#570 line ratchet). A team is named by its id; the primary team (id '') is named `primary`.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/staffing-wiring
 */
import { StaffingExecutor, type StaffingTeam } from './staffing.ts'
import type { SuperagentHost } from './index.ts'
import type { SuperagentTeams } from './teams.ts'
import { isRemoteMemberRef, type CanvasStore } from '../../canvas-store.ts'
import { addCanvasMember } from '../../canvas-member-write.ts'
import type { CliHomeDecision } from '../../cli-home.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homeA2aWrittenSinceBoot, writeHomeA2a } from '../../owner-settings.ts'
import { Config as ConfigSchema } from '../../config.ts'
import type { NetworkSettings } from './staffing.ts'

export interface StaffingWiring {
  readonly path: string
  readonly teams: SuperagentTeams
  readonly canvasStore: Pick<CanvasStore, 'create' | 'remove' | 'hasTeam' | 'addMember' | 'rawMembersOf' | 'membersOf' | 'cliHomeOf' | 'removeMember' | 'isSuspended'>
  readonly canvasNameReserved: (name: string) => boolean
  /** A joined (or live) local session. */
  readonly sessionValid: (id: string) => boolean
  readonly presetOf: (id: string) => string | undefined
  /** The canvas route's member proof and the superagent team refusal, as add-member runs them. */
  readonly memberForWrite: (id: string, peer?: unknown) => Promise<{ ok: true; member: string; ownerKey?: string } | { ok: false; error: string }>
  /** #808: the canvas route's CLI home pin for a CLI member. */
  readonly cliHomeForAdd: (handle: string, requested?: unknown) => Promise<CliHomeDecision>
  /** #808 P2: the DSH home whose cordis.patch.yml holds the home-layer a2a config, and the running a2a config. */
  readonly a2aHome?: string
  /** #808 P3: session joins and seat names, from the host (the join/leave routes' and the owner panel's own steps). */
  readonly sessionOps?: { join(id: string): { ok: true } | { ok: false; error: string }; leave(id: string): boolean; joined(id: string): boolean }
  readonly seatNames?: { read(): Readonly<Record<string, string>>; write(names: Record<string, string>): { ok: true } | { ok: false; error: string } }
  /** The session list's title, through the host's session-title service (a live local session only). */
  readonly sessionTitles?: { read(id: string): { live: boolean; title?: string }; rename(id: string, title: string): { ok: true; title: string } | { ok: false; error: string }; reset(id: string): boolean }
  readonly a2aConfig?: Readonly<Record<string, unknown>>
  readonly teamCanvasRefusal: (canvas: string, member: string) => string | undefined
  readonly revokeCanvasMember: (id: string, reason: 'remove', name: string) => boolean
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
}

const idOfRef = (ref: string): string => ref === 'primary' ? '' : ref
const refOfId = (id: string): string => id === '' ? 'primary' : id

export function createStaffing(w: StaffingWiring): StaffingExecutor {
  const adapt = (team: SuperagentHost): StaffingTeam => ({
    get settings() { return team.settings },
    saveSettings: (raw, by) => team.saveSettings(raw, w.sessionValid, w.presetOf, by),
    memberOfSeat: seatId => team.named.memberOfSeat(seatId),
    ticketOf: session => team.executor.ticketsOf(session)[0],
    proposeStaffingCard: (changeId, question, reason, level) => team.proposeStaffingCard(changeId, question, reason, level),
    ruleRevision: scope => team.ruleChanges.revision(scope as never),
    recordRuleChange: (scope, change) => { team.ruleChanges.applied(scope as never, { at: new Date().toISOString(), by: change.by, reason: change.reason }) },
  })
  return new StaffingExecutor({
    path: w.path,
    now: () => new Date().toISOString(),
    logger: w.logger,
    team: ref => { const team = w.teams.get(idOfRef(ref)); return team === undefined || (ref !== 'primary' && idOfRef(ref) === '') ? undefined : adapt(team) },
    teamOfCanvas: canvas => { const team = w.teams.ofCanvas(canvas); const id = team === undefined ? undefined : w.teams.idOf(team); return id === undefined ? undefined : refOfId(id) },
    canvasExists: name => w.canvasStore.hasTeam(name),
    canvasCreate: name => {
      if (w.canvasNameReserved(name)) return { ok: false, error: `canvas name ${name} is reserved by the roster` }
      return w.canvasStore.create(name) === undefined ? { ok: false, error: 'invalid canvas name, or the team cap is reached' } : { ok: true }
    },
    canvasRemove: name => w.canvasStore.remove(name),
    canvasAddLocal: async (name, session) => {
      if (!w.sessionValid(session)) return { ok: false, error: `${session} is not a joined session on this host` }
      const proof = await w.memberForWrite(session)
      if (!proof.ok) return proof
      const refusal = w.teamCanvasRefusal(name, proof.member)
      if (refusal !== undefined) return { ok: false, error: refusal }
      return w.canvasStore.addMember(name, proof.member, undefined, proof.ownerKey !== undefined ? { ownerKey: proof.ownerKey } : {}) ? { ok: true } : { ok: false, error: `${session} was not added to canvas ${name}` }
    },
    canvasRemoveLocal: (name, session) => w.revokeCanvasMember(session, 'remove', name),
    // #808: plain canvas members through the canvas route's own write.
    canvasAddMember: (name, member, home) => addCanvasMember({ canvasStore: w.canvasStore, canvasNameReserved: w.canvasNameReserved, localMember: w.sessionValid,
      memberForWrite: w.memberForWrite, teamCanvasRefusal: w.teamCanvasRefusal, cliHomeForAdd: w.cliHomeForAdd }, name, member, home !== undefined ? { home } : {}),
    canvasRemoveMember: (name, member) => isRemoteMemberRef(member) ? !w.canvasStore.isSuspended(name, member) && w.canvasStore.removeMember(name, member) : w.revokeCanvasMember(member, 'remove', name),
    canvasMembers: name => w.canvasStore.membersOf(name),
    canvasCliHome: member => w.canvasStore.cliHomeOf(member),
    ...(w.a2aHome !== undefined && w.a2aConfig !== undefined ? networkDeps(w.a2aHome, w.a2aConfig) : {}),
    ...(w.sessionOps !== undefined ? { sessionJoin: w.sessionOps.join, sessionLeave: w.sessionOps.leave, sessionJoined: w.sessionOps.joined } : {}),
    ...(w.seatNames !== undefined ? { seatNamesRead: w.seatNames.read, seatNamesWrite: w.seatNames.write } : {}),
    ...(w.sessionTitles !== undefined ? { sessionTitleRead: w.sessionTitles.read, sessionTitleRename: w.sessionTitles.rename, sessionTitleReset: w.sessionTitles.reset } : {}),
    teamAdd: (canvas, router) => {
      const out = w.teams.add({ canvas, router }, w.sessionValid, w.presetOf)
      return out.ok ? { ok: true, id: refOfId(out.id) } : out
    },
    teamUnbind: ref => { const team = w.teams.get(idOfRef(ref)); return team !== undefined && team.saveSettings({ canvas: '', router: '' }, w.sessionValid, w.presetOf, 'staffing').ok },
  })
}

/** A team's card decision, as the executor names the team. */
export const staffingTeamRef = (teams: SuperagentTeams, team: SuperagentHost): string | undefined => { const id = teams.idOf(team); return id === undefined ? undefined : refOfId(id) }

/**
 * #808 P2: network settings for the staffing executor. Reads are the running config overlaid with what this boot wrote to
 * the home layer (so a second blueprint before a restart starts from the first one's result); writes go through the one
 * home-layer writer, which seeds a new block from the lower layers and refuses to copy credentials.
 */
export function networkDeps(home: string, running: Readonly<Record<string, unknown>>): { networkRead: () => NetworkSettings; networkWrite: (changes: Partial<NetworkSettings>) => { ok: true } | { ok: false; error: string } } {
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const read = (): NetworkSettings => {
    // #817 R2: the shared overlay, so a workbench change before a restart is the base too (and an undo never overwrites it).
    const at = { ...running, ...homeA2aWrittenSinceBoot(home) } as Record<string, unknown>
    const byPeer = at.originClaimByPeer !== null && typeof at.originClaimByPeer === 'object' && !Array.isArray(at.originClaimByPeer) ? at.originClaimByPeer as Record<string, string> : {}
    return { peers: arr(at.peers), announce: at.announce === true, teamScope: effectiveTeamScope(at), originClaimUrl: typeof at.originClaimUrl === 'string' ? at.originClaimUrl : '', originClaimAudiences: arr(at.originClaimAudiences), originClaimByPeer: { ...byPeer } }
  }
  return {
    networkRead: read,
    networkWrite: changes => {
      const { announce, teamScope, ...network } = changes
      try {
        const out = writeHomeA2a(home, { ...(announce !== undefined ? { announce } : {}), ...(teamScope !== undefined ? { teamScope } : {}), network },
          running, ConfigSchema({} as never) as unknown as Record<string, unknown>,
          { exists: existsSync, read: p => readFileSync(p, 'utf8'), write: (p, s) => writeFileSync(p, s, 'utf8'), mkdir: p => { mkdirSync(p, { recursive: true }) } })
        if (!out.ok) return { ok: false, error: out.error }
        return { ok: true }
      } catch (error) { return { ok: false, error: `home-layer write failed: ${error instanceof Error ? error.message : String(error)}` } }
    },
  }
}

/** #817 R1: teamScope as the host reads it (src/index.ts): unset means the two halves, which default to on. */
export function effectiveTeamScope(at: Readonly<Record<string, unknown>>): boolean {
  return at.teamScope !== undefined ? at.teamScope === true : at.teamScopeRouting !== false && at.teamScopeInfo !== false
}
