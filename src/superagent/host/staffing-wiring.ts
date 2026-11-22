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
    teamAdd: (canvas, router) => {
      const out = w.teams.add({ canvas, router }, w.sessionValid, w.presetOf)
      return out.ok ? { ok: true, id: refOfId(out.id) } : out
    },
    teamUnbind: ref => { const team = w.teams.get(idOfRef(ref)); return team !== undefined && team.saveSettings({ canvas: '', router: '' }, w.sessionValid, w.presetOf, 'staffing').ok },
  })
}

/** A team's card decision, as the executor names the team. */
export const staffingTeamRef = (teams: SuperagentTeams, team: SuperagentHost): string | undefined => { const id = teams.idOf(team); return id === undefined ? undefined : refOfId(id) }
