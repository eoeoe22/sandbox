import { AMBIENT_TEMP } from '../game/config';
import type { SnapshotFit } from '../game/config';
import { EMPTY } from '../game/engine/types';
import type { PersistedWorld } from './persistence';

/**
 * Placing a saved world onto a differently-sized sandbox.
 *
 * Snapshots are shared between people, and no two browsers agree on the grid
 * size: aspect ratio, screen resolution, the 해상도 (cell scale) setting and the
 * sidebar/bottom-bar layout all move it. Without this, a world saved on an
 * ultrawide monitor loads on a phone as "the bottom-left corner of the scene",
 * which reads as a broken save rather than a smaller one.
 *
 * Everything here is expressed as one **placement**: the scene is resampled to
 * `cw × ch` destination cells and blitted with its top-left corner at
 * `(offX, offY)`. Content past the destination edge is cropped; area the scene
 * doesn't reach stays empty. Every mode — automatic, 1:1, and whatever the user
 * dials in by hand — is just a different placement, so the load preview can show
 * the exact result by running the same code the apply does.
 *
 * The two halves are split (`resampleScene` then `placeScene`) because panning
 * doesn't change the resampled pixels: the load modal caches the scene and only
 * re-blits while the user drags, which is the difference between a smooth drag
 * and a stuttering one on a large world.
 */

/** Where a snapshot lands on the destination grid, in destination cells. */
export interface SnapshotPlacement {
  /** Size the scene is resampled to. Larger than the destination means the
   *  overflow is cropped. Always ≥ 1. */
  cw: number;
  ch: number;
  /** Top-left corner of the scene in destination coords. May be negative (the
   *  scene starts off the left/top edge). */
  offX: number;
  offY: number;
}

/** Widest/narrowest the manual scale control may go, as a multiple of the
 *  snapshot's original cell size. Wide enough to blow a small sketch up across a
 *  monitor or squeeze an ultrawide scene onto a phone, bounded so a stray drag
 *  can't ask for a billion-cell resample. */
export const SCALE_MIN = 0.125;
export const SCALE_MAX = 8;

/**
 * The placement a non-manual mode produces for this source/destination pair.
 *
 * - `auto`   — scale to fit, aspect preserved: the whole scene is visible and
 *              nothing is cropped, with the leftover area left empty.
 * - `simple` — no scaling at all (1:1 cells). Whatever overflows is cut; where
 *              the scene falls short, the difference stays empty.
 *
 * Both are centered horizontally and aligned to the floor — gravity points down,
 * so a pile that had settled on the ground still sits on the ground rather than
 * hanging in mid-air.
 *
 * `manual` has no canonical answer (it's whatever the user dialled in); it seeds
 * from `auto`, so that's what this returns for it.
 */
export function autoPlacement(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  mode: SnapshotFit,
): SnapshotPlacement {
  let cw: number;
  let ch: number;
  if (mode === 'simple') {
    cw = srcW;
    ch = srcH;
  } else {
    const scale = Math.min(dstW / srcW, dstH / srcH);
    cw = Math.max(1, Math.round(srcW * scale));
    ch = Math.max(1, Math.round(srcH * scale));
  }
  return centered(cw, ch, dstW, dstH);
}

/** Center a scene of `cw × ch` horizontally and sit it on the floor. */
export function centered(
  cw: number,
  ch: number,
  dstW: number,
  dstH: number,
): SnapshotPlacement {
  return { cw, ch, offX: Math.round((dstW - cw) / 2), offY: dstH - ch };
}

/** Clamp a placement to something the resampler can actually build: at least one
 *  cell per axis, and no larger than the scale ceiling allows. */
export function clampPlacement(p: SnapshotPlacement, srcW: number, srcH: number): SnapshotPlacement {
  const maxW = Math.max(1, Math.round(srcW * SCALE_MAX));
  const maxH = Math.max(1, Math.round(srcH * SCALE_MAX));
  return {
    cw: Math.min(maxW, Math.max(1, Math.round(p.cw))),
    ch: Math.min(maxH, Math.max(1, Math.round(p.ch))),
    offX: Math.round(p.offX),
    offY: Math.round(p.offY),
  };
}

/**
 * Resample `src` to exactly `cw × ch` cells.
 *
 * Cell ids are decided by a **majority vote** over the source rectangle each
 * destination cell covers. Empty counts as an ordinary candidate: preferring
 * material would turn a downscaled dust cloud into a solid block, which is a
 * worse lie than losing a thin wire. When the rectangle is narrower than one
 * source cell (an upscale) the vote degenerates to nearest-neighbour, so
 * enlarging never invents a material that wasn't there.
 *
 * Returns `src` itself when it's already the requested size, so a 1:1 placement
 * — and the common "loaded on the machine that saved it" case — costs nothing.
 */
