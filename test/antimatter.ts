// Headless behavioural harness for Antimatter (materials/antimatter.ts): after
// the "everything annihilates" rewrite, the only two materials that survive a
// grain's touch are the container Wall and the Void — every other registered
// material dies, armor included (blast-proof Diamond, the 방폭 uranium series,
// the "indestructible" Clone) and every phase included (gases used to be passed
// through). The counterweight is that the reaction's own flash must not feed
// back into the pocket that made it, so the efficiency scene below pins the 1:1
// trade that the flash marker exists to protect.
// Run: `node test/run-antimatter.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial, allMaterials } from '../src/game/materials/registry';
import { AMBIENT_TEMP } from '../src/game/config';
import { EMPTY } from '../src/game/engine/types';
import { ANTIMATTER } from '../src/game/materials/antimatter';
import { FIRE } from '../src/game/materials/fire';
import { SMOKE } from '../src/game/materials/smoke';
import { VOID } from '../src/game/materials/void';
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
Math.random = mulberry32(7);

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

const ID = (name: string): number => {
  for (const m of allMaterials()) if (m.name === name) return m.id;
  throw new Error('no material ' + name);
};
const WALL = ID('Wall');
const DIAMOND = ID('Diamond');
const CLONE = ID('Clone');
const STEAM = ID('Steam');
const SAND = ID('Sand');

/** The `aux` stamp antimatter.ts puts on its annihilation flash. Duplicated here
 *  on purpose: if that constant moves, this harness should be the thing that
 *  notices rather than silently testing nothing. */
const FLASH_MARK = 0xa17;
const FLASH_TEMP = 1200;

function makeWorld(w = 40, h = 60): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
/** Place a cell the way the brush does: material, its own initial temp, no
 *  leftover per-cell state. */
function put(grid: Grid, x: number, y: number, id: number): void {
  grid.set(x, y, id);
  grid.setTemp(x, y, getMaterial(id).thermal?.init ?? AMBIENT_TEMP);
  grid.setAux(x, y, 0);
}
function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(grid, x, y, id);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Run the antimatter rule itself for one grain, with no other material's update
 *  in the way — the isolation the registry sweep needs, since half the registry
 *  would otherwise move, burn or transform before the grain got its turn. */
function annihilateStep(sim: Simulation, x: number, y: number): void {
  ANTIMATTER.update!(x, y, sim.context);
}
/** Seal a rectangle in Wall so nothing inside can drift out of contact. */
function pocket(grid: Grid, x0: number, y0: number, x1: number, y1: number): void {
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    put(grid, x, y0 - 1, WALL);
    put(grid, x, y1 + 1, WALL);
  }
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    put(grid, x0 - 1, y, WALL);
    put(grid, x1 + 1, y, WALL);
  }
}

// 1. 커버리지 — sweep the registry: every material except the Wall and the Void
//    is annihilated by a touching grain, and the grain dies with it. This is the
//    list-scanning check (same idea as the material-id and acid-tag sweeps): add
//    a material that quietly opts out of annihilation and this prints its name.
{
  const survivors: string[] = [];
  const noFlash: string[] = [];
  for (const m of allMaterials()) {
    if (m.id === EMPTY || m.id === ANTIMATTER.id || m.id === WALL || m.id === VOID.id) continue;
    const { grid, sim } = makeWorld(12, 12);
    put(grid, 6, 6, m.id);
    put(grid, 6, 5, ANTIMATTER.id);
    annihilateStep(sim, 6, 5);
    if (grid.get(6, 6) !== EMPTY) survivors.push(m.name);
    else if (grid.get(6, 5) !== FIRE.id) noFlash.push(m.name);
  }
  check(
    'every registered material but Wall/Void annihilates',
    survivors.length === 0,
    survivors.length ? `survived: ${survivors.join(', ')}` : 'no survivors',
  );
  check(
    'the grain dies with it (flashes to Fire) in every case',
    noFlash.length === 0,
    noFlash.length ? `no flash against: ${noFlash.join(', ')}` : 'always flashed',
  );
}

