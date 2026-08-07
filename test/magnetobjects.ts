// Headless behavioural harness for the Electromagnet's grip on the OBJECT layer
// (engine/objects.ts applyMagnetPull): a powered magnet lifts and HOLDS the steel
// bodies — 드럼통 (every fill) and the 섬광탄 can — while leaving every
// non-ferrous body alone, and both the power switch and a solid shield shut it
// off. Run: `node test/run-magnetobjects.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import {
  createDrum,
  createDynamite,
  createRubberBall,
  createFlashbang,
  createWoodBox,
  bodyReach,
} from '../src/game/engine/objects';
import type { SimBody } from '../src/game/engine/objects';
import { ELECTROMAGNET } from '../src/game/materials/electromagnet';
import { BATTERY } from '../src/game/materials/battery';
import { getMaterial } from '../src/game/materials/registry';
import '../src/game/materials';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(11);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const ID = (name: string): number => {
  for (let i = 1; i < 256; i++) {
    const m = getMaterial(i);
    if (m && m.name === name) return i;
  }
  throw new Error('no material ' + name);
};
const STONE = ID('Stone');

// The board: a stone floor and a 41×3 magnet slab overhead at y=34..36. The floor
// height is per-test, because the field's reach is measured from the body's CENTRE
// against its own half-extent (see applyMagnetPull): a wide drum enters the halo
// from ~18 cells out, a slim canister only from ~15, so each body is stood on a
// floor that leaves it a real gap to climb while genuinely inside the field.
const FLOOR_Y = 60;
const MAGNET_Y0 = 34;
const MAGNET_Y1 = 36;
const SHIELD_Y = 40; // a stone lid slung under the magnet, in the "shielded" world

interface World {
  grid: Grid;
  sim: Simulation;
}

