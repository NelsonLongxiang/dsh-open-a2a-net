/**
 * Structural contract for the native-teams A2A transport bridge (the
 * node-unification design's outbound half-bridge).
 *
 * Contract ownership belongs to `@nelsonlongxiang/dsh-native-teams`
 * (`src/a2a-face.ts`, 0.14.0). These are this plugin's local structural
 * mirrors — plugins never value-import each other, so the shapes are
 * restated here and kept in lockstep by the three-party protocol docs
 * (exposure-grants / t3-declaration-remote-members). Any drift is a
 * protocol-doc bug first.
 * @module @nelsonlongxiang/dsh-open-a2a-net/teams-bridge
 */

/**
 * Service key the face mounts under. Frozen by the tool face's
 * `NATIVE_TEAMS_A2A_FACE_KEY` (mirrored verbatim per the single-source
 * discipline; the protocol docs arbitrate any dispute).
 */
export const NATIVE_TEAMS_A2A_FACE_KEY = 'nativeTeamsA2a'

/** Mirror of native-teams' `A2AResolveInfo`: what the resolver learned. */
export interface TeamsBridgeResolveInfo {
  readonly kind: 'node' | 'group' | 'zone'
  /** Delegation hops behind the resolution. */
  readonly hops: number
  /** Publishing node base URL when known. */
  readonly url?: string
}

/** Mirror of native-teams' `RoutableIdentity` (B1 callbackTarget). */
export interface TeamsBridgeCallbackTarget {
  /** The durable child label the receipt flows back to. */
  readonly label: string
  /** The submitting session's id. */
  readonly parentSessionId: string
  /** The root ancestor session id, when reachable. */
  readonly rootSessionId?: string
}

/** Mirror of native-teams' `A2ASubmitRequest`: one routed-round submission. */
export interface TeamsBridgeSubmitRequest {
  /** Remote group-entry handle (never an unpublished member handle). */
  readonly handle: string
  readonly message: string
  /** `sync` blocks for the final text; `async` resolves on acceptance. */
  readonly delivery: 'sync' | 'async'
  /** Caller-pinned continuity key; minted by the caller when absent. */
  readonly sessionKey?: string
  /** Orchestrator-minted dedup key (B3); becomes the wire task id. */
  readonly idempotencyKey?: string
  /** Known remote thread id to continue. */
  readonly contextId?: string
  /** Where receipts should flow back to (B1); consumed by the P2 slice. */
  readonly callbackTarget?: TeamsBridgeCallbackTarget
}

/** Mirror of native-teams' `A2ASubmitOutcome`: the two submit terminations. */
export type TeamsBridgeSubmitOutcome =
  | { readonly kind: 'completed'; readonly text: string; readonly taskId?: string; readonly contextId?: string }
  | { readonly kind: 'accepted'; readonly taskId: string; readonly acceptedAt: string; readonly contextId?: string }

/** Mirror of native-teams' `A2AQueryRequest` (W7 slice 2): one read-only
 * outcome lookup. The caller re-presents the EXACT submit fields so the
 * transport face can recompute the submit payload's fingerprint — the gate's
 * own shared implementation — as the query's authorization. */
export interface TeamsBridgeQueryRequest {
  /** The claimed task id (the orchestrator's dedup key on graph-loop dispatches). */
  readonly taskId: string
  /** Remote group-entry handle the submit addressed. */
  readonly handle: string
  /** The original submit message text, verbatim. */
  readonly message: string
  /** The original submit delivery mode. */
  readonly delivery: 'sync' | 'async'
}

/** Mirror of native-teams' `A2AQueryOutcome` (W7 slice 2): the four-state
 * read-only answer, 1:1 with the wire's `/a2a/query` body. `undefined` from
 * the face means "no increment of information" (unresolved handle, no peer
 * answered, transport failed) — a query failure is never a verdict. */
export type TeamsBridgeQueryOutcome =
  | { readonly found: false; readonly reason: 'unknown-task' | 'payload-mismatch' }
  | { readonly found: true; readonly status: 'pending' }
  | { readonly found: true; readonly status: 'completed'; readonly reply: string; readonly settledAt: string; readonly truncated?: boolean }
  | { readonly found: true; readonly status: 'failed'; readonly error: string; readonly settledAt: string; readonly truncated?: boolean }

/** Mirror of native-teams' `NativeTeamsA2AFace` transport contract. */
export interface NativeTeamsBridgeFace {
  resolve(handle: string, opts?: { timeoutMs?: number }): Promise<TeamsBridgeResolveInfo | undefined>
  submit(request: TeamsBridgeSubmitRequest, signal?: AbortSignal): Promise<TeamsBridgeSubmitOutcome>
  cancel?(ref: { readonly taskId?: string; readonly sessionKey?: string }, reason?: string): Promise<boolean>
  queryOutcome?(request: TeamsBridgeQueryRequest, signal?: AbortSignal): Promise<TeamsBridgeQueryOutcome | undefined>
}
