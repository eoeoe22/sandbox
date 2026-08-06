// Headless behavioural harness for the 부패 계통 — the shared spoilage model
// (materials/spoil.ts), 곰팡이 (mold.ts), 부패물 (spoiledfood.ts), 퇴비
// (compost.ts), and the fertility those last two buy the plant line
// (soil.ts / plant.ts).
//
// What it pins down:
//   • 무엇이 썩고 무엇이 안 썩는가. The five foods rot; 나무·톱밥·식물·밀가루·
//     옥수수·팝콘·탄 고기 do not, and that boundary is the whole safety property
//     of the round — a build must never decay out from under its owner. The
//     negative half is checked against the *registry*, so a `spoil` tag added to
//     a structural material in future fails here by name rather than in someone's
//     save file.
//   • 보존 넷. 저온·고온·염장·담금 each hold a cut indefinitely, and all four are
//     a *pause*: unsalt it and it carries on from where it stopped rather than
//     restarting or completing. That is the difference between this and a
//     memoryless decay roll, so it is measured rather than asserted.
//   • 육포. A cut dried out by a low heat keeps forever, off the dryness counter
//     meat.ts already maintains — and a cut that is merely cooked does not.
//   • 곰팡이는 아무것도 파괴하지 않는다. A stone/glass/iron/wood box with rotting
//     food inside comes out with every wall cell intact, however long it runs.
//     This is the requirement the design was built around and the one that would
//     be most damaging to get wrong.
//   • 곰팡이는 한 겹이다. It films a surface rather than filling a room — measured
//     as "no mold cell is surrounded only by mold and air", i.e. every colony cell
//     still touches something real.
//   • 물속에는 안 핀다, with no rule of its own: a submerged surface has no empty
//     cells against it.
//   • 전염 경로. Mold against food is what makes a stack go over together — a
//     stack seeded with one rotting cell finishes markedly sooner than the same
//     stack with mold suppressed.
//   • 사슬은 질량을 보존한다. N cells of food end up as N cells of 퇴비, through
//     부패물, with nothing created or lost on either transform.
//   • 퇴비는 밭이다. A seed germinates on it, and a plant rooted over a compost bed
//     grows visibly bigger than the same plant on the same water over plain dirt.
//
// Run: `node test/run-spoil.mjs`.
import { Grid } from '../src/game/engine/Grid';
import { Simulation } from '../src/game/engine/Simulation';
import { getMaterial, allMaterials } from '../src/game/materials/registry';
import { SPOIL_MASK } from '../src/game/materials/spoil';
import { DRY_MASK } from '../src/game/materials/meat';
import { BURNT_LIT_BIT } from '../src/game/materials/burntmeat';
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
/** Each block runs on its own seeded stream, so a change to one scene can't shift
 *  every later scene's randomness. Nothing below is tuned to one lucky stream:
 *  `SEED_BASE=7 node test/run-spoil.mjs` should pass too. */
const SEED_BASE = Number(process.env.SEED_BASE ?? 0x5b01);
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
const RAW_MEAT = ID('Raw Meat');
const COOKED_MEAT = ID('Cooked Meat');
const BURNT_MEAT = ID('Burnt Meat');
const BREAD = ID('Bread');
const BATTER = ID('Batter');
const DEAD_FISH = ID('Dead Fish');
const SPOILED = ID('Spoiled Food');
const COMPOST = ID('Compost');
const MOLD = ID('Mold');
const SALT = ID('Salt');
const HONEY = ID('Honey');
const ALCOHOL = ID('Alcohol');
const STONE = ID('Stone');
const GLASS = ID('Glass');
const IRON = ID('Iron');
const WOOD = ID('Wood');
const WATER = ID('Water');
const DIRT = ID('Dirt');
const SEED = ID('Seed');
const PLANT = ID('Plant');
const ASH = ID('Ash');

/** The three bits a spoilage counter occupies, before it is shifted into place. */
const SPOIL_FIELD = SPOIL_MASK;

/** ×1 sim speed, mirroring config.SIM_HZ_AT_1X — the harness states its
 *  expectations in seconds and converts here. */
const HZ = 30;
/** Room temperature (config.AMBIENT_TEMP), the anchor every declared 부패 시간 is
 *  quoted at. Scenes that mean "left on the counter" simply don't set a
 *  temperature. */
const ROOM = 20;

