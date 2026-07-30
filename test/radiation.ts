// Headless behavioural harness for 방사선 피폭 — the pass that makes every material
// in the 방사능 palette tab lethal to the 생명 tab (src/game/engine/radiation.ts,
// driven from Simulation.updateCell off `Material.radiation`).
//
// What it pins down:
//   • 커버리지 — every material in the 방사능 category declares a dose, and every
//     material in the 생명 category either declares its `radiationDeath` remains
//     or is one of the three documented exemptions (Nanobot the machine, Bleached
//     Coral the dead skeleton, and living Coral which routes the dose into its own
//     백화 stress instead). This is the check that catches the silent failure:
//     a new radioactive material that kills nothing, or a new living material
//     that shrugs off a meltdown.
//   • 전 방사성 물질이 실제로 죽인다 — every registered radioactive material is
//     walked through the same scene and has to kill the probe sitting on it. The
//     probe is a Seed: alone in the roster it has no heat death at all, so the
//     same scene works for a cool bar of U238 and for a 1600° corium pool without
//     the result being confounded by temperature.
//   • 물질별 사체 — Plant/Seed → Ash, Termite → Sawdust, Yeast/Virus → nothing,
//     Slime/Acid Slime → Smoke.
//   • 산호는 백화 — a polyp beside a source loses its colour over time (via its
//     own stress meter, so it visibly stops growing first) and ends as Bleached
//     Coral, while the identical tank with an inert Stone in the source's place
//     keeps a living reef.
//   • 재군체화 차단 — a white skeleton in a cool, brine-filled tank never comes
//     back while a source is touching it, and does come back once it isn't.
//   • 차폐 — one cell of anything between the source and the life stops the dose
//     dead, and Nanobot (a machine) is never touched by it at all.
//
// Every scene boxes its source in Wall (a perfect heat boundary, conductivity 0)
// so the only thing reaching the target is the radiation itself — no boiled
// coolant, no conducted heat, nothing else to explain a death.
//
// Run: `node test/run-radiation.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial, allMaterials } from '../src/game/materials/registry';
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
/** Each block runs on its own seeded stream, so one scene's randomness can't
 *  shift every later scene's. Set SEED_BASE to re-run the whole harness on a
 *  different stream (`SEED_BASE=7 node test/run-radiation.mjs`) — nothing here is
 *  tuned to one lucky seed. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0x24d1);
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
const STONE = ID('Stone');
const SALTWATER = ID('Saltwater');
const ASH = ID('Ash');
const SAWDUST = ID('Sawdust');
const SMOKE = ID('Smoke');
const PLANT = ID('Plant');
const SEED = ID('Seed');
const TERMITE = ID('Termite');
const YEAST = ID('Yeast');
const VIRUS = ID('Virus');
const SLIME = ID('Slime');
const ACID_SLIME = ID('Acid Slime');
const CORAL = ID('Coral');
const BLEACHED = ID('Bleached Coral');
const NANOBOT = ID('Nanobot');
const U238 = ID('U238');

function makeWorld(w = 21, h = 21): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  const sim = new Simulation(grid);
  // Smoke is thinned to 35% at the default 'medium' level, which would drop most
  // of the slimes' remains before they could be counted. The scenes below care
  // about *what* a corpse is, not how much smoke the player wants to see.
  sim.setSmokeLevel('high');
  return { grid, sim };
}
/** Paint a rectangle straight into the buffers (the harness's "brush"). */
function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = grid.idx(x, y);
      grid.cells[i] = id;
      grid.aux[i] = 0;
      grid.temp[i] = getMaterial(id).thermal?.init ?? 20;
      grid.tint[i] = (Math.random() * 256) | 0;
    }
  grid.dirty.rebuild(grid.cells, grid.overlay, grid.width, grid.height);
}
const put = (grid: Grid, x: number, y: number, id: number): void => fill(grid, x, y, x, y, id);
const at = (grid: Grid, x: number, y: number): number => grid.cells[grid.idx(x, y)];
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
function run(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

// ── 1. Coverage: the two tag rosters ────────────────────────────────────────────
//
// The 방사능 tab is the *whole* of the source side and the 생명 tab the whole of
// the target side, so both are enumerated straight out of the registry — a
// material added to either category later shows up here whether or not anyone
// remembered this file.
reseed();
const RADIOACTIVE = allMaterials().filter((m) => m.category === 'radioactive');
const LIVING = allMaterials().filter((m) => m.category === 'life');
/** The 생명 materials that deliberately declare no `radiationDeath`, and why. Any
 *  other one missing it is a bug (a new life material nothing radioactive can
 *  kill), which is exactly what the check below is for. */
const EXEMPT = new Map<string, string>([
  ['Nanobot', '기계 — a machine, not life; it keeps working in a hot zone'],
  ['Bleached Coral', '이미 죽은 골격 — nothing left in it to kill'],
  ['Coral', '백화 — routes the dose into its own bleaching stress instead'],
]);

check('방사능 카테고리가 비어있지 않다', RADIOACTIVE.length >= 5, `${RADIOACTIVE.length}종`);
const doseless = RADIOACTIVE.filter((m) => !(m.radiation && m.radiation > 0)).map((m) => m.name);
check(
  '방사능 카테고리 전 물질이 선량(Material.radiation)을 선언한다',
  doseless.length === 0,
  doseless.length ? `누락: ${doseless.join(', ')}` : RADIOACTIVE.map((m) => `${m.name} ${m.radiation}`).join(' / '),
);
const undeclared = LIVING.filter((m) => m.radiationDeath === undefined && !EXEMPT.has(m.name)).map(
  (m) => m.name,
);
check(
  '생명 카테고리 전 물질이 사체(radiationDeath)를 선언하거나 명시적 예외다',
  undeclared.length === 0,
  undeclared.length ? `누락: ${undeclared.join(', ')}` : `예외 ${[...EXEMPT.keys()].join(', ')}`,
);
const wrongExempt = [...EXEMPT.keys()].filter(
  (n) => getMaterial(ID(n)).radiationDeath !== undefined,
);
check(
  '예외로 적어 둔 물질은 실제로도 사체를 선언하지 않는다',
  wrongExempt.length === 0,
  wrongExempt.join(', '),
);
// Nothing outside the 생명 tab should have picked the tag up: radiation kills
// living things, it doesn't quietly transmute rock.
const strayDeath = allMaterials()
  .filter((m) => m.radiationDeath !== undefined && m.category !== 'life')
  .map((m) => m.name);
check('생명 카테고리 밖에는 radiationDeath가 없다', strayDeath.length === 0, strayDeath.join(', '));

// ── 2. Every radioactive material actually kills ───────────────────────────────
//
// One scene, walked over the whole 방사능 roster: the source sits in a Wall pocket
// with a single open face, and a Seed rests on that face. Wall conducts nothing,
// so a 1600° melt is as thermally inert to the probe as a cool bar of U238 — and
// a Seed has no heat death of its own anyway, which is what makes it the one
// probe that reads the same for every source. It also isn't flammable, so a melt
// can't light it instead. The only thing that can turn it to Ash is the dose.
for (const source of RADIOACTIVE) {
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 0, 20, 20, WALL);
  put(grid, 10, 10, source.id);
  put(grid, 10, 9, SEED); // resting on the source, its one open face
  // Mean time to death is 1/dose ticks; the slowest source (U238, 0.02) needs ~50,
  // so 900 is far past any plausible unlucky streak without hiding a broken source.
  run(sim, 900);
  check(
    `${source.name} (선량 ${source.radiation}) 이 인접한 씨앗을 죽인다`,
    at(grid, 10, 9) !== SEED && count(grid, ASH) > 0,
    `씨앗 자리 = ${getMaterial(at(grid, 10, 9))?.name}`,
  );
}

