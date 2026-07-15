import type { Grid } from '../game/engine/Grid';
import { serializeWorld, deserializeWorld, type PersistedWorld } from './persistence';

/**
 * Named snapshot save/load — user-created slots that capture the whole sandbox
 * (cells + temps + per-cell state + 겹침 overlay, the same envelope the auto-
 * save uses) under a chosen name, so a scene or setup can be banked and pulled
 * back at any time. Lives beside the automatic world save (which still runs on
 * its interval): the two are independent keys in localStorage.
 *
 * Best-effort like the rest of persistence: storage can be missing, disabled,
 * or full — every call degrades to a no-op rather than throwing.
 */

const SNAPSHOT_KEY = 'particle-sandbox:snapshots:v1';
/** Upper bound on snapshot count so a runaway loop or quota issue can't fill
 *  storage indefinitely. Generous for real use; the UI lists them all. */
const MAX_SNAPSHOTS = 50;
/** Cap a single name's length so the stored index stays small. */
const MAX_NAME_LEN = 40;
/** Thumbnail target width in CSS px (aspect preserved). Small enough to keep a
 *  stored JPEG data URL in the ~5–10KB range, so 50 snapshots add a bounded
 *  cost on top of the world envelopes. */
const THUMB_W = 160;
/** JPEG quality for thumbnails — low-ish to keep each data URL compact while
 *  still readable as a small preview. */
const THUMB_QUALITY = 0.55;

function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** One saved snapshot's metadata, as the list/save-modal UI sees it. The full
 *  world envelope is stored separately and only loaded on demand. */
export interface SnapshotMeta {
  /** Stable unique id (assigned at creation, never reused). */
  id: string;
  /** User-visible name (or an auto-generated fallback). */
  name: string;
  /** Creation timestamp (ms epoch). */
  createdAt: number;
  /** Grid dimensions at save time (for a quick "fits / will rescale" hint). */
  w: number;
  h: number;
  /** Small JPEG data URL of the canvas at save time, for gallery/row previews.
   *  Absent on snapshots saved before thumbnails existed (the UI shows a
   *  placeholder). */
  thumb?: string;
}

/** Internal record: metadata + the serialized world envelope in one JSON blob. */
interface SnapshotRecord extends SnapshotMeta {
  /** The v1 world envelope (serialized grid), stored as a JSON string so it
   *  can be handed straight to `deserializeWorld` on load. */
  world: string;
}

function isRecord(v: unknown): v is SnapshotRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.createdAt === 'number' &&
    typeof r.w === 'number' &&
    typeof r.h === 'number' &&
    typeof r.world === 'string'
  );
}

/** Read + validate every record; corrupt ones are silently dropped so one bad
 *  entry can't blank the whole list. */
function loadRecords(): SnapshotRecord[] {
  const raw = readJson(SNAPSHOT_KEY);
  if (!Array.isArray(raw)) return [];
  const out: SnapshotRecord[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (seen.has(item.id)) continue; // dedupe a duplicated id
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function saveRecords(list: SnapshotRecord[]): boolean {
  return writeString(SNAPSHOT_KEY, JSON.stringify(list));
}

/** List saved snapshots, newest first. Returns [] when storage is missing. */
export function listSnapshots(): SnapshotMeta[] {
  if (!storageAvailable()) return [];
  return loadRecords()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ world: _w, ...meta }) => meta);
}

/** Generate a short unique id (time + random suffix, no dependency). */
function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Capture a small JPEG data URL of a canvas, downscaled to `maxW` wide
 * (aspect preserved). Used to bank a snapshot preview without storing the
 * full-resolution frame. Returns '' on any failure so the caller can keep
 * saving the world envelope with a missing thumbnail rather than aborting.
 */
export function captureThumbnail(canvas: HTMLCanvasElement, maxW = THUMB_W): string {
  try {
    const srcW = canvas.width;
    const srcH = canvas.height;
    if (!srcW || !srcH) return '';
    const scale = Math.min(1, maxW / srcW);
    const tw = Math.max(1, Math.round(srcW * scale));
    const th = Math.max(1, Math.round(srcH * scale));
    const tc = document.createElement('canvas');
    tc.width = tw;
    tc.height = th;
    const tctx = tc.getContext('2d');
    if (!tctx) return '';
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(canvas, 0, 0, tw, th);
    return tc.toDataURL('image/jpeg', THUMB_QUALITY);
  } catch {
    return '';
  }
}

/**
 * Save the given grid as a new named snapshot. Returns the new meta on
 * success, or null if storage is unavailable, full, or the count cap was hit.
 * An empty name gets a default ("Save N"); a too-long name is truncated.
 * `thumb` (a JPEG data URL from `captureThumbnail`) is stored for the gallery
 * preview; pass ''/omit to save without one.
 */