function makeWorld(w = 40, h = 30): { grid: Grid; sim: Simulation } {
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
const put = (grid: Grid, x: number, y: number, id: number): void => {
  fill(grid, x, y, x, y, id);
};
function count(grid: Grid, id: number): number {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i] === id) n++;
  return n;
}
function setTemp(grid: Grid, x0: number, y0: number, x1: number, y1: number, t: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid.temp[grid.idx(x, y)] = t;
}
/** Hold a rectangle at a temperature every tick — the harness's stand-in for an
 *  environment (a freezer, a warm plate) rather than a one-shot heat brush. */
function run(
  sim: Simulation,
  grid: Grid,
  ticks: number,
  hold?: { x0: number; y0: number; x1: number; y1: number; t: number },
): void {
  for (let i = 0; i < ticks; i++) {
    if (hold) setTemp(grid, hold.x0, hold.y0, hold.x1, hold.y1, hold.t);
    sim.step();
  }
}
/** A sealed box of `wall`, `inner` cells across, with its interior at (x0,y0). */
function box(grid: Grid, x0: number, y0: number, inner: number, wall: number): void {
  fill(grid, x0 - 1, y0 - 1, x0 + inner, y0 + inner, wall);
  fill(grid, x0, y0, x0 + inner - 1, y0 + inner - 1, EMPTY);
}

// ── 1. 무엇이 썩고, 무엇이 절대 안 썩는가 ────────────────────────────────────
// The safety property of the whole round, checked at the registry rather than by
// simulating: 부패 is declared, so the roster of what decays is a fact about the
// material table and can be stated exactly.
{
  const rots = new Set(
    allMaterials()
      .filter((m) => m.spoil !== undefined)
      .map((m) => m.name),
  );
  const expected = ['Raw Meat', 'Cooked Meat', 'Bread', 'Batter', 'Dead Fish', 'Spoiled Food'];
  check(
    '썩는 것은 식품과 사체뿐 — 여섯, 이름까지',
    rots.size === expected.length && expected.every((n) => rots.has(n)),
    [...rots].sort().join(', '),
  );

  // The negative half, named one by one. Structural organics are the dangerous
  // ones (a decaying wall is the failure the design exists to prevent); the dry
  // foods are the honest ones (마른 것은 안 썩는다).
  const mustNotRot = [
    'Wood',
    'Sawdust',
    'Plant',
    'Seed',
    'Coral',
    'Amber',
    'Resin',
    'Coal',
    'Flour',
    'Corn Kernel',
    'Popcorn',
    'Burnt Meat',
    'Compost',
    'Sugar',
    'Honey',
    'Slime',
  ];
  const leaked = mustNotRot.filter((n) => rots.has(n));
  check(
    '나무·식물·마른 식품은 썩지 않는다 — 지어 둔 것이 삭지 않는다',
    leaked.length === 0,
    leaked.length ? `LEAKED: ${leaked.join(', ')}` : `${mustNotRot.length} materials checked`,
  );

  // Every declaration must keep its counter clear of whatever else that material
  // parks in the same word. Checked structurally rather than by eye because the
  // failure is silent — a steak that quietly changes colour, a loaf whose crust
  // flickers — and the shifts are the one thing SpoilSpec can't derive.
  const overlaps = allMaterials()
    .filter((m) => m.spoil !== undefined && m.spoil.dryMask !== undefined)
    .filter((m) => (m.spoil!.dryMask! & (SPOIL_FIELD << m.spoil!.auxShift)) !== 0)
    .map((m) => m.name);
  check(
    '부패 카운터가 같은 물질의 건조 카운터와 안 겹친다',
    overlaps.length === 0,
    overlaps.length ? `OVERLAP: ${overlaps.join(', ')}` : 'meat chain checked',
  );

  // …and clear of what the material it turns into parks there, which is the half
  // the check above cannot see and the half that actually shipped a bug.
  //
  // `sim.set` preserves aux, so an aux-preserving transform hands the whole word
  // to a material with its own conventions — and "bit 3 is free" can be true of
  // 익은 고기 and false of the 탄 고기 it becomes. It was: the spoilage counter
  // first went in at shift 3, landing on 탄 고기's alight bit, so a cut that had
  // rotted to any odd stage arrived pre-lit and `tryFlameOnlyBurn` let it burn on
  // radiant heat with no flame anywhere near it — the exact failure `flameOnly`
  // exists to prevent, arriving from a material that never touches that code.
  //
  // There is no registry of "which bits does this material claim", so the edges
  // are listed by hand. That is the honest form: each entry is a transform that
  // preserves aux, and adding one is the moment to think about this.
  const AUX_PRESERVING_EDGES: Array<{ from: number; to: number; bits: number; why: string }> = [
    // 익은 고기 --(200° + 바싹 마름)--> 탄 고기, cookedmeat.ts's own `sim.set`.
    { from: COOKED_MEAT, to: BURNT_MEAT, bits: BURNT_LIT_BIT, why: '탄 고기 alight 비트' },
    // 생고기 --(70°)--> 익은 고기, via `tryPhaseChange`. The target's only aux
    // users are the dryness counter and its own spoilage counter, and sharing the
    // latter is deliberate (a steak is not made fresh by cooking), so what is
    // checked is that the dryness counter is still clear.
    { from: RAW_MEAT, to: COOKED_MEAT, bits: DRY_MASK, why: '익은 고기 건조 카운터' },
  ];
  const crossOverlaps = AUX_PRESERVING_EDGES.filter((e) => {
    const spec = getMaterial(e.from).spoil;
    return spec !== undefined && (e.bits & (SPOIL_FIELD << spec.auxShift)) !== 0;
  });
  check(
    '부패 카운터가 **변한 뒤의** 물질이 쓰는 비트와도 안 겹친다',
    crossOverlaps.length === 0,
    crossOverlaps.length
      ? `OVERLAP: ${crossOverlaps.map((e) => `${getMaterial(e.from).name} → ${e.why}`).join(', ')}`
      : `${AUX_PRESERVING_EDGES.length} aux-preserving transforms checked`,
  );
}

