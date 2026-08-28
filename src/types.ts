/**
 * Wire and configuration vocabulary for the A2A client extension.
 * @module @nelsonlongxiang/dsh-open-a2a-net/types
 */

/** One peer node's agent card — the decentralized discovery record. */
export interface A2aPeerCard {
  /** Human-facing peer name. */
  readonly name: string
  /** The team this peer exposes. */
  readonly team: string
  /** The peer's session id (diagnostics and signing identity). */
  readonly session: string
  /** Capability flags the peer published, verbatim. */
  readonly capabilities: unknown
  /** Epoch ms after which the card is stale; enforced at every parse. */
  readonly expiresAt: number
  /**
   * Card URLs of other nodes the publisher knows (discovery referrals).
   * Unsigned and optional: a referral is fetched and verified as its own
   * card before it is trusted, so its integrity is checked at that fetch,
   * not by this card's signature.
   */
  readonly peers?: readonly string[]
  /**
   * Joined session teams this peer currently dispatches. Unsigned and
   * optional: served fresh at read time, each entry is a team name the
   * peer's `/a2a/direct` endpoint routes to that session, with the
   * session's title and recent-activity excerpt as facts.
   */
  readonly sessionTeams?: readonly A2aSessionTeamInfo[]
  /**
   * The publishing host's LAN IPv4. Unsigned and optional: served fresh, it
   * lets peers group and tell machines apart in a same-team fleet.
   */
  readonly lanIp?: string
  /**
   * The publishing plugin's package version. Unsigned and optional: served
   * fresh like `lanIp`, it lets operators audit a fleet's actual running
   * builds without visiting each host.
   */
  readonly version?: string
  /** Base64 SPKI DER of the signing node's Ed25519 public key. */
  readonly publicKey: string
  /**
   * Zone records delegating names to other zones. Signed with the card: a
   * record is an authority claim over the name (GNS DELEGATE semantics),
   * unlike the unsigned `peers` referral hints.
   */
  readonly records?: readonly ZoneRecord[]
  /** Base64 Ed25519 signature over the card's committed fields. */
  readonly signature: string
}

/** One joined session team advertised on a peer's card. */
export interface A2aSessionTeamInfo {
  /** Session team name (`<team>/<agentId8>`); the route target. */
  readonly team: string
  /** The session's title at read time. */
  readonly name: string
  /** One-line excerpt of the session's newest user or assistant text. */
  readonly description: string
  /** The session's working directory, when the publishing node shares it. */
  readonly workspace?: string
}

/**
 * One zone record: a delegation of a name into another zone. The delegating
 * zone's card signature commits the record, so only the zone key holder can
 * publish or retire the name.
 */
export interface ZoneRecord {
  readonly type: 'delegate'
  /** The delegated name; resolves zone-relatively. */
  readonly name: string
  /** Base URL of the zone the name resolves in. */
  readonly url: string
  /**
   * Expected base64 SPKI public key of the target zone's card. When bound,
   * a target card whose key differs fails resolution closed.
   */
  readonly publicKey?: string
}

/** Canonical `a2a_route` success value. */
export interface A2aRouteOk {
  readonly ok: true
  readonly team: string
  /** Reply text the remote team produced. */
  readonly reply: string
  /** The answering peer's task id (diagnostics). */
  readonly task_id: string
  /** Context id for continuing this conversation in a later `a2a_route` call. */
  readonly context_id: string
  readonly task_status: string
  /**
   * Present when the result rode the native-teams bridge: its rounds emit
   * no A2A receipt in this slice, so callers must not book the row as
   * receipt-owed (`trackOwedTask` skips it).
   */
  readonly bridge?: 'native-teams'
}

/** Canonical `a2a_route` failure value. */
export interface A2aRouteError {
  readonly ok: false
  /** Peer or transport failure text. */
  readonly error: string
  /**
   * Wall-clock ms from dispatch to abort/failure. Present on transport-level
   * failures only — pins the wait-window measurement instead of a feeling.
   */
  readonly abortElapsedMs?: number
  /** True when THIS client's own reply-wait budget fired (vs caller signal / peer refusal). */
  readonly ownBudgetExhausted?: boolean
  /** A2A JSON-RPC-style code when the peer supplied one. */
  readonly code?: number
  readonly task_id?: string
}

/** Canonical `a2a_route` value: success or explicit failure. */
export type A2aRouteResult = A2aRouteOk | A2aRouteError
