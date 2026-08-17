/** Package-owned invariant companion. @module @jf/dsh-open-a2a-net/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@jf/dsh-open-a2a-net'

/** Cordis companion plugin name. */
export const name = 'a2a-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin owns no session-event types. Inbound relay
 * messages land as ordinary `user/message` events (source `plugin/a2a`,
 * form `relay`) whose shape the core already validates, and tool results ride
 * the generic tool pipeline.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