// ── 1b. 썩다 만 고기를 태워도 불이 붙지는 않는다 ─────────────────────────────
// The behavioural half of the cross-material aux check above, and the scene that
// would have caught the bug on its own.
//
// 탄 고기 is 직화 전용: radiant heat must never light it, however fierce, because
// an oven cannot be cooler than the fire heating it (combustion.ts). A lit cell
// skips that gate entirely, so a spoilage counter overlapping 탄 고기's alight bit
// silently converted "rotted a bit first" into "ignites with no flame present".
// Measured before the fix: gone in 73 ticks. The scene has no Fire cell in it at
// all, which is what makes it an honest test of the gate.
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 24, 39, 26, STONE);
  fill(grid, 12, 22, 27, 23, COOKED_MEAT);
  // Bone dry (so it chars at once) and part-rotten — the odd stage is the point:
  // at the old shift that single bit *was* 탄 고기's alight flag.
  const spec = getMaterial(COOKED_MEAT).spoil!;
  for (let y = 22; y <= 23; y++)
    for (let x = 12; x <= 27; x++) grid.aux[grid.idx(x, y)] = DRY_MASK | (1 << spec.auxShift);
  const before = count(grid, COOKED_MEAT);
  run(sim, grid, 200, { x0: 11, y0: 21, x1: 28, y1: 24, t: 900 });
  check(
    '썩다 만 고기가 탄 고기가 돼도 불꽃 없이는 안 붙는다 (직화 전용 유지)',
    count(grid, BURNT_MEAT) === before && count(grid, ASH) === 0,
    `${count(grid, BURNT_MEAT)}/${before} 탄 고기 left at 900° with no flame, ` +
      `${count(grid, ASH)} 재`,
  );
}

// ── 2. 상온에 두면 썩는다, 그리고 부패물이 된다 ──────────────────────────────
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 5, 20, 24, 22, RAW_MEAT); // 60 cells on a shelf
  const before = count(grid, RAW_MEAT);
  run(sim, grid, 200 * HZ);
  check(
    '상온에 둔 생고기는 전부 썩는다',
    count(grid, RAW_MEAT) === 0,
    `${before} → ${count(grid, RAW_MEAT)} 생고기 after 200s`,
  );
  check(
    '…그리고 사라지는 게 아니라 부패물이 된다',
    count(grid, SPOILED) + count(grid, COMPOST) === before,
    `${count(grid, SPOILED)} 부패물 + ${count(grid, COMPOST)} 퇴비 = ${before}`,
  );
}

