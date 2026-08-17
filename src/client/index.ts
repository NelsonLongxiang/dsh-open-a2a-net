/**
 * Open A2A network plugin, browser half: a sidebar footer action listing
 * this host's sessions as joinable network nodes. The entry probes the
 * host's session-node state route at registration time — the seat renders
 * only on a host that serves it (the a2a host half composed with session
 * nodes, which is its default) — and each row joins/leaves through the
 * guarded control routes. Opening a cold row (persisted join intent, agent
 * not back after a restart) goes through the standard sessions flow; the
 * host remounts the node when the session loads.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-sidebar's SlotMap merge so PropsRuntime<
// 'sidebar.footer.action'> resolves (the owner props the shell injects).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots'
import { A2aControl } from './A2aControl.tsx'
import { en, zh, type A2aNetKey } from './locales.ts'

export type { A2aControlInjected, A2aControlProps, A2aSessionRow } from './A2aControl.tsx'
export type { A2aNetKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** A2A network sidebar control copy. */
    a2aNet: A2aNetKey
  }
}

/** Dictionary namespace owned by this plugin (network control copy). */
const NS = 'a2aNet'

/** Services required by the browser half: the slot system, the sessions
 * flow used to wake cold rows, and the locale dictionaries. */
export const inject = ['slots', 'sessions', 'locale']

/** Registers the network control's dictionaries and its sidebar seat.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'a2a-net: dictionaries')

  // The network control renders only on a host that serves the session-node
  // state route (a2a host half + session nodes composed); the probe keeps
  // the seat quiet everywhere else.
  void fetch('/__dsh_a2a/state', { cache: 'no-store' })
    .then(response => (response.ok ? response.json() as Promise<{ nodes?: boolean }> : undefined))
    .then((info) => {
      if (info?.nodes !== true) return
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'a2a',
        order: 10,
        locale: NS,
        // Wake = the standard session-open flow: the host materializes the
        // session's agent and the a2a host half's persisted intent remounts
        // the node, so the cold row flips live on the next poll.
        inject: () => ({
          openSession: (id: string) => { ctx.sessions.open(id as SessionIdOf) },
        }),
      }, A2aControl))
    })
    .catch(() => {})
}
