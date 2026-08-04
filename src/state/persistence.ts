import {
  $selectedMaterial,
  $brushSize,
  $brushShape,
  $brushMode,
  $tool,
  $overwriteLevel,
  $running,
  $borderMode,
  $simSpeed,
  $smokeLevel,
  $blendBrush,
  $gravityDir,
  $gravityStrength,
  $cellScale,
  $heatOverlay,
  $gridDivision,
  $bottomDeadzone,
  $favorites,
  $recentPicks,
  OBJECT_KINDS,
  $heatRateMode,
  $heatAbsoluteRate,
  $heatRelativeRate,
  $snapshotFit,
  type BrushShape,
  type BrushMode,
  type Tool,
  type BlendComponent,
  type ObjectKind,
  type RecentPick,
} from './store';
import { $locale, LOCALES, type Locale } from '../i18n';
import { syncHtmlLang } from '../i18n';
import { getMaterial, isPaletteMaterial, MATERIALS } from '../game/materials';
import {
  AMBIENT_TEMP,
  BRUSH_MIN,
  BRUSH_MAX,
  OVERWRITE_LEVEL_MIN,
  OVERWRITE_LEVEL_MAX,
  OVERWRITE_AUTO,
  SIM_SPEEDS,
  SMOKE_LEVELS,
  BLEND_MAX_SLOTS,
  BLEND_RATIO_STEP,
  GRAVITY_DIRS,
  GRAVITY_STRENGTH_MIN,
  GRAVITY_STRENGTH_MAX,
  CELL_SCALES,
  GRID_DIVISIONS,
  BOTTOM_DEADZONE_MIN,
  BOTTOM_DEADZONE_MAX,
  BOTTOM_DEADZONE_DEFAULT,
  RECENT_MATERIALS_MAX,
  HEAT_ABS_RATE_MIN,
  HEAT_ABS_RATE_MAX,
  HEAT_REL_RATE_MIN,
  HEAT_REL_RATE_MAX,
  SNAPSHOT_FITS,
} from '../game/config';
import type { SimSpeed, SmokeLevel, HeatRateMode, SnapshotFit } from '../game/config';
import { EMPTY, type BorderMode } from '../game/engine/types';
import type { Grid } from '../game/engine/Grid';
import type { SimBody, DrumPart, DrumFill, DrumState, WoodBoxPart } from '../game/engine/objects';

// localStorage persistence for the whole session: every control-panel setting
// and the world itself (cells + temperatures), so a reload resumes exactly
// where the user left off.
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
const TOOLS: readonly Tool[] = [
  'material',
  'heat',
  'cool',
  'mix',
  'erase',
  'blend',
  'spark',
  'shock',
  'object',
  'view',
];
const BORDER_MODES: readonly BorderMode[] = ['wall', 'void'];
const SIM_SPEED_VALUES: readonly SimSpeed[] = SIM_SPEEDS;
const HEAT_RATE_MODES: readonly HeatRateMode[] = ['absolute', 'relative'];
const SNAPSHOT_FIT_VALUES: readonly SnapshotFit[] = SNAPSHOT_FITS;
/** Mode names from the first version of the snapshot-fit setting, before the
 *  load modal replaced the three fixed modes with auto/manual/simple. `stretch`
 *  has no like-for-like successor — it maps to `manual`, where filling both axes
 *  is one preset button away. */
const LEGACY_SNAPSHOT_FITS: Record<string, SnapshotFit> = {
  fit: 'auto',
  crop: 'simple',
  stretch: 'manual',
};

function parseSnapshotFit(v: unknown): SnapshotFit {
  if (typeof v === 'string' && v in LEGACY_SNAPSHOT_FITS) return LEGACY_SNAPSHOT_FITS[v];
  return oneOf(v, SNAPSHOT_FIT_VALUES, $snapshotFit.get());
}

