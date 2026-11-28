/**
 * #838 H: hot-loadable network keys. `peers`, `originClaimUrl`, `originClaimAudiences` and `originClaimByPeer` are read
 * through one process-wide snapshot that the home-layer writer (owner-settings.ts writeHomeA2a) replaces atomically after
 * a successful write, so a change shows up in `host.*` and in the next request without a restart. `teamScope` is already
 * hot-applied by its own holder; `announce` starts and stops a discovery announcer, so it keeps its restart-pending contract.
 *
 * The snapshot is not a second source of truth: values come from the boot config and from what the single home-layer writer
 * wrote, are checked with the same shape rules the schema applies at boot, and an invalid value is ignored with a warning
 * (the previous value stays), exactly as an invalid boot entry is. Nothing here opens an endpoint: only the local writer
 * calls `reload`.
 * @module @nelsonlongxiang/dsh-open-a2a-net/live-net-config
 */

import { NETWORK_KEYS, type NetworkKey } from './owner-settings.ts'

export type LiveNetKey = NetworkKey

/** What one reload changed; the host uses it to drop caches that a removed entry would otherwise keep alive. */
export interface LiveNetDiff {
  readonly changed: readonly LiveNetKey[]
  /** Keys whose written value was invalid: ignored, the previous value stays. */
  readonly ignored: readonly LiveNetKey[]
  readonly removedPeers: readonly string[]
  readonly removedAudiences: readonly string[]
  readonly removedByPeer: readonly string[]
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const isStringRecord = (value: unknown): value is Record<string, string> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value as object).every(item => typeof item === 'string')

/** The schema's shape for each hot key (src/config.ts): peers/originClaimAudiences string[], originClaimUrl string, originClaimByPeer string map. */
export function sanitizeLiveNetValue(key: LiveNetKey, value: unknown): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (key === 'originClaimUrl') return typeof value === 'string' ? { ok: true, value } : { ok: false }
  if (key === 'originClaimByPeer') return isStringRecord(value) ? { ok: true, value: Object.freeze({ ...value }) } : { ok: false }
  return isStringArray(value) ? { ok: true, value: Object.freeze([...value]) } : { ok: false }
}

export interface LiveNet<C extends object> {
  /** The boot config with the four hot keys served from the snapshot; hand this to everything that reads them. */
  readonly config: C
  /** Replace the snapshot from the keys the home-layer writer wrote (unknown keys are skipped). */
  reload(overlay: Readonly<Record<string, unknown>>, warn?: (message: string) => void): LiveNetDiff
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const removed = (before: readonly string[], after: readonly string[]): string[] => before.filter(item => !after.includes(item))

/** The same peer: same origin and same path, trailing slashes and a bare root ignored. */
export function sameHostUrl(a: string, b: string): boolean {
  try { const x = new URL(a); const y = new URL(b); return x.origin === y.origin && x.pathname.replace(/\/+$/, '') === y.pathname.replace(/\/+$/, '') } catch { return a === b }
}

/** Drop every entry keyed by a removed peer from each map (card cache, signed discovery set, ...). Returns how many went. */
export function forgetPeerEntries(removedPeers: readonly string[], ...maps: ReadonlyArray<Map<string, unknown>>): number {
  let dropped = 0
  for (const map of maps) for (const key of [...map.keys()]) if (removedPeers.some(url => sameHostUrl(key, url))) { map.delete(key); dropped += 1 }
  return dropped
}

export function createLiveNetConfig<C extends object>(boot: C): LiveNet<C> {
  let state: Record<LiveNetKey, unknown> = {
    peers: (boot as Record<string, unknown>).peers,
    originClaimUrl: (boot as Record<string, unknown>).originClaimUrl,
    originClaimAudiences: (boot as Record<string, unknown>).originClaimAudiences,
    originClaimByPeer: (boot as Record<string, unknown>).originClaimByPeer,
  }
  const config = Object.defineProperties({ ...boot }, Object.fromEntries(NETWORK_KEYS.map(key => [key, { enumerable: true, configurable: false, get: () => state[key] }]))) as C
  return {
    config,
    reload(overlay, warn) {
      const next = { ...state }
      const changed: LiveNetKey[] = []
      const ignored: LiveNetKey[] = []
      for (const key of NETWORK_KEYS) {
        if (!Object.hasOwn(overlay, key)) continue
        const checked = sanitizeLiveNetValue(key, overlay[key])
        if (!checked.ok) { ignored.push(key); warn?.(`a2a: hot reload ignored ${key}: the written value has the wrong shape; the previous value stays`); continue }
        if (!same(state[key], checked.value)) { next[key] = checked.value; changed.push(key) }
      }
      const before = state
      state = next // one atomic swap: a request in flight keeps the object it already read
      const list = (key: LiveNetKey, source: Record<LiveNetKey, unknown>): readonly string[] => (key === 'originClaimByPeer' ? Object.keys((source[key] ?? {}) as object) : Array.isArray(source[key]) ? source[key] as string[] : [])
      return {
        changed, ignored,
        removedPeers: removed(list('peers', before), list('peers', next)),
        removedAudiences: removed(list('originClaimAudiences', before), list('originClaimAudiences', next)),
        removedByPeer: removed(list('originClaimByPeer', before), list('originClaimByPeer', next)),
      }
    },
  }
}
