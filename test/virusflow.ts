// Headless behavioural harness for 액체 바이러스 — the plague flows, but only as a
// goo, and flowing didn't cost it any of the things that used to contain or cure
// it.
//
// Virus was a `Phase.Solid` for most of its life: a colony hung in mid-air
// wherever it happened to grow and never ran anywhere. It is a `Phase.Liquid` now
// (materials/virus.ts), throttled by a FLOW_CHANCE gate on the whole movement
// step plus a high `viscosity` on the lateral half — the Slime/Lava arrangement
// at looser values. That pair of numbers is the entire design: drop either and
// the virus levels out like water, which would put an outbreak in every corner of
// the map within seconds of the first splash and make walls, pits and containers
// pointless; tighten either and it stops visibly flowing at all, which is the
// thing the change exists to add.
//
// So this pins the behaviour from both ends, plus the four counters that a
// suddenly-mobile material is the most likely to break:
//
//   • **It actually flows.** A blob released in mid-air lands on the floor and
//     pools there. (As a solid it stayed exactly where it was placed, forever.)
//   • **It flows like a goo, not like water.** Over the same window a poured
//     column spreads to clearly fewer floor columns than Water and clearly more
//     than Slime — the band the two throttles are aimed at.
//   • **A wall still contains it.** A colony sealed in a stone box is still
//     entirely inside that box after a long run: Stone is not infectable, and a
//     liquid can't move through a solid.
//   • **The cures still work.** Acid on contact, and each of the three chemical
//     disinfectants (H₂O₂, Alcohol, Soapy Water) still eats a colony down. All
//     four scan for a *primary* Virus cell, so a mobile colony is a colony that
//     can walk out from under its own disinfectant between ticks — and H₂O₂'s
//     corrosion front in particular now hands its `aux` budget on through a
//     neighbourhood that reshuffles under it. (The front cell itself never moves:
//     it self-destructs on its own turn, before the movement step. What moves is
//     everything it is trying to reach.) Counted as primary + soaked, so a colony
//     that merely sank into the floor isn't scored as cured.
//   • **It still infects.** A seed dropped on a wood bed converts the bed.
//   • **A soaked cell is not an immortal reservoir.** An overlay occupant does
//     not run its material's `update` (see Simulation's per-cell step), so a virus
//     that seeps into a powder bed would be inert — invisible, uninfectable,
//     uncurable — without virus.ts's `overlapUpdate`. Pinned two ways: soaked into
//     an infectable bed (Sand) it eats its way back out to primary cells, and
//     soaked into one that isn't (Salt) it still dies in heat.
//
// Run: `node test/run-virusflow.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { Phase } from '../src/game/engine/types';
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
const SEED_BASE = Number(process.env.SEED_BASE ?? 0x71c5);
let reseeds = 0;
function reseed(): void {
  Math.random = mulberry32(SEED_BASE + ++reseeds * 0x9e37);
}
reseed();

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
const WALL = ID('Wall');
const STONE = ID('Stone');
const VIRUS = ID('Virus');

/** Frame a grid with indestructible Wall so nothing leaks out of the scene. */
function box(grid: Grid): void {
  const { width: W, height: H } = grid;
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      if (x === 0 || x === W - 1 || y === 0 || y === H - 1) grid.cells[grid.idx(x, y)] = WALL;
}

function countOf(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}

function countOverlay(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.overlay.length; i++) if (grid.overlay[i] === id) n++;
  return n;
}

// --- 1. it is declared a liquid ---------------------------------------------
// The cheapest possible guard against the whole thing being reverted by an
// unrelated edit: everything below is a *consequence* of this one field, and its
// two throttles are what keep the consequence playable.
{
  const m = getMaterial(VIRUS);
  check('Virus is a Liquid', m.phase === Phase.Liquid, `phase=${m.phase}`);
  check(
    'Virus declares a goo viscosity',
    m.viscosity !== undefined && m.viscosity > 0.5,
    `viscosity=${m.viscosity}`,
  );
  // A Solid's density is never read by the movement code, so the old value was a
  // placeholder (1000). As a liquid it has to sort sensibly against the pool it
  // lands in and against the disinfectant poured on top of it.
  check(
    'Virus density sorts between Water and Saltwater',
    m.density > getMaterial(ID('Water')).density && m.density < getMaterial(ID('Saltwater')).density,
    `density=${m.density}`,
  );
  check(
    'Virus is denser than H2O2 (the disinfectant floats and eats down)',
    m.density > getMaterial(ID('H2O2')).density,
  );
}

