// Headless behavioural harness for the aluminum line (materials/aluminumpowder.ts
// → materials/moltenaluminum.ts → materials/aluminum.ts, and the Flash Powder
// recipe in materials/flashpowder.ts). What it pins down:
//
//   • the melt/burn split — flame in contact burns the powder, heat with no flame
//     on it melts it, and a burning grain is never yanked out of the fire by the
//     melt path;
//   • the casting round trip — powder → Molten Aluminum → solid Aluminum, and
//     solid Aluminum back to melt at 660°;
//   • cast Aluminum's two payoffs — it carries a spark (registered as a spark
//     conductor) and it is a laser mirror;
//   • the recipe — Aluminum Powder + Saltpeter → Flash Powder, its 150° cold
//     gate, and that it doesn't cannibalise the Thermite recipe;
//   • Flash Powder's identity — spark/heat sensitivity, the wet misfire, and a
//     blast that breaks no solid.
//
// Run: `node test/run-aluminum.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { AMBIENT_TEMP } from '../src/game/config';
import { conductorClass } from '../src/game/materials/spark';
import { ALUMINUM_POWDER } from '../src/game/materials/aluminumpowder';
import { MOLTEN_ALUMINUM, ALUMINUM_MELT_TEMP } from '../src/game/materials/moltenaluminum';
import { ALUMINUM } from '../src/game/materials/aluminum';
import { FLASH_POWDER } from '../src/game/materials/flashpowder';
import { THERMITE } from '../src/game/materials/thermite';
import { RUST_POWDER } from '../src/game/materials/rustpowder';
import { SALTPETER } from '../src/game/materials/saltpeter';
import { FIRE } from '../src/game/materials/fire';
import { SPARK } from '../src/game/materials/spark';
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
  for (let i = 1; i < 256; i++) {
    const m = getMaterial(i);
    if (m && m.name === name) return i;
  }
  throw new Error('no material ' + name);
};
const STONE = ID('Stone');
const WATER = ID('Water');
const IRON = ID('Iron');
const GLASS = ID('Glass');
const BATTERY = ID('Lithium Battery');

function makeWorld(w = 80, h = 80): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function floor(grid: Grid, y: number, id = STONE): void {
  for (let yy = y; yy < grid.height; yy++)
    for (let x = 0; x < grid.width; x++) grid.cells[grid.idx(x, yy)] = id;
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
/** Paint a cell and hold it at a temperature (the way a hot bed of terrain would). */
function paintHot(grid: Grid, x: number, y: number, id: number, temp: number): void {
  grid.set(x, y, id);
  grid.setTemp(x, y, temp);
}

// 1. The melt/burn split. Aluminum Powder heated with no flame touching it melts
//    at 660° rather than climbing to its 1000° autoignition — the rule the whole
//    casting line rests on.
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let x = 30; x < 40; x++) grid.set(x, 59, ALUMINUM_POWDER.id);
  let melted = 0;
  for (let t = 0; t < 200; t++) {
    // A hot stone bed under the pile — heat, no flame. Held at 900° so it can
    // carry the powder past 660° but never near its 1000° autoignition.
    for (let x = 28; x < 42; x++) for (let y = 60; y < 63; y++) grid.setTemp(x, y, 900);
    sim.step();
    melted = Math.max(melted, count(grid, MOLTEN_ALUMINUM.id));
    if (melted > 0) break;
  }
  check('powder heated past 660° with no flame on it melts', melted > 0, `${melted} cells`);
  check('…and does not catch fire instead', count(grid, FIRE.id) === 0);
}

// 2. …but a flame in contact still wins: the melt path is vetoed while any flame
//    is adjacent, so the grain climbs past 660° to its 1000° autoignition and
//    burns, exactly as it always did.
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let x = 30; x < 40; x++) grid.set(x, 59, ALUMINUM_POWDER.id);
  let burned = false;
  let everMelted = 0;
  for (let t = 0; t < 120; t++) {
    // Keep a flame in contact along the top of the pile, the way a fed fire does.
    for (let x = 30; x < 40; x++) if (grid.get(x, 58) === 0) grid.set(x, 58, FIRE.id);
    sim.step();
    everMelted = Math.max(everMelted, count(grid, MOLTEN_ALUMINUM.id));
    for (let x = 30; x < 40; x++) {
      if (grid.get(x, 59) === ALUMINUM_POWDER.id && grid.getTemp(x, 59) >= 1000) burned = true;
    }
  }
  check('flame in contact lights the powder (burn beats melt)', burned);
  check('…and a burning pile is never yanked into melt', everMelted === 0, `${everMelted} cells`);
}

