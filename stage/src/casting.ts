import type { AccentColorName } from '@/design/tokens'
import type { OfficeCharacterName } from '@/scene/office/cast'

/** Rotation pools so each A2A node gets a stable, distinct floor identity. */
export const CHARACTERS: OfficeCharacterName[] = [
  'michael', 'dwight', 'jim', 'pam', 'stanley', 'kevin',
  'angela', 'oscar', 'phyllis', 'meredith', 'creed', 'ryan',
] as OfficeCharacterName[]

export const ACCENTS: AccentColorName[] = [
  'coral', 'mint', 'sky', 'lemon', 'lilac', 'peach',
] as AccentColorName[]