// ── 3. 물질별 사체 ──────────────────────────────────────────────────────────────
//
// Same pocket, one target per living material, all against U238 — the coolest,
// most inert source there is (a lone cell has no fellow uranium to chain off, so
// it never self-heats), so nothing but the dose is acting on the target.
//
// Two targets need their geometry adjusted rather than their source:
//   • Termite crawls, so it's given a one-cell pocket to be trapped in; a bug
//     that wandered off would "survive" for reasons that have nothing to do with
//     radiation.
//   • Acid Slime corrodes any non-resistant solid it touches *cardinally*, U238
//     included, so it's placed diagonally from the source: the dose reaches over
//     the diagonal (8-neighbourhood), its corrosion doesn't (DIR4), and the test
//     measures the slime dying rather than the slime eating its executioner.
const CORPSES: { name: string; id: number; remains: number; diagonal?: boolean }[] = [
  { name: 'Plant', id: PLANT, remains: ASH },
  { name: 'Seed', id: SEED, remains: ASH },
  { name: 'Termite', id: TERMITE, remains: SAWDUST },
  { name: 'Yeast', id: YEAST, remains: EMPTY },
  { name: 'Virus', id: VIRUS, remains: EMPTY },
  { name: 'Slime', id: SLIME, remains: SMOKE },
  { name: 'Acid Slime', id: ACID_SLIME, remains: SMOKE, diagonal: true },
];
for (const t of CORPSES) {
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 0, 20, 20, WALL);
  put(grid, 10, 10, U238);
  const tx = t.diagonal ? 9 : 10;
  put(grid, tx, 9, t.id);
  // Stepped one tick at a time so the corpse is read on the tick it appears. Smoke
  // has a lifetime of its own (it decays back to Empty), so checking "is there
  // Smoke on the board" a thousand ticks later would fail for the slimes for a
  // reason that has nothing to do with what killed them.
  let leftBehind = -1;
  for (let i = 0; i < 1200 && leftBehind < 0; i++) {
    sim.step();
    if (count(grid, t.id) === 0) leftBehind = at(grid, tx, 9);
  }
  check(`${t.name} 은 피폭사한다`, leftBehind >= 0, `남은 수 ${count(grid, t.id)}`);
  check(
    `${t.name} 의 사체는 ${t.remains === EMPTY ? '없음' : getMaterial(t.remains).name}`,
    leftBehind === t.remains,
    leftBehind >= 0 && leftBehind !== t.remains
      ? `실제 = ${getMaterial(leftBehind)?.name ?? leftBehind}`
      : '',
  );
  // The diagonal placement is only meaningful if the source is still standing:
  // Acid Slime corrodes anything non-resistant it touches cardinally, U238
  // included, so a cardinal scene could pass by the slime eating its executioner
  // and then dying of something else entirely.
  if (t.diagonal) {
    check(
      `${t.name} 은 부식 사거리 밖(대각선)에서도 피폭된다 — 선원은 멀쩡`,
      at(grid, 10, 10) === U238,
      `선원 = ${getMaterial(at(grid, 10, 10))?.name}`,
    );
  }
}