// ── 3. 사슬 전체가 질량을 보존한다: 식품 N칸 → 퇴비 N칸 ──────────────────────
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 4, 24, 35, 25, RAW_MEAT); // 64 cells, floor-level so nothing falls out
  const before = count(grid, RAW_MEAT);
  run(sim, grid, 900 * HZ);
  const total = count(grid, RAW_MEAT) + count(grid, SPOILED) + count(grid, COMPOST);
  check(
    '부패 사슬은 칸을 만들지도 잃지도 않는다',
    total === before,
    `${before} 생고기 → ${count(grid, SPOILED)} 부패물 + ${count(grid, COMPOST)} 퇴비 (합 ${total})`,
  );
  check(
    '…그리고 끝까지 가면 전부 퇴비다',
    count(grid, COMPOST) === before,
    `${count(grid, COMPOST)} of ${before} 퇴비 after 900s`,
  );
}

// ── 4. 보존 넷 ───────────────────────────────────────────────────────────────
// Each holds the same cut for four times its own spoil time. The control in the
// block above is what makes these mean anything: the identical scene without the
// preservation is completely gone by 200s.
{
  const KEEP = 240 * HZ;

  // 4a. 저온 — 냉장고. Held under 0° every tick.
  reseed();
  {
    const { grid, sim } = makeWorld();
    fill(grid, 10, 20, 19, 21, RAW_MEAT);
    const before = count(grid, RAW_MEAT);
    run(sim, grid, KEEP, { x0: 9, y0: 19, x1: 20, y1: 22, t: -10 });
    check(
      '저온 — 얼려 두면 안 썩는다',
      count(grid, RAW_MEAT) === before,
      `${count(grid, RAW_MEAT)} of ${before} left after 240s at -10°`,
    );
  }

  // 4b. 고온 — 조리 중인 것은 썩는 중이 아니다. Held over 60° but under the
  // 70° cook point, so the cut can't leave the material by cooking instead.
  reseed();
  {
    const { grid, sim } = makeWorld();
    fill(grid, 10, 20, 19, 21, RAW_MEAT);
    const before = count(grid, RAW_MEAT);
    run(sim, grid, KEEP, { x0: 9, y0: 19, x1: 20, y1: 22, t: 65 });
    check(
      '고온 — 익히는 중에는 썩지 않는다',
      count(grid, RAW_MEAT) === before,
      `${count(grid, RAW_MEAT)} of ${before} left after 240s at 65°`,
    );
  }

  // 4c. 염장 — a crust of Salt against the meat.
  reseed();
  {
    const { grid, sim } = makeWorld();
    fill(grid, 10, 21, 19, 21, RAW_MEAT);
    fill(grid, 10, 20, 19, 20, SALT); // salt laid straight on top
    fill(grid, 9, 22, 20, 22, STONE); // a shelf, so nothing falls apart
    const before = count(grid, RAW_MEAT);
    run(sim, grid, KEEP);
    check(
      '염장 — 소금에 절이면 안 썩는다',
      count(grid, RAW_MEAT) === before,
      `${count(grid, RAW_MEAT)} of ${before} left after 240s under salt`,
    );
  }

  // 4d. 담금 — a jar of honey, and the same in alcohol.
  for (const [id, label] of [
    [HONEY, '꿀'],
    [ALCOHOL, '알콜'],
  ] as const) {
    reseed();
    const { grid, sim } = makeWorld();
    box(grid, 10, 18, 8, STONE);
    fill(grid, 10, 18, 17, 25, id); // a sealed jar of it
    fill(grid, 12, 21, 15, 22, RAW_MEAT); // submerged in the middle
    const before = count(grid, RAW_MEAT);
    run(sim, grid, KEEP);
    check(
      `담금 — ${label}에 담가 두면 안 썩는다`,
      count(grid, RAW_MEAT) === before,
      `${count(grid, RAW_MEAT)} of ${before} left after 240s`,
    );
  }
}

