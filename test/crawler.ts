// Headless behavioural harness for the two surface-crawling bugs —
// Termite (materials/termite.ts) and Nanobot (materials/nanobot.ts), over the
// locomotion they share (materials/crawler.ts).
//
// What it pins down:
//
//   • **흰개미의 50% 소멸/증식** — a colony no longer converts a timber wall into
//     its own mass cell for cell. Half of what it gnaws goes back to empty air
//     and half becomes another termite, so the eaten total runs about *twice*
//     the population gained. The old behaviour (every meal reproduces) makes the
//     two numbers equal, so the ratio check is the regression pin, and it comes
//     with the two halves nailed down separately: the swarm still grows, and the
//     wood really is gone (not merely relabelled).
//
//   • **나노봇의 금속 기억** — a nanobot is built out of whatever it last ate, and
//     that memory (철/알루미늄) rides in the spare `aux` bits the locomotion layer
//     leaves free. The scenes below check that eating aluminum stamps *both* the
//     eater and the newborn, that a control swarm fed iron stays iron, that a
//     hundred ticks of crawling — which rewrites the heading in the same `aux`
//     word every single tick — never disturbs the memory, and then that all three
//     of the metal's properties actually follow it:
//       – 녹는점: an aluminum-bodied bot slumps into Molten Aluminum at 660° in a
//         heat an iron-bodied one (control, same bed, same ticks) walks through
//         untouched; the iron one melts into Molten Iron at 1200°.
//       – 파괴: a blast leaves the powder of *that bot's* metal, on both residue
//         paths — the crater epicenter (Material.blastDeathIdFor) and the rim its
//         own update catches via an adjacent Blast cell.
//       – 소금물 부식: an iron-bodied swarm rusts in brine; an aluminum-bodied one
//         in the same pool never does.
//
// Run: `node test/run-crawler.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial } from '../src/game/materials/registry';
import { detonate, flashCell } from '../src/game/materials/blast';
import { Phase } from '../src/game/engine/types';
import '../src/game/materials';

