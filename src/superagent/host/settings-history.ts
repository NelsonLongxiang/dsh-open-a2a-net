/**
 * superagent: the team's settings-save history (the team page's 设置, mirroring upstream's settings history).
 *
 * Every successful settings write records one row: who saved, when, and which fields changed with their old and new
 * values. Values are shown, not parsed; long text is clipped. The record lives with the team's state directory, so each
 * team on an instance keeps its own. Nothing here decides who may save: the control route does.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/settings-history
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** How many rows are kept: the recent record a person reads, not an archive. */
export const SETTINGS_HISTORY_KEPT = 50
/** How much of one value is shown. */
export const VALUE_CLIP = 160

/** One changed field, as a person reads it. */
export interface FieldChange { readonly field: string; readonly from: string; readonly to: string }

/** One settings save. */
export interface SettingsSave {
  readonly id: string
  readonly at: string
  readonly by: string
  readonly changes: readonly FieldChange[]
}

/** How a value reads in a row: strings as they are, everything else as compact JSON, clipped. */
export const valueText = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  return text.length > VALUE_CLIP ? `${text.slice(0, VALUE_CLIP)}…` : text
}

const clipText = (text: string): string => valueText(text)

/**
 * The settings saves a team keeps, newest first.
 */
export class SettingsHistory {
  private rows: SettingsSave[]
  constructor(private readonly path: string) {
    let loaded: SettingsSave[] = []
    try { if (existsSync(path)) loaded = JSON.parse(readFileSync(path, 'utf8')) as SettingsSave[] } catch { loaded = [] }
    this.rows = Array.isArray(loaded) ? loaded.filter(row => row !== null && typeof row === 'object' && Array.isArray(row.changes)) : []
  }

  /** The recent saves, newest first. */
  list(): readonly SettingsSave[] { return [...this.rows] }

  /**
   * Record one save: the fields whose serialized value moved, old to new.
   * @param at - when the save happened.
   * @param by - who saved it (the workbench's word for the saver).
   * @param before - the settings as they were.
   * @param after - the settings as they are now.
   */
  record(at: string, by: string, before: Record<string, unknown>, after: Record<string, unknown>): void {
    const changes: FieldChange[] = []
    for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const from = valueText(before[field] ?? null)
      const to = valueText(after[field] ?? null)
      if (from !== to) changes.push({ field, from: clipText(from), to: clipText(to) })
    }
    if (changes.length === 0) return
    this.rows = [{ id: randomUUID(), at, by, changes }, ...this.rows].slice(0, SETTINGS_HISTORY_KEPT)
    this.save()
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.rows), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.path) } finally { rmSync(temporary, { force: true }) }
  }
}