// ── 5. 보존은 멈추는 것이지 되돌리는 것이 아니다 ─────────────────────────────
// The reason spoilage is a counter and not a per-tick roll. A cut is left out to
// go halfway over, frozen for a long while, then thawed: it must finish sooner
// than a fresh cut thawed at the same moment. A memoryless model would make the
// two indistinguishable, and a "preservation resets it" model would make the aged
// one *slower*.
{
  reseed();
  const { grid, sim } = makeWorld(40, 30);
  const W = grid.width;
  /** Meat on the left half (aged first) and on the right half (frozen throughout).
   *  Two populations in one world so they share a clock exactly. */
  const sides = (): [number, number] => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== RAW_MEAT) continue;
      if (i % W < 20) a++;
      else b++;
    }
    return [a, b];
  };
  fill(grid, 5, 20, 14, 21, RAW_MEAT); // A — left, aged at room temperature first
  fill(grid, 25, 20, 34, 21, RAW_MEAT); // B — right, held frozen from the start

  // Phase 1: A ages on the counter while B is kept frozen. A is *meant* to lose
  // some cells here — the point is only that it gets a head start.
  run(sim, grid, 30 * HZ, { x0: 24, y0: 19, x1: 35, y1: 22, t: -10 });
  const [agedA, freshB] = sides();

  // Phase 2: everything frozen. Neither side may move — including the half that
  // is sitting on a part-finished counter, which is the case a memoryless roll
  // could not represent at all.
  run(sim, grid, 120 * HZ, { x0: 0, y0: 0, x1: W - 1, y1: 29, t: -10 });
  const [heldA, heldB] = sides();
  check(
    '얼려 두는 동안에는 진행도 그대로 — 절반쯤 썩은 것도 안 넘어간다',
    heldA === agedA && heldB === freshB,
    `aged ${agedA} → ${heldA}, fresh ${freshB} → ${heldB} across 120s frozen`,
  );

  // Phase 3: thaw both and watch which finishes first. Temperature has to be put
  // back by hand — with no heat source in the scene, a frozen world simply stays
  // frozen (which is itself the freezer working).
  setTemp(grid, 0, 0, W - 1, 29, ROOM);
  let aGone = -1;
  let bGone = -1;
  for (let t = 0; t < 400 * HZ && (aGone < 0 || bGone < 0); t++) {
    sim.step();
    const [a, b] = sides();
    if (a === 0 && aGone < 0) aGone = t;
    if (b === 0 && bGone < 0) bGone = t;
  }
  check(
    '녹이면 멈춘 자리에서 이어진다 — 미리 썩힌 쪽이 확실히 먼저 끝난다',
    aGone >= 0 && bGone >= 0 && aGone < bGone,
    `aged gone at ${(aGone / HZ).toFixed(1)}s, fresh at ${(bGone / HZ).toFixed(1)}s`,
  );
}

// ── 6. 육포 — 바싹 말린 고기는 안 썩는다 ─────────────────────────────────────
// Free off meat.ts's own dryness counter. The control matters as much as the
// case: a cut that was merely *cooked* is not dry and does rot, so the exemption
// has to be earned by actually drying it out.
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 10, 20, 19, 21, RAW_MEAT);
  const before = count(grid, RAW_MEAT);
  // A low plate: over the cook point, well under the char point, held long enough
  // to run every cell's moisture counter out. 150° is the figure meat.ts quotes
  // as "bone dry in about half a minute and then safe forever".
  run(sim, grid, 90 * HZ, { x0: 9, y0: 19, x1: 20, y1: 22, t: 150 });
  const jerky = count(grid, COOKED_MEAT);
  check(
    '낮은 불에 오래 두면 바싹 마른 익은 고기가 된다',
    jerky === before && count(grid, BURNT_MEAT) === 0,
    `${jerky} 익은 고기, ${count(grid, BURNT_MEAT)} 탄 고기`,
  );
  // Off the heat, at room temperature, for four times its spoil time.
  setTemp(grid, 0, 0, 39, 29, ROOM);
  run(sim, grid, 440 * HZ);
  check(
    '육포 — 바싹 말린 고기는 상온에 두어도 안 썩는다',
    count(grid, COOKED_MEAT) === jerky,
    `${count(grid, COOKED_MEAT)} of ${jerky} left after 440s at room temperature`,
  );

  // Control: cooked but still moist. Same material, same shelf, same clock.
  reseed();
  const wet = makeWorld();
  fill(wet.grid, 10, 20, 19, 21, COOKED_MEAT); // aux 0 = 촉촉 (meat.ts)
  const wetBefore = count(wet.grid, COOKED_MEAT);
  run(wet.sim, wet.grid, 440 * HZ);
  check(
    '…그냥 익히기만 한 고기는 그대로 썩는다 (대조군)',
    count(wet.grid, COOKED_MEAT) === 0,
    `${wetBefore} → ${count(wet.grid, COOKED_MEAT)} 익은 고기`,
  );
}