check('Termite phase is Phase.Powder', getMaterial(TERMITE).phase === Phase.Powder);
check('Nanobot phase is Phase.Powder', getMaterial(NANOBOT).phase === Phase.Powder);
check('Fish phase is Phase.Powder', getMaterial(ID('Fish')).phase === Phase.Powder);

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
/** Each block runs on its own seeded stream, so a change to one scene can't shift
 *  every later scene's randomness. None of the checks are tuned to one lucky
 *  stream: `SEED_BASE=7 node test/run-crawler.mjs` should pass just as well. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0xc4a3);
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
const TERMITE = ID('Termite');
const NANOBOT = ID('Nanobot');
const WOOD = ID('Wood');
const SAWDUST = ID('Sawdust');
const STONE = ID('Stone');
const WALL = ID('Wall');
const IRON = ID('Iron');
const IRON_POWDER = ID('Iron Powder');
const MOLTEN_IRON = ID('Molten Iron');
const ALUMINUM = ID('Aluminum');
const ALUMINUM_POWDER = ID('Aluminum Powder');
const MOLTEN_ALUMINUM = ID('Molten Aluminum');
const SALTWATER = ID('Saltwater');
const RUST_POWDER = ID('Rust Powder');

// The 금속 기억 lives above the 3 heading bits crawler.ts owns (see its aux layout
// note). The harness reads/writes the raw word so a change to that packing shows
// up here rather than silently.
const HEADING_BITS = 3;
const METAL_IRON = 0;
const METAL_ALUMINUM = 1;
const metalOf = (grid: Grid, x: number, y: number): number =>
  grid.aux[grid.idx(x, y)] >>> HEADING_BITS;
const headingOf = (grid: Grid, x: number, y: number): number =>
  grid.aux[grid.idx(x, y)] & ((1 << HEADING_BITS) - 1);
function stampMetal(grid: Grid, x: number, y: number, metal: number): void {
  grid.aux[grid.idx(x, y)] = metal << HEADING_BITS;
}

function makeWorld(w = 70, h = 70): { grid: Grid; sim: Simulation } {
  const grid = new Grid(w, h);
  return { grid, sim: new Simulation(grid) };
}
function fill(grid: Grid, x0: number, y0: number, x1: number, y1: number, id: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid.set(x, y, id);
}
function floor(grid: Grid, y: number, id = STONE): void {
  fill(grid, 0, y, grid.width - 1, grid.height - 1, id);
}
/** A sealed room of Wall — nothing crawls in or out, nothing leaks heat. */
function room(grid: Grid, x0: number, y0: number, x1: number, y1: number): void {
  fill(grid, x0, y0, x1, y0, WALL);
  fill(grid, x0, y1, x1, y1, WALL);
  fill(grid, x0, y0, x0, y1, WALL);
  fill(grid, x1, y0, x1, y1, WALL);
}
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
function findFirst(grid: Grid, id: number): { x: number; y: number } | null {
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) if (grid.get(x, y) === id) return { x, y };
  return null;
}
/** Every cell of `id`, so a scene can assert something about the whole swarm. */
function cellsOf(grid: Grid, id: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) if (grid.get(x, y) === id) out.push({ x, y });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 흰개미 — 갉아먹은 나무의 절반은 사라지고 절반만 흰개미가 된다.
// ─────────────────────────────────────────────────────────────────────────────
{
  reseed();
  const { grid, sim } = makeWorld(70, 70);
  floor(grid, 60);
  // A solid timber block with a colony seeded along its top face. Nothing here
  // can kill a termite (no water, no heat, no blast), so every change in the
  // population is a birth and every change in the wood total is a meal.
  fill(grid, 15, 40, 54, 59, WOOD);
  for (let x = 20; x < 26; x++) grid.set(x, 39, TERMITE);

  const wood0 = count(grid, WOOD);
  const bugs0 = count(grid, TERMITE);
  for (let t = 0; t < 900; t++) sim.step();
  const eaten = wood0 - count(grid, WOOD);
  const born = count(grid, TERMITE) - bugs0;
  const ratio = born / eaten;

  check('흰개미가 나무를 갉아먹는다', eaten > 100, `${eaten}칸`);
  check('…군집은 여전히 번식한다', born > 20, `${bugs0} → ${bugs0 + born}마리`);
  check(
    '…먹은 것의 절반만 흰개미가 된다 (나머지는 소멸)',
    ratio > 0.35 && ratio < 0.65,
    `${eaten}칸 먹고 ${born}마리 증가 (${(ratio * 100).toFixed(1)}%)`,
  );
  // The regression pin proper: the old 100%-reproduce colony makes these equal.
  check('…옛 100% 증식이었다면 두 수가 같았다', eaten - born > 50, `차이 ${eaten - born}칸`);
  // …and the difference really is gone, not merely turned into something else:
  // no death happened, so no Sawdust was created either.
  check('…죽은 개체가 없으므로 톱밥도 생기지 않았다', count(grid, SAWDUST) === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 나노봇 — 갉아먹은 금속을 기억한다 (알루미늄 / 철 대조군).
// ─────────────────────────────────────────────────────────────────────────────
for (const [label, food, want] of [
  ['알루미늄', ALUMINUM, METAL_ALUMINUM],
  ['철', IRON, METAL_IRON],
] as const) {
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  // A bot walled in by its food on all eight sides: it can't wander off before it
  // eats, so the scene measures the meal and nothing else.
  fill(grid, 12, 12, 27, 27, food);
  grid.set(20, 20, NANOBOT);

  let ticks = 0;
  while (ticks < 900 && count(grid, NANOBOT) < 6) {
    sim.step();
    ticks++;
  }
  const swarm = cellsOf(grid, NANOBOT);
  const allRemember = swarm.every((c) => metalOf(grid, c.x, c.y) === want);
  check(
    `나노봇이 ${label}을 갉아먹고 번식한다`,
    swarm.length >= 6,
    `${ticks}틱에 ${swarm.length}마리`,
  );
  check(
    `…무리 전체가 먹은 금속(${label})을 기억한다`,
    allRemember,
    `기억 = [${[...new Set(swarm.map((c) => metalOf(grid, c.x, c.y)))].join(',')}]`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 기억은 기어다니는 내내 유지된다 — 이동 방향이 같은 aux 워드를 매 틱 덮어쓴다.
// ─────────────────────────────────────────────────────────────────────────────
{
  reseed();
  const { grid, sim } = makeWorld(50, 50);
  floor(grid, 40);
  grid.set(20, 39, NANOBOT);
  stampMetal(grid, 20, 39, METAL_ALUMINUM);

  for (let t = 0; t < 200; t++) sim.step();
  const bot = findFirst(grid, NANOBOT);
  check('200틱을 기어다닌 뒤에도 나노봇이 살아 있다', bot !== null);
  if (bot) {
    check('…돌아다녔다 (자리를 옮겼거나 방향을 잡았다)', bot.x !== 20 || headingOf(grid, bot.x, bot.y) !== 0, `(${bot.x},${bot.y})`);
    check(
      '…금속 기억은 그대로다 (방향 비트가 침범하지 않는다)',
      metalOf(grid, bot.x, bot.y) === METAL_ALUMINUM,
      `기억 = ${metalOf(grid, bot.x, bot.y)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 녹는점이 기억한 금속을 따른다 — 660°(알루미늄) / 1200°(철).
// ─────────────────────────────────────────────────────────────────────────────
/** Sit a bot of the given body on a bed held at `bedTemp` and report what it
 *  turned into (or NANOBOT if it survived the whole run). */
function meltScene(metal: number, bedTemp: number): number {
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  floor(grid, 30);
  grid.set(20, 29, NANOBOT);
  stampMetal(grid, 20, 29, metal);
  for (let t = 0; t < 300; t++) {
    // Hold the whole floor hot, the way a bed of terrain would (test/aluminum.ts
    // heats the same way) — the bot is free to crawl and stays on the bed.
    for (let y = 30; y < 34; y++) for (let x = 0; x < grid.width; x++) grid.setTemp(x, y, bedTemp);
    sim.step();
    if (count(grid, NANOBOT) === 0) break;
  }
  if (count(grid, MOLTEN_ALUMINUM) > 0) return MOLTEN_ALUMINUM;
  if (count(grid, MOLTEN_IRON) > 0) return MOLTEN_IRON;
  return count(grid, NANOBOT) > 0 ? NANOBOT : EMPTY;
}
{
  check(
    '알루미늄을 기억한 나노봇은 700°에 Molten Aluminum으로 녹는다',
    meltScene(METAL_ALUMINUM, 700) === MOLTEN_ALUMINUM,
  );
  check(
    '…같은 700° 위의 철 나노봇은 멀쩡하다 (대조군 — 철의 융점은 1200°)',
    meltScene(METAL_IRON, 700) === NANOBOT,
  );
  check(
    '…철 나노봇은 1250°에서 Molten Iron으로 녹는다',
    meltScene(METAL_IRON, 1250) === MOLTEN_IRON,
  );
  check(
    '…알루미늄 나노봇은 600°(융점 아래)에서는 멀쩡하다',
    meltScene(METAL_ALUMINUM, 600) === NANOBOT,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 파괴되면 기억한 금속의 가루로 — 크레이터 진앙(blastDeathIdFor)과 그 언저리
//    (자기 update의 인접 Blast 판정) 양쪽.
// ─────────────────────────────────────────────────────────────────────────────
for (const [label, metal, mine, theirs] of [
  ['알루미늄', METAL_ALUMINUM, ALUMINUM_POWDER, IRON_POWDER],
  ['철', METAL_IRON, IRON_POWDER, ALUMINUM_POWDER],
] as const) {
  // 5a. 진앙 — the destroy path, resolved inside detonate() on the calling tick.
  {
    reseed();
    const { grid, sim } = makeWorld(60, 60);
    floor(grid, 40);
    for (let x = 26; x < 34; x++) {
      grid.set(x, 39, NANOBOT);
      stampMetal(grid, x, 39, metal);
    }
    detonate(sim.context, 30, 38, 0, { reach: 10 });
    check(
      `폭발 직격은 ${label} 나노봇을 그 금속의 가루로 부순다`,
      count(grid, mine) > 0,
      `${count(grid, mine)}칸`,
    );
    check(`…다른 금속의 가루는 한 칸도 안 나온다`, count(grid, theirs) === 0);
  }
  // 5b. 언저리 — the rim path in updateNanobot: an adjacent Blast flash cell is
  //     certain death even for a bot the crater itself never reached.
  {
    reseed();
    const { grid, sim } = makeWorld(40, 40);
    floor(grid, 30);
    grid.set(20, 29, NANOBOT);
    stampMetal(grid, 20, 29, metal);
    for (let t = 0; t < 6 && count(grid, NANOBOT) > 0; t++) {
      const bot = findFirst(grid, NANOBOT);
      // A real *flash* cell (flashCell), not a hand-painted Blast — a raw Blast
      // at room temperature reads as a brush seed and detonates a whole crater,
      // which would test the epicenter path 5a all over again (and bury its
      // residue under the crater it made).
      if (bot) flashCell(sim.context, bot.x + 1, bot.y);
      sim.step();
    }
    check(
      `인접 폭발 섬광도 ${label} 나노봇을 그 금속의 가루로 부순다`,
      count(grid, NANOBOT) === 0 && count(grid, mine) > 0,
      `${count(grid, mine)}칸`,
    );
    check(`…역시 다른 금속의 가루는 안 나온다`, count(grid, theirs) === 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 소금물 부식도 기억한 금속을 따른다 — 철은 녹슬고 알루미늄은 안 녹슨다.
// ─────────────────────────────────────────────────────────────────────────────
for (const [label, metal, wantRust] of [
  ['철', METAL_IRON, true],
  ['알루미늄', METAL_ALUMINUM, false],
] as const) {
  reseed();
  const { grid, sim } = makeWorld(40, 40);
  // A sealed brine tank: the bots swim through the liquid (they ignore it) but
  // can't leave the box, so every one of them stays exposed for the whole run.
  room(grid, 8, 8, 31, 31);
  fill(grid, 9, 9, 30, 30, SALTWATER);
  for (let x = 12; x < 24; x++) {
    grid.set(x, 20, NANOBOT);
    stampMetal(grid, x, 20, metal);
  }
  const bots0 = count(grid, NANOBOT);
  for (let t = 0; t < 1500; t++) sim.step();
  const rust = count(grid, RUST_POWDER);
  check(
    `소금물 속 ${label} 나노봇은 ${wantRust ? '녹슨다' : '녹슬지 않는다'}`,
    wantRust ? rust > 0 : rust === 0,
    `${bots0}마리 중 Rust Powder ${rust}칸, 남은 나노봇 ${count(grid, NANOBOT)}마리`,
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