export function resampleScene(src: PersistedWorld, cw: number, ch: number): PersistedWorld {
  if (src.w === cw && src.h === ch) return src;

  const size = cw * ch;
  const cells = new Uint8Array(size);
  const temp = new Float32Array(size).fill(AMBIENT_TEMP);
  const aux = src.aux ? new Uint16Array(size) : undefined;
  const overlay = src.overlay ? new Uint8Array(size) : undefined;
  const overlayAux = src.overlayAux ? new Uint16Array(size) : undefined;

  // Vote counters for one destination cell, indexed by material id. Only the ids
  // actually seen are reset between cells, so this stays O(area) overall instead
  // of O(area × 256).
  const counts = new Int32Array(256);
  const touched: number[] = [];

  for (let dy = 0; dy < ch; dy++) {
    // Source rows this destination row covers. `y1` is exclusive and always at
    // least one past `y0`, so an upscale (rect narrower than a cell) samples one
    // cell rather than none.
    const y0 = Math.min(src.h - 1, Math.floor((dy * src.h) / ch));
    const y1 = Math.max(y0 + 1, Math.min(src.h, Math.ceil(((dy + 1) * src.h) / ch)));
    const cy = (y0 + y1 - 1) / 2;

    for (let dx = 0; dx < cw; dx++) {
      const x0 = Math.min(src.w - 1, Math.floor((dx * src.w) / cw));
      const x1 = Math.max(x0 + 1, Math.min(src.w, Math.ceil(((dx + 1) * src.w) / cw)));
      const cx = (x0 + x1 - 1) / 2;

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
      // conductor id, a Clone's adopted material), so a blended value would be a
      // different, meaningless state. The representative is the winning cell
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

      const di = dy * cw + dx;
      cells[di] = winner;
      temp[di] = src.temp[rep];
      if (aux && src.aux) aux[di] = src.aux[rep];
      if (overlay && src.overlay) overlay[di] = src.overlay[rep];
      if (overlayAux && src.overlayAux) overlayAux[di] = src.overlayAux[rep];
    }
  }

  return { w: cw, h: ch, cells, temp, aux, overlay, overlayAux };
}

/**
 * The part of `scene` that actually lands on a `dstW × dstH` destination at
 * `(offX, offY)`, as a half-open rectangle in scene coords. Shared by the blit
 * below and by the load modal's preview so the two can't drift apart — the
 * preview is only honest if it clips exactly where the apply does.
 */
export function sceneClip(
  sceneW: number,
  sceneH: number,
  dstW: number,
  dstH: number,
  offX: number,
  offY: number,
): { sx0: number; sy0: number; sx1: number; sy1: number } {
  return {
    sx0: Math.max(0, -offX),
    sy0: Math.max(0, -offY),
    sx1: Math.min(sceneW, dstW - offX),
    sy1: Math.min(sceneH, dstH - offY),
  };
}

/**
 * Blit an already-resampled `scene` into a `dstW × dstH` world with its top-left
 * corner at `(offX, offY)`. The overlap is clipped on all four sides, so a scene
 * larger than the destination is cropped and one smaller leaves empty margin —
 * which is exactly the "자르기 / 공백으로 늘리기" behavior, with no separate code
 * path for either.
 */
export function placeScene(
  scene: PersistedWorld,
  dstW: number,
  dstH: number,
  offX: number,
  offY: number,
): PersistedWorld {
  if (scene.w === dstW && scene.h === dstH && offX === 0 && offY === 0) return scene;

  const size = dstW * dstH;
  const cells = new Uint8Array(size);
  const temp = new Float32Array(size).fill(AMBIENT_TEMP);
  const aux = scene.aux ? new Uint16Array(size) : undefined;
  const overlay = scene.overlay ? new Uint8Array(size) : undefined;
  const overlayAux = scene.overlayAux ? new Uint16Array(size) : undefined;

  const { sx0, sy0, sx1, sy1 } = sceneClip(scene.w, scene.h, dstW, dstH, offX, offY);

  for (let sy = sy0; sy < sy1; sy++) {
    const srcRow = sy * scene.w;
    const dstRow = (sy + offY) * dstW + offX;
    const w = sx1 - sx0;
    if (w <= 0) break;
    cells.set(scene.cells.subarray(srcRow + sx0, srcRow + sx1), dstRow + sx0);
    temp.set(scene.temp.subarray(srcRow + sx0, srcRow + sx1), dstRow + sx0);
    if (aux && scene.aux) aux.set(scene.aux.subarray(srcRow + sx0, srcRow + sx1), dstRow + sx0);
    if (overlay && scene.overlay)
      overlay.set(scene.overlay.subarray(srcRow + sx0, srcRow + sx1), dstRow + sx0);
    if (overlayAux && scene.overlayAux)
      overlayAux.set(scene.overlayAux.subarray(srcRow + sx0, srcRow + sx1), dstRow + sx0);
  }

  return { w: dstW, h: dstH, cells, temp, aux, overlay, overlayAux };
}

/**
 * Resample + place in one call: the world that would land on a `dstW × dstH`
 * sandbox under `placement`. The load preview and the apply both go through
 * here, so what the user sees is what they get.
 */
export function fitWorld(
  src: PersistedWorld,
  dstW: number,
  dstH: number,
  placement: SnapshotPlacement,
): PersistedWorld {
  const p = clampPlacement(placement, src.w, src.h);
  return placeScene(resampleScene(src, p.cw, p.ch), dstW, dstH, p.offX, p.offY);
}