function makeWorld(opts: { powered?: boolean; shielded?: boolean; floorY?: number } = {}): World {
  const grid = new Grid(120, 120);
  const sim = new Simulation(grid);
  const floorY = opts.floorY ?? FLOOR_Y;
  for (let y = floorY; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = STONE;
  for (let y = MAGNET_Y0; y <= MAGNET_Y1; y++)
    for (let x = 40; x <= 80; x++) grid.cells[grid.idx(x, y)] = ELECTROMAGNET.id;
  // One battery terminal against the slab's left face — the real power path
  // (battery beat → shared pulse dispatch → energizeElectromagnetBody), not a
  // hand-poked aux countdown.
  if (opts.powered !== false) grid.cells[grid.idx(39, 35)] = BATTERY.id;
  if (opts.shielded) for (let x = 25; x <= 95; x++) grid.cells[grid.idx(x, SHIELD_Y)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  return { grid, sim };
}

/** Stand `body` on the floor — its own VERTICAL half-extent decides where that is
 *  — and drop it into the world. Returns its resting centre. Boxy bodies (the
 *  drums, the crate) carry that as `halfH`; `bodyReach` would be wrong for them,
 *  being the radius of the circle around the whole box, i.e. out to its corner. */
function place(w: World, body: SimBody, floorY = FLOOR_Y): number {
  body.y = floorY - ('halfH' in body ? body.halfH : bodyReach(body));
  w.grid.objects.push(body);
  return body.y;
}

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.sim.step();
}

// 1. The magnet actually energizes through the battery, and publishes a field.
{
  const w = makeWorld();
  run(w, 20);
  const aux = w.grid.aux[w.grid.idx(60, 35)];
  check('a battery on one face powers the whole magnet slab', aux > 0, `aux ${aux}`);
  check('and the powered slab publishes its field', w.grid.magnetFields.length === 1);
}

// 2. A drum on the floor under a live magnet is lifted off it and held against
//    the slab — the whole point of the feature (전자석이 드럼통을 당김).
{
  const w = makeWorld();
  const drum = createDrum(60, 0);
  const startY = place(w, drum);
  run(w, 90);
  const gap = drum.y - MAGNET_Y1; // centre-to-slab-underside
  check('a live magnet lifts a drum off the floor', drum.y < startY - 4, `${startY.toFixed(1)} → ${drum.y.toFixed(1)}`);
  check('and pulls it up against the slab', gap < 10, `gap ${gap.toFixed(1)} cells (half-extent 8)`);
  // Hold: another 60 ticks of gravity must not peel it off.
  const heldY = drum.y;
  run(w, 60);
  check('and HOLDS it there against gravity', Math.abs(drum.y - heldY) < 1.5, `${heldY.toFixed(1)} → ${drum.y.toFixed(1)}`);
  check('without chattering on the face', Math.hypot(drum.vx, drum.vy) < 1.4, `speed ${Math.hypot(drum.vx, drum.vy).toFixed(2)}`);
}

// 3. Every drum fill is the same steel shell, so an oil/acid drum flies too.
for (const fill of ['oil', 'acid'] as const) {
  const w = makeWorld();
  const drum = createDrum(60, 0, fill);
  const startY = place(w, drum);
  run(w, 90);
  check(`a ${fill} drum is pulled the same as an empty one`, drum.y < startY - 4, `${startY.toFixed(1)} → ${drum.y.toFixed(1)}`);
}

// 4. The flashbang can is steel too (전자석이 섬광탄을 당김). Its own countdown is 3s
//    and this run is longer than that, so the timer is stretched out of the way —
//    what's under test is the magnet's grip, not the fuse.
{
  const CAN_FLOOR = 52; // a slim can's halo only reaches ~15 cells from its centre
  const w = makeWorld({ floorY: CAN_FLOOR });
  const can = createFlashbang(60, 0);
  can.fuseTicks = 100000;
  const startY = place(w, can, CAN_FLOOR);
  run(w, 90);
  check('a live magnet lifts a flashbang can too', can.y < startY - 4, `${startY.toFixed(1)} → ${can.y.toFixed(1)}`);
  check('and holds it against the slab', can.y - MAGNET_Y1 < 8, `gap ${(can.y - MAGNET_Y1).toFixed(1)} (half-extent ${bodyReach(can).toFixed(1)})`);
}

// 5. Selectivity is the toy: rubber, timber and a wax-and-paper stick ignore it.
{
  const INERT_FLOOR = 52; // close enough that every one of them is inside the halo
  const cases: ReadonlyArray<readonly [string, () => SimBody]> = [
    ['a rubber ball', () => createRubberBall(60, 0)],
    ['a wooden crate', () => createWoodBox(60, 0)],
    ['a stick of dynamite', () => createDynamite(60, 0)],
  ];
  for (const [label, make] of cases) {
    const w = makeWorld({ floorY: INERT_FLOOR });
    const body = make();
    const startY = place(w, body, INERT_FLOOR);
    run(w, 60);
    // Still in the world, and never climbed toward the magnet.
    const alive = w.grid.objects.includes(body);
    check(`${label} is not ferrous — the magnet ignores it`, alive && body.y > startY - 1, `${startY.toFixed(1)} → ${body.y.toFixed(1)}`);
  }
}

// 6. No power, no grip: an unpowered magnet is inert (the field is what pulls,
//    not the material).
{
  const w = makeWorld({ powered: false });
  const drum = createDrum(60, 0);
  const startY = place(w, drum);
  run(w, 90);
  check('an unpowered magnet pulls nothing', drum.y > startY - 1, `${startY.toFixed(1)} → ${drum.y.toFixed(1)}`);
  check('and publishes no field', w.grid.magnetFields.length === 0);
}

// 7. Solids shadow the pull, exactly as they shadow the cell sweep and the drawn
//    rings — a stone lid slung under the slab makes it inert to the drum below.
{
  const w = makeWorld({ shielded: true });
  const drum = createDrum(60, 0);
  const startY = place(w, drum);
  run(w, 90);
  check('a stone shield blocks the pull', drum.y > startY - 1, `${startY.toFixed(1)} → ${drum.y.toFixed(1)}`);
  check('though the magnet itself is still live', w.grid.magnetFields.length === 1);
}

// 7b. …and a shield made of MAGNET is still a shield (코드리뷰 지적). Magnet is an
//     ordinary structural solid to the ray, so a second, dead, disconnected block
//     shadows the live slab exactly like the stone one above. Keying the ray's
//     passability on the material would have made any magnet block — live or dead,
//     connected or not — silently stop shielding.
{
  const w = makeWorld();
  for (let x = 25; x <= 95; x++) w.grid.cells[w.grid.idx(x, SHIELD_Y)] = ELECTROMAGNET.id;
  w.grid.dirty.rebuild(w.grid.cells, w.grid.overlay, w.grid.width, w.grid.height);
  const drum = createDrum(60, 0);
  const startY = place(w, drum);
  run(w, 90);
  check('an unpowered MAGNET plate shields just like stone', drum.y > startY - 1, `${startY.toFixed(1)} → ${drum.y.toFixed(1)}`);
  check('and the shield never powers up on its own', w.grid.aux[w.grid.idx(60, SHIELD_Y)] === 0);
}

// 7c. No corner-cutting: a 1-cell-thick 45° wall is a wall, not a sieve. The
//     geometry is picked so the ray's ONLY crossing is a diagonal hop whose two
//     flanking cells are both wall while the cells it actually samples are open —
//     i.e. it squeezes through the point where two stones merely touch at a
//     corner. Without the flank guard the drum is dragged straight through it.
//     (Same failure mode, and same fix, as the smoke flood's own check.)
{
  const grid = new Grid(120, 120);
  const sim = new Simulation(grid);
  for (let y = FLOOR_Y; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, y)] = STONE;
  grid.cells[grid.idx(72, 40)] = ELECTROMAGNET.id; // a single magnet cell: exactly one ray
  grid.cells[grid.idx(73, 40)] = BATTERY.id;
  // Wall along y = x − 25, perpendicular to that ray. It passes between the two
  // cells the ray samples at (68,44) → (69,43) without occupying either.
  for (let x = 62; x <= 84; x++) grid.cells[grid.idx(x, x - 25)] = STONE;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const w: World = { grid, sim };
  const drum = createDrum(60, 0);
  const startY = place(w, drum);
  run(w, 90);
  const moved = Math.hypot(drum.x - 60, drum.y - startY);
  check('a 1-cell 45° wall blocks the pull too', moved < 1, `moved ${moved.toFixed(2)} cells`);
  check('(and the magnet in that scene really is live)', grid.magnetFields.length === 1);
}

// 8. Range is finite: a drum parked well outside the halo stays put.
{
  const w = makeWorld();
  const drum = createDrum(15, 0); // 25 cells left of the slab's near end
  const startY = place(w, drum);
  const startX = drum.x;
  run(w, 90);
  check('a drum outside the field is untouched', drum.y > startY - 1 && Math.abs(drum.x - startX) < 1, `(${startX.toFixed(1)},${startY.toFixed(1)}) → (${drum.x.toFixed(1)},${drum.y.toFixed(1)})`);
}

console.log(failures === 0 ? '\nAll magnet/object checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