// 3. The casting round trip: a molten pool poured onto cold terrain sheds its
//    heat and sets into solid Aluminum, and solid Aluminum put back over 660°
//    returns to melt.
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let x = 30; x < 40; x++) paintHot(grid, x, 59, MOLTEN_ALUMINUM.id, 800);
  let cast = 0;
  for (let t = 0; t < 400; t++) {
    sim.step();
    cast = count(grid, ALUMINUM.id);
    if (cast >= 5) break;
  }
  check('a molten pool on cold terrain sets into solid Aluminum', cast >= 5, `${cast} cells`);

  // …and back the other way.
  const { grid: g2, sim: s2 } = makeWorld();
  floor(g2, 60);
  // Comfortably past the melt point: the diffusion pass runs before the material
  // update, so a bar started only a few degrees over would shed its way back
  // under the point against the cold terrain before its own turn came round.
  for (let x = 30; x < 40; x++) paintHot(g2, x, 59, ALUMINUM.id, ALUMINUM_MELT_TEMP + 240);
  s2.step();
  check('solid Aluminum over 660° melts back', count(g2, MOLTEN_ALUMINUM.id) > 0,
    `${count(g2, MOLTEN_ALUMINUM.id)} cells`);
}

// 4. Cast Aluminum's payoffs: it is a registered spark conductor (so a pulse runs
//    the full length of a bar) and it is a laser mirror.
{
  check('Aluminum is registered as a spark conductor', conductorClass(ALUMINUM.id) > 0,
    `class ${conductorClass(ALUMINUM.id)}`);
  // Appending must leave every pre-existing class index exactly where it was —
  // the packed aux values in old saves are indices into CONDUCTOR_IDS, so an
  // insertion anywhere but the end silently rewires them (see spark.ts).
  check('…appended at the end, so every existing conductor keeps its class',
    conductorClass(IRON) === 1 &&
      conductorClass(ID('Mercury')) === 2 &&
      conductorClass(ID('Water')) === 3 &&
      conductorClass(ID('Wire')) === 11 &&
      conductorClass(ALUMINUM.id) === 12,
    `Iron=${conductorClass(IRON)} Wire=${conductorClass(ID('Wire'))} Al=${conductorClass(ALUMINUM.id)}`);
  check('Aluminum is a laser mirror', ALUMINUM.laserReflective === true);
  check('Aluminum conducts heat better than Iron',
    (ALUMINUM.thermal?.conductivity ?? 0) > (getMaterial(IRON).thermal?.conductivity ?? 0));
  check('Aluminum is not magnetic (an Electromagnet leaves a cast bar alone)',
    ALUMINUM.magnetic !== true);

  // A battery against one end of a bar drives a spark down it.
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let x = 20; x < 50; x++) grid.set(x, 59, ALUMINUM.id);
  grid.set(19, 59, BATTERY);
  let reached = 0;
  for (let t = 0; t < 120; t++) {
    sim.step();
    for (let x = 20; x < 50; x++) if (grid.get(x, 59) === SPARK.id) reached = Math.max(reached, x);
  }
  check('a battery drives a spark down an aluminum bar', reached >= 40, `reached x=${reached}`);
}

// 5. The recipe: Aluminum Powder + Saltpeter → Flash Powder, both cells.
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  // Interleaved, the way the docs tell players to lay two density-split powders.
  for (let x = 20; x < 60; x++) grid.set(x, 59, x % 2 ? ALUMINUM_POWDER.id : SALTPETER.id);
  for (let t = 0; t < 80; t++) sim.step();
  const made = count(grid, FLASH_POWDER.id);
  check('Aluminum Powder + Saltpeter grinds into Flash Powder', made >= 30, `${made} cells`);

  // The 150° cold gate: a hot pile mixes nothing.
  const { grid: g2, sim: s2 } = makeWorld();
  floor(g2, 60);
  for (let x = 20; x < 60; x++) {
    paintHot(g2, x, 59, x % 2 ? ALUMINUM_POWDER.id : SALTPETER.id, 300);
  }
  s2.step();
  check('…but not while the pile is hot (150° gate)', count(g2, FLASH_POWDER.id) === 0,
    `${count(g2, FLASH_POWDER.id)} cells`);
}

// 6. The two recipes off one grain don't cannibalise each other: rust still makes
//    Thermite when it's the partner present.
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let x = 20; x < 60; x++) grid.set(x, 59, x % 2 ? ALUMINUM_POWDER.id : RUST_POWDER.id);
  for (let t = 0; t < 80; t++) sim.step();
  check('Aluminum Powder + Rust Powder still makes Thermite',
    count(grid, THERMITE.id) >= 30, `${count(grid, THERMITE.id)} cells`);
  check('…and makes no Flash Powder with no saltpeter around',
    count(grid, FLASH_POWDER.id) === 0);
}

