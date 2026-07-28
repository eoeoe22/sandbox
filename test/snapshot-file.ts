/**
 * Snapshot file + fit harness — guards the two halves of "a scene made on one
 * machine loads correctly on another".
 *
 *   1. File round trip — a `.psbx.json` file built from a saved scene parses
 *      back to the same title, description, dimensions and world payload, and
 *      every way a file can be wrong (not JSON, not ours, a newer container
 *      version, a corrupt payload, a remote-URL thumbnail) is rejected rather
 *      than half-imported.
 *   2. Fit — a snapshot lands inside the target grid the way the placement says:
 *      `auto` preserves the aspect ratio and keeps the whole scene, `simple` is a
 *      1:1 drop that crops the overflow and leaves the shortfall empty, a manual
 *      placement crops and stretches on demand, and the per-cell state planes
 *      (`aux`, `overlay`) stay coherent with the id that won each resampled cell
 *      — a Spark's conductor id must never end up on a cell that resampled to
 *      Sand. The load modal's preview clips through the same `sceneClip`, so
 *      "what you see is what you get" is a property the harness can check.
 *
 * Run: `node test/run-snapshot-file.mjs`.
 */
import { Grid } from '../src/game/engine/Grid';
import { serializeWorld, deserializeWorld } from '../src/state/persistence';
import {
  buildSnapshotFile,
  parseSnapshotFile,
  fileNameFromTitle,
  SNAPSHOT_FILE_EXT,
  SNAPSHOT_FILE_FORMAT,
} from '../src/state/snapshotFile';
import {
  fitWorld,
  resampleScene,
  placeScene,
  autoPlacement,
  centered,
  clampPlacement,
  sceneClip,
  SCALE_MAX,
} from '../src/state/snapshotFit';
import { EMPTY } from '../src/game/engine/types';
import { SAND } from '../src/game/materials/sand';
import { WATER } from '../src/game/materials/water';
import { WALL } from '../src/game/materials/wall';
import '../src/game/materials'; // register all materials (side effect)

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

/**
 * A small scene with something in every plane the format carries: a Wall floor,
 * a Sand pile above it, a Water pocket with a live overlay (겹침) cell, a hot
 * cell, and a non-zero aux word — so a dropped plane shows up as a diff rather
 * than passing unnoticed.
 */
function makeScene(w = 24, h = 16): Grid {
  const grid = new Grid(w, h);
  for (let x = 0; x < w; x++) grid.cells[(h - 1) * w + x] = WALL.id;
  for (let x = 4; x < 12; x++) {
    grid.cells[(h - 2) * w + x] = SAND.id;
    grid.cells[(h - 3) * w + x] = SAND.id;
  }
  for (let x = 14; x < 20; x++) grid.cells[(h - 2) * w + x] = WATER.id;
  const hot = (h - 2) * w + 5;
  grid.temp[hot] = 640.5; // survives the 0.1° quantization exactly
  grid.aux[(h - 2) * w + 6] = 0x1234; // both bytes set — catches a dropped auxHi
  const soaked = (h - 3) * w + 7;
  grid.overlay[soaked] = WATER.id;
  grid.overlayAux[soaked] = 0x0201;
  return grid;
}

// ---------------------------------------------------------------------------
// 1. File round trip
// ---------------------------------------------------------------------------

const grid = makeScene();
const world = serializeWorld(grid);
const TITLE = '용암성 / 3층';
const DESC = '우측 스위치를 켜면 시작. 물을 붓지 말 것.';

const text = buildSnapshotFile({
  title: TITLE,
  description: DESC,
  createdAt: 1_700_000_000_000,
  w: grid.width,
  h: grid.height,
  thumb: 'data:image/jpeg;base64,AAAA',
  world,
});

check('file is valid JSON', (() => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
})());