// 2. The two survivors, and why the Void is one of them: it isn't a stalemate —
//    the sink still swallows the grain, so exempting it just keeps the pair from
//    deleting each other twice over.
{
  const { grid, sim } = makeWorld(12, 12);
  put(grid, 6, 6, WALL);
  put(grid, 6, 5, ANTIMATTER.id);
  annihilateStep(sim, 6, 5);
  check(
    'Wall survives contact and the grain lives on',
    grid.get(6, 6) === WALL && count(grid, ANTIMATTER.id) === 1 && count(grid, FIRE.id) === 0,
  );
}
{
  // Sealed side by side so neither can wander off — "it's gone" can only mean
  // "it was consumed here".
  const { grid, sim } = makeWorld(12, 12);
  pocket(grid, 5, 5, 6, 5);
  put(grid, 5, 5, VOID.id);
  put(grid, 6, 5, ANTIMATTER.id);
  annihilateStep(sim, 6, 5);
  check(
    'Void survives contact',
    grid.get(5, 5) === VOID.id && count(grid, ANTIMATTER.id) === 1 && count(grid, FIRE.id) === 0,
  );
  // 대조군: run the real tick loop and the Void eats the grain instead.
  for (let i = 0; i < 4; i++) sim.step();
  check(
    'Void still swallows the grain (the sink outranks it)',
    grid.get(5, 5) === VOID.id && count(grid, ANTIMATTER.id) === 0,
    `${count(grid, ANTIMATTER.id)} grain(s) left`,
  );
}

// 3. A gas annihilates now, one-for-one, and the flash it leaves is stamped —
//    sealed in a pocket so "it vanished" can't be "it drifted away".
{
  const { grid, sim } = makeWorld(12, 12);
  pocket(grid, 5, 5, 6, 5);
  put(grid, 5, 5, STEAM);
  put(grid, 6, 5, ANTIMATTER.id);
  annihilateStep(sim, 6, 5);
  check(
    'Steam (a gas) annihilates 1:1 and leaves a stamped 1200° flash',
    grid.get(5, 5) === EMPTY &&
      grid.get(6, 5) === FIRE.id &&
      grid.getAux(6, 5) === FLASH_MARK &&
      grid.getTemp(6, 5) === FLASH_TEMP,
    `flash aux ${grid.getAux(6, 5)}, temp ${grid.getTemp(6, 5)}`,
  );
}

// 4. The flash is the reaction, not matter: a second grain touching it leaves it
//    alone — while ordinary Fire (aux 0) sitting in the same spot is annihilated
//    like anything else. Same geometry both ways, so the difference can only be
//    the stamp.
{
  const { grid, sim } = makeWorld(12, 12);
  pocket(grid, 5, 5, 6, 5);
  put(grid, 5, 5, FIRE.id);
  grid.setAux(5, 5, FLASH_MARK); // as if a neighbor had just annihilated here
  put(grid, 6, 5, ANTIMATTER.id);
  annihilateStep(sim, 6, 5);
  check(
    "a grain skips this reaction's own flash",
    grid.get(6, 5) === ANTIMATTER.id && grid.get(5, 5) === FIRE.id,
  );
}
{
  const { grid, sim } = makeWorld(12, 12);
  pocket(grid, 5, 5, 6, 5);
  put(grid, 5, 5, FIRE.id); // ordinary flame — no stamp
  put(grid, 6, 5, ANTIMATTER.id);
  annihilateStep(sim, 6, 5);
  check(
    'ordinary Fire is annihilated like any other material',
    grid.get(5, 5) === EMPTY && grid.get(6, 5) === FIRE.id && grid.getAux(6, 5) === FLASH_MARK,
  );
}
{
  // ...and the same for the wisp the flash settles into (fire.ts keeps aux on
  // the burn-out write), which is the side door the smoke case closes.
  const { grid, sim } = makeWorld(12, 12);
  pocket(grid, 5, 5, 6, 5);
  put(grid, 5, 5, SMOKE.id);
  grid.setAux(5, 5, FLASH_MARK);
  put(grid, 6, 5, ANTIMATTER.id);
  annihilateStep(sim, 6, 5);
  const stampedSmokeSkipped = grid.get(6, 5) === ANTIMATTER.id && grid.get(5, 5) === SMOKE.id;

  const w2 = makeWorld(12, 12);
  pocket(w2.grid, 5, 5, 6, 5);
  put(w2.grid, 5, 5, SMOKE.id); // ordinary smoke
  put(w2.grid, 6, 5, ANTIMATTER.id);
  annihilateStep(w2.sim, 6, 5);
  check(
    "the flash's own smoke is skipped, ordinary Smoke is not",
    stampedSmokeSkipped && w2.grid.get(5, 5) === EMPTY,
  );
}

