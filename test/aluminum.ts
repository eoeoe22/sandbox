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
import { createWoodBox } from '../src/game/engine/objects';
import type { SimWoodBox } from '../src/game/engine/objects';
import { AMBIENT_TEMP } from '../src/game/config';
import { conductorClass } from '../src/game/materials/spark';
import { ALUMINUM_POWDER } from '../src/game/materials/aluminumpowder';
import { MOLTEN_ALUMINUM, ALUMINUM_MELT_TEMP } from '../src/game/materials/moltenaluminum';
import { ALUMINUM } from '../src/game/materials/aluminum';
import { FLASH_POWDER } from '../src/game/materials/flashpowder';
import { FLASH } from '../src/game/materials/flash';
import { LIQUID_GALLIUM } from '../src/game/materials/liquidgallium';
import { GALLIUM } from '../src/game/materials/gallium';
import { BLAST } from '../src/game/materials/blast';
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
const WOOD = ID('Wood');

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
/** Like `count`, but also finds cells riding in a powder's 겹침 (overlap) slot —
 *  a liquid that has soaked into a powder bed is still there, just not a primary
 *  cell, so a plain `count` would report it as destroyed. */
function countWithOverlay(grid: Grid, id: number): number {
  let n = count(grid, id);
  for (let i = 0; i < grid.overlay.length; i++) if (grid.overlay[i] === id) n++;
  return n;
}
/** Stamp a Flash cell *with its real spawn temperature*. `Grid.set` writes the id
 *  only — it does NOT apply `thermal.init` — so a hand-placed flash would sit at
 *  room temperature and the checks below would prove nothing about the hot
 *  reading they exist to test. (test/fireworks.ts's paintBurst does the same for
 *  the same reason.) */
