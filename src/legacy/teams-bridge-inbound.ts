/**
 * The native-teams inbound bridge (gh#77 G-segment, inbound half), moved
 * verbatim out of apply() in src/index.ts: the structural registry probe, the
 * memoized claim check, prepare (claim + seam + parent), and the bounded
 * round. Opt-in behind config.nativeTeamsInbound; when the sibling
 * @nelsonlongxiang/dsh-native-teams plugin is not composed every probe
 * declines and the standard resolution chain keeps its verdict.
 *
 * The OUTBOUND bridgeFace stays with the dispatch trunk in index.ts until the
 * G-out slice - it submits through the trunk's candidate walk (bidirectional
 * coupling), which is why #77 prescribes taking G in pieces.
 * @module src/legacy/teams-bridge-inbound
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '../index.ts'

/** Structural descriptor of one team name across planes (the registry's answer). */
export interface BridgeTeamsDescriptor {
  readonly plane: 'local' | 'a2a'
  readonly ambiguous?: boolean
  readonly localLabel?: string
}

/** The sibling registry's widened structural face (presence-guarded probe). */
export interface BridgeTeamsRegistry {
  listTeams(): Array<{ name: string; description: string }>
  describeTarget(handle: string): Promise<BridgeTeamsDescriptor>
  startRound(args: { team?: string; message: string }, parent: { id: string; session: { events?: readonly unknown[] } }, signal: AbortSignal): Promise<string>
}

/** A prepared dispatch: claim verified, seam live, parent initiator found. */
export type NativeTeamsPrepared =
  | { readonly ok: true; readonly teams: BridgeTeamsRegistry; readonly parent: { id: string; session: { events?: readonly unknown[] } } }
  | { readonly ok: false; readonly reason: 'not-claimed' }
  | { readonly ok: false; readonly reason: 'error'; readonly error: string }

/** The bounded round's outcome (settled / unsettled-deadline / failed / aborted). */
export type NativeTeamsRoundOutcome =
  | { readonly ok: true; readonly reply: string; readonly settled: boolean }
  | { readonly ok: false; readonly error: string; readonly phase?: 'pre-dispatch'; readonly aborted?: boolean }

/** Everything the inbound bridge captures from apply(). */
export interface TeamsBridgeInboundDeps {
  readonly ctx: Context
  readonly config: Config
  readonly liveAgent: () => Agent | undefined
  readonly fromClause: (from: string) => string
}

/** The four inbound-bridge operations, verbatim from apply(). */
export interface TeamsBridgeInbound {
  teamsRegistry(): BridgeTeamsRegistry | undefined
  nativeTeamsClaims(team: string): Promise<boolean>
  nativeTeamsPrepare(team: string): Promise<NativeTeamsPrepared>
  nativeTeamsRound(prepared: Extract<NativeTeamsPrepared, { ok: true }>, team: string, caller: string, message: string, taskId: string | undefined, external?: AbortSignal): Promise<NativeTeamsRoundOutcome>
}

/**
 * Build the inbound bridge. The bodies are byte-identical to their apply()
 * originals (same two-space indent); only the four capture points arrive as
 * deps.
 */
