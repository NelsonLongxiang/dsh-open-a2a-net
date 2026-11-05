/** Fixture archives contain only explicit test payloads, not macOS AppleDouble metadata. */
import { spawnSync } from 'node:child_process'
export function fixtureTar(args, options = {}) {
  return spawnSync('tar', args, {
    ...options,
    // bsdtar otherwise synthesizes ._ entries for com.apple.provenance/xattrs.
    // Keep the override last even when the caller supplied its own environment.
    env: { ...process.env, ...options.env, COPYFILE_DISABLE: '1' },
  })
}