// 5. Armor is no defense any more, through the real tick loop: a pile of grains
//    eats into a Diamond slab (formerly `explosionProof` ⇒ antimatter-proof) and
//    into a Clone block (formerly `indestructible`).
{
  const { grid, sim } = makeWorld(24, 30);
  fill(grid, 8, 20, 15, 24, DIAMOND);
  fill(grid, 10, 16, 13, 18, ANTIMATTER.id); // 12 grains
  const before = count(grid, DIAMOND);
  for (let i = 0; i < 120; i++) sim.step();
  const eaten = before - count(grid, DIAMOND);
  check('Diamond is eaten by antimatter', eaten >= 8, `${eaten} of ${before} diamond cells gone`);
}
{
  const { grid, sim } = makeWorld(24, 30);
  fill(grid, 8, 20, 15, 24, CLONE);
  fill(grid, 10, 16, 13, 18, ANTIMATTER.id);
  const before = count(grid, CLONE);
  for (let i = 0; i < 120; i++) sim.step();
  const eaten = before - count(grid, CLONE);
  check('Clone is eaten by antimatter', eaten >= 8, `${eaten} of ${before} clone cells gone`);
}

// 6. 자기잠식 방지 — the pin the flash marker exists for. A block of grains
//    dropped down a sealed shaft onto a Diamond floor must spend itself roughly
//    one grain per cell destroyed. Without the marker each grain would eat the
//    Fire (and then the Smoke) its neighbor just left, so the block would burn
//    itself out from the inside in a handful of ticks having destroyed almost
//    nothing — the ratio, not the raw counts, is what catches that.
{
  const { grid, sim } = makeWorld(30, 60);
  for (let y = 20; y <= 52; y++) {
    put(grid, 10, y, WALL);
    put(grid, 17, y, WALL);
  }
  for (let x = 10; x <= 17; x++) put(grid, x, 53, WALL);
  fill(grid, 11, 45, 16, 52, DIAMOND); // 48 cells of target
  fill(grid, 11, 30, 16, 35, ANTIMATTER.id); // 36 grains
  const grains = count(grid, ANTIMATTER.id);
  const targets = count(grid, DIAMOND);
  for (let i = 0; i < 400; i++) sim.step();
  const spent = grains - count(grid, ANTIMATTER.id);
  const destroyed = targets - count(grid, DIAMOND);
  const ratio = spent === 0 ? 0 : destroyed / spent;
  check(
    'a pocket of antimatter does not cannibalize itself (≈1 cell destroyed per grain spent)',
    spent >= 30 && ratio >= 0.9,
    `${spent} grains spent, ${destroyed} cells destroyed (ratio ${ratio.toFixed(2)})`,
  );
}

// 7. Ordinary matter still trades 1:1 the way it always did — the pre-existing
//    behaviour this rewrite must not have disturbed.
{
  const { grid, sim } = makeWorld(24, 40);
  fill(grid, 8, 30, 15, 34, SAND);
  fill(grid, 10, 26, 13, 27, ANTIMATTER.id); // 8 grains
  const grains = count(grid, ANTIMATTER.id);
  const sand = count(grid, SAND);
  for (let i = 0; i < 200; i++) sim.step();
  const spent = grains - count(grid, ANTIMATTER.id);
  const eaten = sand - count(grid, SAND);
  check(
    'sand still trades one grain for one cell',
    spent === grains && eaten >= grains - 1 && eaten <= grains + 1,
    `${spent} grains spent, ${eaten} sand cells gone`,
  );
}

console.log(failures === 0 ? '\nAll antimatter checks passed.' : `\n${failures} check(s) failed.`);
if (failures > 0) process.exit(1);