// The "is this id one the palette offers?" gate every reader below shares, so a
// restored blend can't reference a material with no matching <option> and a
// corrupt favorites list can't smuggle a hidden cell into the quick-access bar.
// It lives in game/materials now rather than as a local Set, because the 스포이드
// (휠클릭) asks the same question of the world and the two answers must be the
// same one.

/**
 * Validate a persisted blend-brush config. Accepts it only if it's a 2..MAX list
 * of {id, ratio} matching the exact invariant the editor maintains: every id is a
 * palette material, every ratio is a positive multiple of the step, and the ratios
 * sum to 100. Anything else (corrupt or hand-edited) returns null so the default
 * blend is kept.
 */
function parseBlend(v: unknown): BlendComponent[] | null {
  if (!Array.isArray(v) || v.length < 2 || v.length > BLEND_MAX_SLOTS) return null;
  const out: BlendComponent[] = [];
  let sum = 0;
  for (const item of v) {
    if (!item || typeof item !== 'object') return null;
    const id = (item as { id?: unknown }).id;
    const ratio = (item as { ratio?: unknown }).ratio;
    if (typeof id !== 'number' || !isPaletteMaterial(id)) return null;
    if (
      typeof ratio !== 'number' ||
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      ratio % BLEND_RATIO_STEP !== 0
    )
      return null;
    out.push({ id, ratio });
    sum += ratio;
  }
  return sum === 100 ? out : null;
}

/** Round + clamp a persisted number, falling back when it isn't a finite number. */
function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const n = Math.round(v);
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Validate a persisted overwrite level. Accepts the AUTO sentinel (-1) or any
 * integer in the manual range; falls back to the current atom value otherwise
 * (so a corrupt or pre-AUTO save keeps the live default rather than coercing
 * to a wrong level).
 */
function clampOverwrite(v: unknown, fallback: number): number {
  if (v === OVERWRITE_AUTO) return OVERWRITE_AUTO;
  return clampInt(v, OVERWRITE_LEVEL_MIN, OVERWRITE_LEVEL_MAX, fallback);
}

/** Clamp a persisted float into [lo, hi], falling back when not a finite number. */
function clampFloat(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v < lo ? lo : v > hi ? hi : v;
}

function oneOf<T>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/**
 * Parse a persisted list of material ids (favorites / recents). Keeps only
 * finite integer ids that belong to the curated palette (`isPaletteMaterial`), drops
 * duplicates, and caps the length. Anything malformed yields an empty list
 * rather than throwing.
 */
