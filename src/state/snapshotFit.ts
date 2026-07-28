import { AMBIENT_TEMP } from '../game/config';
import type { SnapshotFit } from '../game/config';
import { EMPTY } from '../game/engine/types';
import type { PersistedWorld } from './persistence';

/**
 * Resampling a saved world onto a differently-sized sandbox.
 *
 * Snapshots are shared between people, and no two browsers agree on the grid
 * size: aspect ratio, screen resolution, the 해상도 (cell scale) setting and the
 * sidebar/bottom-bar layout all move it. Without this, a world saved on an
 * ultrawide monitor loads on a phone as "the bottom-left corner of the scene",
 * which reads as a broken save rather than a smaller one.
 *
 * `crop` keeps the old behavior (hand the source straight to `Grid.resizeFrom`,
 * which copies bottom-left anchored). `fit`/`stretch` rescale here first and
 * hand back a world already at the target size, so the copy afterwards is exact.
 */

/**
 * Rescale `src` so it can be applied to a `dstW × dstH` sandbox under `mode`.
 *
 * `crop` returns the source unchanged — the caller's `resizeFrom` already
 * implements it. `fit`/`stretch` return a fresh world at exactly the target
 * size, with the resampled scene floor-aligned (and horizontally centered under
 * `fit`) so a pile that had settled on the ground still sits on the ground.
 *
 * Returns the source object itself when no work is needed (already the right
 * size, or `crop`), so the common "loaded on the same machine that saved it"
 * path costs nothing.
 */
export function fitWorld(
  src: PersistedWorld,
  dstW: number,
  dstH: number,
  mode: SnapshotFit,
): PersistedWorld {
  if (mode === 'crop') return src;
  if (dstW < 1 || dstH < 1) return src;
  if (src.w === dstW && src.h === dstH) return src;

  // Size of the resampled scene inside the target grid. `stretch` fills it;
  // `fit` keeps the source aspect ratio, so one axis is short of the target.
  let cw = dstW;
  let ch = dstH;
  if (mode === 'fit') {
    const scale = Math.min(dstW / src.w, dstH / src.h);
    cw = Math.min(dstW, Math.max(1, Math.round(src.w * scale)));
    ch = Math.min(dstH, Math.max(1, Math.round(src.h * scale)));
  }
  // Centered horizontally, aligned to the floor: gravity points down, so the
  // empty margin belongs above the scene, not below it.
  const offX = (dstW - cw) >> 1;
  const offY = dstH - ch;

  const size = dstW * dstH;
  const cells = new Uint8Array(size);
  const temp = new Float32Array(size).fill(AMBIENT_TEMP);
  const aux = src.aux ? new Uint16Array(size) : undefined;
  const overlay = src.overlay ? new Uint8Array(size) : undefined;
  const overlayAux = src.overlayAux ? new Uint16Array(size) : undefined;

  // Vote counters for one destination cell, indexed by material id. Only the
  // ids actually seen are reset between cells, so this stays O(area) overall
  // instead of O(area × 256).
  const counts = new Int32Array(256);
  const touched: number[] = [];

  for (let dy = 0; dy < ch; dy++) {
    // Source rows this destination row covers. `y1` is exclusive and always at
    // least one past `y0`, so an upscale (rect narrower than a cell) degrades to
    // nearest-neighbour instead of sampling nothing.
    const y0 = Math.min(src.h - 1, Math.floor((dy * src.h) / ch));
    const y1 = Math.max(y0 + 1, Math.min(src.h, Math.ceil(((dy + 1) * src.h) / ch)));
    const cy = (y0 + y1 - 1) / 2;

    for (let dx = 0; dx < cw; dx++) {
      const x0 = Math.min(src.w - 1, Math.floor((dx * src.w) / cw));
      const x1 = Math.max(x0 + 1, Math.min(src.w, Math.ceil(((dx + 1) * src.w) / cw)));
      const cx = (x0 + x1 - 1) / 2;

      // Majority vote over the covered source cells. Empty counts as an
      // ordinary candidate: preferring material would turn a downscaled dust
      // cloud into a solid block, which is a worse lie than losing a thin wire.
      let winner = EMPTY;
      let best = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * src.w;
        for (let sx = x0; sx < x1; sx++) {
          const id = src.cells[row + sx];
          if (counts[id] === 0) touched.push(id);
          const n = ++counts[id];
          if (n > best) {
            best = n;
            winner = id;
          }
        }
      }
      for (let i = 0; i < touched.length; i++) counts[touched[i]] = 0;
      touched.length = 0;

      // Copy every plane from one representative source cell rather than
      // averaging: `aux`/`overlayAux` are bit-packed state words (a Spark's
      // conductor id, a Clone's adopted material), so a blended value would be
      // a different, meaningless state. The representative is the winning cell
      // nearest the sample centre, which keeps the picked temperature and state
      // consistent with the id that won.
      let rep = -1;
      let repDist = Infinity;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * src.w;
        const ddy = sy - cy;
        for (let sx = x0; sx < x1; sx++) {
          if (src.cells[row + sx] !== winner) continue;
          const ddx = sx - cx;
          const d = ddx * ddx + ddy * ddy;
          if (d < repDist) {
            repDist = d;
            rep = row + sx;
          }
        }
      }
      if (rep < 0) continue; // unreachable (the winner came from this rect)

      const di = (offY + dy) * dstW + offX + dx;
      cells[di] = winner;
      temp[di] = src.temp[rep];
      if (aux && src.aux) aux[di] = src.aux[rep];
      if (overlay && src.overlay) overlay[di] = src.overlay[rep];
      if (overlayAux && src.overlayAux) overlayAux[di] = src.overlayAux[rep];
    }
  }

  return { w: dstW, h: dstH, cells, temp, aux, overlay, overlayAux };
}
