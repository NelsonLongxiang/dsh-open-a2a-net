// Placeholder tile atlases (#471). The office's pixel-art tilesets are licensed art that this package does not
// redistribute: the host serves them from a local directory when their licensee put them there, and the stage loads
// them from ./tiles/. Without them each atlas is replaced by one of the same size whose tiles are flat, muted blocks,
// so the Tiled map, the pathfinding and the seats work unchanged and the floor reads as a plan.

import { Texture } from 'pixi.js';

/** Muted plan colours; a tile's colour depends only on its index, so the same gid always looks the same. */
const PALETTE = ['#d9d4c7', '#cfc8b8', '#c4bca9', '#b9b3a3', '#aab0a8', '#9fa8a4', '#b8aa98', '#a99c8c'] as const;

/** The colour of one atlas tile: a stable pick from the palette by tile index. */
export function placeholderColor(index: number): string {
  // Knuth's multiplicative hash spreads neighbouring indices over the palette.
  const h = Math.imul(index + 1, 2654435761) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/**
 * An atlas texture of the given pixel size whose `tile`-sized cells are flat colours with a faint outline.
 * @param width - the original atlas width in pixels.
 * @param height - the original atlas height in pixels.
 * @param tile - the tile size in pixels.
 * @returns the placeholder texture (nearest-neighbour scaled, like the real atlases).
 */
export function placeholderTexture(width: number, height: number, tile = 16): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(tile, width);
  canvas.height = Math.max(tile, height);
  const g = canvas.getContext('2d');
  if (g !== null) {
    const columns = Math.floor(canvas.width / tile);
    for (let y = 0; y < canvas.height; y += tile) {
      for (let x = 0; x < canvas.width; x += tile) {
        g.fillStyle = placeholderColor((y / tile) * columns + x / tile);
        g.fillRect(x, y, tile, tile);
        g.strokeStyle = 'rgba(60, 56, 48, 0.18)';
        g.strokeRect(x + 0.5, y + 0.5, tile - 1, tile - 1);
      }
    }
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
}
