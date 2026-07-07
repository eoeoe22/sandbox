import {
  $selectedMaterial,
  $brushSize,
  $brushShape,
  $brushMode,
  $tool,
  $overwriteLevel,
  $running,
  $borderMode,
  type BrushShape,
  type BrushMode,
  type Tool,
} from './store';
import { getMaterial } from '../game/materials';
import {
  AMBIENT_TEMP,
  BRUSH_MIN,
  BRUSH_MAX,
  OVERWRITE_LEVEL_MIN,
  OVERWRITE_LEVEL_MAX,
} from '../game/config';
import { EMPTY, type BorderMode } from '../game/engine/types';
import type { Grid } from '../game/engine/Grid';
import type { SandboxLayout, AspectMode } from '../game/layout';

// localStorage persistence for the whole session: every control-panel setting
// and the world itself (cells + temperatures + sandbox size), so a reload
// resumes exactly where the user left off.
//
// Everything here is best-effort: storage can be missing (SSR), disabled
// (privacy modes), or full (quota) — all of those degrade to "runs like
// before, just without persistence" rather than throwing.

const SETTINGS_KEY = 'particle-sandbox:settings:v1';
const WORLD_KEY = 'particle-sandbox:world:v1';

function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null; // blocked storage or corrupt JSON — treat as "nothing saved"
  }
}

function writeString(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false; // quota exceeded / storage blocked
  }
}

// ---------------------------------------------------------------------------
// Settings (brush, tool, overwrite level, border mode, play/pause)
// ---------------------------------------------------------------------------

const BRUSH_SHAPES: readonly BrushShape[] = ['circle', 'square'];
const BRUSH_MODES: readonly BrushMode[] = ['full', 'particle'];
const TOOLS: readonly Tool[] = ['material', 'heat', 'cool', 'mix'];
const BORDER_MODES: readonly BorderMode[] = ['wall', 'void'];

/** Round + clamp a persisted number, falling back when it isn't a finite number. */
function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const n = Math.round(v);
  return n < lo ? lo : n > hi ? hi : n;
}

function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** Apply saved settings to the atoms. Every field is validated independently,
 *  so one corrupt value falls back to its default without dropping the rest. */
function hydrateSettings(): void {
  const raw = readJson(SETTINGS_KEY);
  if (!raw || typeof raw !== 'object') return;
  const s = raw as Record<string, unknown>;

  // A saved material id must still exist in the registry (a future version
  // could remove one) — otherwise keep the default selection.
  const mat = clampInt(s.selectedMaterial, 0, 255, -1);
  if (mat >= 0 && getMaterial(mat)) $selectedMaterial.set(mat);

  $brushSize.set(clampInt(s.brushSize, BRUSH_MIN, BRUSH_MAX, $brushSize.get()));
  $brushShape.set(oneOf(s.brushShape, BRUSH_SHAPES, $brushShape.get()));
  $brushMode.set(oneOf(s.brushMode, BRUSH_MODES, $brushMode.get()));
  $tool.set(oneOf(s.tool, TOOLS, $tool.get()));
  $overwriteLevel.set(
    clampInt(s.overwriteLevel, OVERWRITE_LEVEL_MIN, OVERWRITE_LEVEL_MAX, $overwriteLevel.get()),
  );
  $borderMode.set(oneOf(s.borderMode, BORDER_MODES, $borderMode.get()));
  if (typeof s.running === 'boolean') $running.set(s.running);
}

function saveSettings(): void {
  writeString(
    SETTINGS_KEY,
    JSON.stringify({
      selectedMaterial: $selectedMaterial.get(),
      brushSize: $brushSize.get(),
      brushShape: $brushShape.get(),
      brushMode: $brushMode.get(),
      tool: $tool.get(),
      overwriteLevel: $overwriteLevel.get(),
      borderMode: $borderMode.get(),
      running: $running.get(),
    }),
  );
}

let settingsInitialized = false;