// ── 7. 곰팡이는 아무것도 파괴하지 않는다 ─────────────────────────────────────
// The requirement the material was designed around. Four containers, each sealed
// around rotting food, run for a long time: every wall cell must still be there.
{
  for (const [wall, label] of [
    [STONE, '돌'],
    [GLASS, '유리'],
    [IRON, '철'],
    [WOOD, '나무'],
  ] as const) {
    reseed();
    const { grid, sim } = makeWorld();
    box(grid, 12, 12, 12, wall);
    const wallBefore = count(grid, wall);
    fill(grid, 14, 20, 21, 23, RAW_MEAT); // a good pile, plenty of empty air around it
    run(sim, grid, 600 * HZ);
    check(
      `곰팡이가 ${label} 벽을 갉아먹지 않는다`,
      count(grid, wall) === wallBefore,
      `${count(grid, wall)} of ${wallBefore} wall cells, ${count(grid, MOLD)} 곰팡이 grown`,
    );
  }

  // And it did actually grow — a "nothing was destroyed" check passes trivially if
  // no mold ever appeared, so this is the half that makes the four above mean
  // something.
  reseed();
  const { grid, sim } = makeWorld();
  box(grid, 12, 12, 12, STONE);
  fill(grid, 14, 20, 21, 23, RAW_MEAT);
  run(sim, grid, 300 * HZ);
  check(
    '…곰팡이는 실제로 폈다 (위 네 검사의 전제)',
    count(grid, MOLD) > 0,
    `${count(grid, MOLD)} 곰팡이 cells`,
  );
}

// ── 8. 곰팡이는 표면 한 겹이다 ───────────────────────────────────────────────
// It films rather than fills. Stated as an invariant every colony cell must hold:
// each one touches at least one non-mold solid or powder. If mold ever counted as
// its own support this fails on the first cell that grew out into open air.
{
  reseed();
  const { grid, sim } = makeWorld(50, 36);
  box(grid, 10, 6, 30, STONE);
  fill(grid, 14, 26, 41, 29, RAW_MEAT); // a long shelf of it, lots of open air above
  run(sim, grid, 900 * HZ);
  const molds: { x: number; y: number }[] = [];
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++)
      if (grid.cells[grid.idx(x, y)] === MOLD) molds.push({ x, y });
  let floating = 0;
  for (const { x, y } of molds) {
    let supported = false;
    for (let dy = -1; dy <= 1 && !supported; dy++)
      for (let dx = -1; dx <= 1 && !supported; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        const id = grid.cells[grid.idx(nx, ny)];
        if (id === EMPTY || id === MOLD) continue;
        const ph = getMaterial(id).phase;
        if (ph === 1 || ph === 2) supported = true; // Phase.Solid / Phase.Powder
      }
    if (!supported) floating++;
  }
  check(
    '곰팡이는 붙을 데가 있어야만 자란다 — 공중에 뜬 칸이 없다',
    molds.length > 0 && floating === 0,
    `${molds.length} 곰팡이, ${floating} unsupported`,
  );
}

// ── 9. 물속에는 안 핀다 ──────────────────────────────────────────────────────
// Mostly no rule of its own — a submerged surface has no empty cells against it,
// so the film rule keeps mold out of the water for free — plus `isDrowned`
// (mold.ts) for the one hole that leaves, which is that rot rising through a
// liquid leaves bubbles behind it.
//
// Measured as flooding-versus-not on the same box, because two stricter drafts
// both failed by measuring the wrong thing and the pair is worth recording. An
// open tank grows mold at the waterline: 부패물 floats (density 2.9 against
// Water's 3) and surfaces as scum, and scum has air above it. Sealing the tank
// brim-full does not make it airless either — a Powder rising through water
// absorbs a water cell into its 겹침 slot and leaves an empty behind (two cells
// become one), and the pocket collects under the lid. Neither is the rule
// breaking; both are "submerged" being the wrong word for what was counted. Water
// is a real defence rather than a total one, so that is what gets asserted.
{
  reseed();
  const wet = makeWorld();
  box(wet.grid, 12, 12, 14, STONE); // interior y = 12..25
  fill(wet.grid, 12, 12, 25, 25, WATER); // filled to the lid
  fill(wet.grid, 16, 22, 21, 24, RAW_MEAT); // sunk at the bottom
  run(wet.sim, wet.grid, 400 * HZ);
  const wetMold = count(wet.grid, MOLD);

  reseed();
  const dry = makeWorld();
  box(dry.grid, 12, 12, 14, STONE);
  fill(dry.grid, 16, 22, 21, 24, RAW_MEAT); // same box, same shelf, air instead
  run(dry.sim, dry.grid, 400 * HZ);
  const dryMold = count(dry.grid, MOLD);

  check(
    '물에 잠기면 곰팡이가 거의 안 핀다 — 물이 방어다',
    wetMold * 2 < dryMold,
    `flooded ${wetMold} vs dry ${dryMold} 곰팡이 in the same box`,
  );
  check(
    '…마른 쪽은 제대로 폈다 (위 비교의 전제)',
    dryMold > 0,
    `${dryMold} 곰팡이 in the dry version`,
  );
}

