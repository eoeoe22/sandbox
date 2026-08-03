// Headless behavioural harness for 염소 + 알루미늄 → 불꽃 + 흰 연기
// (2Al + 3Cl₂ → 2AlCl₃ — chlorine.ts's `chlorineMetalBurn`, declared from the
// metal's side in aluminumpowder.ts / activatedaluminum.ts / aluminum.ts).
//
// The reaction's point is that chlorine is an oxidiser in its own right: the
// metal that is the hardest thing in the game to light with a match burns in it
// on contact, with no air, no flame and no ignition source anywhere. What this
// file pins down:
//
//   • It really runs in a sealed, airless pocket — and the control (the same
//     pocket with nothing in it) leaves the metal alone, so it's the gas doing
//     it and not the walls or the fall.
//   • The product is **smoke, not a solid**: aluminum chloride sublimes, so the
//     gas cell becomes Smoke and drifts off. In particular it is never Salt —
//     that is the *sodium* reaction, and the two must not be confused.
//   • Both sides are consumed 1:1, so a cloud is a finite reagent — shown on the
//     cast bar, which nothing but the rule can eat. A powder *pile* still burns
//     past the gas that lit it, because the flame left in the heap is sitting in
//     a fuel; that is the metal fire doing it, not the rule leaking.
//   • The three forms of the metal are ordered the way the material files claim:
//     activated dust (no oxide film) burns fastest, ordinary powder next, and a
//     cast bar needs to be **hot** before chlorine will take it at all.
//   • That bar gate is real in both directions: ambient bar in a cloud, nothing
//     happens; the same bar held at 400° burns away.
//   • And it stays local — a Chlorine/Aluminum scene paints no Blast (this is a
//     burn, not a detonation, and nothing here borrows sodium's stirring thump).
//
// Run: `node test/run-chlorinealuminum.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
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
/** Each block runs on its own seeded stream, so a change to one scene can't
 *  shift every later scene's randomness. Set SEED_BASE to re-run the whole
 *  harness on a different stream (`SEED_BASE=7 node test/run-chlorinealuminum.mjs`)
 *  — nothing here is tuned to one lucky seed. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0xa1c1);
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
const EMPTY = 0;
const WALL = ID('Wall');
const CHLORINE = ID('Chlorine');
const ALUMINUM = ID('Aluminum');
const ALUMINUM_POWDER = ID('Aluminum Powder');
const ACTIVATED_ALUMINUM = ID('Activated Aluminum');
const MOLTEN_ALUMINUM = ID('Molten Aluminum');
const FIRE = ID('Fire');
const SMOKE = ID('Smoke');
const SALT = ID('Salt');
const BLAST = ID('Blast');
const STONE = ID('Stone');

function makeWorld(w = 40, h = 40): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = grid.idx(x, y);
      grid.cells[i] = id;
      grid.aux[i] = 0;
      grid.tint[i] = (Math.random() * 256) | 0;
    }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}

/** A sealed 9x9 pocket with a stone floor in it, `atmosphere` filling the rest,
 *  and a pinch of `metal` resting on the floor. Resting matters: a grain hanging
 *  in the gas is a *suspended* grain, and the first flame in the scene sets the
 *  whole pinch off as a dust explosion before the contact rule gets a second turn
 *  (see test 6, which is about exactly that). On the floor, what is under test is
 *  the rule. */
function pocket(atmosphere: number, metal: number): { grid: Grid; sim: Simulation } {
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 10, 10, 20, 20, WALL);
  fill(grid, 11, 11, 19, 19, atmosphere);
  fill(grid, 11, 19, 19, 19, STONE);
  fill(grid, 14, 18, 16, 18, metal);
  return { grid, sim };
}

