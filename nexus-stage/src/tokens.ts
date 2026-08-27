/**
 * A2A Nexus design tokens.
 * Three-layer: primitive(C) -> semantic(S) -> component-level inline styles.
 */

export const C = {
  bg0: '#060a12',
  bg1: '#0d1322',
  ink: '#dde3f0',
  inkMuted: '#7a86a0',
  accent: '#8b5cf6',
  liveGreen: '#4ade80',
  coldGrey: '#4a5568',
  lineFederal: '#6366f1',
  membershipLine: '#22d3ee',
} as const;

/**
 * Semantic layer: the scene-facing names the viewer actually consumes,
 * each pinned to its primitive above. This is the `S` main.ts reached for
 * as `T.S.*` — the layer was documented but never exported, so every seat
 * attempt threw and cycle()'s empty catch buried it: an eternally empty
 * stage behind a healthy-looking render loop.
 */
export const S = {
  /** Mesh color + emissive for live session nodes (primitive liveGreen). */
  nodeLive: 0x4ade80,
  /** Mesh color + emissive for cold/joined-offline nodes (primitive coldGrey). */
  nodeCold: 0x4a5568,
} as const;

export const FRAME_HUES = [0x8b5cf6, 0x3b82f6, 0x14b8a6, 0xf59e0b, 0xec4899, 0x84cc16];