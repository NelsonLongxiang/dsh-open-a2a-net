/** Stable team hue shared by canvas and roster frames. */
import { FRAME_HUES } from './tokens'

export function frameHue(name: string): { line: string; bg: string } {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h * 31 + name.charCodeAt(i)) & 0xfffffff) >>> 0
  const rgb = FRAME_HUES[h % FRAME_HUES.length]!
  const line = "#" + rgb.toString(16).padStart(6, "0")
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = rgb & 0xff
  return { line, bg: `rgba(${r},${g},${b},0.05)` }
}
