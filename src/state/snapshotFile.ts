import { deserializeWorld } from './persistence';

/**
 * The snapshot *file* format — the same scene the browser keeps in localStorage,
 * written out as a standalone file so it can be shared, backed up, or moved to
 * another device.
 *
 * The container is plain JSON with three parts the user actually cares about:
 * the **title** (which also becomes the filename), a short **description**, and
 * the **world** payload. Everything else is bookkeeping.
 *
 * Extension: `.psbx.json` — `psbx` ("Particle SandBoX") marks it as ours at a
 * glance, and the trailing `.json` keeps editors, GitHub, and OS previewers
 * treating it as what it really is. Nothing is compressed or binary-packed
 * beyond what the world envelope already does (RLE + base64), so a curious user
 * can open the file and read the header.
 */

/** Extension every export is written with (see the note above). */
export const SNAPSHOT_FILE_EXT = '.psbx.json';
/** Marker field, so a random `.json` dropped on the importer is rejected with a
 *  clear "not a snapshot" rather than a confusing parse error. */
export const SNAPSHOT_FILE_FORMAT = 'particle-sandbox-snapshot';
/** Container version. Bumped only if the *envelope* changes; the world payload
 *  carries its own `v` and is validated by `deserializeWorld`. */
export const SNAPSHOT_FILE_VERSION = 1;

/** Upper bound on an imported file, so a mis-picked multi-hundred-MB file is
 *  refused before it's read into a string. A worst-case snapshot (pure noise at
 *  the cell budget) lands a few MB, so this is generous. */
export const SNAPSHOT_FILE_MAX_BYTES = 32 * 1024 * 1024;

/** Longest title/description accepted from a file (mirrors the in-app caps, so
 *  a hand-edited file can't grow the stored index without bound). */
const MAX_TITLE_LEN = 40;
const MAX_DESC_LEN = 200;

/** The parts of a file the app keeps after a successful import. `world` is the
 *  world envelope re-serialized as a string, ready for the snapshot store. */
export interface ParsedSnapshotFile {
  title: string;
  description: string;
  createdAt: number;
  w: number;
  h: number;
  thumb?: string;
  world: string;
}

/**
 * Build the JSON text of a snapshot file. `world` is the envelope string from
 * `serializeWorld`; it's embedded as a nested object (not a quoted string) so
 * the file stays readable and diffable as one JSON document.
 */
export function buildSnapshotFile(params: {
  title: string;
  description: string;
  createdAt: number;
  w: number;
  h: number;
  thumb?: string;
  world: string;
}): string {
  let world: unknown;
  try {
    world = JSON.parse(params.world);
  } catch {
    world = null;
  }
  return JSON.stringify(
    {
      format: SNAPSHOT_FILE_FORMAT,
      v: SNAPSHOT_FILE_VERSION,
      title: params.title,
      description: params.description,
      createdAt: params.createdAt,
      w: params.w,
      h: params.h,
      ...(params.thumb ? { thumb: params.thumb } : {}),
      world,
    },
    null,
    // Indent the top level only far enough to be readable — the payload is one
    // long base64 line either way, and 2-space indent costs almost nothing next
    // to it.
    2,
  );
}

/**
 * Parse and validate a snapshot file's text. Returns null for anything that
 * isn't one of ours or whose world payload fails `deserializeWorld` — the same
 * validation the localStorage path uses, so an imported scene can't feed the
 * simulation values it was never written to handle.
 *
 * A file from a newer container version is rejected rather than guessed at.
 * Title/description are trimmed and capped; a missing description is fine
 * (files written before descriptions existed, or a user who left it blank).
 */
export function parseSnapshotFile(text: string): ParsedSnapshotFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (f.format !== SNAPSHOT_FILE_FORMAT) return null;
  if (typeof f.v !== 'number' || f.v > SNAPSHOT_FILE_VERSION) return null;

  // The world payload must survive the exact same sanitation as a localStorage
  // load. We only need the yes/no here — the record stores the envelope text and
  // re-parses it on apply.
  if (!f.world || typeof f.world !== 'object') return null;
  if (!deserializeWorld(f.world)) return null;

  const w = typeof f.w === 'number' && Number.isInteger(f.w) && f.w > 0 ? f.w : 0;
  const h = typeof f.h === 'number' && Number.isInteger(f.h) && f.h > 0 ? f.h : 0;
  // Dimensions are metadata (the list shows them); if the header is missing or
  // nonsense, fall back to what the payload itself declares.
  const dims = w && h ? { w, h } : null;
  const payload = f.world as Record<string, unknown>;
  const pw = typeof payload.w === 'number' ? payload.w : 0;
  const ph = typeof payload.h === 'number' ? payload.h : 0;

  const title = typeof f.title === 'string' ? f.title.trim().slice(0, MAX_TITLE_LEN) : '';
  const description =
    typeof f.description === 'string' ? f.description.trim().slice(0, MAX_DESC_LEN) : '';
  const createdAt =
    typeof f.createdAt === 'number' && Number.isFinite(f.createdAt) ? f.createdAt : Date.now();
  // Only accept an inline JPEG/PNG data URL as a thumbnail — never a remote or
  // `javascript:` URL, which would turn an imported file into a way to make the
  // gallery fetch (or run) something chosen by whoever wrote the file.
  const thumb =
    typeof f.thumb === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]*$/.test(f.thumb)
      ? f.thumb
      : undefined;

  return {
    title,
    description,
    createdAt,
    w: dims ? dims.w : pw,
    h: dims ? dims.h : ph,
    ...(thumb ? { thumb } : {}),
    world: JSON.stringify(f.world),
  };
}

/**
 * Turn a snapshot title into a safe filename stem. Strips the characters no
 * common filesystem accepts plus control characters, collapses whitespace, and
 * refuses the Windows reserved device names. Non-ASCII is kept as-is — Korean
 * titles are the common case and browsers handle them fine.
 */
export function fileNameFromTitle(title: string, fallback = 'snapshot'): string {
  let name = title
    // Control characters plus the set Windows/macOS reject in a filename.
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Trailing dots/spaces are silently dropped by Windows; strip them here so
    // the saved name matches what the user asked for.
    .replace(/[. ]+$/, '')
    .slice(0, 60)
    .replace(/[. ]+$/, '');
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = fallback;
  return name;
}

/**
 * Hand `text` to the browser as a download named `filename`. Uses an object URL
 * + synthetic anchor click (works everywhere, no permissions); the URL is
 * revoked on the next tick so the blob doesn't leak for the page's lifetime.
 */
export function downloadTextFile(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