/**
 * Restore saved settings into the store, then keep localStorage in sync with
 * every subsequent change. Call once on startup, before anything subscribes to
 * the atoms for side effects (Game.ts seeds the engine from `$borderMode` via
 * subscribe, so hydrating first means it seeds with the restored value).
 *
 * Writes are debounced (a slider drag emits many changes per second) and
 * flushed when the tab is hidden or closed.
 */
export function initSettingsPersistence(): void {
  if (!storageAvailable() || settingsInitialized) return;
  settingsInitialized = true;

  hydrateSettings();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      saveSettings();
    }, 200);
  };
  const flush = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    saveSettings();
  };

  // listen (not subscribe): only user changes should write, not the hydration
  // we just performed.
  $selectedMaterial.listen(schedule);
  $brushSize.listen(schedule);
  $brushShape.listen(schedule);
  $brushMode.listen(schedule);
  $tool.listen(schedule);
  $overwriteLevel.listen(schedule);
  $borderMode.listen(schedule);
  $running.listen(schedule);

  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

// ---------------------------------------------------------------------------
// World (grid cells + temperatures + sandbox size)
// ---------------------------------------------------------------------------
//
// The grid is stored as run-length-encoded binary, base64'd into a JSON
// envelope. RLE keeps the common case (large uniform regions of Empty/settled
// material at ambient temperature) tiny, and the worst case (pure noise at the
// 130k-cell budget: 2 B/cell for ids + 4 B/cell for temps, ~1.1 MB of base64)
// still fits comfortably inside every browser's localStorage quota.

/** Temperatures are quantized to 0.1° steps in an int16 (range ±3276.7 — the
 *  brush clamps at [-50, 2000], so gameplay values fit with headroom). Blast's
 *  encoded life/direction values are small integers, so they survive the
 *  round-trip exactly. */
const TEMP_SCALE = 10;

/** Sanity cap on `w*h` from a saved envelope, so corrupt data can't make us
 *  allocate absurd buffers. Generously above MAX_CELLS. */
const MAX_SAVED_CELLS = 4_000_000;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; // stay under the engine's argument-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Cell ids → [value u8, run u8(1..255)] pairs. */
function encodeCellsRle(cells: Uint8Array): Uint8Array {
  const out = new Uint8Array(cells.length * 2);
  let o = 0;
  let i = 0;
  while (i < cells.length) {
    const v = cells[i];
    let run = 1;
    while (run < 255 && i + run < cells.length && cells[i + run] === v) run++;
    out[o++] = v;
    out[o++] = run;
    i += run;
  }
  return out.slice(0, o);
}

function decodeCellsRle(bytes: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size); // starts EMPTY (0)
  let o = 0;
  for (let i = 0; i + 1 < bytes.length && o < size; i += 2) {
    const run = Math.min(bytes[i + 1], size - o);
    out.fill(bytes[i], o, o + run);
    o += run;
  }
  return out;
}

/**
 * Quantize temperatures for storage. Empty cells are always stored at ambient:
 * their temperature is physically inert (Empty has zero conductivity), and this
 * scrubs Blast's crater markers — those encode the tick they were stamped
 * (see blast.ts), which would read as "freshly cratered" for a long time
 * against the fresh session's restarted tick counter.
 */
function quantizeTemps(cells: Uint8Array, temp: Float32Array): Int16Array {
  const q = new Int16Array(temp.length);
  const ambient = AMBIENT_TEMP * TEMP_SCALE;
  for (let i = 0; i < temp.length; i++) {
    if (cells[i] === EMPTY) {
      q[i] = ambient;
      continue;
    }
    let v = Math.round(temp[i] * TEMP_SCALE);
    if (v > 32767) v = 32767;
    else if (v < -32768) v = -32768;
    q[i] = v;
  }
  return q;
}

