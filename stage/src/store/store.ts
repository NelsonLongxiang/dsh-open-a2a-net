import { create } from 'zustand'
import type { AccentColorName } from '@/design/tokens'
import type { OfficeCharacterName } from '@/scene/office/cast'

// The A2A adaptation re-implements only the sliver of the upstream hive
// store the floor reads: agents on the stage, selection, and the two UI
// toggles the scene consults. Everything else (hires, terminals, QA) is
// out of scope for this surface.

export type StatusKind =
  | 'idle' | 'thinking' | 'working' | 'waiting' | 'blocked' | 'success' | 'ghost'
  | 'compacting' | 'looping' | 'typing'

export interface Agent {
  id: string
  name: string
  character: OfficeCharacterName
  accent: AccentColorName
  description: string
  project: string
  status: StatusKind
  action: string
  progress: number
  isGod?: boolean
  lastPrompt?: string
  /** Tool prop the sprite holds while a step runs (mirrors upstream Agent). */
  carrying?: string
}

interface StageState {
  agents: Agent[]
  selectedId: string | null
  officeTheme: 'office'
  fullscreenAgentId: string | null
  ideOpen: boolean
  select: (id: string | null) => void
  applyFeed: (agents: Agent[]) => void
  requestCommandCenterTab: (_tab: string) => void
}

export const useStore = create<StageState>((set) => ({
  agents: [],
  selectedId: null,
  officeTheme: 'office',
  fullscreenAgentId: null,
  ideOpen: false,
  select: (id) => set({ selectedId: id }),
  applyFeed: (agents) => set({ agents }),
  requestCommandCenterTab: () => { /* headless stage: no command center */ },
}))