function parseIdList(v: unknown, cap: number): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of v) {
    if (typeof item !== 'number' || !Number.isInteger(item)) continue;
    // Validate against the curated palette, not the whole registry: some
    // registered ids (Ember, Spark, Debris, the Eraser, …) are deliberately kept
    // out of MATERIALS and must never surface in the quick-access bar. Reuses the
    // same gate parseBlend relies on.
    if (seen.has(item) || !isPaletteMaterial(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Parse the persisted recent-picks list. Same contract as `parseIdList`, widened
 * to the two things the palette can paint: numbers are material ids (gated by
 * `isPaletteMaterial` as before) and strings are object kinds (gated by OBJECT_KINDS).
 * A save written before objects joined the list holds numbers only and survives
 * untouched; an unknown kind string from a hand-edited save is dropped.
 */
function parseRecentList(v: unknown, cap: number): RecentPick[] {
  if (!Array.isArray(v)) return [];
  const out: RecentPick[] = [];
  const seen = new Set<RecentPick>();
  for (const item of v) {
    let pick: RecentPick;
    if (typeof item === 'number' && Number.isInteger(item) && isPaletteMaterial(item)) {
      pick = item;
    } else if (typeof item === 'string' && OBJECT_KINDS.includes(item as ObjectKind)) {
      pick = item as ObjectKind;
    } else {
      continue;
    }
    if (seen.has(pick)) continue;
    seen.add(pick);
    out.push(pick);
    if (out.length >= cap) break;
  }
  return out;
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
  $heatRateMode.set(oneOf(s.heatRateMode, HEAT_RATE_MODES, $heatRateMode.get()));
  $heatAbsoluteRate.set(clampFloat(s.heatAbsoluteRate, HEAT_ABS_RATE_MIN, HEAT_ABS_RATE_MAX, $heatAbsoluteRate.get()));
  $heatRelativeRate.set(clampFloat(s.heatRelativeRate, HEAT_REL_RATE_MIN, HEAT_REL_RATE_MAX, $heatRelativeRate.get()));
  $overwriteLevel.set(
    clampOverwrite(s.overwriteLevel, $overwriteLevel.get()),
  );
  $borderMode.set(oneOf(s.borderMode, BORDER_MODES, $borderMode.get()));
  $simSpeed.set(oneOf(s.simSpeed, SIM_SPEED_VALUES, $simSpeed.get()));
  if (typeof s.running === 'boolean') $running.set(s.running);

  // Smoke level: prefer the current 3-level field, but migrate a pre-3-level
  // saved boolean (smokeEnabled) so returning users keep their choice —
  // on → 'high' (the old "smoke on" amount), off → 'off'.
  if (SMOKE_LEVELS.includes(s.smokeLevel as SmokeLevel)) {
    $smokeLevel.set(s.smokeLevel as SmokeLevel);
  } else if (typeof s.smokeEnabled === 'boolean') {
    $smokeLevel.set(s.smokeEnabled ? 'high' : 'off');
  }

  const blend = parseBlend(s.blendBrush);
  if (blend) $blendBrush.set(blend);

  $gravityDir.set(oneOf(s.gravityDir, GRAVITY_DIRS, $gravityDir.get()));
  $gravityStrength.set(
    clampFloat(s.gravityStrength, GRAVITY_STRENGTH_MIN, GRAVITY_STRENGTH_MAX, $gravityStrength.get()),
  );
  $cellScale.set(oneOf(s.cellScale, CELL_SCALES, $cellScale.get()));
  if (typeof s.heatOverlay === 'boolean') $heatOverlay.set(s.heatOverlay);
  $gridDivision.set(oneOf(s.gridDivision, GRID_DIVISIONS, $gridDivision.get()));
  $snapshotFit.set(parseSnapshotFit(s.snapshotFit));
  $bottomDeadzone.set(
    clampInt(s.bottomDeadzone, BOTTOM_DEADZONE_MIN, BOTTOM_DEADZONE_MAX, BOTTOM_DEADZONE_DEFAULT),
  );

  // Favorites/recents are validated against the curated palette (ids the
  // palette does not list — hidden/unknown — are dropped). Favorites can hold at most one
  // of every palette material. The recents list also holds object kinds, so it
  // goes through `parseRecentList`; the storage field keeps its old
  // `recentMaterials` name so existing saves still hydrate.
  $favorites.set(parseIdList(s.favorites, MATERIALS.length));
  $recentPicks.set(parseRecentList(s.recentMaterials, RECENT_MATERIALS_MAX));

  // Locale: a persisted choice overrides the browser-detected default. Only
  // known locales are accepted; anything else leaves the detected value.
  if (LOCALES.includes(s.locale as Locale)) $locale.set(s.locale as Locale);
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
      heatRateMode: $heatRateMode.get(),
      heatAbsoluteRate: $heatAbsoluteRate.get(),
      heatRelativeRate: $heatRelativeRate.get(),
      overwriteLevel: $overwriteLevel.get(),
      borderMode: $borderMode.get(),
      simSpeed: $simSpeed.get(),
      running: $running.get(),
      smokeLevel: $smokeLevel.get(),
      blendBrush: $blendBrush.get(),
      gravityDir: $gravityDir.get(),
      gravityStrength: $gravityStrength.get(),
      cellScale: $cellScale.get(),
      heatOverlay: $heatOverlay.get(),
      gridDivision: $gridDivision.get(),
      snapshotFit: $snapshotFit.get(),
      bottomDeadzone: $bottomDeadzone.get(),
      favorites: $favorites.get(),
      recentMaterials: $recentPicks.get(),
      locale: $locale.get(),
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
  $heatRateMode.listen(schedule);
  $heatAbsoluteRate.listen(schedule);
  $heatRelativeRate.listen(schedule);
  $overwriteLevel.listen(schedule);
  $borderMode.listen(schedule);
  $simSpeed.listen(schedule);
  $running.listen(schedule);
  $smokeLevel.listen(schedule);
  $blendBrush.listen(schedule);
  $gravityDir.listen(schedule);
  $gravityStrength.listen(schedule);
  $cellScale.listen(schedule);
  $heatOverlay.listen(schedule);
  $gridDivision.listen(schedule);
  $snapshotFit.listen(schedule);
  $bottomDeadzone.listen(schedule);
  $favorites.listen(schedule);
  $recentPicks.listen(schedule);
  $locale.listen(schedule);

  // Keep <html lang> in sync with the active locale (screen readers, browser
  // features). Idempotent — safe to call alongside other startup wiring.
  syncHtmlLang();

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
// 292.5k-cell budget: 2 B/cell for ids + 4 B/cell for temps, ~2.3 MB of base64)
// still fits inside every browser's localStorage quota (typically 5-10 MB),
// with writeString degrading gracefully on QuotaExceededError regardless.

/** Temperatures are quantized to 0.1° steps in an int16 (range ±3276.7 — the
 *  brush clamps at [-50, 2000], so gameplay values fit with headroom). Blast's
 *  reuse of `temp` (flash life 1..6, or the seed marker 100) is a small integer,
 *  so it survives the round-trip exactly. (Ember packs a larger value into `temp`
 *  that exceeds the int16 range and does *not* round-trip, but embers are
 *  ephemeral debris — a mid-flight save that reloads with a garbled spark or two
 *  is harmless.) */
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
 * Split a 16-bit aux plane into one byte plane for storage. `aux`/`overlayAux`
 * are 16-bit (see Grid.aux), but the RLE codec — and the save format's existing
 * `aux`/`ova` fields — are byte-wide, so each is written as two planes: the low
 * byte under the original key and the high byte under a companion `…Hi` key.
 *
 * That split is deliberate rather than a wider codec: the low plane keeps
 * exactly the bytes older builds wrote, so a save made before aux was widened
 * (no `…Hi` field at all) reloads bit-identically with a zero high plane. Both
 * planes are overwhelmingly zero and RLE to almost nothing.
 */
function auxPlane(src: Uint16Array, shift: number): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = (src[i] >> shift) & 0xff;
  return out;
}

/** Recombine the low/high byte planes written by `auxPlane` into one 16-bit
 *  aux array. A missing high plane (older save) leaves the top byte zero. */
function joinAuxPlanes(lo: Uint8Array, hi: Uint8Array | undefined, size: number): Uint16Array {
  const out = new Uint16Array(size);
  for (let i = 0; i < size; i++) out[i] = lo[i] | ((hi ? hi[i] : 0) << 8);
  return out;
}

/** Decode one base64+RLE byte plane, or undefined if it's absent/corrupt. */
function decodePlane(field: unknown, size: number): Uint8Array | undefined {
  if (typeof field !== 'string') return undefined;
  try {
    return decodeCellsRle(base64ToBytes(field), size);
  } catch {
    return undefined; // invalid base64
  }
}

/**
 * Quantize temperatures for storage. Empty cells are always stored at ambient:
 * their temperature is physically inert (Empty has zero conductivity), so there's
 * no reason to spend RLE runs on whatever stale value an emptied cell happened to
 * hold — normalizing them keeps large cleared regions compressing to almost
 * nothing.
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

export interface PersistedWorld {
  w: number;
  h: number;
  cells: Uint8Array;
  temp: Float32Array;
  /** Per-cell material state word (Grid.aux), when the save carried it. Older
   *  saves predate it and leave this undefined (aux then reloads as zero). */
  aux?: Uint16Array;
  /** Per-cell 겹침 overlap fluid id (Grid.overlay), when the save carried it.
   *  Older saves predate it and reload dry (all zero). */
  overlay?: Uint8Array;
  /** The overlap fluid's parked aux state (Grid.overlayAux), paired with
   *  `overlay`. Undefined on saves that predate it (reloads as zero). */
  overlayAux?: Uint16Array;
  /** Free rigid objects (독립 오브젝트), when the save carried them. */
  objects?: SimBody[];
}

/** Sanitize an arbitrary object into a valid SimBody, or return null if invalid. */
export function sanitizeObject(raw: unknown): SimBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== 'string') return null;

  const num = (v: unknown, fallback = 0): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const bool = (v: unknown, fallback = false): boolean =>
    typeof v === 'boolean' ? v : fallback;

  const x = num(o.x);
  const y = num(o.y);
  const vx = num(o.vx);
  const vy = num(o.vy);

  if (kind === 'ball') {
    const r = num(o.r, 4);
    if (r <= 0) return null;
    return {
      kind: 'ball',
      x,
      y,
      vx,
      vy,
      r,
      mass: num(o.mass, 1),
      restitution: num(o.restitution, 0.8),
      heatTicks: Math.max(0, Math.round(num(o.heatTicks))),
      temp: num(o.temp, AMBIENT_TEMP),
    };
  }

  const angle = num(o.angle);
  const angularVelocity = num(o.angularVelocity);
  const halfLength = Math.max(0, num(o.halfLength));
  const radius = Math.max(0.1, num(o.radius, 1));
  const mass = Math.max(0.001, num(o.mass, 1));
  const momentOfInertia = Math.max(0.001, num(o.momentOfInertia, 1));
  const restitution = num(o.restitution, 0.2);
  const heatTicks = Math.max(0, Math.round(num(o.heatTicks)));
  const temp = num(o.temp, AMBIENT_TEMP);

  if (kind === 'drum') {
    const part = (['drum', 'piece1', 'piece2', 'piece3'].includes(o.part as string)
      ? o.part
      : 'drum') as DrumPart;
    const fill = (['empty', 'oil', 'acid'].includes(o.fill as string)
      ? o.fill
      : 'empty') as DrumFill;
    const state = (['intact', 'destroyed', 'melted'].includes(o.state as string)
      ? o.state
      : 'intact') as DrumState;
    const halfW = Math.max(0.1, num(o.halfW, radius));
    const halfH = Math.max(0.1, num(o.halfH, halfLength + radius));
    const cornerRadius = Math.max(0, num(o.cornerRadius, 0.5));
    const blastGraceTicks = Math.max(0, Math.round(num(o.blastGraceTicks)));

    return {
      kind: 'drum',
      part,
      x,
      y,
      vx,
      vy,
      angle,
      angularVelocity,
      halfLength,
      radius,
      halfW,
      halfH,
      cornerRadius,
      mass,
      momentOfInertia,
      restitution,
      state,
      fill,
      heatTicks,
      temp,
      blastGraceTicks,
    };
  }

  if (kind === 'dynamite') {
    return {
      kind: 'dynamite',
      x,
      y,
      vx,
      vy,
      angle,
      angularVelocity,
      halfLength,
      radius,
      mass,
      momentOfInertia,
      restitution,
      heatTicks,
      temp,
      lit: bool(o.lit, true),
      fuseTicks: Math.max(0, Math.round(num(o.fuseTicks, 100))),
    };
  }

  if (kind === 'smokebomb') {
    return {
      kind: 'smokebomb',
      x,
      y,
      vx,
      vy,
      angle,
      angularVelocity,
      halfLength,
      radius,
      mass,
      momentOfInertia,
      restitution,
      heatTicks,
      temp,
      fuseTicks: Math.max(0, Math.round(num(o.fuseTicks, 200))),
      ventTicks: Math.max(0, Math.round(num(o.ventTicks))),
    };
  }

  if (kind === 'woodbox') {
    const part = (['crate', 'piece1', 'piece2', 'piece3'].includes(o.part as string)
      ? o.part
      : 'crate') as WoodBoxPart;
    const halfW = Math.max(0.1, num(o.halfW, radius));
    const halfH = Math.max(0.1, num(o.halfH, radius));
    const cornerRadius = Math.max(0, num(o.cornerRadius, 0.5));
    const burnTicks = Math.max(0, Math.round(num(o.burnTicks)));
    const acidTicks = Math.max(0, Math.round(num(o.acidTicks)));

    return {
      kind: 'woodbox',
      part,
      x,
      y,
      vx,
      vy,
      angle,
      angularVelocity,
      halfLength,
      radius,
      halfW,
      halfH,
      cornerRadius,
      mass,
      momentOfInertia,
      restitution,
      heatTicks,
      temp,
      burnTicks,
      acidTicks,
    };
  }

  if (kind === 'molotov') {
    return {
      kind: 'molotov',
      x,
      y,
      vx,
      vy,
      angle,
      angularVelocity,
      halfLength,
      radius,
      mass,
      momentOfInertia,
      restitution,
      heatTicks,
      temp,
      lit: bool(o.lit, true),
      fuelTicks: Math.max(0, Math.round(num(o.fuelTicks, 300))),
    };
  }

  return null;
}