/** Quantized temps → [value i16, run u16(1..65535)] pairs, little-endian. */
function encodeTempRle(q: Int16Array): Uint8Array {
  const buf = new Uint8Array(q.length * 4);
  const view = new DataView(buf.buffer);
  let o = 0;
  let i = 0;
  while (i < q.length) {
    const v = q[i];
    let run = 1;
    while (run < 0xffff && i + run < q.length && q[i + run] === v) run++;
    view.setInt16(o, v, true);
    view.setUint16(o + 2, run, true);
    o += 4;
    i += run;
  }
  return buf.slice(0, o);
}

function decodeTempRle(bytes: Uint8Array, size: number): Float32Array {
  const out = new Float32Array(size).fill(AMBIENT_TEMP);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  for (let i = 0; i + 3 < bytes.length && o < size; i += 4) {
    const v = view.getInt16(i, true) / TEMP_SCALE;
    const run = Math.min(view.getUint16(i + 2, true), size - o);
    out.fill(v, o, o + run);
    o += run;
  }
  return out;
}

interface PersistedAspect {
  mode: AspectMode;
  /** The layout's size *intent* in CSS px (see SandboxLayout.wantW/H). */
  w: number;
  h: number;
}

export interface PersistedWorld {
  w: number;
  h: number;
  cells: Uint8Array;
  temp: Float32Array;
  aspect: PersistedAspect | null;
}

let lastWorldJson: string | null = null;

/**
 * Snapshot the grid (+ the sandbox-size intent) into localStorage. Cheap enough
 * to call on an interval: one pass over the two arrays, and the write is
 * skipped entirely when nothing changed since the last save.
 */
export function saveWorld(grid: Grid, layout: SandboxLayout): void {
  if (!storageAvailable()) return;
  const json = JSON.stringify({
    v: 1,
    w: grid.width,
    h: grid.height,
    cells: bytesToBase64(encodeCellsRle(grid.cells)),
    temp: bytesToBase64(encodeTempRle(quantizeTemps(grid.cells, grid.temp))),
    aspect: layout.sizeIntent(),
  });
  if (json === lastWorldJson) return;
  if (writeString(WORLD_KEY, json)) lastWorldJson = json;
}

function parseAspect(v: unknown): PersistedAspect | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as Record<string, unknown>;
  if (a.mode !== 'device' && a.mode !== 'custom') return null;
  if (typeof a.w !== 'number' || !Number.isFinite(a.w) || a.w <= 0) return null;
  if (typeof a.h !== 'number' || !Number.isFinite(a.h) || a.h <= 0) return null;
  return { mode: a.mode, w: a.w, h: a.h };
}

/**
 * Load the saved world, or null when there is none (or it fails validation).
 * Restored cells are sanitized: ids no longer in the material registry become
 * Empty, and Empty cells sit at ambient temperature — so a stale or corrupt
 * save can't feed the simulation values it was never written to handle.
 */
export function loadWorld(): PersistedWorld | null {
  if (!storageAvailable()) return null;
  const raw = readJson(WORLD_KEY);
  if (!raw || typeof raw !== 'object') return null;
  const j = raw as Record<string, unknown>;
  if (j.v !== 1) return null;
  const w = typeof j.w === 'number' && Number.isInteger(j.w) ? j.w : 0;
  const h = typeof j.h === 'number' && Number.isInteger(j.h) ? j.h : 0;
  if (w < 1 || h < 1 || w * h > MAX_SAVED_CELLS) return null;
  if (typeof j.cells !== 'string' || typeof j.temp !== 'string') return null;

  let cells: Uint8Array;
  let temp: Float32Array;
  try {
    cells = decodeCellsRle(base64ToBytes(j.cells), w * h);
    temp = decodeTempRle(base64ToBytes(j.temp), w * h);
  } catch {
    return null; // invalid base64
  }

  for (let i = 0; i < cells.length; i++) {
    if (!getMaterial(cells[i])) cells[i] = EMPTY;
    if (cells[i] === EMPTY) temp[i] = AMBIENT_TEMP;
  }

  return { w, h, cells, temp, aspect: parseAspect(j.aspect) };
}