export function saveSnapshot(grid: Grid, name: string, thumb = ''): SnapshotMeta | null {
  if (!storageAvailable()) return null;
  const list = loadRecords();
  if (list.length >= MAX_SNAPSHOTS) return null;
  const trimmed = name.trim().slice(0, MAX_NAME_LEN);
  const finalName = trimmed || `Save ${list.length + 1}`;
  const record: SnapshotRecord = {
    id: genId(),
    name: finalName,
    createdAt: Date.now(),
    w: grid.width,
    h: grid.height,
    world: serializeWorld(grid),
    ...(thumb ? { thumb } : {}),
  };
  list.push(record);
  if (!saveRecords(list)) return null;
  const { world: _w, ...meta } = record;
  return meta;
}

/** Rename a snapshot by id. Returns true on success. */
export function renameSnapshot(id: string, name: string): boolean {
  if (!storageAvailable()) return false;
  const list = loadRecords();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  list[idx].name = name.trim().slice(0, MAX_NAME_LEN) || list[idx].name;
  return saveRecords(list);
}

/** Delete a snapshot by id. Returns true on success (also true if the id
 *  wasn't found — the caller wants "it's gone"). */
export function deleteSnapshot(id: string): boolean {
  if (!storageAvailable()) return false;
  const list = loadRecords();
  const next = list.filter((r) => r.id !== id);
  if (next.length === list.length) return true; // nothing to delete
  return saveRecords(next);
}

/**
 * Load a snapshot's world envelope by id, parsed and sanitized the same way
 * `loadWorld` handles the auto-save — ready for `Grid.resizeFrom`. Returns null
 * when the id is missing, storage is unavailable, or the envelope is corrupt.
 */
export function loadSnapshot(id: string): PersistedWorld | null {
  if (!storageAvailable()) return null;
  const list = loadRecords();
  const record = list.find((r) => r.id === id);
  if (!record) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.world);
  } catch {
    return null;
  }
  return deserializeWorld(parsed);
}

// ---------------------------------------------------------------------------
// Engine bridge
// ---------------------------------------------------------------------------

/**
 * The live grid reference, registered once by Game.ts on startup. The UI lives
 * in Svelte and can't see the engine instance directly; this avoids threading
 * it through the store. Cleared by `registerGridForSnapshots(null, …)` on
 * teardown (a no-op in practice — the page is unloading).
 */
let liveGrid: Grid | null = null;
/** Post-load callback: re-seed cosmetic tint (not persisted) and refresh the
 *  pointer overlay so the restored world reads right on the first frame. */
let onApplied: (() => void) | null = null;

/**
 * Bind the snapshot module to the live engine. Called once from Game.ts after
 * the grid is constructed; passing null unbinds (used on teardown).
 */
export function registerGridForSnapshots(grid: Grid | null, applied?: () => void): void {
  liveGrid = grid;
  onApplied = applied ?? null;
}

/**
 * Apply a saved snapshot to the live grid: load its envelope by id and resize
 * the current grid from it (bottom-left anchored, same rule as a window
 * resize), so a world saved at a different size is remapped onto the current
 * sandbox. Returns true on success. The live grid's own resolution is kept; the
 * snapshot's content is fitted into it. Free objects (balls, drums) are cleared
 * first — snapshots don't serialize the object layer, so leaving the current
 * session's objects on top of loaded cells would mix two unrelated scenes.
 */
export function applySnapshot(id: string): boolean {
  if (!liveGrid) return false;
  const world = loadSnapshot(id);
  if (!world) return false;
  liveGrid.objects.length = 0; // snapshot doesn't carry objects — start clean
  liveGrid.resizeFrom(
    liveGrid.width,
    liveGrid.height,
    world.cells,
    world.w,
    world.h,
    world.temp,
    world.aux,
    world.overlay,
    world.overlayAux,
  );
  if (onApplied) onApplied();
  return true;
}

/**
 * Save the live grid as a new named snapshot. Thin wrapper the UI calls so it
 * doesn't need the grid reference itself. Captures a thumbnail of the visible
 * game canvas (`#game`) so the gallery/list views can show a preview; if the
 * canvas can't be found or capture fails, the snapshot is still saved without
 * one. Returns the new meta, or null.
 */
export function saveLiveSnapshot(name: string): SnapshotMeta | null {
  if (!liveGrid) return null;
  let thumb = '';
  const canvas = document.getElementById('game');
  if (canvas instanceof HTMLCanvasElement) thumb = captureThumbnail(canvas);
  return saveSnapshot(liveGrid, name, thumb);
}