// 7. Flash Powder's sensitivity — it goes off at a mere 200°, well below every
//    other charge here, and a Spark sets it off directly (electricDetonate).
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let x = 38; x < 42; x++) paintHot(grid, x, 59, FLASH_POWDER.id, 250);
  sim.step();
  check('Flash Powder self-ignites at 200°', count(grid, FLASH_POWDER.id) === 0,
    `${count(grid, FLASH_POWDER.id)} left`);
  check('Flash Powder is electrically detonable', FLASH_POWDER.electricDetonate === true);

  // Wet grains are duds, however hot, exactly like Gunpowder.
  const { grid: g2, sim: s2 } = makeWorld();
  floor(g2, 60);
  for (let x = 38; x < 42; x++) paintHot(g2, x, 59, FLASH_POWDER.id, 250);
  for (let x = 38; x < 42; x++) g2.set(x, 58, WATER);
  s2.step();
  check('…but a wet charge misfires', count(g2, FLASH_POWDER.id) > 0,
    `${count(g2, FLASH_POWDER.id)} left`);
}

// 8. …and what it does when it goes off: a wide flash that breaks nothing solid.
//    Stone/Iron/Glass walls in reach must survive it.
{
  const { grid, sim } = makeWorld(100, 100);
  floor(grid, 70);
  for (let y = 60; y < 70; y++) {
    grid.set(35, y, STONE);
    grid.set(36, y, IRON);
    grid.set(37, y, GLASS);
  }
  const stoneBefore = count(grid, STONE);
  const ironBefore = count(grid, IRON);
  const glassBefore = count(grid, GLASS);
  for (let x = 42; x < 46; x++) paintHot(grid, x, 69, FLASH_POWDER.id, 250);
  for (let t = 0; t < 20; t++) sim.step();
  check('a flash charge cracks no stone', count(grid, STONE) === stoneBefore,
    `${count(grid, STONE)}/${stoneBefore}`);
  check('…nor iron', count(grid, IRON) === ironBefore, `${count(grid, IRON)}/${ironBefore}`);
  // Glass is the one exception, and it's the established one: a solid the shock
  // can't break but that declares a `shatterId` crazes into Broken Glass in
  // place (blast.ts), exactly as it does under a Gunpowder concussion. The pane
  // survives as matter either way — no cell is destroyed.
  check('…and glass at most crazes, never vanishes',
    count(grid, GLASS) + count(grid, ID('Broken Glass')) === glassBefore,
    `${count(grid, GLASS)} intact + ${count(grid, ID('Broken Glass'))} crazed / ${glassBefore}`);
  check('the charge itself is consumed', count(grid, FLASH_POWDER.id) === 0);
}

// 9. Molten Aluminum reads as a *metal* pour, not as fire: it never glows in the
//    orange band Molten Metal/Lava do, and a fresh cell starts genuinely molten.
{
  check('Molten Aluminum starts above its own melt point',
    (MOLTEN_ALUMINUM.thermal?.init ?? 0) > ALUMINUM_MELT_TEMP,
    `${MOLTEN_ALUMINUM.thermal?.init}°`);
  check('…and its glow ramp bottoms out below the melt point (a visible set front)',
    (MOLTEN_ALUMINUM.glow?.min ?? Infinity) < ALUMINUM_MELT_TEMP);
  const floatsOver = ['Lava', 'Molten Glass', 'Slag', 'Molten Iron Ore', 'Molten Metal'];
  check('…and it floats clear of lava and of every smelting liquid',
    floatsOver.every((n) => MOLTEN_ALUMINUM.density < getMaterial(ID(n)).density),
    floatsOver.map((n) => `${n} ${getMaterial(ID(n)).density}`).join(', '));
  // Not the lightest melt outright, though — Molten Salt is lighter, so a pour
  // sinks through a salt bath as well as through water (the docs say so too).
  check('…but sinks in Molten Salt and in water',
    MOLTEN_ALUMINUM.density > getMaterial(ID('Molten Salt')).density &&
      MOLTEN_ALUMINUM.density > getMaterial(WATER).density,
    `Al ${MOLTEN_ALUMINUM.density} vs salt ${getMaterial(ID('Molten Salt')).density}`);
  check('a fresh pour is not at room temperature',
    (MOLTEN_ALUMINUM.thermal?.init ?? AMBIENT_TEMP) > AMBIENT_TEMP);
}

console.log(failures === 0 ? '\nAll aluminum checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