// ── 10. 곰팡이가 전염 경로다 ─────────────────────────────────────────────────
// "창고에 하나 썩으면 다 썩는다" is not a food-to-food rule; it is mold creeping
// along the outside of a stack and the stack rotting faster under it. Measured as
// the same stack with and without room for mold to grow: the open one must go over
// markedly sooner than the one packed in so tightly there is nowhere to film.
{
  // A single row, so *every* cell has a face mold can film and the effect is the
  // whole population rather than a rim of it. A thick block buries most of its
  // cells where no film reaches them, which buries the measurement too — the
  // first draft of this scene was a 2×24 slab and came out at 13 vs 35, a margin
  // thin enough to flip on the seed. Bread because it is the slowest spoiler, so
  // a 3× difference has the most room to show.
  const SLAB = { x0: 4, y0: 26, x1: 35, y1: 26 } as const;

  reseed();
  const open = makeWorld(40, 30);
  fill(open.grid, 0, 27, 39, 29, STONE); // a floor, air everywhere above
  fill(open.grid, SLAB.x0, SLAB.y0, SLAB.x1, SLAB.y1, BREAD);

  reseed();
  const packed = makeWorld(40, 30);
  // The same row with stone laid tight against every face, so there is no empty
  // neighbour anywhere for a spore to land in. Same cell count, same clock; the
  // only difference is whether mold has anywhere to grow.
  fill(packed.grid, SLAB.x0 - 1, SLAB.y0 - 1, SLAB.x1 + 1, SLAB.y1 + 1, STONE);
  fill(packed.grid, SLAB.x0, SLAB.y0, SLAB.x1, SLAB.y1, BREAD);

  const before = count(open.grid, BREAD);
  run(open.sim, open.grid, 200 * HZ);
  run(packed.sim, packed.grid, 200 * HZ);
  const openLeft = count(open.grid, BREAD);
  const packedLeft = count(packed.grid, BREAD);
  check(
    '곰팡이가 핀 쪽이 훨씬 빨리 상한다 — 전염은 곰팡이를 타고 간다',
    count(open.grid, MOLD) > 0 && openLeft === 0 && packedLeft > 0,
    `open ${openLeft} vs sealed ${packedLeft} of ${before} left at 200s ` +
      `(${count(open.grid, MOLD)} 곰팡이 vs ${count(packed.grid, MOLD)})`,
  );
}

// ── 11. 곰팡이를 죽이는 법 ───────────────────────────────────────────────────
{
  for (const [t, label] of [
    [80, '60℃ 위로 익히면'],
    [-10, '0℃ 아래로 얼리면'],
  ] as const) {
    reseed();
    const { grid, sim } = makeWorld();
    fill(grid, 0, 22, 39, 24, STONE);
    fill(grid, 10, 20, 29, 21, MOLD);
    const before = count(grid, MOLD);
    run(sim, grid, 5 * HZ, { x0: 0, y0: 18, x1: 39, y1: 24, t });
    check(`${label} 곰팡이가 죽는다`, count(grid, MOLD) === 0, `${before} → ${count(grid, MOLD)}`);
  }

  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 22, 39, 24, STONE);
  fill(grid, 10, 21, 29, 21, MOLD);
  fill(grid, 10, 20, 29, 20, ALCOHOL); // poured straight on
  const before = count(grid, MOLD);
  run(sim, grid, 5 * HZ);
  check(
    '알콜을 부으면 곰팡이가 죽는다',
    count(grid, MOLD) === 0,
    `${before} → ${count(grid, MOLD)}`,
  );
}

