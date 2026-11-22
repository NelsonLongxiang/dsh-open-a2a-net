/** Required PTC for the general preset; reuse the optional team adapter behind a fail-closed selection. */
import type { Context } from '@deepseek-ai/cordis'
import { apply as activatePtc } from '../superagent/ptc.ts'

export const name = 'a2a-net-ptc'
export const inject = ['tools', 'systemPrompt', 'loader']

/** Missing/denied/late PTC must never expose an inherited native executor. */
export async function apply(ctx: Context): Promise<void> {
  const tools = ctx.get('tools') as unknown as { setExecutor?: (executor: { describe(): never; execute(): Promise<never> }) => () => void } | undefined
  if (typeof tools?.setExecutor !== 'function') throw Error('a2a-net-ptc requires the scoped tool executor API')
  const unavailable = () => Error('a2a-net-ptc: compatible PTC executor/runtime unavailable; native fallback is disabled')
  const release = tools.setExecutor({
    describe() { throw unavailable() },
    async execute() { throw unavailable() },
  })
  // dsh-tools 0.2.2-rc.5 public setExecutor declaration: "Unloading leaves the selection
  // unavailable until it is replaced." The real-host regression checks this contractual seam.
  // The public disposer retains an unavailable selection in this scope. It masks native without
  // occupying the one active-provider slot, which the real executor may subsequently fill.
  release()
  // This established adapter owns profile preflight and compatible provider activation/replacement.
  // Its optional fallbacks leave our blocking selection in place, not the parent native provider.
  await activatePtc(ctx)
}
