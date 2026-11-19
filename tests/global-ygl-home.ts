/**
 * Vitest global setup: the superagent team's ygl-trees home for the whole run (ygl-home.ts reads SUPERAGENT_YGL_HOME), so
 * a plugin instance in a test never writes the developer's real ~/.ygl-trees-superagent. Created before the workers start
 * (they inherit the variable) and removed when the run ends — `pnpm verify` fails on any temp entry left behind.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default function setup(): () => void {
  const home = mkdtempSync(join(tmpdir(), 'a2a-test-ygl-'))
  process.env.SUPERAGENT_YGL_HOME = home
  return () => { rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) }
}