const parsed = parseSnapshotFile(text);
check('file parses back', parsed !== null);
if (parsed) {
  check('title round trips', parsed.title === TITLE, parsed.title);
  check('description round trips', parsed.description === DESC, parsed.description);
  check('createdAt round trips', parsed.createdAt === 1_700_000_000_000);
  check('dimensions round trip', parsed.w === grid.width && parsed.h === grid.height);
  check('data-URL thumbnail is kept', parsed.thumb === 'data:image/jpeg;base64,AAAA');

  // The payload must survive as the exact same world, not merely as valid JSON.
  const back = deserializeWorld(JSON.parse(parsed.world));
  check('payload deserializes', back !== null);
  if (back) {
    let cellsSame = back.w === grid.width && back.h === grid.height;
    for (let i = 0; cellsSame && i < grid.cells.length; i++) {
      if (back.cells[i] !== grid.cells[i]) cellsSame = false;
    }
    check('cells survive the file round trip', cellsSame);
    check(
      'temperature survives',
      Math.abs((back.temp?.[(grid.height - 2) * grid.width + 5] ?? 0) - 640.5) < 0.05,
    );
    check('16-bit aux survives', back.aux?.[(grid.height - 2) * grid.width + 6] === 0x1234);
    const soaked = (grid.height - 3) * grid.width + 7;
    check('overlay survives', back.overlay?.[soaked] === WATER.id);
    check('overlayAux survives', back.overlayAux?.[soaked] === 0x0201);
  }
}

// Rejections. Each of these must yield null — a half-imported scene is worse
// than a refused one.
check('plain text is rejected', parseSnapshotFile('not json at all') === null);
check('a JSON array is rejected', parseSnapshotFile('[1,2,3]') === null);
check(
  'an unrelated JSON object is rejected',
  parseSnapshotFile(JSON.stringify({ hello: 'world' })) === null,
);
check(
  'a newer container version is rejected',
  parseSnapshotFile(
    JSON.stringify({ format: SNAPSHOT_FILE_FORMAT, v: 99, world: JSON.parse(world) }),
  ) === null,
);
check(
  'a corrupt payload is rejected',
  parseSnapshotFile(
    JSON.stringify({ format: SNAPSHOT_FILE_FORMAT, v: 1, world: { v: 1, w: 0, h: 0 } }),
  ) === null,
);
check(
  'a missing payload is rejected',
  parseSnapshotFile(JSON.stringify({ format: SNAPSHOT_FILE_FORMAT, v: 1 })) === null,
);

// A file is authored by someone else; its thumbnail must not become a way to
// make the gallery fetch a remote URL or evaluate a scheme of the author's
// choosing. Only inline image data URLs are kept — anything else is dropped
// (the entry still imports, just without a preview).
for (const bad of [
  'https://example.com/pixel.png',
  'javascript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD4=',
]) {
  const r = parseSnapshotFile(
    JSON.stringify({
      format: SNAPSHOT_FILE_FORMAT,
      v: 1,
      title: 'x',
      w: grid.width,
      h: grid.height,
      thumb: bad,
      world: JSON.parse(world),
    }),
  );
  check(`non-image thumbnail dropped: ${bad.slice(0, 24)}`, r !== null && r.thumb === undefined);
}

// Title/description are capped on the way in, so a hand-edited file can't grow
// the stored index without bound.
const longFile = parseSnapshotFile(
  JSON.stringify({
    format: SNAPSHOT_FILE_FORMAT,
    v: 1,
    title: 'a'.repeat(500),
    description: 'b'.repeat(5000),
    w: grid.width,
    h: grid.height,
    world: JSON.parse(world),
  }),
);
check('over-long title is capped', longFile?.title.length === 40);
check('over-long description is capped', longFile?.description.length === 200);

// Filenames. The title is the filename, so it has to survive contact with a
// filesystem — and never come out empty.
check('filename keeps Korean', fileNameFromTitle('용암성') === '용암성');
check('filename strips separators', fileNameFromTitle('a/b\\c:d') === 'a b c d');
check('filename strips control chars', fileNameFromTitle('a\u0001b') === 'a b');
check('filename drops trailing dots', fileNameFromTitle('scene...') === 'scene');
check('blank title falls back', fileNameFromTitle('   ') === 'snapshot');
check('reserved device name falls back', fileNameFromTitle('CON') === 'snapshot');
check('filename is bounded', fileNameFromTitle('x'.repeat(300)).length === 60);
check('extension is the agreed one', SNAPSHOT_FILE_EXT === '.psbx.json');