let lastWorldJson: string | null = null;

/**
 * Serialize a grid into the v1 JSON envelope (RLE+base64 cells/temps/aux/
 * overlay + objects). The same format `saveWorld` writes to localStorage, returned as a
 * string so callers (the named-snapshot store) can stash it under their own
 * keys. No storage side effects.
 */
export function serializeWorld(grid: Grid): string {
  const objList: SimBody[] = [];
  if (grid.objects && grid.objects.length > 0) {
    for (const item of grid.objects) {
      const sanitized = sanitizeObject(item);
      if (sanitized) objList.push(sanitized);
    }
  }
  return JSON.stringify({
    v: 1,
    w: grid.width,
    h: grid.height,
    cells: bytesToBase64(encodeCellsRle(grid.cells)),
    temp: bytesToBase64(encodeTempRle(quantizeTemps(grid.cells, grid.temp))),
    // Per-cell material state (Grid.aux) — 16 bits per cell, stored as two
    // byte planes (see auxPlane): `aux` is the low byte, `auxHi` the high one.
    // Persisting it is what lets electrical state survive a reload: a Spark
    // cell has *replaced* a wire cell and stores which conductor to turn back
    // into in its aux, so without this an in-flight spark reloads with aux 0
    // and fizzles to Empty, leaving a hole in the circuit. It also restores a
    // Clone's adopted id, a Petroleum Vapor's condensate code, etc. Mostly
    // zero, so both planes compress to almost nothing.
    aux: bytesToBase64(encodeCellsRle(auxPlane(grid.aux, 0))),
    auxHi: bytesToBase64(encodeCellsRle(auxPlane(grid.aux, 8))),
    // 겹침 overlap fluid ids (Grid.overlay) — an ordinary u8 field, RLE'd like
    // cells, so a soaked sand bed or a screen mid-flow survives a reload
    // instead of drying out. Mostly zero, so it compresses to almost nothing.
    ov: bytesToBase64(encodeCellsRle(grid.overlay)),
    // The overlap fluid's parked aux state (Grid.overlayAux), paired with `ov`
    // so a tagged fluid mid-passage (a petroleum vapor cut, …) keeps its
    // identity across a reload. 16-bit like `aux`, so it's split the same way
    // into `ova` (low byte) + `ovaHi` (high). Also mostly zero.
    ova: bytesToBase64(encodeCellsRle(auxPlane(grid.overlayAux, 0))),
    ovaHi: bytesToBase64(encodeCellsRle(auxPlane(grid.overlayAux, 8))),
    ...(objList.length > 0 ? { obj: objList } : {}),
  });
}