export function createTeamsBridgeInbound(deps: TeamsBridgeInboundDeps): TeamsBridgeInbound {
  const {
    ctx, config, liveAgent, fromClause,
  } = deps
  function teamsRegistry(): BridgeTeamsRegistry | undefined {
    const candidate = (ctx as unknown as { get(name: string): unknown }).get('teams') as Partial<BridgeTeamsRegistry> | undefined
    if (candidate === undefined || candidate === null) return undefined
    if (typeof candidate.describeTarget !== 'function' || typeof candidate.startRound !== 'function' || typeof candidate.listTeams !== 'function') return undefined
    return candidate as BridgeTeamsRegistry
  }

  /** Reply-wait parity with the steer path's 180s deadline: native-teams
   * rounds settle on their own cadence, but a wedged seam must not park a
   * caller past a bounded window (config.nativeRoundWaitMs). */
  /** The claim table changes at registry-edit cadence: a short memo dedupes
   * the double probe (callers pre-check, the round re-verifies) without
   * pretending the answer is permanent. */
  const BRIDGE_CLAIM_TTL_MS = 5_000
  const bridgeClaimCache = new Map<string, { at: number; claimed: boolean }>()
  const bridgeTimers = new Set<ReturnType<typeof setTimeout>>()
  ctx.effect(() => () => {
    for (const timer of bridgeTimers) clearTimeout(timer)
  })

  /**
   * Whether the native-teams registry claims `team` as an unambiguous local
   * target, memoized for {@link BRIDGE_CLAIM_TTL_MS}. Ordinary misses never
   * throw (the D2 query contract); anything that does throw is treated as a
   * miss — the bridge is a guest here. The memo is skipped entirely while
   * the bridge is off, so the flag gates the probe itself.
   */
  async function nativeTeamsClaims(team: string): Promise<boolean> {
    if (config.nativeTeamsInbound !== true) return false
    const cached = bridgeClaimCache.get(team)
    if (cached !== undefined && Date.now() - cached.at < BRIDGE_CLAIM_TTL_MS) return cached.claimed
    const teams = teamsRegistry()
    let claimed = false
    if (teams !== undefined) {
      try {
        const descriptor = await teams.describeTarget(team)
        claimed = descriptor.plane === 'local' && descriptor.ambiguous !== true && descriptor.localLabel !== undefined
      } catch {
        claimed = false
      }
    }
    bridgeClaimCache.set(team, { at: Date.now(), claimed })
    // Bounded memo: probe-miss names accumulate one tiny row each; past a
    // generous cap, drop the whole table (a cold re-probe costs one local
    // describeTarget call).
    if (bridgeClaimCache.size > 512) bridgeClaimCache.clear()
    return claimed
  }

  type NativeTeamsPrepared =
    | { readonly ok: true; readonly teams: BridgeTeamsRegistry; readonly parent: { id: string; session: { events?: readonly unknown[] } } }
    | { readonly ok: false; readonly reason: 'not-claimed' }
    | { readonly ok: false; readonly reason: 'error'; readonly error: string }

  /**
   * Resolve everything the round needs BEFORE any caller is told the
   * dispatch happened: the claim, the seam, and a parent initiator. The
   * `error` variant is the only fast-failure shape — `not-claimed` simply
   * hands the address back to the standard resolution chain.
   */
  async function nativeTeamsPrepare(team: string): Promise<NativeTeamsPrepared> {
    if (!await nativeTeamsClaims(team)) return { ok: false, reason: 'not-claimed' }
    const teams = teamsRegistry()
    if (teams === undefined) return { ok: false, reason: 'not-claimed' }
    const parent = liveAgent()
    if (parent === undefined) return { ok: false, reason: 'error', error: 'No live DSH initiator is available to parent the native-teams round.' }
    // The alpha.4 Session face dropped the events member (the widened
    // BridgeTeamsRegistry accepts it optional) — the raw Agent carries the
    // ambient Session whose shape no longer overlaps, so project through the
    // widened structural face explicitly (type-level only; the runtime value
    // is the same live agent).
    const parentFace = parent as unknown as { id: string; session: { events?: readonly unknown[] } }
    return { ok: true, teams, parent: parentFace }
  }

  /** The A2A envelope rides the round message so the dispatcher sees the network origin. */
  function bridgeEnvelope(team: string, caller: string, message: string, taskId: string | undefined): string {
    const from = caller === '' ? 'an unknown node' : caller
    const taskPrefix = taskId === undefined ? '' : `(task ${taskId}) `
    return `[A2A direct] ${taskPrefix}${fromClause(from)} (routed to ${team}) sent:\n\n${message}`
  }

  type NativeTeamsRoundOutcome =
    | { readonly ok: true; readonly reply: string; readonly settled: boolean }
    | { readonly ok: false; readonly error: string; readonly phase?: 'pre-dispatch'; readonly aborted?: boolean }

  /** The projection for a round that outlived the reply window: unlike the
   * steer deadline's text, this must NOT promise a receipt — native-teams
   * rounds route none in this slice. */
  function bridgeUnsettledReply(team: string): string {
    return `The native-teams round for "${team}" is still running past the reply window; it was delivered and keeps going. Native-teams rounds route no A2A receipt in this slice — reconcile with a follow-up route (continuity rides the team's own durable round chain).`
  }

  /**
   * Fire the round and wait, bounded. The caller's signal (when it has one)
   * cancels the round itself; the deadline releases the caller with the
   * unsettled projection while the round keeps running detached.
   * @param prepared - a ready dispatch (claim, seam, parent) from {@link nativeTeamsPrepare}.
   */
  async function nativeTeamsRound(prepared: Extract<NativeTeamsPrepared, { ok: true }>, team: string, caller: string, message: string, taskId: string | undefined, external?: AbortSignal): Promise<NativeTeamsRoundOutcome> {
    const controller = new AbortController()
    // One listener, always removed after the race: an external abort cancels
    // the round through its own controller.
    const onExternalAbort = (): void => { controller.abort() }
    if (external !== undefined) {
      if (external.aborted) controller.abort()
      else external.addEventListener('abort', onExternalAbort)
    }
    if (controller.signal.aborted) return { ok: false, error: 'aborted before the native-teams round was dispatched', phase: 'pre-dispatch' }
    let roundError: unknown
    type Verdict = { readonly kind: 'settled'; readonly reply: string } | { readonly kind: 'failed' } | { readonly kind: 'deadline' } | { readonly kind: 'aborted' }
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<Verdict>(resolve => {
      deadlineTimer = setTimeout(() => {
        if (deadlineTimer !== undefined) bridgeTimers.delete(deadlineTimer)
        resolve({ kind: 'deadline' })
      }, config.nativeRoundWaitMs ?? 180_000)
      deadlineTimer.unref?.()
      bridgeTimers.add(deadlineTimer)
    })
    const verdict = await Promise.race([
      prepared.teams.startRound({ team, message: bridgeEnvelope(team, caller, message, taskId) }, prepared.parent, controller.signal).then(
        (reply): Verdict => ({ kind: 'settled', reply }),
        (error: unknown): Verdict => { roundError = error; return { kind: 'failed' } },
      ),
      deadline,
      new Promise<Verdict>(resolve => {
        if (controller.signal.aborted) resolve({ kind: 'aborted' })
        else controller.signal.addEventListener('abort', () => resolve({ kind: 'aborted' }), { once: true })
      }),
    ])
    // Hygiene: the losing deadline timer stops here (not 180s later), and
    // the external-signal listener does not outlive the round.
    if (deadlineTimer !== undefined) {
      clearTimeout(deadlineTimer)
      bridgeTimers.delete(deadlineTimer)
    }
    if (external !== undefined) external.removeEventListener('abort', onExternalAbort)
    if (verdict.kind === 'settled') return { ok: true, reply: verdict.reply, settled: true }
    if (verdict.kind === 'deadline') return { ok: true, reply: bridgeUnsettledReply(team), settled: false }
    if (verdict.kind === 'aborted') return { ok: false, error: `the wait for the native-teams round "${team}" was aborted (the round was cancelled with it)`, aborted: true }
    return { ok: false, error: `the native-teams round for "${team}" failed: ${String(roundError)}` }
  }
  return { teamsRegistry, nativeTeamsClaims, nativeTeamsPrepare, nativeTeamsRound }
}