// 1. The reaction itself, in a sealed pocket of gas with no air in it: a pinch of
//    aluminum powder burns away, flame is seen where the metal was, and smoke —
//    the AlCl₃ fume — is seen where the gas was. Nothing outside the box can be
//    credited for any of it.
//
//    The smoke half runs at the `high` smoke level on purpose. Reaction Smoke is
//    thinned to 35% at the default `medium` (SimContext's applySmokeLevel — a
//    global legibility knob, nothing to do with this reaction), and three grains
//    make three cells of fume, so at the default the check would be a coin flip
//    on the seed rather than a statement about the rule.
{
  reseed();
  const { grid, sim } = pocket(CHLORINE, ALUMINUM_POWDER);
  sim.setSmokeLevel('high');
  let sawFire = false;
  let sawSmoke = false;
  for (let t = 0; t < 120; t++) {
    sim.step();
    if (count(grid, FIRE) > 0) sawFire = true;
    if (count(grid, SMOKE) > 0) sawSmoke = true;
  }
  check('aluminum powder in a sealed chlorine pocket burns away',
    count(grid, ALUMINUM_POWDER) === 0, `${count(grid, ALUMINUM_POWDER)} grains left`);
  check('…with no air, no flame and no ignition source — the gas is the oxidiser', sawFire);
  check('…and the gas it ate leaves as white fume', sawSmoke);
  check('…never as a solid product — that is the sodium reaction, not this one',
    count(grid, SALT) === 0, `${count(grid, SALT)} salt`);
}

// 2. Control for #1: the identical pocket, evacuated. It's the chlorine.
{
  reseed();
  const { grid, sim } = pocket(EMPTY, ALUMINUM_POWDER);
  for (let t = 0; t < 120; t++) sim.step();
  check('aluminum powder alone in an empty box is untouched',
    count(grid, ALUMINUM_POWDER) === 3, `${count(grid, ALUMINUM_POWDER)} of 3 left`);
}

// 3. One cell of gas takes exactly one cell of metal, so a cloud is a reagent and
//    not a catalyst. Measured on the *cast bar*, which is the only form of the
//    metal that can show this cleanly: the bar carries no `combustion` tag, so
//    nothing but the rule itself can consume it (a powder pile, by contrast, is
//    a fuel that the fire this reaction lights goes on to burn — test 4). The bar
//    is held over its gate the whole time, so the gas is the only thing in short
//    supply.
{
  reseed();
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 5, 5, 25, 25, WALL);
  fill(grid, 6, 6, 24, 24, EMPTY);
  fill(grid, 8, 15, 22, 15, ALUMINUM); // a 15-cell bar
  const gas = 6;
  fill(grid, 8, 14, 8 + gas - 1, 14, CHLORINE); // …under 6 cells of gas
  for (let t = 0; t < 300; t++) {
    for (let x = 8; x <= 22; x++) if (grid.get(x, 15) === ALUMINUM) grid.setTemp(x, 15, 400);
    sim.step();
  }
  const burned = 15 - count(grid, ALUMINUM);
  check('the gas is spent as it works — 6 cells of it burn at most 6 of metal',
    burned > 0 && burned <= gas, `${burned} cells of bar gone to ${gas} of chlorine`);
  check('…so the rest of the bar survives the cloud', count(grid, ALUMINUM) >= 15 - gas,
    `${count(grid, ALUMINUM)} of 15 cells left`);
}

// 4. A powder pile, on the other hand, does not stop when the gas does — and
//    that is the honest outcome rather than a leak in the 1:1 rule above. The
//    flame the reaction leaves behind is sitting *in* the heap, and aluminum
//    powder is a fuel: what chlorine does to a pile is light it. 60 cells of gas
//    over 100 grains therefore takes far more than 60 grains, as a metal fire,
//    and it is still a fire — no Blast is ever painted.
{
  reseed();
  const { grid, sim } = makeWorld(60, 60);
  fill(grid, 0, 45, 59, 59, STONE);
  const pile = 20 * 5;
  fill(grid, 20, 40, 39, 44, ALUMINUM_POWDER); // 20x5 = 100 grains
  fill(grid, 20, 36, 39, 38, CHLORINE); // 60 cells of gas over it
  let sawBlast = false;
  for (let t = 0; t < 400; t++) {
    sim.step();
    if (count(grid, BLAST) > 0) sawBlast = true;
  }
  const left = count(grid, ALUMINUM_POWDER);
  check('a chlorine cloud lights a powder pile, and the fire finishes it',
    left < pile - 60, `${pile - left} of ${pile} grains gone to 60 cells of gas`);
  check('…as a burn, never a detonation (no Blast anywhere)', !sawBlast);
}