// ---------------------------------------------------------------------------
// 2. Fit / placement
// ---------------------------------------------------------------------------

const src = deserializeWorld(JSON.parse(world));
if (!src) {
  check('scene deserializes for fit checks', false);
} else {
  const SW = src.w;
  const SH = src.h;

  // A 1:1 resample must be free — the caller gets the same object back, which is
  // what makes "loaded on the machine that saved it" and `simple` cost nothing.
  check('a same-size resample is a pass-through', resampleScene(src, SW, SH) === src);
  check(
    'a same-size, zero-offset placement is a pass-through',
    placeScene(src, SW, SH, 0, 0) === src,
  );

  // `simple` is 1:1: no rescale, crop the overflow, leave the shortfall empty.
  const simple = autoPlacement(SW, SH, 60, 40, 'simple');
  check('simple does not rescale', simple.cw === SW && simple.ch === SH);
  const simpleOut = fitWorld(src, 60, 40, simple);
  check('simple lands at the target size', simpleOut.w === 60 && simpleOut.h === 40);
  // Bottom-aligned, so the snapshot's floor is still the canvas floor, and the
  // cells that do land are byte-identical to the source (no resampling at all).
  let identical = true;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const di = (simple.offY + y) * 60 + simple.offX + x;
      if (simpleOut.cells[di] !== src.cells[y * SW + x]) identical = false;
    }
  }
  check('simple copies cells 1:1', identical);
  // And into a canvas smaller than the scene, the overflow is cut rather than
  // squeezed — the placement is still 1:1.
  const cropped = fitWorld(src, 12, 8, autoPlacement(SW, SH, 12, 8, 'simple'));
  check('simple crops instead of scaling', cropped.w === 12 && cropped.h === 8);

  // `auto` keeps the aspect ratio: the source is 24×16 (3:2), so into a 60×60
  // target it occupies 60×40 and leaves the top empty.
  const autoP = autoPlacement(SW, SH, 60, 60, 'auto');
  check('auto preserves the aspect ratio', autoP.cw === 60 && autoP.ch === 40);
  const tall = fitWorld(src, 60, 60, autoP);
  check('auto lands at the target size', tall.w === 60 && tall.h === 60);
  let topEmpty = true;
  for (let i = 0; i < 60 * 19; i++) if (tall.cells[i] !== EMPTY) topEmpty = false;
  check('auto leaves the margin above the scene empty', topEmpty);
  // The floor must stay a floor — gravity points down, so the scene is aligned
  // to the bottom rather than centred vertically.
  let floorSolid = true;
  for (let x = 0; x < 60; x++) if (tall.cells[59 * 60 + x] !== WALL.id) floorSolid = false;
  check('auto keeps the floor on the floor', floorSolid);

  // Upscaling must not invent materials: every id present afterwards was present
  // before (nearest-neighbour, no interpolation between ids).
  const before = new Set(Array.from(src.cells));
  check(
    'auto invents no new materials',
    Array.from(new Set(Array.from(tall.cells))).every((id) => before.has(id)),
  );

  // Downscaling roughly halves each axis. Content must still be there — a scene
  // that resamples to nothing is the failure mode this whole path exists to
  // avoid.
  const small = fitWorld(src, 12, 8, autoPlacement(SW, SH, 12, 8, 'auto'));
  check('downscale keeps the target size', small.w === 12 && small.h === 8);
  check(
    'downscale keeps material',
    small.cells.some((id) => id !== EMPTY),
  );

  // A manual placement can fill both axes independently (the old "stretch"), and
  // can hang off any edge — the clip has to hold on all four sides, including
  // negative offsets, without throwing or wrapping a row.
  const filled = fitWorld(src, 60, 40, centered(60, 40, 60, 40));
  check('manual fill lands at the target size', filled.w === 60 && filled.h === 40);
  for (const [label, off] of [
    ['off the left', { offX: -40, offY: 0 }],
    ['off the top', { offX: 0, offY: -30 }],
    ['off the right', { offX: 55, offY: 0 }],
    ['off the bottom', { offX: 0, offY: 35 }],
    ['fully outside', { offX: -500, offY: -500 }],
  ] as const) {
    let threw = false;
    let out: ReturnType<typeof fitWorld> | null = null;
    try {
      out = fitWorld(src, 60, 40, { cw: SW, ch: SH, offX: off.offX, offY: off.offY });
    } catch {
      threw = true;
    }
    check(`a placement ${label} clips cleanly`, !threw && out?.cells.length === 2400);
  }
  // Entirely outside means an empty canvas, not a wrapped one.
  const gone = fitWorld(src, 60, 40, { cw: SW, ch: SH, offX: -500, offY: -500 });
  check(
    'a fully-outside placement leaves the canvas empty',
    gone.cells.every((id) => id === EMPTY),
  );

  // The scale ceiling is what stops a stray drag from asking for a billion-cell
  // resample.
  const huge = clampPlacement({ cw: SW * 1000, ch: SH * 1000, offX: 0, offY: 0 }, SW, SH);
  check('an over-large scale is clamped', huge.cw === SW * SCALE_MAX && huge.ch === SH * SCALE_MAX);
  const tiny = clampPlacement({ cw: 0, ch: -5, offX: 0, offY: 0 }, SW, SH);
  check('a degenerate scale is clamped to one cell', tiny.cw === 1 && tiny.ch === 1);

  // The load modal draws its preview by walking `sceneClip` and colouring the
  // cells inside it. If that rectangle ever disagreed with what `placeScene`
  // actually writes, the preview would be a polite lie — so pin them together:
  // every cell inside the clip matches the scene, every cell outside is empty.
  for (const p of [
    { cw: SW, ch: SH, offX: 3, offY: 2 },
    { cw: 40, ch: 30, offX: -7, offY: -4 },
    { cw: 90, ch: 70, offX: -10, offY: -20 },
  ]) {
    const scene = resampleScene(src, p.cw, p.ch);
    const out = placeScene(scene, 60, 40, p.offX, p.offY);
    const clip = sceneClip(scene.w, scene.h, 60, 40, p.offX, p.offY);
    let agrees = true;
    const inside = new Set<number>();
    for (let sy = clip.sy0; sy < clip.sy1; sy++) {
      for (let sx = clip.sx0; sx < clip.sx1; sx++) {
        const di = (sy + p.offY) * 60 + p.offX + sx;
        inside.add(di);
        if (out.cells[di] !== scene.cells[sy * scene.w + sx]) agrees = false;
      }
    }
    for (let i = 0; agrees && i < out.cells.length; i++) {
      if (!inside.has(i) && out.cells[i] !== EMPTY) agrees = false;
    }
    check(`preview clip matches the applied world (${p.cw}×${p.ch} @ ${p.offX},${p.offY})`, agrees);
  }

  // Per-cell state must stay attached to the id it belongs to: aux/overlay are
  // copied from one representative source cell, never blended, so a state word
  // can only sit on a cell whose id came from that same source cell.
  for (const [label, out] of [
    ['upscale', tall],
    ['downscale', small],
    ['manual fill', filled],
    ['simple', simpleOut],
  ] as const) {
    let coherent = true;
    for (let i = 0; i < out.cells.length; i++) {
      // An empty cell must carry no leftover state, and an overlay must only sit
      // under a real host cell.
      if (out.cells[i] === EMPTY && ((out.aux?.[i] ?? 0) !== 0 || (out.overlay?.[i] ?? 0) !== 0)) {
        coherent = false;
        break;
      }
      if ((out.overlayAux?.[i] ?? 0) !== 0 && (out.overlay?.[i] ?? 0) === 0) {
        coherent = false;
        break;
      }
    }
    check(`${label} keeps per-cell state coherent`, coherent);
  }

  // Degenerate grids: a 1×1 source and a 1×1 destination both have to survive
  // the partition math (this is where floor/ceil index tricks usually break).
  const oneByOne = { w: 1, h: 1, cells: new Uint8Array([WALL.id]), temp: new Float32Array([20]) };
  check('a 1x1 source upscales', resampleScene(oneByOne, 8, 8).cells.every((id) => id === WALL.id));
  check('a source downscales to 1x1', resampleScene(src, 1, 1).cells.length === 1);
}

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
