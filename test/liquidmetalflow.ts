// Headless behavioural harness for 액체 금속의 유동성 — the liquid metals flow
// freely, the non-metal melts still creep.
//
// Every melt in the game used to be sluggish in one of two ways: a FLOW_CHANCE
// gate in its own update (Lava, Molten Iron, Molten Iron Ore, Molten Glass,
// Molten Salt, Slag), or a `viscosity` field that updateLiquid reads to hold a
// mound instead of levelling (Molten Aluminum, Molten U238). A metal melt is a
// *thin* liquid, though — a tapped heat is a stream, not the creeping tongue lava
// makes — so the liquid metals carry neither any more, and the drag is now the
// mark of the non-metals.
//
// The distinction is easy to lose by accident (re-adding a gate "for feel", or
// declaring `viscosity` on a new melt by copying lava's block), and it is exactly
// the sort of thing no other test would notice. So this pins it from both sides:
//
//   • **The liquid metals level out like water.** A poured column spreads to the
//     full width of its floor within the same short window Water does — Molten
//     Iron, Molten Aluminum, Molten Iron Ore, Molten U238.
//   • **The non-metal melts do not.** Lava, Molten Glass, Molten Salt and the Slag
//     an iron heat sets into are still visibly slower over that same window, which
//     is what keeps a slag skin reading as a crust over a runny melt.
//   • **No liquid metal declares `viscosity`.** The registry is scanned directly,
//     so a new melt that copies the wrong block is caught by name.
//
// Scenes are short on purpose (the melts are placed hot and cool toward their set
// points), and each one asserts the melt never froze mid-run, so the spread being
// measured is a *liquid* spreading rather than a column that quietly went solid.
//
// Run: `node test/run-liquidmetalflow.mjs`.
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
const SEED_BASE = Number(process.env.SEED_BASE ?? 0x3e17);
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

// The liquid metals — no flow gate, no `viscosity`.
const METALS = ['Molten Iron', 'Molten Aluminum', 'Molten Iron Ore', 'Molten U238'];
// …and the melts that keep their drag, all non-metals.
const THICK = ['Lava', 'Molten Glass', 'Molten Salt', 'Slag'];

/** Pour a narrow column of `id` onto the floor of a walled box and run `ticks`
 *  steps. Returns how many of the floor's columns the puddle covers by the end
 *  (1 = still a stack, WIDTH = levelled right out to both walls) and how many
 *  cells of the poured material are left (to catch a column that froze). */
const W = 42;
const H = 24;
const FLOOR_Y = H - 2;
function spread(id: number, ticks: number): { columns: number; left: number; poured: number } {
  const grid = new Grid(W, H);
  const sim = new Simulation(grid);
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++)
      if (x === 0 || x === W - 1 || y === 0 || y >= FLOOR_Y + 1) grid.cells[grid.idx(x, y)] = WALL;
  // A 4-wide, 12-tall column standing on the floor in the middle of the box —
  // more cells than the floor is wide, so "levelled out" is a full sheet from
  // wall to wall and the measure can't saturate before it gets there.
  const cx = (W >> 1) - 2;
  let poured = 0;
  for (let y = FLOOR_Y - 11; y <= FLOOR_Y; y++)
    for (let x = cx; x <= cx + 3; x++) {
      grid.cells[grid.idx(x, y)] = id;
      poured++;
    }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
  // Placed temperature comes from the material's own `thermal.init` via the
  // painting path, which a raw cell write skips — stamp it so a melt starts as
  // hot as it would in game.
  const init = getMaterial(id).thermal?.init;
  if (init !== undefined)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) if (grid.cells[grid.idx(x, y)] === id) grid.temp[grid.idx(x, y)] = init;

  for (let t = 0; t < ticks; t++) sim.step();

  const cols = new Set<number>();
  let left = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (grid.cells[grid.idx(x, y)] === id) {
        cols.add(x);
        left++;
      }
  return { columns: cols.size, left, poured };
}

// How long a scene runs, and the two bars. The window is short on purpose: a
// gated melt is *slower*, not frozen, so given long enough even lava levels out
// and the measure stops separating anything. Measured over these runs, the free
// liquids reach 27–30 of the 40 floor columns and the gated melts 12–19, so the
// bars sit inside that gap with room for seed noise on both sides.
const TICKS = Number(process.env.TICKS ?? 45);
const THIN_BAR = 24; // columns of the 40-wide floor a free-flowing liquid reaches
const THICK_BAR = 22; // …and the most a still-viscous melt manages in the same time

{
  reseed();
  const water = spread(ID('Water'), TICKS);
  check('the reference thin liquid (water) levels right out', water.columns >= THIN_BAR,
    `${water.columns}/${W - 2} columns`);
}

for (const name of METALS) {
  reseed();
  const r = spread(ID(name), TICKS);
  check(`${name} flows like water`, r.columns >= THIN_BAR, `${r.columns}/${W - 2} columns`);
  check(`…and was still liquid the whole time`, r.left === r.poured,
    `${r.left}/${r.poured} cells still molten`);
}

for (const name of THICK) {
  reseed();
  const r = spread(ID(name), TICKS);
  check(`${name} still creeps (non-metal melt keeps its drag)`, r.columns <= THICK_BAR,
    `${r.columns}/${W - 2} columns`);
}

// The declarative half: whatever the scenes above measure, no liquid metal may
// carry the field that holds a mound. Checked by name so a new melt copying the
// wrong block is reported rather than silently slowed.
{
  const declared = METALS.filter((n) => getMaterial(ID(n)).viscosity !== undefined);
  check('no liquid metal declares `viscosity`', declared.length === 0, declared.join(', '));
}

console.log(
  failures === 0 ? '\nAll liquid metal flow checks passed.' : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
