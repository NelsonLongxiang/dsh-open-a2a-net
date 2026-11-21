/**
 * Optional code-mode entry for team presets. Host services, not a one-shot YAML condition, own activation.
 * This imports only the host's existing executor; it never supplies a runtime, installs a package or alters a role guard.
 */
import type { Context } from '@deepseek-ai/cordis'

export const name = 'superagent-ptc'
export const inject = ['tools', 'systemPrompt', 'loader']
const EXECUTOR = '@deepseek-ai/dsh-tool-executor-ptc'

/**
 * The earlier service used the same name but has no retained-state/program-form contract. The program format is only
 * that contract's marker here: this plugin never interprets it, and the host's own PTC executor, which ships with the
 * runtime, renders instructions for it. So any non-empty format is accepted, not a fixed list that would silently send
 * members back to native tools whenever DSH adds one (DSH master added `scoped-repl` after 0.2.2-rc.5).
 */
export function compatiblePtcRuntime(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const runtime = value as Record<string, unknown>
  return ['typescript', 'python'].includes(String(runtime.language))
    && typeof runtime.programFormat === 'string' && runtime.programFormat !== ''
    && typeof runtime.retainsState === 'boolean'
    && typeof runtime.release === 'function'
    && typeof runtime.resolve === 'function'
    && typeof runtime.run === 'function'
}

/** Only the optional package itself being absent is compatibility fallback, not a broken dependency or import. */
function absentExecutor(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND')
    && (error.message.startsWith(`Cannot find package '${EXECUTOR}'`) || error.message.startsWith(`Cannot find module '${EXECUTOR}'`))
}

/** Load in the preset scope; Cordis tears the selected executor down with its runtime and the preset. */
export async function apply(ctx: Context): Promise<void> {
  const tools = ctx.get('tools') as unknown as { setExecutor?: unknown } | undefined
  // Old DSH tools have an integrated PTC seam, not the split executor API. Do not even import the new package there.
  if (typeof tools?.setExecutor !== 'function') return
  let active = true
  ctx.effect(() => () => { active = false }, 'superagent: optional PTC lifetime')
  const loader = ctx.get('loader')!
  if (ctx.get('profileContext') !== undefined) {
    // Dynamically mounted plugins must pass the same DSH compatibility policy as ordinary preset rows.
    const boot = await loader.import('@deepseek-ai/dsh-app-boot') as {
      prepareProfileEntries?: (context: Context, rows: { name: string }[], base?: string) => { disabled?: unknown }[]
    }
    if (!active || ctx.fiber.uid === null) return
    if (typeof boot.prepareProfileEntries !== 'function') throw Error('superagent: host has no plugin compatibility preflight')
    const admitted = boot.prepareProfileEntries(ctx, [{ name: EXECUTOR }], ctx.baseUrl ?? loader.ctx.baseUrl)
    if (admitted.length !== 1 || admitted[0]?.disabled === true) {
      ctx.logger.warn('superagent: host compatibility policy denied the PTC executor; team presets keep native tools')
      return
    }
  }
  let executor: { apply?: unknown; inject?: unknown }
  try {
    executor = await loader.import(EXECUTOR)
  } catch (error) {
    if (!absentExecutor(error)) throw error
    ctx.logger.warn('superagent: this host has no split PTC executor; team presets keep native tools')
    return
  }
  if (!active || ctx.fiber.uid === null) return
  if (typeof executor.apply !== 'function') throw Error('superagent: incompatible split PTC executor module')
  // Keep this row mounted even with no runtime. The child activates on a late provider without refreshing a preset row.
  await ctx.inject(['ptcRuntime'], async child => {
    if (!compatiblePtcRuntime(child.get('ptcRuntime'))) {
      child.logger.warn('superagent: incompatible PTC runtime contract; team presets keep native tools')
      return
    }
    await child.plugin(executor as Parameters<Context['plugin']>[0])
  })
}
