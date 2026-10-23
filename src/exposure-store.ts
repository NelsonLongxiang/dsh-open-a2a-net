/**
 * #19 exposure tiers (ruling final, D3/D4): per-session visibility tier on
 * the A2A network — 'linked' (the default floor: visible to linked callers
 * per the W3 gate) or 'fleet' (the member's voluntary opt-UP: visible to
 * any fleet peer). v1 carries exactly these two tiers (D5: no private
 * residue below linked).
 *
 * D3: joins default to linked — existing members transfer automatically
 * (tier absence IS linked, so no migration is needed); a member may raise
 * itself to fleet and lower itself back (fleet is an opt-up, linked is the
 * floor, never a ceiling decision taken from the member).
 *
 * D4 (成文, zero group knobs): a GROUP's visibility equals its STRICTEST
 * member tier — one linked member keeps the group linked-level. The rule
 * binds every future group surface (canvas listing, fleet feeds); v1 has
 * no group-level tier API by design, so the rule needs no enforcement
 * seam yet.
 * @module @nelsonlongxiang/dsh-open-a2a-net/exposure-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The two v1 tiers (D5: nothing below linked exists). */
export type ExposureTier = 'linked' | 'fleet'

/** The persisted tier document (whole-file read/write, small by design). */
export interface ExposureSnapshot {
  readonly tiers?: Readonly<Record<string, ExposureTier>>
}

export class ExposureStore {
  private tiers = new Map<string, ExposureTier>()

  /**
   * @param path - persistence file (`<dsh-home>/a2a/exposure.json`); empty = no persistence.
   */
  constructor(private readonly path: string) {
    if (this.path === '') return
    if (!existsSync(this.path)) return
    try {
      const snapshot = JSON.parse(readFileSync(this.path, 'utf8')) as ExposureSnapshot | null
      const tiers = snapshot?.tiers
      if (tiers === undefined || typeof tiers !== 'object') return
      for (const [id, tier] of Object.entries(tiers)) {
        if (tier === 'fleet') this.tiers.set(id, 'fleet') // linked is the absence default
      }
    } catch {
      // A corrupt store is not fatal: everyone degrades to linked (the default floor).
    }
  }

  /**
   * The session's tier — 'linked' unless explicitly raised to 'fleet'
   * (D3: existing members transfer as linked automatically).
   */
  tierOf(id: string): ExposureTier {
    return this.tiers.get(id) === 'fleet' ? 'fleet' : 'linked'
  }

  /**
   * Set the session's tier. Members may opt up to fleet and back down to
   * linked; there is no tier below linked (D5) and no group-level knob
   * (D4 — group visibility derives from the strictest member).
   */
  setTier(id: string, tier: ExposureTier): void {
    if (tier === 'fleet') this.tiers.set(id, 'fleet')
    else this.tiers.delete(id)
    this.persist()
  }

  private persist(): void {
    if (this.path === '') return
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tiers: Record<string, ExposureTier> = {}
      for (const [id, tier] of this.tiers) tiers[id] = tier
      const snapshot: ExposureSnapshot = { tiers }
      writeFileSync(this.path, JSON.stringify(snapshot), { mode: 0o600 })
    } catch {
      // An unwritable home must not break tier changes; memory-only degradation.
    }
  }
}