/**
 * Parse a v1 JSON envelope (from `serializeWorld` / `saveWorld`) back into the
 * typed arrays a `Grid.resizeFrom` call wants. Restored cells are sanitized:
 * ids no longer in the material registry become Empty, and Empty cells sit at
 * ambient temperature — so a stale or corrupt save can't feed the simulation
 * values it was never written to handle. Returns null on any parse/validation
 * failure so the caller can fall back gracefully.
 */
export function deserializeWorld(raw: unknown): PersistedWorld | null {
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

  // Aux is optional (older saves lack it); a decode failure just drops it,
  // degrading to the pre-aux behavior rather than losing the whole world. The
  // low plane is what decides whether we have aux at all: a save written before
  // aux was widened to 16 bits carries only that one, and rejoins with a zero
  // high plane for exactly its old meaning.
  let aux: Uint16Array | undefined;
  const auxLo = decodePlane(j.aux, w * h);
  if (auxLo) aux = joinAuxPlanes(auxLo, decodePlane(j.auxHi, w * h), w * h);

  // The 겹침 overlap layer is optional the same way (a dropped decode reloads
  // the world dry rather than losing it). overlayAux is paired with it.
  const overlay = decodePlane(j.ov, w * h);
  let overlayAux: Uint16Array | undefined;
  if (overlay) {
    const ovaLo = decodePlane(j.ova, w * h);
    if (ovaLo) overlayAux = joinAuxPlanes(ovaLo, decodePlane(j.ovaHi, w * h), w * h);
  }

  for (let i = 0; i < cells.length; i++) {
    if (!getMaterial(cells[i])) cells[i] = EMPTY;
    if (cells[i] === EMPTY) {
      temp[i] = AMBIENT_TEMP;
      if (aux) aux[i] = 0; // an empty cell must carry no leftover state
      if (overlay) overlay[i] = 0; // nothing to overlap with
    }
    // An overlap id no longer in the registry reloads as "dry" — same rule as
    // an unknown primary id becoming Empty.
    if (overlay && overlay[i] !== 0 && !getMaterial(overlay[i])) overlay[i] = 0;
    // overlayAux is meaningless without an overlay fluid to own it; normalize
    // it to 0 wherever the slot is dry so a stale byte can't leak into a later
    // overlapped fluid.
    if (overlayAux && (!overlay || overlay[i] === 0)) overlayAux[i] = 0;
  }

  let objects: SimBody[] | undefined;
  const rawObj = j.obj ?? j.objects;
  if (Array.isArray(rawObj)) {
    const list: SimBody[] = [];
    for (const item of rawObj) {
      const sanitized = sanitizeObject(item);
      if (sanitized) list.push(sanitized);
      if (list.length >= 200) break;
    }
    if (list.length > 0) objects = list;
  }

  return { w, h, cells, temp, aux, overlay, overlayAux, objects };
}

/**
 * Snapshot the grid into localStorage. Cheap enough to call on an interval: one
 * pass over the two arrays, and the write is skipped entirely when nothing
 * changed since the last save.
 */
export function saveWorld(grid: Grid): void {
  if (!storageAvailable()) return;
  const json = serializeWorld(grid);
  if (json === lastWorldJson) return;
  if (writeString(WORLD_KEY, json)) lastWorldJson = json;
}

/**
 * Load the saved auto-world, or null when there is none (or it fails
 * validation). A world saved at a different grid size is remapped onto the
 * current sandbox by the caller (Grid.resizeFrom).
 */
export function loadWorld(): PersistedWorld | null {
  if (!storageAvailable()) return null;
  return deserializeWorld(readJson(WORLD_KEY));
}