// 5. The ordering the material files claim, measured on identical scenes: the
//    activated dust has no oxide film left for the gas to get through, so it goes
//    faster than the ordinary powder does (0.4 vs 0.2 per contact). Scored after a
//    SINGLE tick, and on a wide row: the rule rolls once per gas neighbour, so a
//    grain in open cloud is already near-certain to go within a few ticks either
//    way, and anything longer just measures both of them finishing.
{
  const burnedInOneTick = (metal: number): number => {
    reseed();
    const { grid, sim } = makeWorld(70, 30);
    fill(grid, 2, 5, 67, 25, CHLORINE);
    fill(grid, 2, 16, 67, 25, STONE); // …resting on a floor, so no grain is airborne
    fill(grid, 4, 15, 63, 15, metal); // 60 grains laid in the gas
    sim.step();
    return 60 - count(grid, metal);
  };
  const plain = burnedInOneTick(ALUMINUM_POWDER);
  const activated = burnedInOneTick(ACTIVATED_ALUMINUM);
  check('activated dust burns in chlorine faster than ordinary powder', activated > plain,
    `${activated} vs ${plain} of 60 grains gone in one tick`);
}

// 6. And the one that falls out of putting an oxidiser in reach of a *suspended*
//    cloud: the flame the first contact leaves behind is an igniter, and airborne
//    aluminum dust flashes as a body (aluminumdust.ts's tryDustExplosion). So a
//    pinch of dust hanging in chlorine does not burn grain by grain the way the
//    heap in test 1 does — it goes off at once, well before the gas could have
//    eaten it. Nothing here is chlorine-specific code; it is the dust rule
//    meeting a light that needs no air, and it is worth pinning because it is the
//    difference between "가루를 뿌려 둔다" and "가루를 흩날린다".
{
  reseed();
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 10, 10, 20, 20, WALL);
  fill(grid, 11, 11, 19, 19, CHLORINE);
  fill(grid, 14, 15, 16, 15, ALUMINUM_POWDER); // suspended in the middle of the gas
  let firstEmpty = -1;
  for (let t = 0; t < 120 && firstEmpty < 0; t++) {
    sim.step();
    if (count(grid, ALUMINUM_POWDER) === 0) firstEmpty = t;
  }
  check('a pinch of dust suspended in chlorine flashes all at once', firstEmpty >= 0 && firstEmpty < 5,
    `all three grains gone by tick ${firstEmpty}`);
}

// 7. The cast bar's heat gate, both ways round. Ambient, chlorine does nothing to
//    it: real bulk aluminum is protected by its oxide skin, and the gate is what
//    keeps a plain aluminum wall from dissolving in any stray cloud.
{
  reseed();
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 5, 5, 25, 25, WALL);
  fill(grid, 6, 6, 24, 24, CHLORINE);
  fill(grid, 12, 15, 18, 15, ALUMINUM);
  for (let t = 0; t < 300; t++) sim.step();
  check('an ambient aluminum bar just sits in chlorine', count(grid, ALUMINUM) === 7,
    `${count(grid, ALUMINUM)} of 7 cells left`);
}

// 8. …and the same bar held at 400° (over the 250° gate, under the 660° melt
//    point) burns away instead. Re-stamped each tick, so what is under test is
//    the gate and not how fast the bar sheds heat into the gas.
{
  reseed();
  const { grid, sim } = makeWorld(30, 30);
  fill(grid, 5, 5, 25, 25, WALL);
  fill(grid, 6, 6, 24, 24, CHLORINE);
  fill(grid, 12, 15, 18, 15, ALUMINUM);
  let sawSmoke = false;
  for (let t = 0; t < 300; t++) {
    for (let x = 12; x <= 18; x++) if (grid.get(x, 15) === ALUMINUM) grid.setTemp(x, 15, 400);
    sim.step();
    if (count(grid, SMOKE) > 0) sawSmoke = true;
  }
  check('a bar held at 400° burns in chlorine', count(grid, ALUMINUM) === 0,
    `${count(grid, ALUMINUM)} of 7 cells left`);
  check('…giving off the same white fume', sawSmoke);
  check('…and burning rather than melting — it never became Molten Aluminum',
    count(grid, MOLTEN_ALUMINUM) === 0, `${count(grid, MOLTEN_ALUMINUM)} molten cells`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