// ── 12. 부패물 — 태우면 재, 얼리면 그대로 ────────────────────────────────────
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 25, 39, 27, STONE);
  fill(grid, 10, 23, 29, 24, SPOILED);
  const before = count(grid, SPOILED);
  run(sim, grid, 5 * HZ, { x0: 9, y0: 22, x1: 30, y1: 25, t: 400 });
  check(
    '부패물은 250℃가 넘으면 재가 된다',
    count(grid, SPOILED) === 0 && count(grid, ASH) === before,
    `${before} 부패물 → ${count(grid, ASH)} 재`,
  );

  reseed();
  const cold = makeWorld();
  fill(cold.grid, 0, 25, 39, 27, STONE);
  fill(cold.grid, 10, 23, 29, 24, SPOILED);
  const coldBefore = count(cold.grid, SPOILED);
  run(cold.sim, cold.grid, 600 * HZ, { x0: 0, y0: 0, x1: 39, y1: 29, t: -10 });
  check(
    '얼려 두면 부패물인 채로 멈춘다 — 퇴비도 공짜가 아니다',
    count(cold.grid, SPOILED) === coldBefore,
    `${count(cold.grid, SPOILED)} of ${coldBefore} left after 600s frozen`,
  );
}

// ── 13. 죽은 물고기는 사라지지 않고 썩는다 ───────────────────────────────────
// The one existing behaviour this round changed. A corpse used to vanish; now its
// mass stays in the world and ends up as soil.
{
  reseed();
  const { grid, sim } = makeWorld();
  fill(grid, 0, 26, 39, 29, STONE);
  fill(grid, 8, 24, 31, 25, DEAD_FISH);
  const before = count(grid, DEAD_FISH);
  run(sim, grid, 600 * HZ);
  check(
    '사체는 삭아 없어지는 게 아니라 썩어서 남는다',
    count(grid, DEAD_FISH) === 0 &&
      count(grid, SPOILED) + count(grid, COMPOST) === before,
    `${before} 사체 → ${count(grid, SPOILED)} 부패물 + ${count(grid, COMPOST)} 퇴비`,
  );
}

// ── 14. 퇴비는 밭이다 ────────────────────────────────────────────────────────
{
  // 14a. A seed germinates on it, exactly as it does on dirt.
  reseed();
  const { grid, sim } = makeWorld(40, 30);
  fill(grid, 0, 20, 39, 29, COMPOST);
  fill(grid, 0, 26, 39, 27, WATER); // a water table under the bed
  put(grid, 20, 19, SEED);
  run(sim, grid, 60 * HZ);
  check(
    '퇴비 위에 심은 씨앗도 싹이 튼다',
    count(grid, PLANT) > 0,
    `${count(grid, PLANT)} 식물 cells`,
  );

  // 14b. The payoff. Same watering, same clock, same everything but the bed — and
  // the compost plot has to grow more.
  //
  // Two things about the scene are load-bearing and were both learned by getting
  // them wrong. **The water is poured on top**, not buried inside the bed: a layer
  // of standing water sandwiched in a powder bed churns (the grains sink through
  // it and it wells back up), and compost churns differently from dirt because
  // dirt drinks a touching Water cell and becomes Mud while compost deliberately
  // does not — so the scene was comparing two different disturbances rather than
  // two soils. **And it sows six plants per bed, not one.** The L-system's
  // run-to-run spread is enormous; a single plant per side flipped the result
  // outright on one seed in six. Six plants average it down to a margin that holds
  // on every seed tried.
  const grow = (bed: number): number => {
    reseed();
    const { grid: g, sim: s } = makeWorld(80, 60);
    fill(g, 0, 55, 79, 59, STONE); // floor
    fill(g, 0, 48, 79, 54, bed); // the plot
    fill(g, 0, 45, 79, 47, WATER); // watered from above, soaks down and drains
    run(s, g, 60 * HZ); // let it drain before anything is sown
    for (let x = 8; x < 80; x += 14) put(g, x, 47, SEED);
    run(s, g, 600 * HZ);
    return count(g, PLANT);
  };
  const onCompost = grow(COMPOST);
  const onDirt = grow(DIRT);
  check(
    '퇴비 밭에서는 같은 물로 훨씬 무성하게 자란다',
    onCompost > onDirt,
    `퇴비 ${onCompost}칸 vs 흙 ${onDirt}칸 after 600s (6 plants each)`,
  );
}

console.log(failures === 0 ? '\nAll 부패 checks passed.' : `\n${failures} check(s) FAILED.`);
if (failures > 0) process.exit(1);