function paintFlash(grid: Grid, x: number, y: number): void {
  grid.set(x, y, FLASH.id);
  grid.setTemp(x, y, FLASH.thermal?.init ?? AMBIENT_TEMP);
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

// 3b. It is a *liquid*, not a puddle glued where it was poured: a pour on a
//     flat floor spreads sideways and levels out. (The first version registered
//     an `update` that never called updateLiquid, so a pool sat in a frozen
//     column — it froze and cast correctly while never flowing at all.)
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  // A tall, narrow column poured onto flat stone. A liquid collapses into a
  // wide shallow puddle; a stuck one keeps its column.
  for (let y = 50; y < 59; y++) for (let x = 39; x <= 41; x++) paintHot(grid, x, y, MOLTEN_ALUMINUM.id, 800);
  for (let t = 0; t < 60; t++) {
    // Hold the floor hot so the run is testing flow, not freezing.
    for (let x = 0; x < grid.width; x++) for (let y = 60; y < 63; y++) grid.setTemp(x, y, 800);
    sim.step();
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.get(x, y) !== MOLTEN_ALUMINUM.id) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  check('a molten pour falls to the floor', maxY === 59, `lowest cell at y=${maxY}`);
  check('…and spreads sideways like a liquid', maxX - minX > 6, `spread ${maxX - minX + 1} cells wide`);
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

// 8b. …and what it *looks* like: the disc it fills is white Flash light, not the
//     orange-fading shockwave flash every other charge leaves. That's the whole
//     point of the material — a charge that breaks nothing must not read as a
//     bomb. The physics override is deliberately air-only, so the solids it
//     can't break are still shadowing it (checked above).
{
  const { grid, sim } = makeWorld(100, 100);
  floor(grid, 80);
  for (let x = 48; x < 52; x++) paintHot(grid, x, 79, FLASH_POWDER.id, 250);
  sim.step();
  const flash = count(grid, FLASH.id);
  const blast = count(grid, BLAST.id);
  // Reach 10, trimmed by blast.ts's global 2/3 scale and with the lower half of
  // the disc buried in the floor — so a few dozen cells of open air is the whole
  // visible flash.
  check('the disc is filled with white Flash light', flash > 60, `${flash} cells`);
  check('…and almost none of it is the orange shockwave flash', blast < flash / 8,
    `${blast} blast vs ${flash} flash`);
  // The next three are the same properties test/fireworks.ts pins for the
  // firework flower, checked the same way — by *outcome*, not by reading the tag
  // back. A property-only assertion (`FLASH.decorTemp === true`) keeps passing
  // even if the consumers of the tag stop honouring it, which is the regression
  // worth catching.
  {
    // A block of Wood buried in flash light, re-stamped every tick so the light
    // is continuously present far longer than one real flash lives. This is the
    // *grid* half of the rule, and it is `conductivity: 0` that carries it: heat
    // exchange is gated by the lower of two cells' conductivities, so a 0 never
    // warms a neighbour and Wood's own ignition check never sees the 3000°.
    const { grid: g, sim: s } = makeWorld();
    for (let y = 38; y <= 42; y++) for (let x = 38; x <= 42; x++) g.set(x, y, WOOD);
    let peak = -Infinity;
    for (let t = 0; t < 120; t++) {
      for (let y = 36; y <= 44; y++)
        for (let x = 36; x <= 44; x++) if (g.get(x, y) === 0) paintFlash(g, x, y);
      s.step();
      for (let y = 38; y <= 42; y++)
        for (let x = 38; x <= 42; x++)
          if (g.get(x, y) === WOOD) peak = Math.max(peak, g.getTemp(x, y));
    }
    check('Flash light never heats the grid it washes over', peak < AMBIENT_TEMP + 1,
      `wood peaked at ${peak.toFixed(1)}°C`);
    check('…and never sets it alight', count(g, WOOD) === 25, `${count(g, WOOD)}/25 cells`);
  }
  {
    // …and the *object* half, which is what `decorTemp` actually exists for. The
    // object layer is the one consumer that reads raw cell temperatures rather
    // than going through conduction (engine/objects.ts scanBodyExposure and the
    // dynamite fuse tip), so conductivity 0 does not protect it — without the tag
    // a crate engulfed in 3000° light would cook off and a snuffed fuse would
    // relight. Only this scenario can catch that.
    const { grid: g, sim: s } = makeWorld(100, 100);
    floor(g, 70);
    const crate = createWoodBox(50, 63) as SimWoodBox;
    g.objects.push(crate);
    for (let t = 0; t < 40; t++) s.step(); // let it land
    check('a cold crate starts unlit', crate.burnTicks === 0);
    let lit = false;
    for (let t = 0; t < 300; t++) {
      for (let y = 50; y <= 70; y++)
        for (let x = 40; x <= 70; x++) if (g.get(x, y) === 0) paintFlash(g, x, y);
      s.step();
      if (crate.burnTicks > 0) lit = true;
    }
    check('a crate engulfed in Flash light never catches (decorTemp)', !lit);
    check('…and is still there afterwards', g.objects.includes(crate));
    // (The other decorTemp consumer, the dynamite fuse tip, is left to
    // test/fireworks.ts — a Flash-based version of it turned out not to
    // discriminate, so it would have been a check that claims more than it
    // proves. The crate scenario above is verified to fail when the tag is
    // removed, which is what makes it worth having.)
  }
  {
    // A field of flash light with a charge going off inside it: every cell must
    // still be there (or expired on its own timer) — never converted to Debris,
    // which is what a blast does to loose matter it can't break. Debris carrying
    // FLASH would deposit stray flash cells wherever the fragments land.
    const { grid: g, sim: s } = makeWorld(100, 100);
    floor(g, 80);
    for (let y = 70; y < 79; y++) for (let x = 40; x < 60; x++) paintFlash(g, x, y);
    const before = count(g, FLASH.id);
    for (let x = 49; x < 51; x++) paintHot(g, x, 79, FLASH_POWDER.id, 250);
    s.step();
    // Some cells legitimately expire on their own `life` timer during the step —
    // what must never happen is a single one becoming Debris.
    check('…and a blast passes straight over it rather than shoving it as Debris',
      count(g, ID('Debris')) === 0 && count(g, FLASH.id) > before * 0.7,
      `${count(g, ID('Debris'))} debris, ${count(g, FLASH.id)}/${before} flash still lit`);
  }
  // It must not be a detonation trigger itself — an effect cell that reads as
  // one lets a charge set off a stockpile it should never reach (see woofer.ts).
  const { grid: g2, sim: s2 } = makeWorld();
  floor(g2, 60);
  for (let x = 30; x < 34; x++) g2.set(x, 59, FLASH_POWDER.id);
  for (let x = 28; x < 36; x++) paintFlash(g2, x, 58);
  s2.step();
  check('Flash light alone does not set off a charge it touches',
    count(g2, FLASH_POWDER.id) === 4, `${count(g2, FLASH_POWDER.id)}/4 left`);
}

// 8c. Liquid Gallium embrittles cast Aluminum into powder — and is not consumed
//     doing it, so one drop keeps eating its way through a wall.
{
  const { grid, sim } = makeWorld();
  floor(grid, 60);
  for (let y = 40; y < 59; y++) for (let x = 38; x <= 42; x++) grid.set(x, y, ALUMINUM.id);
  const bar = count(grid, ALUMINUM.id);
  for (let x = 38; x <= 42; x++) grid.set(x, 39, LIQUID_GALLIUM.id);
  // Counted with the overlap slot: as the wall crumbles the puddle sinks into the
  // fresh powder bed, and a drop riding a grain's 겹침 slot is still a drop.
  const gallium = countWithOverlay(grid, LIQUID_GALLIUM.id);
  for (let t = 0; t < 200; t++) {
    // Hold the puddle above its 28° set point. Ambient is 20°, so gallium left
    // alone freezes within a few ticks and the run would be measuring the melt
    // point rather than the embrittlement (that half is checked below).
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const id = grid.get(x, y);
        const over = grid.getOverlay(x, y);
        if (id === LIQUID_GALLIUM.id || id === GALLIUM.id || over === LIQUID_GALLIUM.id) {
          grid.setTemp(x, y, 40); // an overlap fluid shares its host cell's temperature
        }
      }
    }
    sim.step();
  }
  check('liquid gallium crumbles cast Aluminum into Aluminum Powder',
    count(grid, ALUMINUM.id) < bar && count(grid, ALUMINUM_POWDER.id) > 0,
    `${bar - count(grid, ALUMINUM.id)} cells eaten → ${count(grid, ALUMINUM_POWDER.id)} powder`);
  check('…without being consumed (one drop keeps eating)',
    countWithOverlay(grid, LIQUID_GALLIUM.id) === gallium,
    `${countWithOverlay(grid, LIQUID_GALLIUM.id)}/${gallium} drops left`);

  // The off switch: solid Gallium is the same metal two degrees colder and does
  // nothing, so chilling the puddle stops it mid-meal.
  const { grid: g2, sim: s2 } = makeWorld();
  floor(g2, 60);
  for (let y = 40; y < 59; y++) for (let x = 38; x <= 42; x++) g2.set(x, y, ALUMINUM.id);
  const bar2 = count(g2, ALUMINUM.id);
  for (let x = 38; x <= 42; x++) g2.set(x, 39, GALLIUM.id);
  for (let t = 0; t < 200; t++) {
    for (let x = 38; x <= 42; x++) if (g2.get(x, 39) === GALLIUM.id) g2.setTemp(x, 39, 10);
    s2.step();
  }
  check('…but frozen (solid) Gallium does not touch it', count(g2, ALUMINUM.id) === bar2,
    `${count(g2, ALUMINUM.id)}/${bar2}`);
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