// ── 4. 차폐 — one cell of anything stops it ────────────────────────────────────
reseed();
{
  const { grid, sim } = makeWorld();
  fill(grid, 0, 0, 20, 20, WALL);
  put(grid, 10, 10, U238);
  put(grid, 10, 9, STONE); // the shield
  put(grid, 10, 8, PLANT); // two cells out — out of the 8-neighbourhood
  run(sim, 3000);
  check(
    '한 칸만 가려도 방사선이 막힌다 (인접 8칸이 전부)',
    at(grid, 10, 8) === PLANT,
    `가려진 식물 자리 = ${getMaterial(at(grid, 10, 8))?.name}`,
  );
}

// ── 5. 나노봇은 기계라 죽지 않는다 ──────────────────────────────────────────────
reseed();
{
  const { grid, sim } = makeWorld();
  fill(grid, 0, 0, 20, 20, WALL);
  put(grid, 10, 10, U238);
  put(grid, 10, 9, NANOBOT); // boxed in against the source's one open face
  run(sim, 3000);
  check(
    '나노봇(기계)은 방사선에 죽지 않는다',
    count(grid, NANOBOT) === 1,
    `남은 수 ${count(grid, NANOBOT)}`,
  );
}

// ── 6. 산호는 즉사가 아니라 백화한다 ───────────────────────────────────────────
//
// A brine tank sealed in Wall, its floor a Wall shelf with one cell cut out for
// the source; a single polyp sits over that cell with three brine neighbours
// above it (its hydration supply). The source touches nothing but the polyp — so
// it boils none of the brine and conducts no heat into the tank — which is the
// whole reason the pocket is here: a bare uranium cell in open water flashes the
// coolant around it to steam, and a reef bleached by *that* would prove nothing.
function coralTank(floorCell: number): { grid: Grid; sim: Simulation } {
  const { grid, sim } = makeWorld(21, 21);
  fill(grid, 0, 0, 20, 20, WALL);
  fill(grid, 1, 1, 19, 12, SALTWATER); // the tank
  fill(grid, 1, 13, 19, 19, WALL); // its floor…
  put(grid, 10, 13, floorCell); // …with the source (or an inert control) set into it
  // Wall shoulders either side of the polyp, so the cell in the floor touches
  // nothing but the polyp itself: a bare uranium cell in open brine flashes the
  // water around it to Steam, and neither a reef bleached by *that* nor a skeleton
  // that failed to recolonise in a boiled-dry tank would say anything about
  // radiation. With the shoulders in place the polyp keeps exactly RECOVER_BRINE
  // (3) brine neighbours above it and the source has no coolant to reach.
  put(grid, 9, 12, WALL);
  put(grid, 11, 12, WALL);
  put(grid, 10, 12, CORAL); // the polyp, sitting on the source, brine on three sides
  return { grid, sim };
}
reseed();
{
  const { grid, sim } = coralTank(U238);
  // Halfway through, the polyp should still be a *living, stressed* coral: this is
  // the difference between "bleaches over time" and "flips to skeleton instantly".
  run(sim, 60);
  const stillAliveEarly = at(grid, 10, 12) === CORAL;
  run(sim, 5000);
  check('피폭된 산호는 처음엔 살아 있다 (즉사가 아님)', stillAliveEarly);
  check(
    '피폭된 산호는 결국 백화한다',
    at(grid, 10, 12) === BLEACHED,
    `산호 자리 = ${getMaterial(at(grid, 10, 12))?.name}`,
  );
}
reseed();
{
  // Control: the identical tank with inert Stone where the source was. Same brine,
  // same geometry, same temperature — so a bleach here would mean the scene, not
  // the radiation, is what kills.
  const { grid, sim } = coralTank(STONE);
  run(sim, 5060);
  check(
    '같은 수조에 선원이 없으면 산호는 멀쩡하다 (대조군)',
    at(grid, 10, 12) === CORAL && count(grid, CORAL) > 1,
    `산호 ${count(grid, CORAL)} / 백화 ${count(grid, BLEACHED)}`,
  );
}

// ── 7. 백화 골격은 방사선 아래서 재군체화하지 않는다 ────────────────────────────
//
// Same tank, a bare skeleton in place of the polyp. Recolonisation asks for cool
// water and three brine neighbours, which this scene gives it — the only thing
// withheld is a clean tank.
reseed();
{
  const { grid, sim } = coralTank(U238);
  put(grid, 10, 12, BLEACHED);
  run(sim, 20000);
  check(
    '선원이 닿아 있으면 백화 골격은 다시 산호가 되지 않는다',
    at(grid, 10, 12) === BLEACHED && count(grid, CORAL) === 0,
    `골격 자리 = ${getMaterial(at(grid, 10, 12))?.name}`,
  );
}
reseed();
{
  // …and the same skeleton in the same tank does come back once the source is
  // gone, so the block above is the radiation and not the scene being unlivable.
  const { grid, sim } = coralTank(STONE);
  put(grid, 10, 12, BLEACHED);
  run(sim, 20000);
  check(
    '선원이 없으면 같은 골격이 재군체화한다 (대조군)',
    count(grid, CORAL) > 0,
    `산호 ${count(grid, CORAL)}`,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