// --- 2. a released blob falls and pools --------------------------------------
/** Drop a 6×6 blob from mid-air in an empty box and report where its cells are
 *  after `ticks`. Nothing in the scene is infectable, so the count is conserved
 *  and only the movement is being measured. */
function drop(id: number, ticks: number): { n: number; cy: number; minY: number } {
  const W = 30;
  const H = 40;
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  box(grid);
  for (let y = 4; y < 10; y++) for (let x = 12; x < 18; x++) grid.cells[grid.idx(x, y)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  for (let t = 0; t < ticks; t++) sim.step();
  let n = 0;
  let sy = 0;
  let minY = H;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (grid.cells[grid.idx(x, y)] === id) {
        n++;
        sy += y;
        if (y < minY) minY = y;
      }
  return { n, cy: n > 0 ? sy / n : -1, minY };
}
{
  reseed();
  const d = drop(VIRUS, 200);
  // Released at rows 4..9 in a 40-tall box whose floor is row 38.
  check('a virus blob is conserved as it falls', d.n === 36, `${d.n} cells`);
  check(
    'a virus blob falls to the floor instead of hanging where it was placed',
    d.cy > 30 && d.minY > 20,
    `centre y=${d.cy.toFixed(1)}, highest cell y=${d.minY}`,
  );
}

// --- 3. …but spreads like a goo, not like water ------------------------------
/** liquidmetalflow.ts's measure: a tall narrow column poured on the floor of a
 *  walled box, scored by how many of the floor's columns it covers after a fixed
 *  window. Short on purpose — a gated goo is *slower*, not frozen, so given long
 *  enough even Slime levels out and the measure stops separating anything. */
function spread(id: number, ticks: number): number {
  const W = 42;
  const H = 24;
  const FLOOR_Y = H - 2;
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      if (x === 0 || x === W - 1 || y === 0 || y >= FLOOR_Y + 1) grid.cells[grid.idx(x, y)] = WALL;
  const cx = (W >> 1) - 2;
  for (let y = FLOOR_Y - 11; y <= FLOOR_Y; y++)
    for (let x = cx; x <= cx + 3; x++) grid.cells[grid.idx(x, y)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  for (let t = 0; t < ticks; t++) sim.step();
  const cols = new Set<number>();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (grid.cells[grid.idx(x, y)] === id) cols.add(x);
  return cols.size;
}
{
  reseed();
  const virus = spread(VIRUS, 120);
  reseed();
  const water = spread(ID('Water'), 120);
  reseed();
  const slime = spread(ID('Slime'), 120);
  // Measured over these runs: Water ~32 of the 40 floor columns, Virus ~20,
  // Slime ~11. Asserted as a strict ordering with a margin rather than as
  // absolute bands, so ordinary RNG jitter doesn't flake the run while a virus
  // that had quietly become water-thin (or frozen back into a solid) still fails.
  check(
    'a virus column spreads less than Water',
    virus + 4 < water,
    `virus ${virus} vs water ${water} floor columns`,
  );
  check(
    'a virus column spreads more than Slime',
    virus > slime + 4,
    `virus ${virus} vs slime ${slime} floor columns`,
  );
}

// --- 4. a wall still contains an outbreak ------------------------------------
{
  reseed();
  const W = 30;
  const H = 30;
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  box(grid);
  for (let x = 8; x <= 20; x++)
    for (let y = 8; y <= 20; y++)
      if (x === 8 || x === 20 || y === 8 || y === 20) grid.cells[grid.idx(x, y)] = STONE;
  for (let x = 10; x <= 18; x++)
    for (let y = 10; y <= 14; y++) grid.cells[grid.idx(x, y)] = VIRUS;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  for (let t = 0; t < 600; t++) sim.step();
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (grid.cells[grid.idx(x, y)] === VIRUS) {
        if (x > 8 && x < 20 && y > 8 && y < 20) inside++;
        else outside++;
      }
  check('a stone box still contains a flowing colony', outside === 0, `${outside} cells escaped`);
  check('…and the colony is still in there', inside > 0, `${inside} cells`);
}

// --- 5. it still infects -----------------------------------------------------
{
  reseed();
  const W = 40;
  const H = 30;
  const WOOD = ID('Wood');
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  box(grid);
  for (let y = 10; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) grid.cells[grid.idx(x, y)] = WOOD;
  for (let x = 18; x < 22; x++) grid.cells[grid.idx(x, 10)] = VIRUS;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const wood0 = countOf(grid, WOOD);
  for (let t = 0; t < 300; t++) sim.step();
  const wood1 = countOf(grid, WOOD);
  check(
    'a seed colony still eats a wood bed',
    wood1 < wood0 / 2,
    `${wood0} → ${wood1} wood cells`,
  );
}

// --- 6. the cures still work -------------------------------------------------
/** A floor of Virus with a pool of `name` dropped onto it; how much virus is
 *  left (primary + soaked) after `ticks`. */
function cure(name: string, ticks: number): { start: number; end: number } {
  const W = 30;
  const H = 24;
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  const chem = ID(name);
  box(grid);
  for (let y = 16; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) grid.cells[grid.idx(x, y)] = VIRUS;
  for (let y = 12; y < 16; y++)
    for (let x = 10; x < 20; x++) grid.cells[grid.idx(x, y)] = chem;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const start = countOf(grid, VIRUS);
  for (let t = 0; t < ticks; t++) sim.step();
  return { start, end: countOf(grid, VIRUS) + countOverlay(grid, VIRUS) };
}
for (const name of ['Acid', 'H2O2', 'Alcohol', 'Soapy Water']) {
  reseed();
  const r = cure(name, 200);
  check(
    `${name} still eats a flowing colony`,
    r.end < r.start / 4,
    `${r.start} → ${r.end} virus cells`,
  );
}

// --- 7. a soaked cell is not an immortal reservoir ---------------------------
/** Pour a blob onto a powder bed and let it soak in through the 겹침 layer.
 *  `hot` holds the whole scene past the 100° cure point every tick. */
function soak(
  bedName: string,
  ticks: number,
  hot: boolean,
  bedAux = 0,
): { prim: number; ov: number; auxSeen: number } {
  const W = 24;
  const H = 24;
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  const bed = ID(bedName);
  box(grid);
  for (let y = 14; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      grid.cells[grid.idx(x, y)] = bed;
      // Stand-in for a host that keeps its own per-cell state in the aux byte
      // (Cement's cure countdown, Seed's sprout progress). See the caller.
      if (bedAux !== 0) grid.aux[grid.idx(x, y)] = bedAux;
    }
  for (let y = 10; y < 14; y++)
    for (let x = 8; x < 16; x++) grid.cells[grid.idx(x, y)] = VIRUS;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  // Sampled EVERY tick, not just at the end: a virus cell handed a phantom
  // corrosion budget destroys itself within a tick or two, so the final frame is
  // exactly the one frame where the evidence is already gone.
  let auxSeen = 0;
  for (let t = 0; t < ticks; t++) {
    if (hot) grid.temp.fill(300);
    sim.step();
    for (let i = 0; i < grid.cells.length; i++)
      if (grid.cells[i] === VIRUS && grid.aux[i] !== 0) auxSeen++;
  }
  return { prim: countOf(grid, VIRUS), ov: countOverlay(grid, VIRUS), auxSeen };
}
{
  // Salt is not infectable, so a virus poured on a salt bed soaks in and stays
  // there as an overlay occupant — visible as a tinted bed (the renderer's
  // `wetted`), and the exact configuration that would be inert without
  // `overlapUpdate`. Heat has to reach it.
  reseed();
  const cold = soak('Salt', 200, false);
  check(
    'virus does soak into a salt bed (the reservoir case exists)',
    cold.ov > 0,
    `${cold.prim} primary, ${cold.ov} soaked`,
  );
  reseed();
  const hot = soak('Salt', 200, true);
  check(
    'a soaked colony still burns out in heat',
    hot.prim === 0 && hot.ov === 0,
    `${hot.prim} primary, ${hot.ov} soaked`,
  );
  // Sand IS infectable, so a soaked cell infects the grain holding it and the
  // pair collapses back into one ordinary virus cell — it eats its way out of
  // the bed rather than accumulating in the overlap layer.
  reseed();
  const sand = soak('Sand', 200, false);
  check(
    'virus soaked into an infectable bed eats its way back out',
    sand.prim > 0 && sand.ov === 0,
    `${sand.prim} primary, ${sand.ov} soaked`,
  );
  // …and the cell it comes back out as is FRESH. `SimContext.set` deliberately
  // keeps a cell's aux on a non-EMPTY write, so the in-place infect in
  // `updateSoakedVirus` has to clear it by hand (as `spawn` does for the ordinary
  // infect, and as every other in-place transform in the roster does). Virus
  // reads aux as a corrosion-front budget, so a host that kept its own state in
  // that byte would hand each infected cell a phantom front and the colony would
  // eat itself away with no disinfectant anywhere near it. No powder that is both
  // infectable and aux-using ships today, so this stamps the bed by hand rather
  // than waiting for the first one that does — dropping the `setAux` collapses
  // both of these.
  reseed();
  const stamped = soak('Sand', 200, false, 200);
  check(
    'a cell infected out of a soaked bed carries no leftover host state',
    stamped.auxSeen === 0,
    `${stamped.auxSeen} virus cell-ticks carrying aux`,
  );
  check(
    '…so a colony in an aux-using bed survives as well as in a plain one',
    stamped.prim > sand.prim / 2,
    `${stamped.prim} vs ${sand.prim} on a plain bed`,
  );
}

// --- 8. 산성 슬라임은 죽이고, 일반 슬라임은 아무 상관이 없다 --------------------
// The two goos are the same material at two acidities (acidslime.ts), and against
// the virus they are meant to be opposites. Both halves need pinning, and the
// negative half more than the positive one: the acid bite lives in a shared
// `isAcidic` in virus.ts, so a future edit that reaches for something broader —
// "anything in the 생명 tab", "anything named *Slime*", a `corrosive` flag on the
// material — would silently make plain Slime a disinfectant too and quietly delete
// a whole containment toy.
//
// The kill is a contact rule on the virus's own turn, NOT corrosion.ts's
// `tryCorrode`: that pass eats Solids and Powders only, and the virus is a Liquid,
// so an acid slime blob's own turn can never touch it. If the rule were ever moved
// into the corroder's side it would stop working entirely — which is exactly what
// 8a would catch.
{
  reseed();
  const acidGoo = cure('Acid Slime', 200);
  check(
    'Acid Slime eats a flowing colony',
    acidGoo.end < acidGoo.start / 4,
    `${acidGoo.start} → ${acidGoo.end} virus cells`,
  );
}
{
  // Same scene, plain Slime instead. Nothing may happen in EITHER direction:
  // Slime is not infectable (not flammable, no `combustion`, not one of the named
  // earth/water exceptions), and it is not acidic, so both counts are conserved
  // exactly — there is no roll anywhere in the pair that could nibble at either.
  reseed();
  const W = 30;
  const H = 24;
  const SLIME = ID('Slime');
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  box(grid);
  for (let y = 16; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) grid.cells[grid.idx(x, y)] = VIRUS;
  for (let y = 12; y < 16; y++)
    for (let x = 10; x < 20; x++) grid.cells[grid.idx(x, y)] = SLIME;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  const v0 = countOf(grid, VIRUS);
  const s0 = countOf(grid, SLIME);
  for (let t = 0; t < 200; t++) sim.step();
  const v1 = countOf(grid, VIRUS) + countOverlay(grid, VIRUS);
  const s1 = countOf(grid, SLIME) + countOverlay(grid, SLIME);
  check('plain Slime does not touch a colony', v1 === v0, `${v0} → ${v1} virus cells`);
  check('…and the colony does not infect plain Slime', s1 === s0, `${s0} → ${s1} slime cells`);
}
{
  // 스며든 바이러스 too. Built by hand rather than by pouring, because the point is
  // to put the acid beside a colony that is already in the overlap layer: a soaked
  // cell runs `updateSoakedVirus`, a completely separate turn from the surface one,
  // and its acid check is the same shared predicate. (Stamping `grid.overlay`
  // directly is the harness pattern the other overlap tests use.)
  const SALT = ID('Salt');
  /** A salt bed with a soaked virus colony in it and a `goo` puddle sitting on
   *  top; returns the virus left (primary + soaked) after `ticks`. */
  function soakedBeside(goo: number, ticks: number): { start: number; end: number } {
    const W = 24;
    const H = 20;
    const grid = new Grid(W, H);
    const sim = new Simulation(grid);
    box(grid);
    for (let y = 14; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        grid.cells[grid.idx(x, y)] = SALT;
        if (x >= 8 && x < 16) grid.overlay[grid.idx(x, y)] = VIRUS;
      }
    for (let y = 11; y < 14; y++)
      for (let x = 8; x < 16; x++) grid.cells[grid.idx(x, y)] = goo;
    grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
    const start = countOverlay(grid, VIRUS);
    for (let t = 0; t < ticks; t++) sim.step();
    return { start, end: countOf(grid, VIRUS) + countOverlay(grid, VIRUS) };
  }
  reseed();
  const acidGoo = soakedBeside(ID('Acid Slime'), 300);
  check(
    'Acid Slime reaches a colony hiding in a powder bed',
    acidGoo.start > 0 && acidGoo.end < acidGoo.start / 4,
    `${acidGoo.start} → ${acidGoo.end} virus cells`,
  );
  reseed();
  const plain = soakedBeside(ID('Slime'), 300);
  check(
    '…and plain Slime leaves it alone',
    plain.end === plain.start,
    `${plain.start} → ${plain.end} virus cells`,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
