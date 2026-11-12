/**
 * superagent: what a team host needs from the DSH instance it runs in (moved out of host/index.ts for the #570 line ratchet).
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/deps
 */
import type { SuperagentHost } from './index.ts'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { Engine, UserError, reasonText, ticketStage, type Assessor, type Candidate, type Outbox, type Reason, type Ticket, type Trigger, type ReceiveResult } from '../upstream/dsh-superagent/src/core/index.ts'
import { JsonRepositories, type StoredMessage } from './store.ts'
import { A2aSource } from './a2a-source.ts'
import { MemberExecutor, transientError, type MemberTurn, type PrepareRunner } from './executor.ts'
import { ReviewRequests } from './review-requests.ts'
import { RuleChanges, memberScope, type RuleScope } from './rule-changes.ts'
import { SettingsHistory } from './settings-history.ts'
import { HealthReminders, HEALTH_TICK_MS, type HealthProblem } from './health-reminders.ts'
import { DECISION_FILES_MAX, DecisionBook, oneClick, parseDecision, ticketCardId, type DecisionFile, type DecisionSpec, type StoredCard } from './decisions.ts'
import { parseFileRef } from '../../blob-store.ts'
import { GITHUB_SOURCE, PrFollower, defaultGh, parsePullRequest, type GhRun } from './pr-follow.ts'
import { IssueSource } from './github-issues.ts'
import type { ReportState } from '../upstream/dsh-superagent/src/core/index.ts'
import { MEMBER_PRESET, OBSERVER_PRESET, ROUTER_PRESET, type Role } from './role-tools.ts'
import { CLI_HANDLE_RE } from '../../cli-deposit.ts'
import { DEFAULT_SETTINGS, WORKBENCH_CLI, WORKBENCH_OWNER, OBSERVER_OPEN_MAX, PROMPT_MAX, observerActor, observerOfActor, parseSettings, parseStoredSettings, policyEffects, policyVersion, teamPolicy, teamScope, type RemoteMember, type TeamSettings } from './policy.ts'


