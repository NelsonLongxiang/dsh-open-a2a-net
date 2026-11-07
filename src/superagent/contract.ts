/**
 * Type-level contract between this repo's superagent Source types (./source-types.ts) and the upstream snapshot
 * (./upstream). The typecheck fails when a type the a2a Source hands to superagent would not be accepted there, or when
 * something superagent hands the Source lacks what the Source reads. It emits no code.
 */
import type * as Ours from './source-types.ts'
import type * as Up from './upstream/snapshot-8c32a9d.ts'
import type { A2aConfig, a2aKind } from './a2a-watch.ts'

type Extends<A, B> = [A] extends [B] ? true : false
type Same<A, B> = Extends<A, B> extends true ? Extends<B, A> : false
type Holds<T extends true> = T

type Config = A2aConfig

/** What the Source registers must be a valid upstream kind. */
export type KindIsUpstream = Holds<Extends<Ours.SourceKind<Config>, Up.SourceKind<Config>>>
/** The kind the a2a-watch plugin actually registers is a valid upstream kind. */
export type PluginKindIsUpstream = Holds<Extends<typeof a2aKind, Up.SourceKind<A2aConfig>>>
/** The host superagent injects as `orchestrator` serves everything the plugin entry calls. */
export type HostFromUpstream = Holds<Extends<Up.SourceHost, Ours.SourceHost>>
/** What upstream hands the Source must carry everything the Source reads. */
export type ContextFromUpstream = Holds<Extends<Up.SourceContext, Ours.SourceContext>>
/** Values that cross in both directions must match exactly. */
export type TriggerSame = Holds<Same<Ours.Trigger, Up.Trigger>>
export type ScopeResultSame = Holds<Same<Ours.ScopeResult, Up.ScopeResult>>
export type OutboundMessageSame = Holds<Same<Ours.OutboundMessage, Up.OutboundMessage>>
export type ReceiveResultSame = Holds<Same<Ours.ReceiveResult, Up.ReceiveResult>>
export type ChannelRefSame = Holds<Same<Ours.ChannelRef, Up.ChannelRef>>
export type CommandsFromUpstream = Holds<Extends<Up.Commands, Ours.Commands>>
/** The Source's health reports and thread pages must be accepted upstream. */
export type HealthIsUpstream = Holds<Extends<Ours.Health, Up.Health>>
export type ContextPartIsUpstream = Holds<Extends<Ours.ContextPart, Up.ContextPart>>
export type HealthCodesUpstream = Holds<Extends<Ours.HealthCode, Up.HealthCode>>