export interface SuperagentHostDeps {
  /** The a2a home directory; state lives under `<home>/superagent/`. */
  readonly home: string
  /** Whether a local session is loaded and on the network, so the host can put a card into it (reliability R6). */
  readonly sessionLoaded?: (sessionId: string) => boolean
  /** Whether the host has finished waking its sessions after starting: before that, one not loaded yet is no problem. */
  readonly bootSettled?: () => boolean
  /** A local session's workspace directory, where a ticket's prepare command runs (reliability R1). */
  readonly workspaceOf?: (sessionId: string) => string | undefined
  /** Runs a prepare command; tests replace it. */
  readonly runPrepare?: PrepareRunner
  /** Selects a session's model through DSH's session/selectModel (owner 2026-11-10, 对照上游); failures are logged, never thrown. */
  readonly selectModel?: (sessionId: string, pick: { provider: string; model: string; reasoningEffort?: string }) => Promise<boolean>
  /**
   * Stage files from a local session's workspace on the file channel, granted to the team's canvas (decision cards C8).
   * Absent, a card takes no files.
   */
  /** Whether a local session can call a tool (its preset mounts it): the ygl-trees steps go only to a member that has them. */
  readonly hasTool?: (sessionId: string, name: string) => boolean
  /** Make the team's ygl-trees project in the team workspace (design Y1c); idempotent. */
  readonly ensureYglProject?: (name: string) => void
  readonly stageFiles?: (sessionId: string, paths: readonly string[], canvas: string) => { ok: true; files: DecisionFile[] } | { ok: false; code: string; error: string }
  /** Where this team's state lives instead, when it is not the instance's primary team (design M2). */
  readonly stateDir?: string
  /** Whether another team on this instance holds a canvas: one canvas is one team. */
  readonly canvasTaken?: (canvas: string, self: SuperagentHost) => boolean
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
  /** Put text into a live local session as a follow-up; false when the session is not live here. */
  readonly deliverToSession: (sessionId: string, text: string) => boolean
  /** Stop a session's running turn; true when one was running. */
  readonly cancelTurn?: (sessionId: string) => boolean
  /** What a session's ended turn left: whether its shell jobs have ended, and its last words. */
  readonly memberTurn?: (sessionId: string) => MemberTurn | undefined
  /** The person's own message a session's turn answers, if that is what it answers (design D11). */
  readonly personMessage?: (sessionId: string) => PersonMessage | undefined
  /** A local session's name, for the router's list of members. */
  readonly sessionName?: (sessionId: string) => string | undefined
  /** `gh` for reading pull requests; the operator's by default, tests stub it. */
  readonly gh?: GhRun
  /** A repeating timer; returns its disposer. */
  readonly interval: (fn: () => void, ms: number) => () => void
  readonly now?: () => string
  /** This host's own base URL for the team identity's CLI, once the web server listens. */
  readonly homeUrl?: () => string | undefined
  /** This host's API key (the CLI's control credential). */
  readonly apiKey?: () => string | undefined
  /**
   * PR-C2: a signed request to another a2a host (OriginClaim, body-bound, on this host's card key). Absent: no remote
   * members can be reached and no team can be served.
   */
  readonly signedPost?: (baseUrl: string, path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** A local session's `<zone>/<id8>` handle, and the local session a handle of this host names. */
  readonly handleOf?: (sessionId: string) => string
  readonly localSessionOf?: (handle: string) => string | undefined
  /** Tests shorten the A2A mailbox poll. */
  readonly a2aPollSeconds?: number
  /** Tests stub the CLI. */
  readonly runCli?: (args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<string>
  /** Settings were written: who is router or member may have changed (PR-D re-applies the role tool lists). */
  readonly onRolesChanged?: () => void
  /**
   * Design v5: a canvas team this host owns, as the team reads it — its local sessions (in canvas order), and its members
   * on other hosts with the key the canvas pinned and that host's base URL (empty while unknown). CLI handle slots are
   * not team members. Undefined when no canvas team has that name. Absent: no team can be bound.
   */
  readonly canvasTeam?: (name: string) => { readonly local: readonly string[]; readonly remote: readonly RemoteMember[] } | undefined
  /** Design v5 (D2): the host-face sender of the team's replies to requests that came through its canvas address. */
  readonly teamSend?: (args: readonly string[]) => Promise<string | undefined>
  /**
   * superagent-market-progress-roster P3: whether a canvas remote member (its pinned ref) declares a capability on its
   * verified card, and the roster report's send — a fire-and-forget direct message from this host's process face (no
   * debt booked, no queue slot), on its own task id. The host's card key fingerprint names the host in the report.
   */
  readonly memberDeclares?: (ref: string, capability: string) => boolean
  /** Named dispatch N1: whether an A2A caller (its handle) is a pinned canvas remote member whose verified card declares a capability. */
  readonly callerDeclares?: (caller: string, capability: string) => boolean
  readonly rosterSend?: (ref: string, text: string, taskId: string) => Promise<void>
  readonly hostFingerprint?: () => string | undefined
  /** The canvas teams this host owns, by name (the owner binds one of them). */
  readonly canvasNames?: () => readonly string[]
  /** The agent preset a live local session runs (undefined: not loaded, or no preset registry). */
  readonly presetOf?: (sessionId: string) => string | undefined
  /** The canvas teams a local session sits in (any slot shape that names it). */
  readonly canvasesOf?: (sessionId: string) => readonly string[]
}

/** The candidate card the router reads: bounded facts and the ids its decision names, never authority. */
/** A message a person typed into a session: only the host can mark one. */
/** Who a workbench request is from, when it is not the owner at the page: their terminal, or an observer. */
export type WorkbenchVia = 'cli' | { readonly observer: string }

export interface PersonMessage { readonly id: string; readonly atMs: number; readonly text: string }
